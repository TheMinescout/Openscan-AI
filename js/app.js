console.log("✅ app.js v5.0 (Final Complete) running");

// --- STATE MANAGEMENT ---
let scannedDocs = [];   // Stores processed/edited images
let rawDocs = [];       // Stores original camera captures (for Re-Crop)
let currentEditIndex = -1;
let detectedQuad = null; 
let isCVReady = false;
let isAutoCaptureOn = true;
let stabilityThreshold = 20; 
let stabilityCounter = 0;
let isProcessing = false;
let retakeMode = false;
let focusPoint = null;
let focusTimer = null;
let currentStream = null;

// Drawing State (Circle-to-Scan)
let isDrawing = false;
let drawPoints = [];
let scanRegion = null; 

// DOM Elements
const video = document.getElementById('video-feed');
const overlayCanvas = document.getElementById('overlay-canvas');
const gestureCanvas = document.getElementById('gesture-canvas');
const freezeLayer = document.getElementById('freeze-layer');
const statusMsg = document.getElementById('status-msg');
const scanCount = document.getElementById('scan-count');
const lastScanImg = document.getElementById('last-scan-img');
const focusRing = document.getElementById('focus-ring');
const progressCircle = document.querySelector('.progress-ring__circle');
const qualitySelect = document.getElementById('quality-select');
const autoSpeedSelect = document.getElementById('auto-speed');

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    setupButtons();
    setupGestures();
    setupTouchFocus();
    
    // Security Check
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        alert("Camera requires HTTPS. Please run on localhost or a secure server.");
    }

    startCamera();
    
    // Reset Progress Ring
    if(progressCircle) progressCircle.style.strokeDashoffset = 251; 

    // Initialize OpenCV
    if (typeof cv !== 'undefined' && cv.getBuildInformation) {
        onOpenCVReady();
    } else {
        document.addEventListener('opencv_ready', onOpenCVReady);
        // Fallback check
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
    console.log("OpenCV Ready");
    statusMsg.innerText = "Draw to Scan";
    requestAnimationFrame(processVideoFrame);
}

// --- GESTURE LOGIC (Circle to Scan) ---
function setupGestures() {
    const ctx = gestureCanvas.getContext('2d');
    
    function start(e) {
        if(e.target.closest('button')) return; // Ignore button clicks
        isDrawing = true;
        drawPoints = [];
        ctx.clearRect(0,0,gestureCanvas.width, gestureCanvas.height);
        scanRegion = null; // Reset existing region
        statusMsg.innerText = "Drawing...";
    }

    function move(e) {
        if(!isDrawing) return;
        e.preventDefault(); // Prevent scrolling while drawing
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        
        drawPoints.push({x: clientX, y: clientY});
        
        // Draw visual trail
        ctx.beginPath();
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#D0BCFF';
        ctx.lineCap = 'round';
        if (drawPoints.length > 1) {
            ctx.moveTo(drawPoints[drawPoints.length-2].x, drawPoints[drawPoints.length-2].y);
            ctx.lineTo(clientX, clientY);
        }
        ctx.stroke();
    }

    function end() {
        if(!isDrawing) return;
        isDrawing = false;
        
        if (drawPoints.length > 10) {
            // Calculate Bounding Box
            let minX = Infinity, maxX = 0, minY = Infinity, maxY = 0;
            drawPoints.forEach(p => {
                if(p.x < minX) minX = p.x;
                if(p.x > maxX) maxX = p.x;
                if(p.y < minY) minY = p.y;
                if(p.y > maxY) maxY = p.y;
            });
            
            // Map to Video Coordinates
            const rect = video.getBoundingClientRect();
            const scaleX = video.videoWidth / rect.width;
            const scaleY = video.videoHeight / rect.height;

            scanRegion = {
                x: (minX - rect.left) * scaleX,
                y: (minY - rect.top) * scaleY,
                width: (maxX - minX) * scaleX,
                height: (maxY - minY) * scaleY
            };
            
            statusMsg.innerText = "Scanning Region";
            // Fade out the drawing after 1s
            setTimeout(() => ctx.clearRect(0,0,gestureCanvas.width, gestureCanvas.height), 1000);
        } else {
            // Tap or short line -> Reset
            statusMsg.innerText = "Ready";
            ctx.clearRect(0,0,gestureCanvas.width, gestureCanvas.height);
        }
    }

    // Attach Listeners
    gestureCanvas.addEventListener('mousedown', start);
    gestureCanvas.addEventListener('mousemove', move);
    gestureCanvas.addEventListener('mouseup', end);
    gestureCanvas.addEventListener('touchstart', start);
    gestureCanvas.addEventListener('touchmove', move);
    gestureCanvas.addEventListener('touchend', end);
    
    // Handle Window Resize
    window.addEventListener('resize', () => {
        gestureCanvas.width = window.innerWidth;
        gestureCanvas.height = window.innerHeight;
    });
    gestureCanvas.width = window.innerWidth;
    gestureCanvas.height = window.innerHeight;
}

// --- AI PROCESSING LOOP ---
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
        // Slight Blur to reduce noise
        cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
        
        let edges = new cv.Mat();
        // Looser Thresholds (30, 150) to catch faint edges better
        cv.Canny(gray, edges, 30, 150);
        
        let contours = new cv.MatVector();
        let hierarchy = new cv.Mat();
        cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        let bestContour = null;
        let maxArea = 0;
        // Min area 5% of screen (was 10%) - more sensitive
        let minArea = width * height * 0.05; 

        for (let i = 0; i < contours.size(); ++i) {
            let cnt = contours.get(i);
            let area = cv.contourArea(cnt);
            
            if (area > minArea) {
                // If a region is drawn, ignore contours outside it
                if (scanRegion) {
                    let M = cv.moments(cnt);
                    let cX = M.m10 / M.m00;
                    let cY = M.m01 / M.m00;
                    
                    if (cX < scanRegion.x || cX > scanRegion.x + scanRegion.width ||
                        cY < scanRegion.y || cY > scanRegion.y + scanRegion.height) {
                        cnt.delete(); continue;
                    }
                }

                // If Touch Focus is active, ignore contours far away
                if (focusPoint) {
                    if (cv.pointPolygonTest(cnt, new cv.Point(focusPoint.x, focusPoint.y), false) < 0) {
                        cnt.delete(); continue;
                    }
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
            
            // Standardize to 4 corners
            if (points.length >= 4) {
                let tl = points.reduce((prev, curr) => (curr.x + curr.y) < (prev.x + prev.y) ? curr : prev);
                let br = points.reduce((prev, curr) => (curr.x + curr.y) > (prev.x + prev.y) ? curr : prev);
                let tr = points.reduce((prev, curr) => (curr.x - curr.y) > (prev.x - prev.y) ? curr : prev);
                let bl = points.reduce((prev, curr) => (curr.x - curr.y) < (prev.x - prev.y) ? curr : prev);
                detectedQuad = [tl, tr, br, bl]; 
            } else { detectedQuad = sortPoints(points); }

            // Draw Blue Box
            ctx.strokeStyle = '#D0BCFF'; ctx.fillStyle = 'rgba(208, 188, 255, 0.2)';
            ctx.beginPath(); ctx.moveTo(detectedQuad[0].x, detectedQuad[0].y);
            for (let i = 1; i < 4; i++) ctx.lineTo(detectedQuad[i].x, detectedQuad[i].y);
            ctx.closePath(); ctx.stroke(); ctx.fill();

            // Auto Capture Logic
            if (isAutoCaptureOn) {
                stabilityCounter++;
                statusMsg.innerText = "Hold Still";
                let progress = stabilityCounter / stabilityThreshold;
                progressCircle.style.strokeDashoffset = 251 - (251 * progress);

                if (stabilityCounter >= stabilityThreshold) {
                    statusMsg.innerText = "Capturing!";
                    captureImage(false); // False = Auto Mode
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
            statusMsg.innerText = scanRegion ? "Scanning Region..." : "Draw or Aim";
        }
        src.delete(); gray.delete(); edges.delete(); contours.delete(); hierarchy.delete();
    } catch (err) { console.log(err); }
    requestAnimationFrame(processVideoFrame);
}

// --- MANUAL DETECTION (One-Shot on Static Image) ---
function detectCornersOnImage(imgSrc) {
    return new Promise((resolve) => {
        let img = new Image();
        img.onload = () => {
            let src = cv.imread(img);
            let gray = new cv.Mat();
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
            cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
            let edges = new cv.Mat();
            cv.Canny(gray, edges, 30, 150); // Loose thresholds
            let contours = new cv.MatVector();
            let hierarchy = new cv.Mat();
            cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

            let bestContour = null;
            let maxArea = 0;
            let minArea = (img.width * img.height) * 0.05;

            for (let i = 0; i < contours.size(); ++i) {
                let cnt = contours.get(i);
                let area = cv.contourArea(cnt);
                if (area > maxArea && area > minArea) {
                    maxArea = area;
                    if (bestContour) bestContour.delete();
                    bestContour = cnt;
                } else { cnt.delete(); }
            }

            let foundQuad = null;
            if (bestContour) {
                let hull = new cv.Mat();
                cv.convexHull(bestContour, hull, false, true);
                let approx = new cv.Mat();
                cv.approxPolyDP(hull, approx, 0.02 * cv.arcLength(hull, true), true);
                
                let points = [];
                for (let i = 0; i < approx.rows; i++) points.push({ x: approx.data32S[i * 2], y: approx.data32S[i * 2 + 1] });
                
                if (points.length >= 4) {
                    let tl = points.reduce((prev, curr) => (curr.x + curr.y) < (prev.x + prev.y) ? curr : prev);
                    let br = points.reduce((prev, curr) => (curr.x + curr.y) > (prev.x + prev.y) ? curr : prev);
                    let tr = points.reduce((prev, curr) => (curr.x - curr.y) > (prev.x - prev.y) ? curr : prev);
                    let bl = points.reduce((prev, curr) => (curr.x - curr.y) < (prev.x - prev.y) ? curr : prev);
                    foundQuad = [tl, tr, br, bl];
                } else {
                    foundQuad = sortPoints(points); 
                }
                hull.delete(); approx.delete(); bestContour.delete();
            }
            
            src.delete(); gray.delete(); edges.delete(); contours.delete(); hierarchy.delete();
            resolve(foundQuad);
        };
        img.src = imgSrc;
    });
}

// --- CAPTURE & WORKFLOW ---
async function captureImage(manual = true) {
    isProcessing = true;
    stabilityCounter = 0;
    progressCircle.style.strokeDashoffset = 251;
    video.style.opacity = "0.2"; setTimeout(() => video.style.opacity = "1", 150);

    const hidden = document.getElementById('hidden-canvas');
    hidden.width = video.videoWidth; hidden.height = video.videoHeight;
    const ctx = hidden.getContext('2d');
    ctx.drawImage(video, 0, 0);
    const rawData = hidden.toDataURL('image/jpeg', 1.0); // Save High Quality
    
    // If Manual: Run detection on the captured image
    let pointsToUse = detectedQuad;
    if (manual) {
        statusMsg.innerText = "Analyzing...";
        const manualQuad = await detectCornersOnImage(rawData);
        if (manualQuad) pointsToUse = manualQuad;
    }

    if (retakeMode) {
        rawDocs[currentEditIndex] = rawData; 
        setTimeout(() => prepareCropModal(rawData, pointsToUse), 200);
    } else {
        setTimeout(() => prepareCropModal(rawData, pointsToUse), 200);
    }
}

// --- UTILS ---
function sortPoints(points) {
    if (points.length !== 4) return points;
    points.sort((a, b) => a.y - b.y);
    let top = points.slice(0, 2).sort((a, b) => a.x - b.x);
    let bottom = points.slice(2, 4).sort((a, b) => b.x - a.x);
    return [top[0], top[1], bottom[0], bottom[1]];
}

function startCamera(overrideWidth = null) {
    const quality = qualitySelect.value;
    let width = overrideWidth || 1920; 
    let height = (width === 3840) ? 2160 : (width === 1280 ? 720 : 1080);
    if (!overrideWidth) { if (quality === '4k') width = 3840; else if (quality === '720p') width = 1280; }
    
    if (currentStream) currentStream.getTracks().forEach(track => track.stop());

    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: width }, height: { ideal: height } }, audio: false })
        .then(stream => { 
            currentStream = stream; 
            video.srcObject = stream; 
            video.onloadedmetadata = () => { video.play(); resizeCanvas(); window.addEventListener('resize', resizeCanvas); }; 
        })
        .catch(e => { 
            if (width > 1280) startCamera(1280); 
            else statusMsg.innerText = "No Camera"; 
        });
}

function resizeCanvas() {
    if (video.videoWidth > 0) {
        overlayCanvas.width = video.videoWidth; overlayCanvas.height = video.videoHeight;
        gestureCanvas.width = window.innerWidth; gestureCanvas.height = window.innerHeight;
        video.width = video.videoWidth; video.height = video.videoHeight;
    }
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

// --- CROP LOGIC ---
function prepareCropModal(imgSrc, autoPoints) {
    const container = document.getElementById('crop-ui-container');
    const c = document.getElementById('crop-canvas');
    previewImgObj = new Image();
    previewImgObj.onload = () => {
        const maxW = window.innerWidth * 0.9, maxH = window.innerHeight * 0.7;
        const scale = Math.min(maxW / previewImgObj.width, maxH / previewImgObj.height);
        const finalW = Math.floor(previewImgObj.width * scale), finalH = Math.floor(previewImgObj.height * scale);
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
    let positions = (autoPoints && autoPoints.length === 4) ? 
        [{ x: autoPoints[0].x * scale, y: autoPoints[0].y * scale }, { x: autoPoints[1].x * scale, y: autoPoints[1].y * scale }, { x: autoPoints[2].x * scale, y: autoPoints[2].y * scale }, { x: autoPoints[3].x * scale, y: autoPoints[3].y * scale }] :
        [{ x: w * 0.2, y: h * 0.2 }, { x: w * 0.8, y: h * 0.2 }, { x: w * 0.8, y: h * 0.8 }, { x: w * 0.2, y: h * 0.8 }];
    handles.forEach((handle, i) => {
        handle.style.left = positions[i].x + 'px'; handle.style.top = positions[i].y + 'px';
        handle.onmousedown = (e) => startDrag(e, handle, document.getElementById('crop-ui-container'), false);
        handle.ontouchstart = (e) => startDrag(e, handle, document.getElementById('crop-ui-container'), true);
    });
}

function startDrag(e, handle, container, isTouch) {
    e.preventDefault();
    const rect = container.getBoundingClientRect();
    function move(event) {
        event.preventDefault();
        const cx = isTouch ? event.touches[0].clientX : event.clientX;
        const cy = isTouch ? event.touches[0].clientY : event.clientY;
        handle.style.left = (cx - rect.left) + 'px'; handle.style.top = (cy - rect.top) + 'px';
        requestAnimationFrame(drawCropLines);
    }
    function stop() { if (isTouch) { document.ontouchmove = null; document.ontouchend = null; } else { document.onmousemove = null; document.onmouseup = null; } }
    if (isTouch) { document.ontouchmove = move; document.ontouchend = stop; } else { document.onmousemove = move; document.onmouseup = stop; }
}

function drawCropLines() {
    const c = document.getElementById('crop-canvas'), ctx = c.getContext('2d');
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
    const scale = parseFloat(document.getElementById('crop-ui-container').dataset.scale);
    let p = Array.from(handles).map(h => ({ x: parseFloat(h.style.left) / scale, y: parseFloat(h.style.top) / scale }));
    
    let src = cv.imread(previewImgObj);
    let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [ p[0].x, p[0].y, p[1].x, p[1].y, p[2].x, p[2].y, p[3].x, p[3].y ]);
    
    let w1 = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y), w2 = Math.hypot(p[2].x - p[3].x, p[2].y - p[3].y);
    let h1 = Math.hypot(p[3].x - p[0].x, p[3].y - p[0].y), h2 = Math.hypot(p[2].x - p[1].x, p[2].y - p[1].y);
    let maxWidth = Math.max(w1, w2), maxHeight = Math.max(h1, h2);

    let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [ 0, 0, maxWidth, 0, maxWidth, maxHeight, 0, maxHeight ]);
    let M = cv.getPerspectiveTransform(srcTri, dstTri);
    let dst = new cv.Mat();
    cv.warpPerspective(src, dst, M, new cv.Size(maxWidth, maxHeight), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

    let canvas = document.createElement('canvas');
    cv.imshow(canvas, dst);
    let processedImg = canvas.toDataURL('image/jpeg', 0.9);
    
    if (retakeMode) {
        scannedDocs[currentEditIndex] = processedImg;
        document.getElementById('editor-img').src = processedImg;
        retakeMode = false;
        closeSheet('crop-modal'); openSheet('editor-modal');
    } else {
        saveScan(processedImg, previewImgObj.src);
        closeSheet('crop-modal');
    }
    src.delete(); dst.delete(); M.delete(); srcTri.delete(); dstTri.delete();
    isProcessing = false;
}

function saveScan(imgData, rawData) {
    scannedDocs.push(imgData); rawDocs.push(rawData);
    lastScanImg.src = imgData; lastScanImg.style.display = 'block'; 
    document.querySelector('.placeholder-icon').style.display = 'none';
    scanCount.innerText = scannedDocs.length; scanCount.style.display = 'block';
    freezeLayer.style.backgroundImage = `url(${imgData})`; freezeLayer.style.display = 'block';
    void freezeLayer.offsetWidth; freezeLayer.classList.add('fly-to-corner');
    setTimeout(() => { freezeLayer.style.display = 'none'; freezeLayer.classList.remove('fly-to-corner'); isProcessing = false; }, 700);
}

// --- TOOLS: RETAKE & RE-CROP (Closing Gallery Fix) ---
function performRetake() {
    retakeMode = true;
    closeSheet('editor-modal');
    closeSheet('gallery-modal'); // Force Close Gallery
    statusMsg.innerText = "Snap to Replace";
    statusMsg.style.background = "rgba(255, 150, 0, 0.8)";
}

function startReCrop() {
    if (rawDocs[currentEditIndex]) {
        closeSheet('editor-modal');
        closeSheet('gallery-modal'); // Force Close Gallery
        retakeMode = true; 
        prepareCropModal(rawDocs[currentEditIndex], null);
    } else {
        alert("Original image not found.");
    }
}

// --- FILTERS & EDITING ---
window.applyFilter = function(type) {
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d'), img = new Image();
    img.onload = () => {
        canvas.width = img.width; canvas.height = img.height;
        let src = cv.imread(img), dst = new cv.Mat();
        if (type === 'original') src.copyTo(dst);
        else if (type === 'bw') { cv.cvtColor(src, src, cv.COLOR_RGBA2GRAY); cv.threshold(src, dst, 128, 255, cv.THRESH_BINARY); }
        else if (type === 'magic') { cv.cvtColor(src, src, cv.COLOR_RGBA2GRAY); cv.adaptiveThreshold(src, dst, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 15, 10); }
        else if (type === 'invert') cv.bitwise_not(src, dst);
        cv.imshow(canvas, dst); updateCurrentImage(canvas.toDataURL('image/jpeg', 0.9)); src.delete(); dst.delete();
    }; img.src = document.getElementById('editor-img').src; 
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
        ctx.translate(canvas.width, 0); ctx.scale(-1, 1);
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

function updateCurrentImage(newData) { document.getElementById('editor-img').src = newData; scannedDocs[currentEditIndex] = newData; }

function openGallery() {
    const grid = document.getElementById('gallery-grid'); grid.innerHTML = '';
    if (scannedDocs.length === 0) grid.innerHTML = '<div style="text-align:center; padding:40px; color:#666;">No scans</div>';
    else scannedDocs.forEach((doc, index) => {
        const img = document.createElement('img'); img.src = doc; 
        img.onclick = () => { currentEditIndex = index; document.getElementById('editor-img').src = doc; openSheet('editor-modal'); };
        grid.appendChild(img);
    });
    openSheet('gallery-modal');
}

function deleteCurrentPage() { if(confirm("Delete?")) { scannedDocs.splice(currentEditIndex, 1); rawDocs.splice(currentEditIndex, 1); closeSheet('editor-modal'); openGallery(); scanCount.innerText = scannedDocs.length; } }

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
