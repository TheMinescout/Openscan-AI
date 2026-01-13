let scannedDocs = [];
const video = document.getElementById('video-feed');
const canvas = document.getElementById('overlay-canvas');
const freezeLayer = document.getElementById('freeze-layer');
const lastScanImg = document.getElementById('last-scan-img');
const scanCountLabel = document.getElementById('scan-count');
const galleryModal = document.getElementById('gallery-modal');

// 1. Initialize Camera
async function init() {
    const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: "environment" }, audio: false 
    });
    video.srcObject = stream;
    video.play();
    requestAnimationFrame(renderLoop);
}

// 2. Continuous Rendering Loop (Edge Detection)
function renderLoop() {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    
    // Check if OpenCV is ready
    if (typeof cv !== 'undefined' && cv.Mat) {
        try {
            let src = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC4);
            let cap = new cv.VideoCapture(video);
            cap.read(src);
            
            // Logic to find document (same as previous version)
            // drawOverlay(ctx, contour);
            
            src.delete();
        } catch (e) {}
    }
    requestAnimationFrame(renderLoop);
}

// 3. Capture Action & Animation
document.getElementById('capture-btn').addEventListener('click', () => {
    const hiddenCanvas = document.getElementById('hidden-canvas');
    hiddenCanvas.width = video.videoWidth;
    hiddenCanvas.height = video.videoHeight;
    const hCtx = hiddenCanvas.getContext('2d');
    hCtx.drawImage(video, 0, 0);

    const imgData = hiddenCanvas.toDataURL('image/jpeg', 0.8);
    
    // Add to gallery
    scannedDocs.push(imgData);
    
    // Trigger Animation
    freezeLayer.style.backgroundImage = `url(${imgData})`;
    freezeLayer.classList.remove('fly-to-corner');
    void freezeLayer.offsetWidth; // Force reflow
    freezeLayer.classList.add('fly-to-corner');

    // Update Bottom Preview
    setTimeout(() => {
        lastScanImg.src = imgData;
        lastScanImg.style.display = 'block';
        scanCountLabel.innerText = scannedDocs.length;
    }, 700);
});

// 4. Gallery View Logic
document.getElementById('gallery-trigger').addEventListener('click', () => {
    const grid = document.getElementById('gallery-content');
    grid.innerHTML = '';
    scannedDocs.forEach(img => {
        const el = document.createElement('img');
        el.src = img;
        el.onclick = () => window.open(img); // Full screen preview
        grid.appendChild(el);
    });
    galleryModal.style.display = 'flex';
});

document.getElementById('close-gallery').addEventListener('click', () => {
    galleryModal.style.display = 'none';
});

// 5. Final PDF Export
document.getElementById('export-btn').addEventListener('click', () => {
    if (scannedDocs.length === 0) return alert("Scan something first!");
    
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');

    scannedDocs.forEach((img, index) => {
        if (index > 0) pdf.addPage();
        pdf.addImage(img, 'JPEG', 0, 0, 210, 297);
    });

    pdf.save("My_Scanned_Document.pdf");
});

window.onload = init;
