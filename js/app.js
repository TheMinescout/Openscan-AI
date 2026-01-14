// --- STATE MANAGEMENT ---
let scannedDocs = [];
let currentRawImg = null;
let currentEditIndex = -1;

// DOM Elements
const video = document.getElementById('video-feed');
const freezeLayer = document.getElementById('freeze-layer');
const statusMsg = document.getElementById('status-msg');
const scanCount = document.getElementById('scan-count');
const lastScanImg = document.getElementById('last-scan-img');

// --- 1. STARTUP LOGIC ---
window.onload = function() {
    // A. Start Camera immediately
    startCamera();

    // B. Activate Buttons immediately (Fixes "Settings won't open")
    setupButtons();
};

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
        console.error("Camera Error:", e);
        statusMsg.innerText = "Camera Denied";
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

    // Settings (Fixing the specific issue you mentioned)
    document.getElementById('settings-btn').onclick = () => {
        toggleModal('settings-modal', true);
    };
    document.getElementById('close-settings').onclick = () => toggleModal('settings-modal', false);
}

// --- 2. MODAL HELPER ---
function toggleModal(modalId, show) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = show ? 'flex' : 'none';
    } else {
        console.error(`Modal #${modalId} not found in HTML!`);
    }
}

// --- 3. CAPTURE & SMART CROP ---
function captureImage() {
    // Flash Effect
    video.style.opacity = "0.5";
    setTimeout(() => video.style.opacity = "1", 100);

    const hidden = document.getElementById('hidden-canvas');
    hidden.width = video.videoWidth;
    hidden.height = video.videoHeight;
    const ctx = hidden.getContext('2d');
    ctx.drawImage(video, 0, 0);
    
    currentRawImg = hidden.toDataURL('image/jpeg', 0.85);
    prepareCropModal(currentRawImg);
}

function prepareCropModal(imgSrc) {
    const modal = document.getElementById('crop-modal');
    const container = document.getElementById('crop-ui-container'); // We resize this div!
    const c = document.getElementById('crop-canvas');
    const ctx = c.getContext('2d');
    const img = new Image();

    img.onload = () => {
        // 1. Calculate Available Screen Space (leaving room for header)
        const maxW = window.innerWidth * 0.95;
        const maxH = (window.innerHeight - 80) * 0.95; // Subtract 80px for header buttons

        // 2. Calculate "Contain" Ratio (Fits BOTH width and height)
        const scale = Math.min(maxW / img.width, maxH / img.height);
        
        const finalW = img.width * scale;
        const finalH = img.height * scale;
        
        // 3. Set Canvas Size
        c.width = finalW;
        c.height = finalH;
        ctx.drawImage(img, 0, 0, finalW, finalH);
        
        // 4. CRITICAL FIX: Resize the Container to match the Canvas exactly.
        // This forces the "0,0" coordinate of the container to match the image.
        container.style.width = finalW + "px";
        container.style.height = finalH + "px";

        toggleModal('crop-modal', true);
        
        // 5. Place Handles
        setupHandles(finalW, finalH);
    };
    img.src = imgSrc;
}

// --- 4. DRAGGABLE HANDLES (FIXED) ---
function setupHandles(w, h) {
    const handles = document.querySelectorAll('.crop-handle');
    const container = document.getElementById('crop-ui-container');
    
    // Default Positions (Corners with padding)
    const padding = 20;
    const positions = [
        {x: padding, y: padding},         // Top-Left
        {x: w - padding, y: padding},     // Top-Right
        {x: w - padding, y: h - padding}, // Bottom-Right
        {x: padding, y: h - padding}      // Bottom-Left
    ];

    handles.forEach((handle, i) => {
        // Position handle
        handle.style.left = positions[i].x + 'px';
        handle.style.top = positions[i].y + 'px';

        // Clear old listeners to prevent stacking
        handle.onmousedown = null;
        handle.ontouchstart = null;

        // Attach new listeners
        handle.onmousedown = (e) => startDrag(e, handle, container, false);
        handle.ontouchstart = (e) => startDrag(e, handle, container, true);
    });
}

function startDrag(e, handle, container, isTouch) {
    e.preventDefault(); 
    
    // 1. Get container offset ONCE at start
    const rect = container.getBoundingClientRect();

    function move(event) {
        // Get pointer coordinates
        const clientX = isTouch ? event.touches[0].clientX : event.clientX;
        const clientY = isTouch ? event.touches[0].clientY : event.clientY;

        // 2. Calculate local position relative to container
        let x = clientX - rect.left;
        let y = clientY - rect.top;

        // 3. Update handle
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

    // Attach to document to prevent "losing" the handle if moving fast
    if (isTouch) {
        document.ontouchmove = move;
        document.ontouchend = stop;
    } else {
        document.onmousemove = move;
        document.onmouseup = stop;
    }
}

// --- 5. FINISH & ANIMATE ---
function finishCrop() {
    toggleModal('crop-modal', false);
    saveScan(currentRawImg);
}

function saveScan(imgData) {
    scannedDocs.push(imgData);

    // Animation
    freezeLayer.style.backgroundImage = `url(${imgData})`;
    freezeLayer.style.display = 'block';
    void freezeLayer.offsetWidth; // Force Reflow
    freezeLayer.classList.add('fly-to-corner');

    setTimeout(() => {
        freezeLayer.style.display = 'none';
        freezeLayer.classList.remove('fly-to-corner');
        
        lastScanImg.src = imgData;
        lastScanImg.style.display = 'block';
        scanCount.innerText = scannedDocs.length;
    }, 700);
}

// --- 6. GALLERY & EDITOR ---
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
