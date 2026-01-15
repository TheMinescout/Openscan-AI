// --- STATE ---
let scannedDocs = [];
let currentRawImg = null;
let currentEditIndex = -1;
let detectedQuad = null; 
let isCVReady = false;
let isAutoCaptureOn = true;
let stabilityCounter = 0;
const STABILITY_THRESHOLD = 20;
let isProcessing = false;
let focusPoint = null;
let focusTimer = null;
let currentStream = null; // Track stream to stop it when changing quality

const video = document.getElementById('video-feed');
const overlayCanvas = document.getElementById('overlay-canvas');
const freezeLayer = document.getElementById('freeze-layer');
const statusMsg = document.getElementById('status-msg');
const scanCount = document.getElementById('scan-count');
const lastScanImg = document.getElementById('last-scan-img');
const uiLayer = document.querySelector('.ui-layer');
const focusRing = document.getElementById('focus-ring');
const autoToggleBtn = document.getElementById('auto-toggle');
const progressCircle = document.querySelector('.progress-ring__circle');
const qualitySelect = document.getElementById('quality-select'); // NEW

document.addEventListener('DOMContentLoaded', () => {
    setupButtons();
    setupTouchFocus(); 
    startCamera(); // Starts with default (1080p)
    
    if(progressCircle) progressCircle.style.strokeDashoffset = 238;

    if (typeof cv !== 'undefined' && cv.getBuildInformation) {
        onOpenCVReady();
    } else {
        document.addEventListener('opencv_ready', onOpenCVReady);
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
    statusMsg.innerText = "Scanner Active";
    requestAnimationFrame(processVideoFrame);
}

// --- CAMERA LOGIC ---
async function startCamera() {
    // 1. Get Selected Quality
    const quality = qualitySelect.value;
    let width = 1920, height = 1080; // Default 1080p

    if (quality === '4k') { width = 3840; height = 2160; }
    else if (quality === '720p') { width = 1280; height = 720; }

    // 2. Stop old stream if exists
    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                facingMode: "environment", 
                width: { ideal: width }, 
                height: { ideal: height } 
            },
            audio: false
        });
        
        currentStream = stream;
        video.srcObject = stream;
        
        video.onloadedmetadata = () => {
            video.play();
            resizeCanvas();
            window.addEventListener('resize', resizeCanvas);
            
            // Flash status
            const oldText = statusMsg.innerText;
            statusMsg.innerText = quality.toUpperCase() + " Ready";
            setTimeout(() => statusMsg.innerText = oldText, 2000);
        };
    } catch (e) { statusMsg.innerText = "Camera Denied"; }
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
        requestAnimationFrame(processVideoFrame);
        return;
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
        cv.GaussianBlur(gray, gray, new cv.Size(11, 11), 0);
        let edges = new cv.Mat();
        cv.Canny(gray, edges, 75, 200);
        let kernel = cv.Mat.ones(5, 5, cv.CV_8U);
        cv.dilate(edges, edges, kernel);
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
                if (focusPoint) {
                    const result = cv.pointPolygonTest(cnt, new cv.Point(focusPoint.x, focusPoint.y), false);
                    if (result < 0) { cnt.delete(); continue; }
                }
                if (area > maxArea) {
                    maxArea = area;
                    if (bestContour) bestContour.delete();
                    bestContour = cnt; 
                } else { cnt.delete(); }
            } else { cnt.delete(); }
        }

        ctx.clearRect(0, 0, width, height);
        ctx.lineWidth = 5;

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

            drawPoly(ctx, detectedQuad, '#007AFF', 'rgba(0, 122, 255, 0.2)');

            if (isAutoCaptureOn) {
                stabilityCounter++;
                statusMsg.innerText = "Hold Still...";
                statusMsg.style.background = "rgba(0, 122, 255, 0.8)";
                let progress = stabilityCounter / STABILITY_THRESHOLD;
                progressCircle.style.strokeDashoffset = 238 - (238 * progress);

                if (stabilityCounter >= STABILITY_THRESHOLD) {
                    statusMsg.innerText = "Capturing!";
                    captureImage(); 
                    stabilityCounter = 0; 
                    progressCircle.style.strokeDashoffset = 238;
                }
            } else {
                statusMsg.innerText = "Ready";
                statusMsg.style.background = "rgba(0, 200, 0, 0.6)";
                stabilityCounter = 0;
                progressCircle.style.strokeDashoffset = 238;
            }
            hull.delete(); approx.delete(); bestContour.delete();
        } else {
            detectedQuad = null;
            stabilityCounter = 0;
            progressCircle.style.strokeDashoffset = 238;
            if (!focusPoint) {
                statusMsg.innerText = "Searching...";
                statusMsg.style.background = "rgba(50, 50, 50, 0.6)";
            }
        }
        src.delete(); gray.delete(); edges.delete(); contours.delete(); hierarchy.delete(); kernel.delete();
    } catch (err) { console.log(err); }
    requestAnimationFrame(processVideoFrame);
}

// --- UTILS ---
function drawPoly(ctx, points, stroke, fill) {
    if (!points || points.length < 3) return;
    ctx.strokeStyle = stroke; ctx.fillStyle = fill;
    ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.fillStyle = 'white';
    points.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fill(); });
}

function sortPoints(points) {
    if (points.length !== 4) return points;
    points.sort((a, b) => a.y - b.y);
    let top = points.slice(0, 2).sort((a, b) => a.x - b.x);
    let bottom = points.slice(2, 4).sort((a, b) => b.x - a.x);
    return [top[0], top[1], bottom[0], bottom[1]];
}

// --- UI SETUP ---
function setupButtons() {
    autoToggleBtn.onclick = () => {
        isAutoCaptureOn = !isAutoCaptureOn;
        const span = autoToggleBtn.querySelector('span');
        if (isAutoCaptureOn) { span.innerText = "ON"; span.style.color = "#00FF00"; }
        else { span.innerText = "OFF"; span.style.color = "#FF3B30"; progressCircle.style.strokeDashoffset = 238; }
    };
    
    // Quality Change Listener
    qualitySelect.onchange = () => {
        startCamera(); // Restart with new setting
    };

    document.getElementById('capture-btn').onclick = captureImage;
    document.getElementById('done-crop').onclick = finishCrop;
    document.getElementById('cancel-crop').onclick = () => { toggleModal('crop-modal', false); isProcessing = false; };
    
    document.getElementById('gallery-trigger').onclick = openGallery;
    document.getElementById('close-gallery').onclick = () => toggleModal('gallery-modal', false);
    document.getElementById('close-editor').onclick = () => toggleModal('editor-modal', false);
    document.getElementById('delete-page-btn').onclick = deleteCurrentPage;
    document.getElementById('settings-btn').onclick = () => toggleModal('settings-modal', true);
    document.getElementById('close-settings').onclick = () => toggleModal('settings-modal', false);
    document.getElementById('export-btn').onclick = exportPDF;
    document.getElementById('about-btn').onclick = () => { toggleModal('settings-modal', false); toggleModal('about-modal', true); };
    document.getElementById('close-about').onclick = () => toggleModal('about-modal', false);
}

function toggleModal(modalId, show) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.style.display = show ? 'flex' : 'none';
    if(uiLayer) uiLayer.style.display = show ? 'none' : 'flex';
}

function setupTouchFocus() {
    const app = document.getElementById('app-container');
    app.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON' || e.target.closest('button') || e.target.closest('.modal')) return;
        const rect = video.getBoundingClientRect();
        const scaleX = video.videoWidth / rect.width;
        const scaleY = video.videoHeight / rect.height;
        focusPoint = { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
        focusRing.style.display = 'block';
        focusRing.style.left = e.clientX + 'px';
        focusRing.style.top = e.clientY + 'px';
        statusMsg.innerText = "Targeting...";
        statusMsg.style.background = "rgba(255, 0, 85, 0.8)"; 
        if (focusTimer) clearTimeout(focusTimer);
        focusTimer = setTimeout(() => {
            focusPoint = null; focusRing.style.display = 'none'; 
            statusMsg.innerText = "Auto Scan"; statusMsg.style.background = "rgba(0, 150, 255, 0.6)";
        }, 4000);
    });
}

function captureImage() {
    isProcessing = true; stabilityCounter = 0; progressCircle.style.strokeDashoffset = 238;
    video.style.opacity = "0.2";
    setTimeout(() => video.style.opacity = "1", 150);
    const hidden = document.getElementById('hidden-canvas');
    hidden.width = video.videoWidth; hidden.height = video.videoHeight;
    const ctx = hidden.getContext('2d');
    ctx.drawImage(video, 0, 0);
    currentRawImg = hidden.toDataURL('image/jpeg', 0.9);
    setTimeout(() => { prepareCropModal(currentRawImg, detectedQuad); }, 200);
}

function prepareCropModal(imgSrc, autoPoints) {
    const container = document.getElementById('crop-ui-container');
    const c = document.getElementById('crop-canvas');
    previewImgObj = new Image();
    previewImgObj.onload = () => {
        const maxW = window.innerWidth * 0.9;
        const maxH = window.innerHeight * 0.8;
        const scale = Math.min(maxW / previewImgObj.width, maxH / previewImgObj.height);
        const finalW = Math.floor(previewImgObj.width * scale);
        const finalH = Math.floor(previewImgObj.height * scale);
        container.style.width = finalW + "px"; container.style.height = finalH + "px";
        c.width = finalW; c.height = finalH;
        container.dataset.scale = scale;
        toggleModal('crop-modal', true);
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
        handle.style.left = (positions[i].x - 15) + 'px';
        handle.style.top = (positions[i].y - 15) + 'px';
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
        handle.style.left = (x - 15) + 'px'; handle.style.top = (y - 15) + 'px';
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
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(previewImgObj, 0, 0, c.width, c.height);
    const p = Array.from(handles).map(h => ({ x: parseFloat(h.style.left) + 15, y: parseFloat(h.style.top) + 15 }));
    ctx.strokeStyle = '#007AFF'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y); for (let i = 1; i < 4; i++) ctx.lineTo(p[i].x, p[i].y); ctx.closePath(); ctx.stroke();
    ctx.fillStyle = 'white'; p.forEach(point => { ctx.beginPath(); ctx.arc(point.x, point.y, 4, 0, Math.PI * 2); ctx.fill(); });
}

function finishCrop() {
    toggleModal('crop-modal', false);
    const handles = document.querySelectorAll('.crop-handle');
    const container = document.getElementById('crop-ui-container');
    const scale = parseFloat(container.dataset.scale);
    let p = Array.from(handles).map(h => ({ x: (parseFloat(h.style.left) + 15) / scale, y: (parseFloat(h.style.top) + 15) / scale }));

    let src = cv.imread(previewImgObj);
    let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [ p[0].x, p[0].y, p[1].x, p[1].y, p[2].x, p[2].y, p[3].x, p[3].y ]);
    
    let widthTop = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
    let widthBottom = Math.hypot(p[2].x - p[3].x, p[2].y - p[3].y);
    let heightLeft = Math.hypot(p[3].x - p[0].x, p[3].y - p[0].y);
    let heightRight = Math.hypot(p[2].x - p[1].x, p[2].y - p[1].y);
    let maxWidth = Math.max(widthTop, widthBottom);
    let maxHeight = Math.max(heightLeft, heightRight);

    let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [ 0, 0, maxWidth, 0, maxWidth, maxHeight, 0, maxHeight ]);
    let M = cv.getPerspectiveTransform(srcTri, dstTri);
    let dst = new cv.Mat();
    cv.warpPerspective(src, dst, M, new cv.Size(maxWidth, maxHeight), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

    let canvas = document.createElement('canvas');
    cv.imshow(canvas, dst);
    saveScan(canvas.toDataURL('image/jpeg', 0.9));
    src.delete(); dst.delete(); M.delete(); srcTri.delete(); dstTri.delete();
}

function saveScan(imgData) {
    scannedDocs.push(imgData);
    freezeLayer.style.backgroundImage = `url(${imgData})`;
    freezeLayer.style.display = 'block';
    void freezeLayer.offsetWidth; 
    freezeLayer.classList.add('fly-to-corner');
    setTimeout(() => {
        freezeLayer.style.display = 'none'; freezeLayer.classList.remove('fly-to-corner');
        lastScanImg.src = imgData; lastScanImg.style.display = 'block'; scanCount.innerText = scannedDocs.length;
        isProcessing = false; 
    }, 700);
}

// --- GALLERY & OCR ---
function openGallery() {
    if (scannedDocs.length === 0) return;
    const grid = document.getElementById('gallery-grid'); grid.innerHTML = '';
    scannedDocs.forEach((doc, index) => {
        const img = document.createElement('img'); img.src = doc; img.onclick = () => openEditor(index); grid.appendChild(img);
    });
    toggleModal('gallery-modal', true);
}

function openEditor(index) {
    currentEditIndex = index;
    document.getElementById('editor-img').src = scannedDocs[index];
    toggleModal('editor-modal', true);
}

// NEW: OCR FUNCTION
async function extractText() {
    const img = document.getElementById('editor-img');
    const statusMsg = document.createElement('div');
    statusMsg.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.8);color:white;padding:20px;border-radius:10px;z-index:3000;";
    statusMsg.innerText = "Reading Text...";
    document.body.appendChild(statusMsg);

    try {
        const { data: { text } } = await Tesseract.recognize(img.src, 'eng');
        document.body.removeChild(statusMsg);
        document.getElementById('ocr-result-area').value = text;
        document.getElementById('text-result-modal').style.display = 'flex';
    } catch (e) {
        document.body.removeChild(statusMsg);
        alert("OCR Failed: " + e);
    }
}

function copyOCRText() {
    const text = document.getElementById('ocr-result-area');
    text.select();
    document.execCommand('copy');
    alert("Copied to clipboard!");
}

window.applyFilter = function(type) {
    const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d'); const img = new Image();
    img.onload = () => {
        canvas.width = img.width; canvas.height = img.height; ctx.drawImage(img, 0, 0);
        if (type === 'bw') {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height); const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
                const avg = (data[i] + data[i + 1] + data[i + 2]) / 3; const color = avg > 110 ? 255 : 0;
                data[i] = color; data[i + 1] = color; data[i + 2] = color;
            }
            ctx.putImageData(imageData, 0, 0);
        }
        updateCurrentImage(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.src = scannedDocs[currentEditIndex];
};

window.rotateImage = function() {
    const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d'); const img = new Image();
    img.onload = () => {
        canvas.width = img.height; canvas.height = img.width;
        ctx.translate(canvas.width / 2, canvas.height / 2); ctx.rotate(90 * Math.PI / 180);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
        updateCurrentImage(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.src = document.getElementById('editor-img').src;
};

function updateCurrentImage(newData) {
    document.getElementById('editor-img').src = newData;
    scannedDocs[currentEditIndex] = newData;
}

function deleteCurrentPage() {
    if (confirm("Delete this page?")) {
        scannedDocs.splice(currentEditIndex, 1);
        toggleModal('editor-modal', false);
        if (scannedDocs.length > 0) openGallery(); else toggleModal('gallery-modal', false);
    }
}

// SECURITY & EXPORT
function exportPDF() {
    if (scannedDocs.length === 0) return alert("Nothing to export!");
    if (!window.jspdf) return alert("PDF Library not loaded.");
    const { jsPDF } = window.jspdf;
    
    // Check Password
    const password = document.getElementById('pdf-password').value;
    const options = password ? { encryption: { userPassword: password, ownerPassword: password, userPermissions: ["print", "modify", "copy", "annot-forms"] } } : {};
    
    const doc = new jsPDF(options);

    scannedDocs.forEach((imgData, index) => {
        if (index > 0) doc.addPage();
        const props = doc.getImageProperties(imgData);
        const pdfWidth = doc.internal.pageSize.getWidth();
        const pdfHeight = (props.height * pdfWidth) / props.width;
        doc.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
    });
    
    // CLOUD INTEGRATION (WEB SHARE API)
    const pdfBlob = doc.output('blob');
    const file = new File([pdfBlob], "OpenScan_Doc.pdf", { type: "application/pdf" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({
            files: [file],
            title: 'Scanned Document',
            text: 'Here is your scan from OpenScan AI.'
        }).catch(err => doc.save("OpenScan_Doc.pdf"));
    } else {
        doc.save("OpenScan_Doc.pdf");
    }
}
