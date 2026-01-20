console.log("✅ app.js v5.1 (Persistence & Haptics) running");

// --- STATE ---
let scannedDocs = [];   
let rawDocs = [];       
let currentEditIndex = -1;
let detectedQuad = null; 
let isCVReady = false;
let isAutoCaptureOn = true;
let stabilityThreshold = 20;
let stabilityCounter = 0;
let isProcessing = false;
let retakeMode = false;
let focusPoint = null;
let currentStream = null;
let isDrawing = false;
let drawPoints = [];
let scanRegion = null; 

// DOM
const video = document.getElementById('video-feed');
const overlayCanvas = document.getElementById('overlay-canvas');
const gestureCanvas = document.getElementById('gesture-canvas');
const freezeLayer = document.getElementById('freeze-layer');
const statusMsg = document.getElementById('status-msg');
const scanCount = document.getElementById('scan-count');
const lastScanImg = document.getElementById('last-scan-img');
const progressCircle = document.querySelector('.progress-ring__circle');
const qualitySelect = document.getElementById('quality-select');
const autoSpeedSelect = document.getElementById('auto-speed');

// --- INIT ---
document.addEventListener('DOMContentLoaded', () => {
    loadFromStorage();
    setupButtons();
    setupGestures();
    setupTouchFocus();
    
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') alert("HTTPS Required.");
    startCamera();
    if(progressCircle) progressCircle.style.strokeDashoffset = 251; 
    if (typeof cv !== 'undefined' && cv.getBuildInformation) onOpenCVReady();
    else document.addEventListener('opencv_ready', onOpenCVReady);
});

function onOpenCVReady() {
    isCVReady = true;
    console.log("OpenCV Ready");
    statusMsg.innerText = "Draw to Scan";
    requestAnimationFrame(processVideoFrame);
}

// --- STORAGE ---
function loadFromStorage() {
    const saved = localStorage.getItem('openScanDocs');
    if (saved) {
        scannedDocs = JSON.parse(saved);
        scanCount.innerText = scannedDocs.length;
        if (scannedDocs.length > 0) {
            lastScanImg.src = scannedDocs[scannedDocs.length - 1];
            lastScanImg.style.display = 'block';
            document.querySelector('.placeholder-icon').style.display = 'none';
            scanCount.style.display = 'block';
        }
    }
}

function saveToStorage() {
    try {
        localStorage.setItem('openScanDocs', JSON.stringify(scannedDocs));
    } catch (e) {
        alert("Storage Full! Delete some scans.");
    }
}

// --- GESTURES ---
function setupGestures() {
    const ctx = gestureCanvas.getContext('2d');
    function start(e) {
        if(e.target.closest('button')) return;
        isDrawing = true; drawPoints = []; ctx.clearRect(0,0,gestureCanvas.width, gestureCanvas.height); scanRegion = null; statusMsg.innerText = "Drawing...";
    }
    function move(e) {
        if(!isDrawing) return;
        e.preventDefault();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        drawPoints.push({x: clientX, y: clientY});
        ctx.beginPath(); ctx.lineWidth = 4; ctx.strokeStyle = '#D0BCFF'; ctx.lineCap = 'round';
        if (drawPoints.length > 1) { ctx.moveTo(drawPoints[drawPoints.length-2].x, drawPoints[drawPoints.length-2].y); ctx.lineTo(clientX, clientY); }
        ctx.stroke();
    }
    function end() {
        if(!isDrawing) return;
        isDrawing = false;
        if (drawPoints.length > 10) {
            let minX = Infinity, maxX = 0, minY = Infinity, maxY = 0;
            drawPoints.forEach(p => { if(p.x < minX) minX = p.x; if(p.x > maxX) maxX = p.x; if(p.y < minY) minY = p.y; if(p.y > maxY) maxY = p.y; });
            const rect = video.getBoundingClientRect();
            const scaleX = video.videoWidth / rect.width;
            const scaleY = video.videoHeight / rect.height;
            scanRegion = { x: (minX - rect.left) * scaleX, y: (minY - rect.top) * scaleY, width: (maxX - minX) * scaleX, height: (maxY - minY) * scaleY };
            statusMsg.innerText = "Scanning Region";
            setTimeout(() => ctx.clearRect(0,0,gestureCanvas.width, gestureCanvas.height), 1000);
        } else {
            statusMsg.innerText = "Ready"; ctx.clearRect(0,0,gestureCanvas.width, gestureCanvas.height);
        }
    }
    gestureCanvas.addEventListener('mousedown', start); gestureCanvas.addEventListener('mousemove', move); gestureCanvas.addEventListener('mouseup', end);
    gestureCanvas.addEventListener('touchstart', start); gestureCanvas.addEventListener('touchmove', move); gestureCanvas.addEventListener('touchend', end);
    window.addEventListener('resize', () => { gestureCanvas.width = window.innerWidth; gestureCanvas.height = window.innerHeight; });
    gestureCanvas.width = window.innerWidth; gestureCanvas.height = window.innerHeight;
}

// --- AI LOOP ---
function processVideoFrame() {
    if (!isCVReady || video.paused || video.ended || video.videoWidth === 0 || isProcessing) { requestAnimationFrame(processVideoFrame); return; }
    try {
        const width = video.videoWidth, height = video.videoHeight, ctx = overlayCanvas.getContext('2d');
        let src = new cv.Mat(height, width, cv.CV_8UC4); let cap = new cv.VideoCapture(video); cap.read(src);
        let gray = new cv.Mat(); cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY); cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
        let edges = new cv.Mat(); cv.Canny(gray, edges, 30, 150);
        let contours = new cv.MatVector(); let hierarchy = new cv.Mat(); cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        let bestContour = null; let maxArea = 0; let minArea = width * height * 0.05;

        for (let i = 0; i < contours.size(); ++i) {
            let cnt = contours.get(i); let area = cv.contourArea(cnt);
            if (area > minArea) {
                if (scanRegion) {
                    let M = cv.moments(cnt); let cX = M.m10 / M.m00; let cY = M.m01 / M.m00;
                    if (cX < scanRegion.x || cX > scanRegion.x + scanRegion.width || cY < scanRegion.y || cY > scanRegion.y + scanRegion.height) { cnt.delete(); continue; }
                }
                if (focusPoint && cv.pointPolygonTest(cnt, new cv.Point(focusPoint.x, focusPoint.y), false) < 0) { cnt.delete(); continue; }
                if (area > maxArea) { maxArea = area; if (bestContour) bestContour.delete(); bestContour = cnt; } else { cnt.delete(); }
            } else { cnt.delete(); }
        }

        ctx.clearRect(0, 0, width, height); ctx.lineWidth = 4;
        if (bestContour) {
            let hull = new cv.Mat(); cv.convexHull(bestContour, hull, false, true);
            let approx = new cv.Mat(); let peri = cv.arcLength(hull, true); cv.approxPolyDP(hull, approx, 0.02 * peri, true);
            let points = []; for (let i = 0; i < approx.rows; i++) points.push({ x: approx.data32S[i * 2], y: approx.data32S[i * 2 + 1] });
            if (points.length >= 4) {
                let tl = points.reduce((p, c) => (c.x + c.y) < (p.x + p.y) ? c : p); let br = points.reduce((p, c) => (c.x + c.y) > (p.x + p.y) ? c : p);
                let tr = points.reduce((p, c) => (c.x - c.y) > (p.x - p.y) ? c : p); let bl = points.reduce((p, c) => (c.x - c.y) < (p.x - p.y) ? c : p);
                detectedQuad = [tl, tr, br, bl]; 
            } else detectedQuad = sortPoints(points);

            ctx.strokeStyle = '#D0BCFF'; ctx.fillStyle = 'rgba(208, 188, 255, 0.2)';
            ctx.beginPath(); ctx.moveTo(detectedQuad[0].x, detectedQuad[0].y); for (let i = 1; i < 4; i++) ctx.lineTo(detectedQuad[i].x, detectedQuad[i].y); ctx.closePath(); ctx.stroke(); ctx.fill();

            if (isAutoCaptureOn) {
                stabilityCounter++; statusMsg.innerText = "Hold Still";
                let progress = stabilityCounter / stabilityThreshold; progressCircle.style.strokeDashoffset = 251 - (251 * progress);
                if (stabilityCounter >= stabilityThreshold) { statusMsg.innerText = "Capturing!"; captureImage(false); stabilityCounter = 0; progressCircle.style.strokeDashoffset = 251; }
            } else { statusMsg.innerText = "Detected"; stabilityCounter = 0; progressCircle.style.strokeDashoffset = 251; }
            hull.delete(); approx.delete(); bestContour.delete();
        } else {
            detectedQuad = null; stabilityCounter = 0; progressCircle.style.strokeDashoffset = 251; statusMsg.innerText = scanRegion ? "Scanning..." : "Draw or Aim";
        }
        src.delete(); gray.delete(); edges.delete(); contours.delete(); hierarchy.delete();
    } catch (err) { console.log(err); }
    requestAnimationFrame(processVideoFrame);
}

function detectCornersOnImage(imgSrc) {
    return new Promise((resolve) => {
        let img = new Image(); img.onload = () => {
            let src = cv.imread(img); let gray = new cv.Mat(); cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY); cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
            let edges = new cv.Mat(); cv.Canny(gray, edges, 30, 150); let contours = new cv.MatVector(); let hierarchy = new cv.Mat();
            cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
            let bestContour = null; let maxArea = 0; let minArea = (img.width * img.height) * 0.05;
            for (let i = 0; i < contours.size(); ++i) {
                let cnt = contours.get(i); let area = cv.contourArea(cnt);
                if (area > maxArea && area > minArea) { maxArea = area; if (bestContour) bestContour.delete(); bestContour = cnt; } else { cnt.delete(); }
            }
            let foundQuad = null;
            if (bestContour) {
                let hull = new cv.Mat(); cv.convexHull(bestContour, hull, false, true);
                let approx = new cv.Mat(); cv.approxPolyDP(hull, approx, 0.02 * cv.arcLength(hull, true), true);
                let points = []; for (let i = 0; i < approx.rows; i++) points.push({ x: approx.data32S[i * 2], y: approx.data32S[i * 2 + 1] });
                if (points.length >= 4) {
                    let tl = points.reduce((p, c) => (c.x + c.y) < (p.x + p.y) ? c : p); let br = points.reduce((p, c) => (c.x + c.y) > (p.x + p.y) ? c : p);
                    let tr = points.reduce((p, c) => (c.x - c.y) > (p.x - p.y) ? c : p); let bl = points.reduce((p, c) => (c.x - c.y) < (p.x - p.y) ? c : p);
                    foundQuad = [tl, tr, br, bl];
                } else foundQuad = sortPoints(points);
                hull.delete(); approx.delete(); bestContour.delete();
            }
            src.delete(); gray.delete(); edges.delete(); contours.delete(); hierarchy.delete(); resolve(foundQuad);
        }; img.src = imgSrc;
    });
}

async function captureImage(manual = true) {
    if (navigator.vibrate) navigator.vibrate(50);
    isProcessing = true; stabilityCounter = 0; progressCircle.style.strokeDashoffset = 251;
    video.style.opacity = "0.2"; setTimeout(() => video.style.opacity = "1", 150);
    const hidden = document.getElementById('hidden-canvas'); hidden.width = video.videoWidth; hidden.height = video.videoHeight;
    const ctx = hidden.getContext('2d'); ctx.drawImage(video, 0, 0); const rawData = hidden.toDataURL('image/jpeg', 1.0);
    let pointsToUse = detectedQuad;
    if (manual) { statusMsg.innerText = "Analyzing..."; const manualQuad = await detectCornersOnImage(rawData); if (manualQuad) pointsToUse = manualQuad; }
    if (retakeMode) { rawDocs[currentEditIndex] = rawData; setTimeout(() => prepareCropModal(rawData, pointsToUse), 200); }
    else { setTimeout(() => prepareCropModal(rawData, pointsToUse), 200); }
}

function sortPoints(points) { if (points.length !== 4) return points; points.sort((a, b) => a.y - b.y); let top = points.slice(0, 2).sort((a, b) => a.x - b.x); let bottom = points.slice(2, 4).sort((a, b) => b.x - a.x); return [top[0], top[1], bottom[0], bottom[1]]; }
function startCamera(overrideWidth = null) {
    const quality = qualitySelect.value; let width = overrideWidth || 1920; let height = (width === 3840) ? 2160 : (width === 1280 ? 720 : 1080);
    if (!overrideWidth) { if (quality === '4k') width = 3840; else if (quality === '720p') width = 1280; }
    if (currentStream) currentStream.getTracks().forEach(track => track.stop());
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: width }, height: { ideal: height } }, audio: false })
        .then(stream => { currentStream = stream; video.srcObject = stream; video.onloadedmetadata = () => { video.play(); resizeCanvas(); window.addEventListener('resize', resizeCanvas); }; })
        .catch(e => { if (width > 1280) startCamera(1280); else statusMsg.innerText = "No Camera"; });
}
function resizeCanvas() { if (video.videoWidth > 0) { overlayCanvas.width = video.videoWidth; overlayCanvas.height = video.videoHeight; gestureCanvas.width = window.innerWidth; gestureCanvas.height = window.innerHeight; video.width = video.videoWidth; video.height = video.videoHeight; } }
function setupButtons() {
    document.getElementById('auto-toggle').onclick = () => { isAutoCaptureOn = !isAutoCaptureOn; document.getElementById('auto-text').innerText = isAutoCaptureOn ? "Auto" : "Manual"; document.getElementById('auto-toggle').style.opacity = isAutoCaptureOn ? "1" : "0.5"; progressCircle.style.strokeDashoffset = 251; };
    autoSpeedSelect.onchange = () => { stabilityThreshold = parseInt(autoSpeedSelect.value); };
    qualitySelect.onchange = () => startCamera();
    document.getElementById('capture-btn').onclick = () => captureImage(true);
    document.getElementById('gallery-trigger').onclick = openGallery;
    document.getElementById('close-gallery').onclick = () => closeSheet('gallery-modal');
    document.getElementById('settings-btn').onclick = () => openSheet('settings-modal');
    document.getElementById('close-settings').onclick = () => closeSheet('settings-modal');
    document.getElementById('tutorial-btn').onclick = () => { closeSheet('settings-modal'); openSheet('tutorial-modal'); };
    document.getElementById('close-tutorial').onclick = () => closeSheet('tutorial-modal');
    document.getElementById('about-btn').onclick = () => { closeSheet('settings-modal'); openSheet('about-modal'); };
    document.getElementById('close-about').onclick = () => closeSheet('about-modal');
    document.getElementById('close-editor').onclick = () => closeSheet('editor-modal');
    document.getElementById('save-editor').onclick = () => { closeSheet('editor-modal'); openGallery(); };
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
        const rect = video.getBoundingClientRect(); const scaleX = video.videoWidth / rect.width; const scaleY = video.videoHeight / rect.height;
        focusPoint = { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
        focusRing.style.display = 'block'; focusRing.style.left = e.clientX + 'px'; focusRing.style.top = e.clientY + 'px';
        if (focusTimer) clearTimeout(focusTimer); focusTimer = setTimeout(() => { focusPoint = null; focusRing.style.display = 'none'; }, 4000);
        if(navigator.vibrate) navigator.vibrate(10);
    });
}
function prepareCropModal(imgSrc, autoPoints) {
    const container = document.getElementById('crop-ui-container'); const c = document.getElementById('crop-canvas'); previewImgObj = new Image();
    previewImgObj.onload = () => {
        const maxW = window.innerWidth * 0.9, maxH = window.innerHeight * 0.7;
        const scale = Math.min(maxW / previewImgObj.width, maxH / previewImgObj.height);
        const finalW = Math.floor(previewImgObj.width * scale), finalH = Math.floor(previewImgObj.height * scale);
        container.style.width = finalW + "px"; container.style.height = finalH + "px"; c.width = finalW; c.height = finalH; container.dataset.scale = scale;
        openSheet('crop-modal'); setupHandles(finalW, finalH, autoPoints, scale); drawCropLines();
    }; previewImgObj.src = imgSrc;
}
function setupHandles(w, h, autoPoints, scale) {
    const handles = document.querySelectorAll('.crop-handle');
    let positions = (autoPoints && autoPoints.length === 4) ? [{ x: autoPoints[0].x * scale, y: autoPoints[0].y * scale }, { x: autoPoints[1].x * scale, y: autoPoints[1].y * scale }, { x: autoPoints[2].x * scale, y: autoPoints[2].y * scale }, { x: autoPoints[3].x * scale, y: autoPoints[3].y * scale }] : [{ x: w * 0.2, y: h * 0.2 }, { x: w * 0.8, y: h * 0.2 }, { x: w * 0.8, y: h * 0.8 }, { x: w * 0.2, y: h * 0.8 }];
    handles.forEach((handle, i) => { handle.style.left = positions[i].x + 'px'; handle.style.top = positions[i].y + 'px'; handle.onmousedown = (e) => startDrag(e, handle, document.getElementById('crop-ui-container'), false); handle.ontouchstart = (e) => startDrag(e, handle, document.getElementById('crop-ui-container'), true); });
}
function startDrag(e, handle, container, isTouch) {
    e.preventDefault(); const rect = container.getBoundingClientRect();
    function move(event) { event.preventDefault(); const cx = isTouch ? event.touches[0].clientX : event.clientX; const cy = isTouch ? event.touches[0].clientY : event.clientY; handle
