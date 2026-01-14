// --- STATE MANAGEMENT ---
let scannedDocs = [];
let currentRawImg = null; // High-res original from camera
let previewImgObj = null; // The loaded image object for the crop preview
let currentEditIndex = -1;
let detectedQuad = null; // Stores AI-detected corners
let isCVReady = false;

// DOM Elements
const video = document.getElementById('video-feed');
const overlayCanvas = document.getElementById('overlay-canvas'); // For blue AI box
const freezeLayer = document.getElementById('freeze-layer');
const statusMsg = document.getElementById('status-msg');
const scanCount = document.getElementById('scan-count');
const lastScanImg = document.getElementById('last-scan-img');
const uiLayer = document.querySelector('.ui-layer');

// --- 1. STARTUP SEQUENCE ---
document.addEventListener('DOMContentLoaded', () => {
    setupButtons();
    startCamera();
    
    // Check if OpenCV is ready
    if (typeof cv !== 'undefined' && cv.getBuildInformation) {
        onOpenCVReady();
    } else {
        // Wait for it to load
        document.addEventListener('opencv_ready', onOpenCVReady);
        // Fallback polling
        let checkCV = setInterval(() => {
            if (typeof cv !== 'undefined' && cv.getBuildInformation) {
                clearInterval(checkCV);
                onOpenCVReady();
            }
        }, 500);
    }
});

function onOpenCVReady() {
    isCVReady = true;
    statusMsg.innerText = "AI Active";
    statusMsg.style.background = "rgba(0, 150, 255, 0.6)"; // Blue pill
    requestAnimationFrame(processVideoFrame);
}

// --- 2. CAMERA SETUP ---
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
            // Match overlay canvas to video resolution
            overlayCanvas.width = video.videoWidth;
            overlayCanvas.height = video.videoHeight;
        };
    } catch (e) {
        console.error(e);
        statusMsg.innerText = "Camera Denied";
        statusMsg.style.background = "rgba(255, 0, 0, 0.6)";
    }
}

function setupButtons() {
    // Main Camera Actions
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

    // Export Action
    document.getElementById('export-btn').onclick = exportPDF;
}

// --- 3. UI HELPER ---
function toggleModal(modalId, show) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    if (show) {
        modal.style.display = 'flex';
        // Hide Camera UI so buttons don't bleed through
        if(uiLayer) uiLayer.style.display = 'none';
    } else {
        modal.style.display = 'none';
        // Show Camera UI again
        if(uiLayer) uiLayer.style.display = 'flex';
    }
}

// --- 4. LIVE AI DETECTION LOOP ---
function processVideoFrame() {
    if (!isCVReady || video.paused || video.ended) {
        requestAnimationFrame(processVideoFrame);
        return;
    }

    try {
        const width = video.videoWidth;
        const height = video.videoHeight;

        // 1. Read Frame
        let src = new cv.Mat(height, width, cv.CV_8UC4);
        let cap = new cv.VideoCapture(video);
        cap.read(src);

        // 2. Pre-process (Gray -> Blur -> Edge)
        let gray = new cv.Mat();
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
        cv.Canny(gray, gray, 75, 200);

        // 3. Find Contours
        let contours = new cv.MatVector();
        let hierarchy = new cv.Mat();
        cv.findContours(gray, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        // 4. Find Best Rectangle
        let maxArea = 0;
        let bestContour = null;
        let minArea = width * height * 0.10; // Must be at least 10% of screen

        for (let i = 0; i < contours.size(); ++i) {
            let cnt = contours.get(i);
            let area = cv.contourArea(cnt);

            if (area > minArea) {
                let peri = cv.arcLength(cnt, true);
                let approx = new cv.Mat();
                cv.approxPolyDP(cnt, approx, 0.02 * peri, true);

                if (approx.rows === 4) {
                    if (area > maxArea) {
                        maxArea = area;
                        if (bestContour) bestContour.delete();
                        bestContour = approx; // Keep this one
                    } else {
                        approx.delete();
                    }
                } else {
                    approx.delete();
                }
            }
            cnt.delete();
        }

        // 5. Draw Result on Overlay Canvas
        const ctx = overlayCanvas.getContext('2d');
        ctx.clearRect(0, 0, width, height);

        if (bestContour) {
            // Extract points
            let points = [];
            for (let i = 0; i < 4; i++) {
                points.push({
                    x: bestContour.data32S[i * 2],
                    y: bestContour.data32S[i * 2 + 1]
                });
            }

            // Save for later capture
            detectedQuad = sortPoints(points);

            // Draw Blue Box
            ctx.beginPath();
            ctx.lineWidth = 4;
            ctx.strokeStyle = '#007AFF';
            ctx.moveTo(detectedQuad[0].x, detectedQuad[0].y);
            ctx.lineTo(detectedQuad[1].x, detectedQuad[1].y);
            ctx.lineTo(detectedQuad[2].x, detectedQuad[2].y);
            ctx.lineTo(detectedQuad[3].x, detectedQuad[3].y);
            ctx.closePath();
            ctx.stroke();

            // Fill
            ctx.fillStyle = 'rgba(0, 122, 255, 0.2)';
            ctx.fill();

            bestContour.delete();
        } else {
            detectedQuad = null; // No paper found
        }

        // Cleanup
        src.delete(); gray.delete(); contours.delete(); hierarchy.delete();

    } catch (err) {
        // Suppress errors to keep loop alive
    }

    requestAnimationFrame(processVideoFrame);
}

function sortPoints(points) {
    // Sort to [TopLeft, TopRight, BottomRight, BottomLeft]
    points.sort((a, b) => a.y - b.y);
    let top = points.slice(0, 2).sort((a, b) => a.x - b.x);
    let bottom = points.slice(2, 4).sort((a, b) => b.x - a.x);
    return [top[0], top[1], bottom[0], bottom[1]];
}

// --- 5. CAPTURE & CROP SETUP ---
function captureImage() {
    // Visual Flash
    video.style.opacity = "0.2";
    setTimeout(() => video.style.opacity = "1", 150);

    // Capture Full Res Frame
    const hidden = document.getElementById('hidden-canvas');
    hidden.width = video.videoWidth;
    hidden.height = video.videoHeight;
    const ctx = hidden.getContext('2d');
    ctx.drawImage(video, 0, 0);
    
    currentRawImg = hidden.toDataURL('image/jpeg', 0.9);
    
    // Open Crop Modal with detected points (if any)
    prepareCropModal(currentRawImg, detectedQuad);
}

function prepareCropModal(imgSrc, autoPoints) {
    const container = document.getElementById('crop-ui-container');
    const c = document.getElementById('crop-canvas');
    previewImgObj = new Image();

    previewImgObj.onload = () => {
        // Fit to screen (90% width, 80% height)
        const maxW = window.innerWidth * 0.9;
        const maxH = window.innerHeight * 0.8;
        const scale = Math.min(maxW / previewImgObj.width, maxH / previewImgObj.height);
        
        const finalW = Math.floor(previewImgObj.width * scale);
        const finalH = Math.floor(previewImgObj.height * scale);
        
        // Resize Container & Canvas
        container.style.width = finalW + "px";
        container.style.height = finalH + "px";
        c.width = finalW;
        c.height = finalH;
        container.dataset.scale = scale;

        toggleModal('crop-modal', true);

        // Setup Handles
        setupHandles(finalW, finalH, autoPoints, scale);
        drawCropLines();
    };
    previewImgObj.src = imgSrc;
}

function setupHandles(w, h, autoPoints, scale) {
    const handles = document.querySelectorAll('.crop-handle');
    const container = document.getElementById('crop-ui-container');
    
    let positions;

    if (autoPoints) {
        // Use AI points, scaled down to preview size
        positions = [
            { x: autoPoints[0].x * scale, y: autoPoints[0].y * scale },
            { x: autoPoints[1].x * scale, y: autoPoints[1].y * scale },
            { x: autoPoints[2].x * scale, y: autoPoints[2].y * scale },
            { x: autoPoints[3].x * scale, y: autoPoints[3].y * scale }
        ];
    } else {
        // Default: 20% in from corners
        positions = [
            { x: w * 0.2, y: h * 0.2 }, { x: w * 0.8, y: h * 0.2 },
            { x: w * 0.8, y: h * 0.8 }, { x: w * 0.2, y: h * 0.8 }
        ];
    }

    handles.forEach((handle, i) => {
        // Center handle (-15px for 30px width)
        handle.style.left = (positions[i].x - 15) + 'px';
        handle.style.top = (positions[i].y - 15) + 'px';
        
        // Reset listeners
        handle.onmousedown = null; handle.ontouchstart = null;
        
        // Add Drag listeners
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

        // Constraint
        x = Math.max(0, Math.min(x, container.offsetWidth));
        y = Math.max(0, Math.min(y, container.offsetHeight));

        // Update handle center
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

function drawCropLines() {
    const c = document.getElementById('crop-canvas');
    const ctx = c.getContext('2d');
    const handles = document.querySelectorAll('.crop-handle');

    // Clear & Redraw Image
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(previewImgObj, 0, 0, c.width, c.height);

    // Get Centers
    const p = Array.from(handles).map(h => ({
        x: parseFloat(h.style.left) + 15,
        y: parseFloat(h.style.top) + 15
    }));

    // Draw Lines
    ctx.beginPath();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#007AFF';
    ctx.moveTo(p[0].x, p[0].y);
    ctx.lineTo(p[1].x, p[1].y);
    ctx.lineTo(p[2].x, p[2].y);
    ctx.lineTo(p[3].x, p[3].y);
    ctx.closePath();
    ctx.stroke();

    // Corner Dots
    ctx.fillStyle = 'white';
    p.forEach(point => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
        ctx.fill();
    });
}

// --- 6. FINISH CROP ---
function finishCrop() {
    toggleModal('crop-modal', false);

    const handles = document.querySelectorAll('.crop-handle');
    const container = document.getElementById('crop-ui-container');
    const scale = parseFloat(container.dataset.scale);

    // Get coords (+15 offset)
    let p = Array.from(handles).map(h => ({
        x: (parseFloat(h.style.left) + 15) / scale,
        y: (parseFloat(h.style.top) + 15) / scale
    }));

    // Simple Bounding Box Crop (Robust)
    let minX = Math.min(p[0].x, p[3].x);
    let minY = Math.min(p[0].y, p[1].y);
    let maxX = Math.max(p[1].x, p[2].x);
    let maxY = Math.max(p[2].y, p[3].y);
    let w = maxX - minX;
    let h = maxY - minY;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    const img = new Image();
    img.onload = () => {
        ctx.drawImage(img, minX, minY, w, h, 0, 0, w, h);
        saveScan(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.src = currentRawImg;
}

function saveScan(imgData) {
    scannedDocs.push(imgData);
    
    // Animation
    freezeLayer.style.backgroundImage = `url(${imgData})`;
    freezeLayer.style.display = 'block';
    void freezeLayer.offsetWidth; // Reflow
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

// --- 7. GALLERY & EDITOR ---
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

// EDITOR LOGIC
let originalEditImgData = null; 

function openEditor(index) {
    currentEditIndex = index;
    const imgData = scannedDocs[index];
    document.getElementById('editor-img').src = imgData;
    originalEditImgData = imgData; // Save for undo
    toggleModal('editor-modal', true);
}

// Global scope for HTML onclick access
window.applyFilter = function(type) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        if (type === 'bw') {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
                const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
                const color = avg > 110 ? 255 : 0; // Threshold
                data[i] = color; data[i + 1] = color; data[i + 2] = color;
            }
            ctx.putImageData(imageData, 0, 0);
        }
        updateCurrentImage(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.src = type === 'original' ? originalEditImgData : document.getElementById('editor-img').src;
};

window.rotateImage = function() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
        canvas.width = img.height;
        canvas.height = img.width;
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(90 * Math.PI / 180);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
        
        const rotated = canvas.toDataURL('image/jpeg', 0.9);
        updateCurrentImage(rotated);
        originalEditImgData = rotated; // Update original so filters work on new rotation
    };
    img.src = document.getElementById('editor-img').src;
};

function updateCurrentImage(newData) {
    document.getElementById('editor-img').src = newData;
    scannedDocs[currentEditIndex] = newData;
    // Update gallery grid background
    const grid = document.getElementById('gallery-grid');
    if(grid.children[currentEditIndex]) grid.children[currentEditIndex].src = newData;
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

// --- 8. EXPORT ---
function exportPDF() {
    if (scannedDocs.length === 0) return alert("Nothing to export!");
    
    // Check if jsPDF is loaded
    if (!window.jspdf) return alert("PDF Library not ready yet.");
    
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    scannedDocs.forEach((imgData, index) => {
        if (index > 0) doc.addPage();
        const props = doc.getImageProperties(imgData);
        const pdfWidth = doc.internal.pageSize.getWidth();
        const pdfHeight = (props.height * pdfWidth) / props.width;
        doc.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
    });

    doc.save("OpenScan_Doc.pdf");
}
