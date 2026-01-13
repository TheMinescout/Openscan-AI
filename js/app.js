let scannedDocs = [];
let currentCropImg = null;
let corners = [{x: 50, y: 50}, {x: 250, y: 50}, {x: 250, y: 350}, {x: 50, y: 350}]; // Default points

const video = document.getElementById('video-feed');
const canvas = document.getElementById('overlay-canvas');
const freezeLayer = document.getElementById('freeze-layer');
const lastScanImg = document.getElementById('last-scan-img');
const scanCountLabel = document.getElementById('scan-count');
const statusMsg = document.getElementById('status-msg');

async function init() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "environment", width: { ideal: 1920 } }, audio: false 
        });
        video.srcObject = stream;
        video.onloadedmetadata = () => startRenderLoop();
    } catch (e) { statusMsg.innerText = "Camera Denied"; }
}

function startRenderLoop() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    // (OpenCV detection logic would go here to update overlay-canvas)
    requestAnimationFrame(startRenderLoop);
}

// DELETE LAST SCAN
document.getElementById('delete-last-btn').addEventListener('click', () => {
    if (scannedDocs.length > 0) {
        if (confirm("Delete the last page?")) {
            scannedDocs.pop();
            updateGalleryPreview();
        }
    }
});

function updateGalleryPreview() {
    if (scannedDocs.length > 0) {
        lastScanImg.src = scannedDocs[scannedDocs.length - 1];
        lastScanImg.style.display = 'block';
    } else {
        lastScanImg.style.display = 'none';
    }
    scanCountLabel.innerText = scannedDocs.length;
}

// CAPTURE & CROP LOGIC
document.getElementById('capture-btn').addEventListener('click', () => {
    const hiddenCanvas = document.getElementById('hidden-canvas');
    hiddenCanvas.width = video.videoWidth;
    hiddenCanvas.height = video.videoHeight;
    const hCtx = hiddenCanvas.getContext('2d');
    hCtx.drawImage(video, 0, 0);
    
    const rawImg = hiddenCanvas.toDataURL('image/jpeg', 0.9);
    currentCropImg = rawImg;
    
    // Switch to Crop Modal
    showCropModal(rawImg);
});

function showCropModal(imgSrc) {
    const modal = document.getElementById('crop-modal');
    const c = document.getElementById('crop-canvas');
    const ctx = c.getContext('2d');
    const img = new Image();
    
    img.onload = () => {
        c.width = img.width / 4; // Scale down for UI
        c.height = img.height / 4;
        ctx.drawImage(img, 0, 0, c.width, c.height);
        
        // Draw initial crop points
        ctx.strokeStyle = "#007AFF";
        ctx.lineWidth = 3;
        ctx.strokeRect(50, 50, c.width - 100, c.height - 100);
        
        modal.style.display = 'flex';
    };
    img.src = imgSrc;
}

// DONE CROPPING
document.getElementById('done-crop').addEventListener('click', () => {
    // For now, we save the full image. 
    // In next step, we add the OpenCV WarpPerspective here.
    scannedDocs.push(currentCropImg);
    
    // Animation
    freezeLayer.style.backgroundImage = `url(${currentCropImg})`;
    freezeLayer.classList.remove('fly-to-corner');
    void freezeLayer.offsetWidth;
    freezeLayer.classList.add('fly-to-corner');
    
    document.getElementById('crop-modal').style.display = 'none';
    updateGalleryPreview();
});

document.getElementById('cancel-crop').addEventListener('click', () => {
    document.getElementById('crop-modal').style.display = 'none';
});

// PDF EXPORT
document.getElementById('export-btn').addEventListener('click', () => {
    if (scannedDocs.length === 0) return;
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    scannedDocs.forEach((img, i) => {
        if (i > 0) pdf.addPage();
        pdf.addImage(img, 'JPEG', 0, 0, 210, 297);
    });
    pdf.save(`OpenScan_${Date.now()}.pdf`);
});

window.onload = init;
