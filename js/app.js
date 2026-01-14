let scannedDocs = [];
let currentRawImg = null;
let currentEditIndex = -1;

// Define the 4 corners for the crop (Default values)
let handlePoints = [
    {x: 50, y: 50},   // Top-Left
    {x: 250, y: 50},  // Top-Right
    {x: 250, y: 350}, // Bottom-Right
    {x: 50, y: 350}   // Bottom-Left
];

const video = document.getElementById('video-feed');
const freezeLayer = document.getElementById('freeze-layer');
const statusMsg = document.getElementById('status-msg');
const scanCount = document.getElementById('scan-count');
const lastScanImg = document.getElementById('last-scan-img');

// --- 1. INITIALIZATION ---
async function init() {
    try {
        // Request camera with high resolution
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
        statusMsg.innerText = "Camera Error";
        statusMsg.style.background = "rgba(255, 0, 0, 0.4)";
        alert("Camera access denied. Please check your browser permissions.");
    }
}

// --- 2. CAPTURE & CROP FLOW ---
const captureBtn = document.getElementById('capture-btn');
if (captureBtn) {
    captureBtn.addEventListener('click', () => {
        // Flash Effect
        video.style.opacity = "0.5";
        setTimeout(() => video.style.opacity = "1", 100);

        // Capture to hidden canvas
        const hidden = document.getElementById('hidden-canvas');
        if (!hidden) return; // Safety check
        
        hidden.width = video.videoWidth;
        hidden.height = video.videoHeight;
        const ctx = hidden.getContext('2d');
        ctx.drawImage(video, 0, 0);
        
        // Save raw data
        currentRawImg = hidden.toDataURL('image/jpeg', 0.85);

        // Open Crop Modal
        prepareCropModal(currentRawImg);
    });
}

function prepareCropModal(imgSrc) {
    const modal = document.getElementById('crop-modal');
    const c = document.getElementById('crop-canvas');
    if (!modal || !c) return;

    const ctx = c.getContext('2d');
    const img = new Image();

    img.onload = () => {
        // Calculate aspect ratio to fit screen
        const maxWidth = window.innerWidth * 0.9;
        const scaleFactor = maxWidth / img.width;
        
        c.width = maxWidth;
        c.height = img.height * scaleFactor;
        
        ctx.drawImage(img, 0, 0, c.width, c.height);
        
        modal.style.display = 'flex';
        
        // Reset handles to corners
        resetHandles(c.width, c.height);
    };
    img.src = imgSrc;
}

function resetHandles(w, h) {
    const handles = document.querySelectorAll('.crop-handle');
    // Default positions: 20px padding from edges
    const positions = [
        {x: 20, y: 20},       // TL
        {x: w - 20, y: 20},   // TR
        {x: w - 20, y: h - 20}, // BR
        {x: 20, y: h - 20}    // BL
    ];

    handles.forEach((h, i) => {
        h.style.left = positions[i].x + 'px';
        h.style.top = positions[i].y + 'px';
        
        // Enable Touch Dragging
        makeDraggable(h);
    });
}

function makeDraggable(el) {
    let isDragging = false;
    
    // Touch Events (Mobile)
    el.ontouchstart = (e) => { isDragging = true; e.preventDefault(); };
    el.ontouchmove = (e) => {
        if (!isDragging) return;
        const touch = e.touches[0];
        moveElement(el, touch.clientX, touch.clientY);
    };
    el.ontouchend = () => { isDragging = false; };

    // Mouse Events (Desktop)
    el.onmousedown = () => { isDragging = true; };
    window.onmousemove = (e) => {
        if (!isDragging) return;
        moveElement(el, e.clientX, e.clientY);
    };
    window.onmouseup = () => { isDragging = false; };
}

function moveElement(el, clientX, clientY) {
    const container = document.getElementById('crop-ui-container');
    const rect = container.getBoundingClientRect();
    
    // Calculate position relative to the container
    let x = clientX - rect.left;
    let y = clientY - rect.top;
    
    el.style.left = x + 'px';
    el.style.top = y + 'px';
}

// --- 3. THE "WARP & KEEP" BUTTON ---
const doneBtn = document.getElementById('done-crop');
if (doneBtn) {
    doneBtn.addEventListener('click', () => {
        // 1. Close Modal Immediately to unfreeze UI
        document.getElementById('crop-modal').style.display = 'none';

        // 2. Run Save & Animation
        saveScan(currentRawImg);
    });
}

function saveScan(imgData) {
    scannedDocs.push(imgData);

    // Update Freeze Layer (Animation)
    if (freezeLayer) {
        freezeLayer.style.backgroundImage = `url(${imgData})`;
        freezeLayer.style.display = 'block';
        
        // Trigger Reflow
        void freezeLayer.offsetWidth;
        
        freezeLayer.classList.add('fly-to-corner');

        // Hide after animation
        setTimeout(() => {
            freezeLayer.style.display = 'none';
            freezeLayer.classList.remove('fly-to-corner');
            updateGalleryIcon();
        }, 700);
    } else {
        updateGalleryIcon();
    }
}

function updateGalleryIcon() {
    if (scannedDocs.length > 0) {
        lastScanImg.src = scannedDocs[scannedDocs.length - 1];
        lastScanImg.style.display = 'block';
        scanCount.innerText = scannedDocs.length;
    }
}

// --- 4. CANCEL / RETAKE ---
const cancelBtn = document.getElementById('cancel-crop');
if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
        document.getElementById('crop-modal').style.display = 'none';
    });
}

// --- 5. GALLERY & EDITOR ---
const galleryTrigger = document.getElementById('gallery-trigger');
if (galleryTrigger) {
    galleryTrigger.addEventListener('click', () => {
        if(scannedDocs.length === 0) return;
        renderGallery();
        document.getElementById('gallery-modal').style.display = 'flex';
    });
}

function renderGallery() {
    const grid = document.getElementById('gallery-grid');
    grid.innerHTML = '';
    scannedDocs.forEach((doc, index) => {
        const img = document.createElement('img');
        img.src = doc;
        img.onclick = () => openEditor(index);
        grid.appendChild(img);
    });
}

// Close Buttons
document.getElementById('close-gallery').onclick = () => document.getElementById('gallery-modal').style.display = 'none';

// Start
window.onload = init;
