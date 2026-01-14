// --- STATE MANAGEMENT ---
let scannedDocs = [];
let currentRawImg = null;
let previewImgObj = null;
let currentEditIndex = -1;

// DOM Elements
const video = document.getElementById('video-feed');
const freezeLayer = document.getElementById('freeze-layer');
const statusMsg = document.getElementById('status-msg');
const scanCount = document.getElementById('scan-count');
const lastScanImg = document.getElementById('last-scan-img');
const uiLayer = document.querySelector('.ui-layer');

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
        statusMsg.innerText = "Camera Denied";
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

function toggleModal(modalId, show) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.style.display = show ? 'flex' : 'none';
    // Hide UI layer when modal is open to prevent "ghost clicks"
    if(uiLayer) uiLayer.style.display = show ? 'none' : 'flex';
}

// --- 2. CAPTURE & SETUP ---
function captureImage() {
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
        // 1. Calculate dimensions to fit screen (90% width, 80% height)
        const maxW = window.innerWidth * 0.9;
        const maxH = window.innerHeight * 0.8;
        const scale = Math.min(maxW / previewImgObj.width, maxH / previewImgObj.height);
        
        const finalW = Math.floor(previewImgObj.width * scale);
        const finalH = Math.floor(previewImgObj.height * scale);
        
        // 2. Set Container & Canvas size EXACTLY the same
        container.style.width = finalW + "px";
        container.style.height = finalH + "px";
        
        c.width = finalW;
        c.height = finalH;
        container.dataset.scale = scale;

        toggleModal('crop-modal', true);
        
        // 3. Initialize Handles & Draw
        setupHandles(finalW, finalH);
        drawCropLines(); 
    };
    previewImgObj.src = imgSrc;
}

// --- 3. THE FIX: COORDINATE SYNC ---
function setupHandles(w, h) {
    const handles = document.querySelectorAll('.crop-handle');
    const container = document.getElementById('crop-ui-container');
    
    // Default: 10% in from corners
    const positions = [
        {x: w * 0.2, y: h * 0.2}, // TL
        {x: w * 0.8, y: h * 0.2}, // TR
        {x: w * 0.8, y: h * 0.8}, // BR
        {x: w * 0.2, y: h * 0.8}  // BL
    ];

    handles.forEach((handle, i) => {
        // We set the handle's CENTER to the position.
        // Since handle is 30px, we subtract 15px.
        handle.style.left = (positions[i].x - 15) + 'px';
        handle.style.top = (positions[i].y - 15) + 'px';

        // Clear old listeners
        handle.onmousedown = null; handle.ontouchstart = null;
        
        // Add new listeners
        handle.onmousedown = (e) => startDrag(e, handle, container, false);
        handle.ontouchstart = (e) => startDrag(e, handle, container, true);
    });
}

function drawCropLines() {
    const c = document.getElementById('crop-canvas');
    const ctx = c.getContext('2d');
    const handles = document.querySelectorAll('.crop-handle');

    // 1. Redraw Image
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(previewImgObj, 0, 0, c.width, c.height);

    // 2. Calculate Centers
    // We get the visual "Left" and add 15 to find the mathematical "Center"
    const p1 = { x: parseFloat(handles[0].style.left) + 15, y: parseFloat(handles[0].style.top) + 15 };
    const p2 = { x: parseFloat(handles[1].style.left) + 15, y: parseFloat(handles[1].style.top) + 15 };
    const p3 = { x: parseFloat(handles[2].style.left) + 15, y: parseFloat(handles[2].style.top) + 15 };
    const p4 = { x: parseFloat(handles[3].style.left) + 15, y: parseFloat(handles[3].style.top) + 15 };

    // 3. Draw Lines (Blue)
    ctx.beginPath();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#007AFF';
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.lineTo(p4.x, p4.y);
    ctx.closePath();
    ctx.stroke();
    
    // 4. Draw Corner Circles (White Dots at corners for precision)
    [p1, p2, p3, p4].forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, 2 * Math.PI);
        ctx.fillStyle = '#fff';
        ctx.fill();
    });
}

function startDrag(e, handle, container, isTouch) {
    e.preventDefault(); 
    const rect = container.getBoundingClientRect();

    function move(event) {
        event.preventDefault();
        const clientX = isTouch ? event.touches[0].clientX : event.clientX;
        const clientY = isTouch ? event.touches[0].clientY : event.clientY;

        // Calculate Position relative to container
        let x = clientX - rect.left;
        let y = clientY - rect.top;

        // Constraint: Keep inside box
        x = Math.max(0, Math.min(x, container.offsetWidth));
        y = Math.max(0, Math.min(y, container.offsetHeight));

        // Apply Position (Subtract 15 to center the handle visually)
        handle.style.left = (x - 15) + 'px';
        handle.style.top = (y - 15) + 'px';

        requestAnimationFrame(drawCropLines);
    }

    function stop() {
        if (isTouch) { document.ontouchmove = null; document.ontouchend = null; }
        else { document.onmousemove = null; document.onmouseup = null; }
    }

    if (isTouch) { document.ontouchmove = move; document.ontouchend = stop; }
    else { document.onmousemove = move; document.onmouseup = stop; }
}

// --- 4. FINISH CROP ---
function finishCrop() {
    toggleModal('crop-modal', false);
    
    const handles = document.querySelectorAll('.crop-handle');
    const container = document.getElementById('crop-ui-container');
    const scale = parseFloat(container.dataset.scale);

    // Get Points (+15 offset)
    let x1 = (parseFloat(handles[0].style.left) + 15);
    let y1 = (parseFloat(handles[0].style.top) + 15);
    let x3 = (parseFloat(handles[2].style.left) + 15);
    let y3 = (parseFloat(handles[2].style.top) + 15);

    // Scale to original size
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

// --- 5. HELPERS ---
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
