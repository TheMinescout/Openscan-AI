// --- STATE MANAGEMENT ---
let scannedDocs = [];
let currentRawImg = null;
let currentEditIndex = -1;
let detectedQuad = null; 
let isCVReady = false;

// Manual "Touch to Focus" State
let focusPoint = null;      // {x, y}
let focusTimer = null;      // Timeout to clear focus

// DOM Elements
const video = document.getElementById('video-feed');
const overlayCanvas = document.getElementById('overlay-canvas');
const freezeLayer = document.getElementById('freeze-layer');
const statusMsg = document.getElementById('status-msg');
const scanCount = document.getElementById('scan-count');
const lastScanImg = document.getElementById('last-scan-img');
const uiLayer = document.querySelector('.ui-layer');
const focusRing = document.getElementById('focus-ring');

// --- 1. STARTUP ---
document.addEventListener('DOMContentLoaded', () => {
    setupButtons();
    setupTouchFocus(); 
    startCamera();
    
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
    statusMsg.style.background = "rgba(0, 150, 255, 0.6)";
    requestAnimationFrame(processVideoFrame);
}

// --- 2. CAMERA & CANVAS ---
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
            resizeCanvas();
            window.addEventListener('resize', resizeCanvas);
        };
    } catch (e) {
        console.error(e);
        statusMsg.innerText = "Camera Error";
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

// --- 3. TOUCH TO TARGET ---
function setupTouchFocus() {
    const app = document.getElementById('app-container');
    
    app.addEventListener('click', (e) => {
        // Prevent targeting when clicking UI elements
        if (e.target.tagName === 'BUTTON' || e.target.closest('button') || e.target.closest('.modal')) return;

        const rect = video.getBoundingClientRect();
        const scaleX = video.videoWidth / rect.width;
        const scaleY = video.videoHeight / rect.height;
        const clickX = (e.clientX - rect.left) * scaleX;
        const clickY = (e.clientY - rect.top) * scaleY;

        focusPoint = { x: clickX, y: clickY };
        
        focusRing.style.display = 'block';
        focusRing.style.left = e.clientX + 'px';
        focusRing.style.top = e.clientY + 'px';
        
        statusMsg.innerText = "Targeting...";
        statusMsg.style.background = "rgba(255, 0, 85, 0.8)"; 

        if (focusTimer) clearTimeout(focusTimer);
        focusTimer = setTimeout(() => {
            focusPoint = null;
            focusRing.style.display = 'none'; 
            statusMsg.innerText = "Auto Scan";
            statusMsg.style.background = "rgba(0, 150, 255, 0.6)";
        }, 4000);
    });
}

// --- 4. THE BLOB DETECTION LOOP ---
function processVideoFrame() {
    if (!isCVReady || video.paused || video.ended || video.videoWidth === 0) {
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
                } else {
                    cnt.delete();
                }
            } else {
                cnt.delete();
            }
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
            for (let i = 0; i < approx.rows; i++) {
                points.push({ x: approx.data32S[i * 2], y: approx.data32S[i * 2 + 1] });
            }

            if (points.length >= 4) {
                let tl = points.reduce((prev, curr) => (curr.x + curr.y) < (prev.x + prev.y) ? curr : prev);
                let br = points.reduce((prev, curr) => (curr.x + curr.y) > (prev.x + prev.y) ? curr : prev);
                let tr = points.reduce((prev, curr) => (curr.x - curr.y) > (prev.x - prev.y) ? curr : prev);
                let bl = points.reduce((prev, curr) => (curr.x - curr.y) < (prev.x - prev.y) ? curr : prev);
                
                detectedQuad = [tl, tr, br, bl]; 
            } else {
                detectedQuad = sortPoints(points);
            }

            statusMsg.innerText = "Scan Ready";
            statusMsg.style.background = "rgba(0, 200, 0, 0.6)"; 

            drawPoly(ctx, detectedQuad, '#007AFF', 'rgba(0, 122, 255, 0.2)');

            hull.delete(); approx.delete(); bestContour.delete();
        } else {
            detectedQuad = null;
            if (!focusPoint) {
                statusMsg.innerText = "Searching...";
                statusMsg.style.background = "rgba(50, 50, 50, 0.6)";
            }
        }

        src.delete(); gray.delete(); edges.delete(); contours.delete(); hierarchy.delete(); kernel.delete();

    } catch (err) {
        console.log(err);
    }

    requestAnimationFrame(processVideoFrame);
}

// --- HELPER FUNCTIONS ---
function drawPoly(ctx, points, stroke, fill) {
    if (!points || points.length < 3) return;
    ctx.strokeStyle = stroke;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    
    ctx.fillStyle = 'white';
    points.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fill();
    });
}

function sortPoints(points) {
    if (points.length !== 4) return points;
    points.sort((a, b) => a.y - b.y);
    let top = points.slice(0, 2).sort((a, b) => a.x - b.x);
    let bottom = points.slice(2, 4).sort((a, b) => b.x - a.x);
    return [top[0], top[1], bottom[0], bottom[1]];
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
    
    document.getElementById('export-btn').onclick = exportPDF;

    // About & Donate Logic
    // FIXED: Close settings menu first, then open About
    document.getElementById('about-btn').onclick = () => {
        toggleModal('settings-modal', false);
        toggleModal('about-modal', true);
    };
    
    document.getElementById('close-about').onclick = () => toggleModal('about-modal', false);
}

function toggleModal(modalId, show) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.style.display = show ? 'flex' : 'none';
    if(uiLayer) uiLayer.style.display = show ? 'none' : 'flex';
}

function captureImage() {
    video.style.opacity = "0.2";
    setTimeout(() => video.style.opacity = "1", 150);
    const hidden = document.getElementById('hidden-canvas');
    hidden.width = video.videoWidth;
    hidden.height = video.videoHeight;
    const ctx = hidden.getContext('2d');
    ctx.drawImage(video, 0, 0);
    currentRawImg = hidden.toDataURL('image/jpeg', 0.9);
    prepareCropModal(currentRawImg, detectedQuad);
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
        container.style.width = finalW + "px";
        container.style.height = finalH + "px";
        c.width = finalW;
        c.height = finalH;
        container.dataset.scale = scale;
        toggleModal('crop-modal', true);
        setupHandles(finalW, finalH, autoPoints, scale);
        drawCropLines();
    };
    previewImgObj.src = imgSrc;
}

function setupHandles(w, h, autoPoints, scale) {
    const handles = document.querySelectorAll('.crop-handle');
    const container = document.getElementById('crop-ui-container');
    let positions;
    if (autoPoints && autoPoints.length === 4) {
        positions = [
            { x: autoPoints[0].x * scale, y: autoPoints[0].y * scale },
            { x: autoPoints[1].x * scale, y: autoPoints[1].y * scale },
            { x: autoPoints[2].x * scale, y: autoPoints[2].y * scale },
            { x: autoPoints[3].x * scale, y: autoPoints[3].y * scale }
        ];
    } else {
        positions = [
            { x: w * 0.2, y: h * 0.2 }, { x: w * 0.8, y: h * 0.2 },
            { x: w * 0.8, y: h * 0.8 }, { x: w * 0.2, y: h * 0.8 }
        ];
    }
    handles.forEach((handle, i) => {
        handle.style.left = (positions[i].x - 15) + 'px';
        handle.style.top = (positions[i].y - 15) + 'px';
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
        x = Math.max(0, Math.min(x, container.offsetWidth));
        y = Math.max(0, Math.min(y, container.offsetHeight));
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
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(previewImgObj, 0, 0, c.width, c.height);
    const p = Array.from(handles).map(h => ({
        x: parseFloat(h.style.left) + 15,
        y: parseFloat(h.style.top) + 15
    }));
    ctx.strokeStyle = '#007AFF';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(p[0].x, p[0].y);
    ctx.lineTo(p[1].x, p[1].y);
    ctx.lineTo(p[2].x, p[2].y);
    ctx.lineTo(p[3].x, p[3].y);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = 'white';
    p.forEach(point => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
        ctx.fill();
    });
}

// PERSPECTIVE WARP
function finishCrop() {
    toggleModal('crop-modal', false);
    const handles = document.querySelectorAll('.crop-handle');
    const container = document.getElementById('crop-ui-container');
    const scale = parseFloat(container.dataset.scale);

    let p = Array.from(handles).map(h => ({
        x: (parseFloat(h.style.left) + 15) / scale,
        y: (parseFloat(h.style.top) + 15) / scale
    }));

    let src = cv.imread(previewImgObj);
    let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        p[0].x, p[0].y, p[1].x, p[1].y, p[2].x, p[2].y, p[3].x, p[3].y
    ]);

    let widthTop = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
    let widthBottom = Math.hypot(p[2].x - p[3].x, p[2].y - p[3].y);
    let heightLeft = Math.hypot(p[3].x - p[0].x, p[3].y - p[0].y);
    let heightRight = Math.hypot(p[2].x - p[1].x, p[2].y - p[1].y);

    let maxWidth = Math.max(widthTop, widthBottom);
    let maxHeight = Math.max(heightLeft, heightRight);

    let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        0, 0, maxWidth, 0, maxWidth, maxHeight, 0, maxHeight
    ]);

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
        freezeLayer.style.display = 'none';
        freezeLayer.classList.remove('fly-to-corner');
        lastScanImg.src = imgData;
        lastScanImg.style.display = 'block';
        scanCount.innerText = scannedDocs.length;
    }, 700);
}

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

let originalEditImgData = null; 
function openEditor(index) {
    currentEditIndex = index;
    const imgData = scannedDocs[index];
    document.getElementById('editor-img').src = imgData;
    originalEditImgData = imgData;
    toggleModal('editor-modal', true);
}

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
                const color = avg > 110 ? 255 : 0; 
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
        originalEditImgData = rotated;
    };
    img.src = document.getElementById('editor-img').src;
};

function updateCurrentImage(newData) {
    document.getElementById('editor-img').src = newData;
    scannedDocs[currentEditIndex] = newData;
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

function exportPDF() {
    if (scannedDocs.length === 0) return alert("Nothing to export!");
    if (!window.jspdf) return alert("PDF Library not loaded.");
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
