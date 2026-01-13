let scannedDocs = [];
const video = document.getElementById('video-feed');
const canvas = document.getElementById('overlay-canvas');
const freezeLayer = document.getElementById('freeze-layer');
const lastScanImg = document.getElementById('last-scan-img');
const scanCountLabel = document.getElementById('scan-count');
const galleryModal = document.getElementById('gallery-modal');
const statusMsg = document.getElementById('status-msg');

async function init() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "environment", width: { ideal: 1280 } }, 
            audio: false 
        });
        video.srcObject = stream;
        video.onloadedmetadata = () => {
            statusMsg.innerText = "Scanner Ready";
            startRenderLoop();
        };
    } catch (e) {
        statusMsg.innerText = "Camera access denied";
    }
}

function startRenderLoop() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    // Basic loop for now; OpenCV integration remains the same as before
    requestAnimationFrame(startRenderLoop);
}

// CAPTURE LOGIC
document.getElementById('capture-btn').addEventListener('click', () => {
    // 1. Setup hidden canvas for full res capture
    const hiddenCanvas = document.getElementById('hidden-canvas');
    hiddenCanvas.width = video.videoWidth;
    hiddenCanvas.height = video.videoHeight;
    const hCtx = hiddenCanvas.getContext('2d');
    hCtx.drawImage(video, 0, 0);

    const imgData = hiddenCanvas.toDataURL('image/jpeg', 0.8);
    
    // 2. Add to internal storage
    scannedDocs.push(imgData);
    
    // 3. EXECUTE ANIMATION
    // Apply the image to the freeze layer background
    freezeLayer.style.backgroundImage = `url(${imgData})`;
    
    // Reset animation state
    freezeLayer.classList.remove('fly-to-corner');
    void freezeLayer.offsetWidth; // Force CSS reflow to restart animation
    freezeLayer.classList.add('fly-to-corner');

    // 4. Update Preview UI after animation finishes
    setTimeout(() => {
        lastScanImg.src = imgData;
        lastScanImg.style.display = 'block';
        scanCountLabel.innerText = scannedDocs.length;
    }, 750);
});

// GALLERY LOGIC
document.getElementById('gallery-trigger').addEventListener('click', () => {
    if (scannedDocs.length === 0) return;
    const grid = document.getElementById('gallery-content');
    grid.innerHTML = '';
    
    scannedDocs.forEach((img, index) => {
        const wrapper = document.createElement('div');
        wrapper.style.position = 'relative';
        
        const el = document.createElement('img');
        el.src = img;
        el.onclick = () => {
            const win = window.open();
            win.document.write(`<img src="${img}" style="width:100%">`);
        };
        
        wrapper.appendChild(el);
        grid.appendChild(wrapper);
    });
    galleryModal.style.display = 'flex';
});

document.getElementById('close-gallery').addEventListener('click', () => {
    galleryModal.style.display = 'none';
});

// EXPORT LOGIC
document.getElementById('export-btn').addEventListener('click', () => {
    if (scannedDocs.length === 0) return alert("No documents to save.");
    
    statusMsg.innerText = "Generating PDF...";
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');

    scannedDocs.forEach((img, index) => {
        if (index > 0) pdf.addPage();
        // Calculate aspect ratio to fit A4
        pdf.addImage(img, 'JPEG', 0, 0, 210, 297);
    });

    pdf.save(`Scan_${new Date().getTime()}.pdf`);
    statusMsg.innerText = "PDF Saved!";
});

window.onload = init;
