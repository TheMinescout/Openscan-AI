// --- STATE MANAGEMENT ---
let scannedDocs = [];
let currentRawImg = null; // The full resolution original
let currentEditIndex = -1;

// DOM Elements
const video = document.getElementById('video-feed');
const freezeLayer = document.getElementById('freeze-layer');
const statusMsg = document.getElementById('status-msg');
const scanCount = document.getElementById('scan-count');
const lastScanImg = document.getElementById('last-scan-img');

// --- 1. STARTUP LOGIC ---
// We use 'DOMContentLoaded' to wire up buttons instantly, before images load.
document.addEventListener('DOMContentLoaded', () => {
    setupButtons();
    startCamera();
});

async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                facingMode: "environment", 
                width: { ideal: 1920 }, 
                height: { ideal: 1080 } 
            },
            audio: false
        });
        video.srcObject = stream;
        video.onloadedmetadata = () => {
            video.play();
            statusMsg.innerText = "Ready";
            statusMsg.style.background = "rgba(0, 200, 0, 0.4)";
        };
    } catch (e) {
        console.error("Camera Error:", e);
        statusMsg.innerText = "Check Camera Permissions";
        statusMsg.style.background = "rgba(255, 0, 0, 0.4)";
    }
}

function setupButtons() {
    // Capture
    const capBtn = document.getElementById('capture-btn');
    if (capBtn) capBtn.onclick = captureImage;

    // Crop Modal
    document.getElementById('done-crop').onclick = finishCrop;
    document.getElementById('cancel-crop').onclick = () => toggleModal('crop-modal', false);

    // Gallery & Editor
    document.getElementById('gallery-trigger').onclick = openGallery;
    document.getElementById('close-gallery').onclick = () => toggleModal('gallery-modal', false);
    document.getElementById('close-editor').onclick = () => toggleModal('editor-modal', false);
    document.getElementById('delete-page-btn').onclick = deleteCurrentPage;

    // Settings
    document.getElementById('settings-btn').onclick = () => toggleModal('settings-modal', true);
    document.getElementById('close-settings').onclick = () => toggleModal('settings-modal', false);
}

function toggleModal(modalId, show) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = show ? 'flex' : 'none';
    }
}

// --- 2. CAPTURE & SMART CROP ---
function captureImage() {
    // Visual flash
    video.style.opacity = "0.5";
    setTimeout(() => video.style.opacity = "1", 100);

    const hidden = document.getElementById('hidden-canvas');
    hidden.width = video.videoWidth;
    hidden.height = video.videoHeight;
    const ctx = hidden.getContext('2d');
    
    // Draw full video frame to hidden canvas
    ctx.drawImage(video, 0, 0);
    
    // Save the FULL RES image for cropping later
    currentRawImg = hidden.toDataURL('image/jpeg', 0.9);
    
    prepareCropModal(currentRawImg);
}

function prepareCropModal(imgSrc) {
    const modal = document.getElementById('crop-modal');
    const container = document.getElementById('crop-ui-container');
    const c = document.getElementById('crop-canvas');
    const ctx = c.getContext('2d');
    const img = new Image();

    img.onload = () => {
        // Fit canvas to screen
        const maxW = window.innerWidth * 0.95;
        const maxH = (window.innerHeight - 80) * 0.95;
        const scale = Math.min(maxW / img.width, maxH / img.height);
        
        const finalW = img.width * scale;
        const finalH = img.height * scale;
        
        c.width = finalW;
        c.height = finalH;
        ctx.drawImage(img, 0, 0, finalW, finalH);
        
        // Resize container to match image exactly
        container.style.width = finalW + "px";
        container.style.height = finalH + "px";
        
        // Store the scale factor so we can crop the original later
        container.dataset.scale = scale;

        toggleModal('crop-modal', true);
        setupHandles(finalW, finalH);
    };
    img.src = imgSrc;
}

// --- 3. DRAGGABLE HANDLES ---
function setupHandles(w, h) {
    const handles = document.querySelectorAll('.crop-handle');
    const container = document.getElementById('crop-ui-container');
    const padding = 20;
    
    // Initial Corner Positions
    const positions = [
        {x: padding, y: padding},
        {x: w - padding, y: padding},
        {x: w - padding, y: h - padding},
        {x: padding, y: h - padding}
    ];

    handles.forEach((handle, i) => {
        handle.style.left = positions[i].x + 'px';
        handle.style.top = positions[i].y + 'px';
        
        // Clear old listeners
        handle.onmousedown = null;
        handle.ontouchstart = null;

        // Add new listeners
        handle.onmousedown = (e) => startDrag(e, handle, container, false);
        handle.ontouchstart = (e) => startDrag(e, handle, container, true);
    });
}

function startDrag(e, handle, container, isTouch) {
    e.preventDefault(); 
    const rect = container.getBoundingClientRect();

    function move(event) {
        event.preventDefault();
        const clientX = isTouch ? event.touches[0].clientX : event.clientX;
        const clientY = isTouch ? event.touches[0].clientY : event.clientY;

        let x = clientX - rect.left;
        let y = clientY - rect.top;

        // Boundary Checks (Keep inside image)
        x = Math.max(0, Math.min(x, container.offsetWidth));
        y = Math.max(0, Math.min(y, container.offsetHeight));

        handle.style.left = x + 'px';
        handle.style.top = y + 'px';
    }

    function stop() {
        if (isTouch) {
            document.ontouchmove = null;
            document.ontouchend = null;
        } else {
            document.onmousemove = null;
            document.onmouseup = null;
        }
    }

    if (isTouch) {
        document.ontouchmove = move;
        document.ontouchend = stop;
    } else {
        document.onmousemove = move;
        document.onmouseup = stop;
    }
}

// --- 4. THE ACTUAL "CROP" LOGIC ---
function finishCrop() {
    toggleModal('crop-modal', false);

    // 1. Get handle positions from UI
    const handles = document.querySelectorAll('.crop-handle');
    const container = document.getElementById('crop-ui-container');
    const scale = parseFloat(container.dataset.scale); // Get the scale factor used for preview

    // Get UI coordinates
    let x1 = parseFloat(handles[0].style.left);
    let y1 = parseFloat(handles[0].style.top);
    let x3 = parseFloat(handles[2].style.left); // Bottom-Right handle
    let y3 = parseFloat(handles[2].style.top);

    // 2. Scale coordinates back up to ORIGINAL image size
    // Note: This is a simple bounding box crop. 
    // For true perspective warp, we would need the OpenCV logic here.
    let realX = x1 / scale;
    let realY = y1 / scale;
    let realW = (x3 - x1) / scale;
    let realH = (y3 - y1) / scale;

    // 3. Crop using a temporary canvas
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = realW;
    tempCanvas.height = realH;
    const ctx = tempCanvas.getContext('2d');

    const originalImg = new Image();
    originalImg.onload = () => {
        // Draw only the sliced portion
        ctx.drawImage(originalImg, realX, realY, realW, realH, 0, 0, realW, realH);
        
        // Save result
        const finalCroppedData = tempCanvas.toDataURL('image/jpeg', 0.9);
        saveScan(finalCroppedData);
    };
    originalImg.src = currentRawImg;
}

function saveScan(imgData) {
    scannedDocs.push(imgData);

    // Animation
    freezeLayer.style.backgroundImage = `url(${imgData})`;
    freezeLayer.style.display = 'block';
    void freezeLayer.offsetWidth; 
    freezeLayer.classList.add('fly-to-corner');

    setTimeout(() => {
        freezeLayer.style.display = 'none';
        freezeLayer.classList.remove('fly-to-corner');
        
        lastScanImg.src = imgData;
        lastScanImg.style.display = 'block';
        scanCount.innerText = scannedDocs.length;
    }, 700);
}

// --- 5. GALLERY & EDITOR ---
function openGallery() {
    if (scannedDocs.length === 0) return;
    const grid = document.getElementById('gallery-grid');
    grid.innerHTML = '';
    scannedDocs.forEach((doc, index) => {
        const img = document.createElement('img');
        img.src = doc;
        img.onclick = () => openEditor(index);
        grid.appendChild(img);
    });
    toggleModal('gallery-modal', true);
}

function openEditor(index) {
    currentEditIndex = index;
    const editorImg = document.getElementById('editor-img');
    if (editorImg) {
        editorImg.src = scannedDocs[index];
        toggleModal('editor-modal', true);
    }
}

function deleteCurrentPage() {
    if (confirm("Delete this page?")) {
        scannedDocs.splice(currentEditIndex, 1);
        toggleModal('editor-modal', false);
        if (scannedDocs.length > 0) {
            openGallery(); 
            lastScanImg.src = scannedDocs[scannedDocs.length - 1];
            scanCount.innerText = scannedDocs.length;
        } else {
            toggleModal('gallery-modal', false);
            lastScanImg.style.display = 'none';
            scanCount.innerText = '0';
        }
    }
}
