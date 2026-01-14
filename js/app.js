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

// --- 1. INITIALIZATION ---
async function init() {
    // A. Start Camera
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

    // B. Attach ALL Button Listeners (Moved here to ensure they exist)
    attachEventListeners();
}

function attachEventListeners() {
    // Capture
    document.getElementById('capture-btn').onclick = captureImage;
    
    // Crop Modal Actions
    document.getElementById('done-crop').onclick = finishCrop;
    document.getElementById('cancel-crop').onclick = () => toggleModal('crop-modal', false);

    // Gallery Actions
    document.getElementById('gallery-trigger').onclick = openGallery;
    document.getElementById('close-gallery').onclick = () => toggleModal('gallery-modal', false);

    // Editor Actions
    document.getElementById('close-editor').onclick = () => toggleModal('editor-modal', false);
    document.getElementById('delete-page-btn').onclick = deleteCurrentPage;

    // Settings Actions
    document.getElementById('settings-btn').onclick = () => toggleModal('settings-modal', true);
    document.getElementById('close-settings').onclick = () => toggleModal('settings-modal', false);
}

// --- 2. HELPER: TOGGLE MODALS ---
function toggleModal(modalId, show) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = show ? 'flex' : 'none';
    }
}

// --- 3. CAPTURE & CROP ---
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
    const c = document.getElementById('crop-canvas');
    const ctx = c.getContext('2d');
    const img = new Image();

    img.onload = () => {
        // Scale image to fit 90% of screen width
        const maxWidth = window.innerWidth * 0.9;
        const scale = maxWidth / img.width;
        
        c.width = maxWidth;
        c.height = img.height * scale;
        
        ctx.drawImage(img, 0, 0, c.width, c.height);
        
        toggleModal('crop-modal', true);
        
        // Initialize Handles
        setupHandles(c.width, c.height);
    };
    img.src = imgSrc;
}

// --- 4. DRAGGABLE HANDLES (FIXED FOR DESKTOP & MOBILE) ---
function setupHandles(w, h) {
    const handles = document.querySelectorAll('.crop-handle');
    const container = document.getElementById('crop-ui-container');
    
    // Default Positions (Corners with padding)
    const padding = 20;
    const positions = [
        {x: padding, y: padding},         // TL
        {x: w - padding, y: padding},     // TR
        {x: w - padding, y: h - padding}, // BR
        {x: padding, y: h - padding}      // BL
    ];

    handles.forEach((handle, i) => {
        // Set Initial Position
        handle.style.left = positions[i].x + 'px';
        handle.style.top = positions[i].y + 'px';

        // MOUSE EVENTS (Desktop)
        handle.onmousedown = (e) => startDrag(e, handle, container, false);
        
        // TOUCH EVENTS (Mobile)
        handle.ontouchstart = (e) => startDrag(e, handle, container, true);
    });
}

function startDrag(e, handle, container, isTouch) {
    e.preventDefault(); // Stop text selection/scrolling
    
    // 1. Get container offset ONCE at start of drag
    const rect = container.getBoundingClientRect();

    function move(event) {
        event.preventDefault();
        
        // Get pointer coordinates (Mouse or Touch)
        const clientX = isTouch ? event.touches[0].clientX : event.clientX;
        const clientY = isTouch ? event.touches[0].clientY : event.clientY;

        // 2. Calculate local position relative to container
        let x = clientX - rect.left;
        let y = clientY - rect.top;

        // 3. Apply to handle
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

    // Attach listeners to DOCUMENT (so you can drag outside the handle and it still works)
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

    // Animation Logic
    freezeLayer.style.backgroundImage = `url(${imgData})`;
    freezeLayer.style.display = 'block';
    
    // Force Reflow
    void freezeLayer.offsetWidth;
    
    freezeLayer.classList.add('fly-to-corner');

    setTimeout(() => {
        freezeLayer.style.display = 'none';
        freezeLayer.classList.remove('fly-to-corner');
        
        // Update Thumbnail
        lastScanImg.src = imgData;
        lastScanImg.style.display = 'block';
        scanCount.innerText = scannedDocs.length;
    }, 700);
}

// --- 6. GALLERY & EDITOR LOGIC ---
function openGallery() {
    if (scannedDocs.length === 0) return;
    
    const grid = document.getElementById('gallery-grid');
    grid.innerHTML = ''; // Clear previous
    
    scannedDocs.forEach((doc, index) => {
        const img = document.createElement('img');
        img.src = doc;
        img.onclick = () => openEditor(index); // Click thumb to open editor
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
        
        // Refresh Gallery or Close it if empty
        if (scannedDocs.length > 0) {
            openGallery(); // Refresh grid
            // Update main screen thumbnail
            lastScanImg.src = scannedDocs[scannedDocs.length - 1];
            scanCount.innerText = scannedDocs.length;
        } else {
            toggleModal('gallery-modal', false);
            lastScanImg.style.display = 'none';
            scanCount.innerText = '0';
        }
    }
}

// Start App
window.onload = init;
