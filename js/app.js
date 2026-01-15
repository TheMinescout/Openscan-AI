console.log("✅ app.js v4.0 running");

// --- STATE ---
let scannedDocs = [];   // Processed images (Edits saved here)
let rawDocs = [];       // Original camera captures (For Re-Crop)
let currentEditIndex = -1;
let detectedQuad = null; 
let isCVReady = false;
let isAutoCaptureOn = true;
let stabilityThreshold = 20;
let stabilityCounter = 0;
let isProcessing = false;
let retakeMode = false; // Flag for retake
let focusPoint = null;
let focusTimer = null;
let currentStream = null;

// DOM
const video = document.getElementById('video-feed');
const overlayCanvas = document.getElementById('overlay-canvas');
const freezeLayer = document.getElementById('freeze-layer');
const statusMsg = document.getElementById('status-msg');
const scanCount = document.getElementById('scan-count');
const lastScanImg = document.getElementById('last-scan-img');
const focusRing = document.getElementById('focus-ring');
const progressCircle = document.querySelector('.progress-ring__circle');
const qualitySelect = document.getElementById('quality-select');
const autoSpeedSelect = document.getElementById('auto-speed');

// --- INIT ---
document.addEventListener('DOMContentLoaded', () => {
    setupButtons();
    setupTouchFocus();
    
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        alert("HTTPS Required.");
    }

    startCamera();
    if(progressCircle) progressCircle.style.strokeDashoffset = 251; 

    if (typeof cv !== 'undefined' && cv.getBuildInformation) onOpenCVReady();
    else document.addEventListener('opencv_ready', onOpenCVReady);
});

function onOpenCVReady() {
    isCVReady = true;
    console.log("OpenCV Ready");
    statusMsg.innerText = "Ready";
    requestAnimationFrame(processVideoFrame);
}

// --- CAMERA ---
async function startCamera(overrideWidth = null) {
    const quality = qualitySelect.value;
    let width = overrideWidth || 1920; 
    let height = (width === 3840) ? 2160 : (width === 1280 ? 720 : 1080);
    
    if (!overrideWidth) {
        if (quality === '4k') { width = 3840; height = 2160; }
        else if (quality === '720p') { width = 1280; height = 720; }
    }

    if (currentStream) currentStream.getTracks().forEach(track => track.stop());

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "environment", width: { ideal: width }, height: { ideal: height } },
            audio: false
        });
        currentStream = stream;
        video.srcObject = stream;
        video.onloadedmetadata = () => {
            video.play();
            resizeCanvas();
            window.addEventListener('resize', resizeCanvas);
        };
    } catch (e) {
        if (width > 1280) startCamera(1280);
        else statusMsg.innerText = "No Camera";
    }
}

function resizeCanvas() {
    if (video.videoWidth > 0) {
        overlayCanvas.width = video.videoWidth;
        overlayCanvas.height = video.videoHeight;
        video.width = video.videoWidth;
        video.height = video.videoHeight;
    }
}

// --- AI LOOP ---
function processVideoFrame() {
    if (!isCVReady || video.paused || video.ended || video.videoWidth === 0 || isProcessing) {
        requestAnimationFrame(processVideoFrame); return;
    }

    try {
        const width = video.videoWidth;
        const height = video.videoHeight;
        const ctx = overlayCanvas.getContext('2d');
        let src = new cv.Mat(height, width, cv.CV_8UC4);
        let cap = new cv.VideoCapture(video);
        cap.read(src);

        let gray = new cv.Mat();
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        cv.GaussianBlur(gray, gray, new cv.Size(9, 9), 0);
        let edges = new cv.Mat();
        cv.Canny(gray, edges, 50, 200);
        let contours = new cv.MatVector();
        let hierarchy = new cv.Mat();
        cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        let bestContour = null;
        let maxArea = 0;
        let minArea = width * height * 0.10;

        for (let i = 0; i < contours.size(); ++i) {
            let cnt = contours.get(i);
            let area = cv.contourArea(cnt);
            if (area > minArea) {
                if (focusPoint && cv.pointPolygonTest(cnt, new cv.Point(focusPoint.x, focusPoint.y), false) < 0) {
                    cnt.delete(); continue;
                }
                if (area > maxArea) {
                    maxArea = area;
                    if (bestContour) bestContour.delete();
                    bestContour = cnt;
                } else { cnt.delete(); }
            } else { cnt.delete(); }
        }

        ctx.clearRect(0, 0, width, height);
        ctx.lineWidth = 4;

        if (bestContour) {
            let hull = new cv.Mat();
            cv.convexHull(bestContour, hull, false, true);
            let approx = new cv.Mat();
            let peri = cv.arcLength(hull, true);
            cv.approxPolyDP(hull, approx, 0.02 * peri, true);
            
            let points = [];
            for (let i = 0; i < approx.rows; i++) points.push({ x: approx.data32S[i * 2], y: approx.data32S[i * 2 + 1] });
            
            if (points.length >= 4) {
                let tl = points.reduce((prev, curr) => (curr.x + curr.y) < (prev.x + prev.y) ? curr : prev);
                let br = points.reduce((prev, curr) => (curr.x + curr.y) > (prev.x + prev.y) ? curr : prev);
                let tr = points.reduce((prev, curr) => (curr.x - curr.y) > (prev.x - prev.y) ? curr : prev);
                let bl = points.reduce((prev, curr) => (curr.x - curr.y) < (prev.x - prev.y) ? curr : prev);
                detectedQuad = [tl, tr, br, bl]; 
            } else { detectedQuad = sortPoints(points); }

            ctx.strokeStyle = '#D0BCFF'; ctx.fillStyle = 'rgba(208, 188, 255, 0.2)';
            ctx.beginPath(); ctx.moveTo(detectedQuad[0].x, detectedQuad[0].y);
            for (let i = 1; i < 4; i++) ctx.lineTo(detectedQuad[i].x, detectedQuad[i].y);
            ctx.closePath(); ctx.stroke(); ctx.fill();

            if (isAutoCaptureOn) {
                stabilityCounter++;
                statusMsg.innerText = "Steady...";
                let progress = stabilityCounter / stabilityThreshold;
                progressCircle.style.strokeDashoffset = 251 - (251 * progress);

                if (stabilityCounter >= stabilityThreshold) {
                    statusMsg.innerText = "Capturing!";
                    captureImage(); 
                    stabilityCounter = 0; 
                    progressCircle.style.strokeDashoffset = 251;
                }
            } else {
                statusMsg.innerText = "Detected";
                stabilityCounter = 0;
                progressCircle.style.strokeDashoffset = 251;
            }
            hull.delete(); approx.delete(); bestContour.delete();
        } else {
            detectedQuad = null;
            stabilityCounter = 0;
            progressCircle.style.strokeDashoffset = 251;
            statusMsg.innerText = focusPoint ? "Scanning..." : "Ready";
        }
        src.delete(); gray.delete(); edges.delete(); contours.delete(); hierarchy.delete();
    } catch (err) { console.log(err); }
    requestAnimationFrame(processVideoFrame);
}

function sortPoints(points) {
    if (points.length !== 4) return points;
    points.sort((a, b) => a.y - b.y);
    let top = points.slice(0, 2).sort((a, b) => a.x - b.x);
    let bottom = points.slice(2, 4).sort((a, b) => b.x - a.x);
    return [top[0], top[1], bottom[0], bottom[1]];
}

// --- BUTTONS ---
function setupButtons() {
    document.getElementById('auto-toggle').onclick = () => {
        isAutoCaptureOn = !isAutoCaptureOn;
        document.getElementById('auto-text').innerText = isAutoCaptureOn ? "Auto" : "Manual";
        document.getElementById('auto-toggle').style.opacity = isAutoCaptureOn ? "1" : "0.5";
        progressCircle.style.strokeDashoffset = 251;
    };

    autoSpeedSelect.onchange = () => { stabilityThreshold = parseInt(autoSpeedSelect.value); };
    qualitySelect.onchange = () => startCamera();

    document.getElementById('capture-btn').onclick = captureImage;
    document.getElementById('gallery-trigger').onclick = openGallery;
    document.getElementById('close-gallery').onclick = () => closeSheet('gallery-modal');
    
    document.getElementById('settings-btn').onclick = () => openSheet('settings-modal');
    document.getElementById('close-settings').onclick = () => closeSheet('settings-modal');
    document.getElementById('tutorial-btn').onclick = () => { closeSheet('settings-modal'); openSheet('tutorial-modal'); };
    document.getElementById('close-tutorial').onclick = () => closeSheet('tutorial-modal');
    document.getElementById('about-btn').onclick = () => { closeSheet('settings-modal'); openSheet('about-modal'); };
    document.getElementById('close-about').onclick = () => closeSheet('about-modal');

    document.getElementById('close-editor').onclick = () => closeSheet('editor-modal');
    document.getElementById('save-editor').onclick = () => { closeSheet('editor-modal'); openGallery(); }; // Save & Close
    document.getElementById('export-btn').onclick = exportPDF;

    document.getElementById('done-crop').onclick = finishCrop;
    document.getElementById('cancel-crop').onclick = () => { closeSheet('crop-modal'); isProcessing = false; };
}

function openSheet(id) { document.getElementById(id).style.display = 'flex'; document.querySelector('.ui-layer').style.display = 'none'; }
function closeSheet(id) { document.getElementById(id).style.display = 'none'; document.querySelector('.ui-layer').style.display = 'flex'; }

function setupTouchFocus() {
    const app = document.getElementById('app-container');
    app.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('.modal-sheet') || e.target.closest('.ui-layer')) return;
        const rect = video.getBoundingClientRect();
        const scaleX = video.videoWidth / rect.width;
        const scaleY = video.videoHeight / rect.height;
        focusPoint = { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
        focusRing.style.display = 'block';
        focusRing.style.left = e.clientX + 'px';
        focusRing.style.top = e.clientY + 'px';
        if (focusTimer) clearTimeout(focusTimer);
        focusTimer = setTimeout(() => { focusPoint = null; focusRing.style.display = 'none'; }, 4000);
    });
}

function captureImage() {
    isProcessing = true;
    stabilityCounter = 0;
    progressCircle.style.strokeDashoffset = 251;
    video.style.opacity = "0.2"; setTimeout(() => video.style.opacity = "1", 150);

    const hidden = document.getElementById('hidden-canvas');
    hidden.width = video.videoWidth; hidden.height = video.videoHeight;
    const ctx = hidden.getContext('2d');
    ctx.drawImage(video, 0, 0);
    const rawData = hidden.toDataURL('image/jpeg', 1.0); // Save High Quality
    
    // Logic for Retake vs New Scan
    if (retakeMode) {
        rawDocs[currentEditIndex] = rawData; // Overwrite raw
        setTimeout(() => prepareCropModal(rawData, detectedQuad), 200);
    } else {
        // Temp storage until crop is confirmed, effectively just passes to crop
        setTimeout(() => prepareCropModal(rawData, detectedQuad), 200);
    }
}

function prepareCropModal(imgSrc, autoPoints) {
    const container = document.getElementById('crop-ui-container');
    const c = document.getElementById('crop-canvas');
    previewImgObj = new Image();
    previewImgObj.onload = () => {
        const maxW = window.innerWidth * 0.9;
        const maxH = window.innerHeight * 0.7;
        const scale = Math.min(maxW / previewImgObj.width, maxH / previewImgObj.height);
        const finalW = Math.floor(previewImgObj.width * scale);
        const finalH = Math.floor(previewImgObj.height * scale);
        container.style.width = finalW + "px"; container.style.height = finalH + "px";
        c.width = finalW; c.height = finalH;
        container.dataset.scale = scale;
        openSheet('crop-modal');
        setupHandles(finalW, finalH, autoPoints, scale);
        drawCropLines();
    };
    previewImgObj.src = imgSrc;
}

function setupHandles(w, h, autoPoints, scale) {
    const handles = document.querySelectorAll('.crop-handle');
    let positions;
    if (autoPoints && autoPoints.length === 4) {
        positions = [ { x: autoPoints[0].x * scale, y: autoPoints[0].y * scale }, { x: autoPoints[1].x * scale, y: autoPoints[1].y * scale }, { x: autoPoints[2].x * scale, y: autoPoints[2].y * scale }, { x: autoPoints[3].x * scale, y: autoPoints[3].y * scale } ];
    } else {
        positions = [ { x: w * 0.2, y: h * 0.2 }, { x: w * 0.8, y: h * 0.2 }, { x: w * 0.8, y: h * 0.8 }, { x: w * 0.2, y: h * 0.8 } ];
    }
    handles.forEach((handle, i) => {
        handle.style.left = (positions[i].x) + 'px';
        handle.style.top = (positions[i].y) + 'px';
        handle.onmousedown = (e) => startDrag(e, handle, document.getElementById('crop-ui-container'), false);
        handle.ontouchstart = (e) => startDrag(e, handle, document.getElementById('crop-ui-container'), true);
    });
}

function startDrag(e, handle, container, isTouch) {
    e.preventDefault();
    const rect = container.getBoundingClientRect();
    function move(event) {
        event.preventDefault();
        const clientX = isTouch ? event.touches[0].clientX : event.clientX;
        const clientY = isTouch ? event.touches[0].clientY : event.clientY;
        let x = clientX - rect.left; let y = clientY - rect.top;
        x = Math.max(0, Math.min(x, container.offsetWidth)); y = Math.max(0, Math.min(y, container.offsetHeight));
        handle.style.left = x + 'px'; handle.style.top = y + 'px';
        requestAnimationFrame(drawCropLines);
    }
    function stop() {
        if (isTouch) { document.ontouchmove = null; document.ontouchend = null; } else { document.onmousemove = null; document.onmouseup = null; }
    }
    if (isTouch) { document.ontouchmove = move; document.ontouchend = stop; } else { document.onmousemove = move; document.onmouseup = stop; }
}

function drawCropLines() {
    const c = document.getElementById('crop-canvas');
    const ctx = c.getContext('2d');
    const handles = document.querySelectorAll('.crop-handle');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(previewImgObj, 0, 0, c.width, c.height);
    const p = Array.from(handles).map(h => ({ x: parseFloat(h.style.left), y: parseFloat(h.style.top) }));
    ctx.strokeStyle = '#D0BCFF'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y); for (let i = 1; i < 4; i++) ctx.lineTo(p[i].x, p[i].y); ctx.closePath(); ctx.stroke();
    ctx.fillStyle = 'white'; p.forEach(point => { ctx.beginPath(); ctx.arc(point.x, point.y, 6, 0, Math.PI * 2); ctx.fill(); });
}

function finishCrop() {
    const handles = document.querySelectorAll('.crop-handle');
    const container = document.getElementById('crop-ui-container');
    const scale = parseFloat(container.dataset.scale);
    let p = Array.from(handles).map(h => ({ x: parseFloat(h.style.left) / scale, y: parseFloat(h.style.top) / scale }));

    let src = cv.imread(previewImgObj);
    let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [ p[0].x, p[0].y, p[1].x, p[1].y, p[2].x, p[2].y, p[3].x, p[3].y ]);
    
    let w1 = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
    let w2 = Math.hypot(p[2].x - p[3].x, p[2].y - p[3].y);
    let h1 = Math.hypot(p[3].x - p[0].x, p[3].y - p[0].y);
    let h2 = Math.hypot(p[2].x - p[1].x, p[2].y - p[1].y);
    let maxWidth = Math.max(w1, w2);
    let maxHeight = Math.max(h1, h2);

    let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [ 0, 0, maxWidth, 0, maxWidth, maxHeight, 0, maxHeight ]);
    let M = cv.getPerspectiveTransform(srcTri, dstTri);
    let dst = new cv.Mat();
    cv.warpPerspective(src, dst, M, new cv.Size(maxWidth, maxHeight), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

    let canvas = document.createElement('canvas');
    cv.imshow(canvas, dst);
    
    // Save Result
    let processedImg = canvas.toDataURL('image/jpeg', 0.9);
    
    if (retakeMode) {
        scannedDocs[currentEditIndex] = processedImg;
        // Don't modify rawDocs here, it was done in capture
        openSheet('editor-modal'); // Go back to editor
        document.getElementById('editor-img').src = processedImg;
        retakeMode = false;
    } else {
        saveScan(processedImg, previewImgObj.src); // Pass raw as well
    }

    src.delete(); dst.delete(); M.delete(); srcTri.delete(); dstTri.delete();
    closeSheet('crop-modal');
    isProcessing = false;
}

function saveScan(imgData, rawData) {
    scannedDocs.push(imgData);
    rawDocs.push(rawData); // Save Original
    
    // UPDATE THUMBNAIL
    lastScanImg.src = imgData; 
    lastScanImg.style.display = 'block'; 
    document.querySelector('.placeholder-icon').style.display = 'none';
    scanCount.innerText = scannedDocs.length;
    scanCount.style.display = 'block';

    freezeLayer.style.backgroundImage = `url(${imgData})`;
    freezeLayer.style.display = 'block';
    void freezeLayer.offsetWidth; 
    freezeLayer.classList.add('fly-to-corner');
    setTimeout(() => {
        freezeLayer.style.display = 'none'; freezeLayer.classList.remove('fly-to-corner');
    }, 700);
}

// --- TOOLS: RETAKE & RE-CROP ---
function performRetake() {
    retakeMode = true;
    closeSheet('editor-modal');
    // Camera is already running under UI
    alert("Retake Mode: Capture a new photo to replace this one.");
}

function startReCrop() {
    if (rawDocs[currentEditIndex]) {
        closeSheet('editor-modal');
        retakeMode = true; // Treating re-crop save like a retake save (overwrite)
        prepareCropModal(rawDocs[currentEditIndex], null);
    } else {
        alert("Original image not found.");
    }
}

// --- FILTERS ---
window.applyFilter = function(type) {
    const canvas = document.createElement('canvas'); 
    const ctx = canvas.getContext('2d'); 
    const img = new Image();
    
    img.onload = () => {
        canvas.width = img.width; canvas.height = img.height;
        let src = cv.imread(img);
        let dst = new cv.Mat();

        if (type === 'original') {
            // Revert to raw cropped state (need to store cropped-raw? For now, revert to current saved state)
            // Ideally we re-crop the rawDoc, but let's just use what we have or implement a "clean" copy.
            // Simplified: Just draw image.
            src.copyTo(dst); 
        } 
        else if (type === 'bw') {
            cv.cvtColor(src, src, cv.COLOR_RGBA2GRAY);
            cv.threshold(src, dst, 128, 255, cv.THRESH_BINARY);
        } 
        else if (type === 'gray') {
            cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);
        }
        else if (type === 'magic') {
            cv.cvtColor(src, src, cv.COLOR_RGBA2GRAY);
            cv.adaptiveThreshold(src, dst, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 15, 10);
        }
        else if (type === 'invert') {
            cv.bitwise_not(src, dst);
        }
        else if (type === 'lighten') {
            src.convertTo(dst, -1, 1.2, 30); // Alpha 1.2, Beta 30
        }
        else if (type === 'darken') {
            src.convertTo(dst, -1, 0.8, -30);
        }
        else if (type === 'sharpen') {
            let kernel = cv.matFromArray(3, 3, cv.CV_32F, [0, -1, 0, -1, 5, -1, 0, -1, 0]);
            cv.filter2D(src, dst, -1, kernel);
            kernel.delete();
        }

        cv.imshow(canvas, dst);
        updateCurrentImage(canvas.toDataURL('image/jpeg', 0.9));
        src.delete(); dst.delete();
    };
    // Always filter the CURRENT image in editor to allow stacking? 
    // Or filter the "Saved" version? Let's filter the one on screen for stacking.
    img.src = document.getElementById('editor-img').src; 
};

function rotateImage(angle) {
    const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d'); const img = new Image();
    img.onload = () => {
        if(Math.abs(angle) === 90) {
            canvas.width = img.height; canvas.height = img.width;
            ctx.translate(canvas.width/2, canvas.height/2);
            ctx.rotate(angle * Math.PI / 180);
            ctx.drawImage(img, -img.width/2, -img.height/2);
        }
        updateCurrentImage(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.src = document.getElementById('editor-img').src;
}

function flipImage() {
    const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d'); const img = new Image();
    img.onload = () => {
        canvas.width = img.width; canvas.height = img.height;
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, 0);
        updateCurrentImage(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.src = document.getElementById('editor-img').src;
}

async function extractText() {
    const img = document.getElementById('editor-img');
    alert("Scanning text... wait.");
    try {
        const { data: { text } } = await Tesseract.recognize(img.src, 'eng');
        document.getElementById('ocr-result-area').value = text;
        openSheet('text-result-modal');
    } catch (e) { alert("OCR Failed"); }
}

function copyOCRText() { navigator.clipboard.writeText(document.getElementById('ocr-result-area').value); alert("Copied!"); }

function updateCurrentImage(newData) {
    document.getElementById('editor-img').src = newData;
    scannedDocs[currentEditIndex] = newData;
}

function openGallery() {
    const grid = document.getElementById('gallery-grid'); grid.innerHTML = '';
    
    if (scannedDocs.length === 0) {
        grid.innerHTML = '<div style="text-align:center; padding:40px; color:#666;">No scans yet</div>';
    } else {
        scannedDocs.forEach((doc, index) => {
            const img = document.createElement('img'); img.src = doc; img.onclick = () => { currentEditIndex = index; document.getElementById('editor-img').src = doc; openSheet('editor-modal'); };
            grid.appendChild(img);
        });
    }
    openSheet('gallery-modal');
}

function deleteCurrentPage() {
    if (confirm("Delete page?")) {
        scannedDocs.splice(currentEditIndex, 1);
        rawDocs.splice(currentEditIndex, 1);
        closeSheet('editor-modal');
        openGallery();
        // Update badge
        scanCount.innerText = scannedDocs.length;
        if(scannedDocs.length===0) { 
            scanCount.style.display='none'; 
            document.querySelector('.placeholder-icon').style.display='block'; 
            lastScanImg.style.display='none';
        } else {
            lastScanImg.src = scannedDocs[scannedDocs.length-1];
        }
    }
}

function exportPDF() {
    if (scannedDocs.length === 0) return alert("Scan something first!");
    const { jsPDF } = window.jspdf;
    const pwd = document.getElementById('pdf-password').value;
    const opt = pwd ? { encryption: { userPassword: pwd, ownerPassword: pwd, userPermissions: ["print", "copy"] } } : {};
    const doc = new jsPDF(opt);
    scannedDocs.forEach((img, i) => {
        if (i > 0) doc.addPage();
        const props = doc.getImageProperties(img);
        const w = doc.internal.pageSize.getWidth();
        const h = (props.height * w) / props.width;
        doc.addImage(img, 'JPEG', 0, 0, w, h);
    });
    const blob = doc.output('blob');
    const file = new File([blob], "OpenScan.pdf", { type: "application/pdf" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file], title: 'Scanned Document' });
    else doc.save("OpenScan.pdf");
}
