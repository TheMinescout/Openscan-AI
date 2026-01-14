// --- STATE MANAGEMENT ---
let scannedDocs = [];
let currentRawImg = null; // High-res original
let previewImgObj = null; // The loaded image object for the crop preview
let currentEditIndex = -1;

// DOM Elements
const video = document.getElementById('video-feed');
const freezeLayer = document.getElementById('freeze-layer');
const statusMsg = document.getElementById('status-msg');
const scanCount = document.getElementById('scan-count');
const lastScanImg = document.getElementById('last-scan-img');
const uiLayer = document.querySelector('.ui-layer'); // The overlay buttons

// --- 1. STARTUP ---
document.addEventListener('DOMContentLoaded', () => {
    setupButtons();
    startCamera();
});

async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: false
        });
        video.srcObject = stream;
        video.onloadedmetadata = () => {
            video.play();
            statusMsg.innerText = "Ready";
            statusMsg.style.background = "rgba(0, 200, 0, 0.4)";
        };
    } catch (e) {
        console.error(e);
        statusMsg.innerText = "Check Permission";
        statusMsg.style.background = "rgba(255, 0, 0, 0.4)";
    }
}

function setupButtons() {
    document.getElementById('capture-btn').onclick = captureImage;
    document.getElementById('done-crop').onclick = finishCrop;
    document.getElementById('cancel-crop').onclick = () => toggleModal('crop-modal', false);

    document.getElementById('gallery-trigger').onclick = openGallery;
    document.getElementById('close-gallery').onclick = () => toggleModal('gallery-modal', false);
    
    document.getElementById('close-editor').onclick = () => toggleModal('editor-modal', false);
    document.getElementById('delete-page-btn').onclick = deleteCurrentPage;

    document.getElementById('settings-btn').onclick = () => toggleModal('settings-modal', true);
    document.getElementById('close-settings').onclick = () => toggleModal('settings-modal', false);
}

// --- 2. VISIBILITY MANAGER ---
function toggleModal(modalId, show) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    if (show) {
        modal.style.display = 'flex';
        // HIDE the main camera buttons when a modal is open
        uiLayer.style.display = 'none';
    } else {
        modal.style.display = 'none';
        // SHOW the main camera buttons when going back to camera
        uiLayer.style.display = 'flex';
    }
}

// --- 3. CAPTURE & PREPARE ---
function captureImage() {
    // Flash
    video.style.opacity = "0.5";
    setTimeout(() => video.style.opacity = "1", 100);

    const hidden = document.getElementById('hidden-canvas');
    hidden.width = video.videoWidth;
    hidden.height = video.videoHeight;
    const ctx = hidden.getContext('2d');
    ctx.drawImage(video, 0, 0);
    
    currentRawImg = hidden.toDataURL('image/jpeg', 0.9);
    prepareCropModal(currentRawImg);
}

function prepareCropModal(imgSrc) {
    const container = document.getElementById('crop-ui-container');
    const c = document.getElementById('crop-canvas');
    previewImgObj = new Image();

    previewImgObj.onload = () => {
        // Fit to screen logic
        const maxW = window.innerWidth * 0.95;
        const maxH = (window.innerHeight - 80) * 0.95;
        const scale = Math.min(maxW / previewImgObj.width, maxH / previewImgObj.height);
        
        const finalW = previewImgObj.width * scale;
        const finalH = previewImgObj.height * scale;
        
        c.width = finalW;
        c.height = finalH;
        container.style.width = finalW + "px";
        container.style.height = finalH + "px";
        container.dataset.scale = scale;

        toggleModal('crop-modal', true);
        
        // Setup handles and Draw the first set of lines
        setupHandles(finalW, finalH);
        drawCropLines(); 
    };
    previewImgObj.src = imgSrc;
}

// --- 4. DRAWING & DRAGGING ---
function drawCropLines() {
    const c = document.getElementById('crop-canvas');
    const ctx = c.getContext('2d');
    const handles = document.querySelectorAll('.crop-handle');
    
    // 1. Clear and Redraw Image (Clean slate)
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(previewImgObj, 0, 0, c.width, c.height);

    // 2. Get handle centers
    // We add 16px (half of 32px width) to get center of handle
    const p1 = { x: parseFloat(handles[0].style.left) + 16, y: parseFloat(handles[0].style.top) + 16 };
    const p2 = { x: parseFloat(handles[1].style.left) + 16, y: parseFloat(handles[1].style.top) + 16 };
    const p3 = { x: parseFloat(handles[2].style.left) + 16, y: parseFloat(handles[2].style.top) + 16 };
    const p4 = { x: parseFloat(handles[3].style.left) + 16, y: parseFloat(handles[3].style.top) + 16 };

    // 3. Draw Blue Connecting Lines
    ctx.beginPath();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#007AFF'; // iOS Blue
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.lineTo(p4.x, p4.y);
    ctx.closePath(); // Connects p4 back to p1
    ctx.stroke();

    // Optional: Draw a semi-transparent fill inside
    ctx.fillStyle = "rgba(0, 122, 255, 0.1)";
    ctx.fill();
}

function setupHandles(w, h) {
    const handles = document.querySelectorAll('.crop-handle');
    const container = document.getElementById('crop-ui-container');
    const padding = 20;
    
    // Initial Positions
    const positions = [
        {x: padding, y: padding},
        {x: w - padding, y: padding},
        {x: w - padding, y: h - padding},
        {x: padding, y: h - padding}
    ];

    handles.forEach((handle, i) => {
        // -16 centers the handle (32px / 2)
        handle.style.left = (positions[i].x - 16) + 'px';
        handle.style.top = (positions[i].y - 16) + 'px';
        
        handle.onmousedown = null; handle.ontouchstart = null;
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

        let x = clientX - rect.left - 16; // -16 to center drag on finger
        let y = clientY - rect.top - 16;

        // Bounds check
        x = Math.max(-16, Math.min(x, container.offsetWidth - 16));
        y = Math.max(-16, Math.min(y, container.offsetHeight - 16));

        handle.style.left = x + 'px';
        handle.style.top = y + 'px';

        // REDRAW LINES ON EVERY MOVE
        requestAnimationFrame(drawCropLines);
    }

    function stop() {
        if (isTouch) { document.ontouchmove = null; document.ontouchend = null; }
        else { document.onmousemove = null; document.onmouseup = null; }
    }

    if (isTouch) { document.ontouchmove = move; document.ontouchend = stop; }
    else { document.onmousemove = move; document.onmouseup = stop; }
}

// --- 5. FINISH CROP ---
function finishCrop() {
    toggleModal('crop-modal', false);

    const handles = document.querySelectorAll('.crop-handle');
    const container = document.getElementById('crop-ui-container');
    const scale = parseFloat(container.dataset.scale);

    // Get positions (+16 to adjust for handle center)
    let x1 = (parseFloat(handles[0].style.left) + 16);
    let y1 = (parseFloat(handles[0].style.top) + 16);
    let x3 = (parseFloat(handles[2].style.left) + 16);
    let y3 = (parseFloat(handles[2].style.top) + 16);

    // Scale up
    let realX = x1 / scale;
    let realY = y1 / scale;
    let realW = (x3 - x1) / scale;
    let realH = (y3 - y1) / scale;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = realW;
    tempCanvas.height = realH;
    const ctx = tempCanvas.getContext('2d');

    const originalImg = new Image();
    originalImg.onload = () => {
        ctx.drawImage(originalImg, realX, realY, realW, realH, 0, 0, realW, realH);
        saveScan(tempCanvas.toDataURL('image/jpeg', 0.9));
    };
    originalImg.src = currentRawImg;
}

function saveScan(imgData) {
    scannedDocs.push(imgData);
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

// --- 6. HELPERS ---
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
    document.getElementById('editor-img').src = scannedDocs[index];
    toggleModal('editor-modal', true);
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
