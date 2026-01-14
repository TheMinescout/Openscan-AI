let scannedDocs = []; // Stores all our images
let currentRawImg = null; // Stores the temp image before cropping
let currentEditIndex = -1; // Tracks which page we are editing
let handlePoints = [{x: 50, y: 50}, {x: 250, y: 50}, {x: 250, y: 350}, {x: 50, y: 350}];

// DOM Elements
const video = document.getElementById('video-feed');
const freezeLayer = document.getElementById('freeze-layer');
const statusMsg = document.getElementById('status-msg');
const scanCount = document.getElementById('scan-count');
const lastScanImg = document.getElementById('last-scan-img');

// --- 1. INITIALIZATION ---
async function init() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "environment", width: { ideal: 1920 } } 
        });
        video.srcObject = stream;
        video.onloadedmetadata = () => {
            statusMsg.innerText = "Ready";
            statusMsg.style.background = "rgba(0, 200, 0, 0.4)"; // Green pill
        };
    } catch (e) {
        statusMsg.innerText = "Camera Denied";
        statusMsg.style.background = "rgba(255, 0, 0, 0.4)";
    }
}

// --- 2. CAPTURE & CROP FLOW ---
document.getElementById('capture-btn').addEventListener('click', () => {
    // 1. Flash effect
    video.style.opacity = "0.5";
    setTimeout(() => video.style.opacity = "1", 100);

    // 2. Capture frame to hidden canvas
    const hidden = document.getElementById('hidden-canvas');
    hidden.width = video.videoWidth;
    hidden.height = video.videoHeight;
    hidden.getContext('2d').drawImage(video, 0, 0);
    currentRawImg = hidden.toDataURL('image/jpeg', 0.8);

    // 3. Open Crop Modal
    prepareCropModal(currentRawImg);
});

function prepareCropModal(imgSrc) {
    const modal = document.getElementById('crop-modal');
    const c = document.getElementById('crop-canvas');
    const ctx = c.getContext('2d');
    const img = new Image();

    img.onload = () => {
        // Fit image into canvas for UI
        c.width = window.innerWidth * 0.9;
        c.height = (img.height / img.width) * c.width;
        ctx.drawImage(img, 0, 0, c.width, c.height);
        
        modal.style.display = 'flex';
        setupDraggableHandles(c);
    };
    img.src = imgSrc;
}

// --- 3. WARP & ANIMATION (The "Shrink & Zoom" Effect) ---
document.getElementById('done-crop').addEventListener('click', () => {
    // In a real app, we would run OpenCV warpPerspective here.
    // For now, we save the image and trigger the animation.
    saveScan(currentRawImg);
    document.getElementById('crop-modal').style.display = 'none';
});

function saveScan(imgData) {
    scannedDocs.push(imgData);

    // 1. Set the freeze layer to the captured image
    freezeLayer.style.backgroundImage = `url(${imgData})`;
    freezeLayer.style.display = 'block';

    // 2. Force browser to recognize the change (Reflow)
    void freezeLayer.offsetWidth;

    // 3. Add the CSS animation class
    freezeLayer.classList.add('fly-to-corner');

    // 4. Update the UI *after* the animation finishes
    setTimeout(() => {
        freezeLayer.style.display = 'none';
        freezeLayer.classList.remove('fly-to-corner');
        
        // Update Thumbnail
        lastScanImg.src = imgData;
        lastScanImg.style.display = 'block';
        scanCount.innerText = scannedDocs.length;
    }, 700); // 700ms matches the CSS animation duration
}

document.getElementById('cancel-crop').addEventListener('click', () => {
    document.getElementById('crop-modal').style.display = 'none';
});

// --- 4. GALLERY & EDITOR LOGIC ---
document.getElementById('gallery-trigger').addEventListener('click', () => {
    if(scannedDocs.length === 0) return;
    
    const grid = document.getElementById('gallery-grid');
    grid.innerHTML = ''; // Clear old
    
    scannedDocs.forEach((doc, index) => {
        const img = document.createElement('img');
        img.src = doc;
        img.onclick = () => openEditor(index); // Click to edit
        grid.appendChild(img);
    });

    document.getElementById('gallery-modal').style.display = 'flex';
});

function openEditor(index) {
    currentEditIndex = index;
    document.getElementById('editor-img').src = scannedDocs[index];
    document.getElementById('editor-modal').style.display = 'flex';
}

// Delete Page
document.getElementById('delete-page-btn').addEventListener('click', () => {
    if(confirm("Delete this page?")) {
        scannedDocs.splice(currentEditIndex, 1);
        
        // Close Editor
        document.getElementById('editor-modal').style.display = 'none';
        
        // Refresh Gallery
        document.getElementById('gallery-trigger').click();
        
        // Update Thumbnail in main view
        if(scannedDocs.length > 0) {
            lastScanImg.src = scannedDocs[scannedDocs.length - 1];
            scanCount.innerText = scannedDocs.length;
        } else {
            lastScanImg.style.display = 'none';
            scanCount.innerText = '0';
            document.getElementById('gallery-modal').style.display = 'none';
        }
    }
});

// Close Buttons
document.getElementById('close-gallery').onclick = () => document.getElementById('gallery-modal').style.display = 'none';
document.getElementById('close-editor').onclick = () => document.getElementById('editor-modal').style.display = 'none';

// --- 5. SETTINGS LOGIC ---
document.getElementById('settings-btn').onclick = () => document.getElementById('settings-modal').style.display = 'flex';
document.getElementById('close-settings').onclick = () => document.getElementById('settings-modal').style.display = 'none';

// --- 6. DRAGGABLE HANDLES LOGIC ---
function setupDraggableHandles(c) {
    const handles = document.querySelectorAll('.crop-handle');
    const container = document.getElementById('crop-ui-container');
    const rect = container.getBoundingClientRect();

    // Reset handles to corners for demo
    // (Real app would use OpenCV to find edges automatically)
    const positions = [
        {top: '20%', left: '20%'}, {top: '20%', left: '80%'},
        {top: '80%', left: '80%'}, {top: '80%', left: '20%'}
    ];

    handles.forEach((h, i) => {
        h.style.top = positions[i].top;
        h.style.left = positions[i].left;

        h.onpointermove = (e) => {
            if (e.buttons > 0) { // If dragging
                h.style.left = e.clientX + 'px';
                h.style.top = e.clientY + 'px';
            }
        };
    });
}

// Start
window.onload = init;
