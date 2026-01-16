/**
 * OpenScan-AI v6.1 - Thresholding Fix
 * Switched to Binary Thresholding for robust detection of white paper on dark backgrounds.
 */

const app = {
    // State
    cvReady: false,
    streaming: false,
    autoCapture: true,
    processing: false,
    scannedDocs: [], 
    currentDocIndex: -1,
    
    // Detection Config
    detectWidth: 600, // Higher res for better accuracy
    stabilityCounter: 0,
    stabilityThreshold: 10, // Faster capture
    detectedQuad: null, 
    
    // OpenCV Memory Pool
    mat: { src: null, dst: null, gray: null, blur: null, binary: null, contours: null, hierarchy: null, poly: null },

    elements: {},

    init: function() {
        console.log("🚀 OpenScan-AI v6.1 initializing...");
        this.cacheElements();
        this.bindEvents();
        
        // Wait for OpenCV
        if (typeof cv !== 'undefined' && cv.getBuildInformation) {
            this.onOpenCVReady();
        } else {
            document.addEventListener('opencv_ready', () => this.onOpenCVReady());
            // Fallback check
            setTimeout(() => { if(!this.cvReady && typeof cv !== 'undefined') this.onOpenCVReady(); }, 1000);
        }
    },

    cacheElements: function() {
        const ids = ['video-feed', 'overlay-canvas', 'proc-canvas', 'status-msg', 'capture-btn', 
                     'crop-modal', 'editor-modal', 'editor-img', 'flash-layer', 'gallery-modal', 
                     'gallery-grid', 'scan-count', 'last-scan-img'];
        ids.forEach(id => this.elements[id] = document.getElementById(id));
        this.ctxOverlay = this.elements['overlay-canvas'].getContext('2d');
        this.ctxProc = this.elements['proc-canvas'].getContext('2d');
        this.progressCircle = document.querySelector('.progress-ring__circle');
    },

    bindEvents: function() {
        document.getElementById('settings-btn').onclick = () => document.getElementById('settings-modal').style.display = 'flex';
        document.getElementById('close-settings').onclick = () => document.getElementById('settings-modal').style.display = 'none';
        
        document.getElementById('auto-toggle').onclick = () => {
            this.autoCapture = !this.autoCapture;
            document.getElementById('auto-text').innerText = this.autoCapture ? "Auto: ON" : "Auto: OFF";
            document.getElementById('auto-toggle').style.opacity = this.autoCapture ? "1" : "0.5";
            this.resetStability();
        };

        this.elements['capture-btn'].onclick = () => this.triggerCapture(true);
        
        // Modal Controls
        document.getElementById('gallery-trigger').onclick = () => this.openGallery();
        document.getElementById('close-gallery').onclick = () => this.elements['gallery-modal'].style.display = 'none';
        document.getElementById('close-editor').onclick = () => this.elements['editor-modal'].style.display = 'none';
        document.getElementById('save-editor').onclick = () => {
            this.elements['editor-modal'].style.display = 'none';
            this.openGallery();
        };

        document.getElementById('done-crop').onclick = () => this.finishCrop();
        document.getElementById('cancel-crop').onclick = () => {
            this.elements['crop-modal'].style.display = 'none';
            this.processing = false;
        };
        
        document.getElementById('export-btn').onclick = () => this.exportPDF();
        document.getElementById('quality-select').onchange = () => this.startCamera();
        
        window.addEventListener('resize', () => this.resizeOverlay());
    },

    onOpenCVReady: function() {
        if(this.cvReady) return;
        this.cvReady = true;
        this.elements['status-msg'].innerText = "Camera Starting...";
        console.log("OpenCV Ready");
        this.startCamera();
    },

    startCamera: async function() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
        }

        const quality = document.getElementById('quality-select').value;
        const constraints = {
            video: {
                facingMode: "environment",
                width: { ideal: quality === '4k' ? 3840 : (quality === '720p' ? 1280 : 1920) },
                height: { ideal: quality === '4k' ? 2160 : (quality === '720p' ? 720 : 1080) }
            },
            audio: false
        };

        try {
            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.elements['video-feed'].srcObject = this.stream;
            this.elements['video-feed'].onloadedmetadata = () => {
                this.elements['video-feed'].play();
                this.resizeOverlay();
                this.streaming = true;
                this.initCVMats();
                this.processFrame();
            };
        } catch (err) {
            alert("Camera Error: " + err.message);
            this.elements['status-msg'].innerText = "Cam Error";
        }
    },

    resizeOverlay: function() {
        const video = this.elements['video-feed'];
        const canvas = this.elements['overlay-canvas'];
        if(video.videoWidth === 0) return;
        
        canvas.width = video.clientWidth;
        canvas.height = video.clientHeight;
    },

    initCVMats: function() {
        // Pre-allocate memory
        // Calculate aspect ratio correct height
        const video = this.elements['video-feed'];
        const aspect = video.videoHeight / video.videoWidth;
        const h = Math.round(this.detectWidth * aspect);
        const w = this.detectWidth;
        
        // Dispose old if exists
        if(this.mat.src) this.mat.src.delete();
        
        this.mat.src = new cv.Mat(h, w, cv.CV_8UC4);
        this.mat.dst = new cv.Mat(h, w, cv.CV_8UC1);
        this.mat.binary = new cv.Mat(h, w, cv.CV_8UC1);
        this.mat.hierarchy = new cv.Mat();
        this.mat.poly = new cv.Mat();
    },

    processFrame: function() {
        if (!this.streaming || !this.cvReady) return;
        
        const video = this.elements['video-feed'];
        const procCvs = this.elements['proc-canvas'];
        
        // 1. Maintain correct aspect ratio in processing canvas
        if(procCvs.width !== this.detectWidth) {
            procCvs.width = this.detectWidth;
            procCvs.height = Math.round(this.detectWidth * (video.videoHeight / video.videoWidth));
        }

        this.ctxProc.drawImage(video, 0, 0, procCvs.width, procCvs.height);
        
        // 2. OpenCV Pipeline (Threshold Method)
        try {
            let src = this.mat.src;
            src.data.set(this.ctxProc.getImageData(0, 0, procCvs.width, procCvs.height).data);
            
            // Grayscale
            cv.cvtColor(src, this.mat.dst, cv.COLOR_RGBA2GRAY);
            
            // Blur (Removes noise/text details)
            cv.GaussianBlur(this.mat.dst, this.mat.dst, new cv.Size(5, 5), 0);
            
            // Threshold (Everything bright becomes pure white, everything else black)
            // This fills the paper as a solid block!
            cv.threshold(this.mat.dst, this.mat.binary, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
            
            let contours = new cv.MatVector();
            cv.findContours(this.mat.binary, contours, this.mat.hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

            let maxArea = 0;
            let bestContour = null;
            // Reduced min area to 5% (was 15%) to detect smaller/further documents
            let minArea = (procCvs.width * procCvs.height) * 0.05; 

            for (let i = 0; i < contours.size(); ++i) {
                let cnt = contours.get(i);
                let area = cv.contourArea(cnt);

                if (area > minArea) {
                    let peri = cv.arcLength(cnt, true);
                    cv.approxPolyDP(cnt, this.mat.poly, 0.02 * peri, true);
                    
                    // If it has 4 corners, perfect. If it has more (folded paper), we still track it if it's huge.
                    if (area > maxArea && (this.mat.poly.rows === 4 || area > minArea * 3)) {
                        maxArea = area;
                        bestContour = this.mat.poly.data32S; // Store raw points
                    }
                }
            }

            contours.delete(); 
            this.drawOverlay(bestContour, procCvs.width, procCvs.height);

        } catch (e) { 
            console.error(e);
            // Re-init if memory glitch
            this.initCVMats();
        }

        if (!this.processing) requestAnimationFrame(() => this.processFrame());
    },

    drawOverlay: function(pointsData, pW, pH) {
        const ctx = this.ctxOverlay;
        const w = this.elements['overlay-canvas'].width;
        const h = this.elements['overlay-canvas'].height;
        ctx.clearRect(0, 0, w, h);

        if (pointsData) {
            // Mapping Logic
            const scaleX = w / pW;
            const scaleY = h / pH;
            
            let pts = [];
            // Handle 4 points (Quad)
            if (pointsData.length === 8) {
                pts = [
                    {x: pointsData[0], y: pointsData[1]},
                    {x: pointsData[2], y: pointsData[3]},
                    {x: pointsData[4], y: pointsData[5]},
                    {x: pointsData[6], y: pointsData[7]}
                ];
            } else {
                // Fallback: If 5+ points, take bounding box (safer than nothing)
                // This fixes "folded corners" breaking detection
                let xMin=9999, yMin=9999, xMax=0, yMax=0;
                for(let i=0; i<pointsData.length; i+=2) {
                    if(pointsData[i] < xMin) xMin = pointsData[i];
                    if(pointsData[i] > xMax) xMax = pointsData[i];
                    if(pointsData[i+1] < yMin) yMin = pointsData[i+1];
                    if(pointsData[i+1] > yMax) yMax = pointsData[i+1];
                }
                pts = [{x: xMin, y: yMin}, {x: xMax, y: yMin}, {x: xMax, y: yMax}, {x: xMin, y: yMax}];
            }
            
            pts = this.sortPoints(pts);
            this.detectedQuad = pts.map(p => ({ x: p.x / pW, y: p.y / pH })); 

            // Visual Detection Box
            ctx.beginPath();
            ctx.lineWidth = 5;
            ctx.strokeStyle = '#D0BCFF'; // Purple
            ctx.moveTo(pts[0].x * scaleX, pts[0].y * scaleY);
            for(let i=1; i<4; i++) ctx.lineTo(pts[i].x * scaleX, pts[i].y * scaleY);
            ctx.closePath();
            ctx.stroke();

            // Auto Capture
            if (this.autoCapture && !this.processing) {
                this.elements['status-msg'].innerText = "Hold Still";
                this.elements['status-msg'].style.background = "rgba(0, 200, 0, 0.5)"; // Greenish hint
                
                this.stabilityCounter++;
                const prog = Math.min(this.stabilityCounter / this.stabilityThreshold, 1);
                this.progressCircle.style.strokeDashoffset = 251 - (251 * prog);
                
                if (this.stabilityCounter >= this.stabilityThreshold) {
                    this.triggerCapture(false);
                }
            }
        } else {
            this.detectedQuad = null;
            this.resetStability();
            this.elements['status-msg'].innerText = "Searching...";
            this.elements['status-msg'].style.background = "rgba(0, 0, 0, 0.4)";
        }
    },

    resetStability: function() {
        this.stabilityCounter = 0;
        this.progressCircle.style.strokeDashoffset = 251;
    },

    triggerCapture: function(isManual) {
        if (this.processing) return;
        this.processing = true;
        this.resetStability();
        
        const flash = this.elements['flash-layer'];
        flash.style.opacity = 0.8;
        setTimeout(() => flash.style.opacity = 0, 150);

        const video = this.elements['video-feed'];
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0);

        let points = this.detectedQuad;
        // Fallback for manual capture: center crop
        if (!points || isManual) {
            if(!points) points = [{x:0.15, y:0.15}, {x:0.85, y:0.15}, {x:0.85, y:0.85}, {x:0.15, y:0.85}];
        }
        
        const fullPoints = points.map(p => ({ x: p.x * canvas.width, y: p.y * canvas.height }));

        this.rawCapture = canvas.toDataURL('image/jpeg');
        this.openCropModal(this.rawCapture, fullPoints);
    },

    openCropModal: function(imgSrc, points) {
        const modal = this.elements['crop-modal'];
        modal.style.display = 'flex';
        this.elements['status-msg'].innerText = "Adjust Corners";
        
        const canvas = document.getElementById('crop-canvas');
        const container = document.getElementById('crop-ui-container');
        
        this.previewImg = new Image();
        this.previewImg.onload = () => {
            const maxW = window.innerWidth - 48;
            const maxH = window.innerHeight * 0.7;
            const scale = Math.min(maxW / this.previewImg.width, maxH / this.previewImg.height);
            
            const dispW = this.previewImg.width * scale;
            const dispH = this.previewImg.height * scale;
            
            canvas.width = dispW;
            canvas.height = dispH;
            container.style.width = dispW + "px";
            container.style.height = dispH + "px";
            
            const ctx = canvas.getContext('2d');
            ctx.drawImage(this.previewImg, 0, 0, dispW, dispH);
            
            this.cropPoints = points.map(p => ({ x: p.x * scale, y: p.y * scale }));
            this.updateCropUI(scale);
        };
        this.previewImg.src = imgSrc;
    },

    updateCropUI: function(scale) {
        const handles = document.querySelectorAll('.crop-handle');
        const ctx = document.getElementById('crop-canvas').getContext('2d');
        
        ctx.drawImage(this.previewImg, 0, 0, ctx.canvas.width, ctx.canvas.height);
        
        // Fill Crop Area (Darken outside)
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath();
        ctx.moveTo(0,0); ctx.lineTo(ctx.canvas.width, 0); ctx.lineTo(ctx.canvas.width, ctx.canvas.height); ctx.lineTo(0, ctx.canvas.height); ctx.closePath();
        
        ctx.moveTo(this.cropPoints[0].x, this.cropPoints[0].y);
        ctx.lineTo(this.cropPoints[1].x, this.cropPoints[1].y);
        ctx.lineTo(this.cropPoints[2].x, this.cropPoints[2].y);
        ctx.lineTo(this.cropPoints[3].x, this.cropPoints[3].y);
        ctx.closePath();
        ctx.fill('evenodd');

        // Draw Lines
        ctx.strokeStyle = '#D0BCFF'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(this.cropPoints[0].x, this.cropPoints[0].y);
        this.cropPoints.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.closePath();
        ctx.stroke();

        handles.forEach((h, i) => {
            h.style.left = this.cropPoints[i].x + 'px';
            h.style.top = this.cropPoints[i].y + 'px';
            
            const onMove = (e) => {
                e.preventDefault();
                const cx = e.touches ? e.touches[0].clientX : e.clientX;
                const cy = e.touches ? e.touches[0].clientY : e.clientY;
                const rect = document.getElementById('crop-ui-container').getBoundingClientRect();
                
                this.cropPoints[i].x = Math.max(0, Math.min(ctx.canvas.width, cx - rect.left));
                this.cropPoints[i].y = Math.max(0, Math.min(ctx.canvas.height, cy - rect.top));
                this.updateCropUI(scale);
            };
            
            const onEnd = () => {
                document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onEnd);
                document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onEnd);
            };

            h.onmousedown = (e) => { document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onEnd); };
            h.ontouchstart = (e) => { document.addEventListener('touchmove', onMove); document.addEventListener('touchend', onEnd); };
        });
    },

    finishCrop: function() {
        const canvas = document.getElementById('crop-canvas');
        const scale = this.previewImg.width / canvas.width;
        
        const srcPts = this.cropPoints.map(p => p.x * scale);
        const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [srcPts[0].x, srcPts[0].y, srcPts[1].x, srcPts[1].y, srcPts[2].x, srcPts[2].y, srcPts[3].x, srcPts[3].y]);

        const w1 = Math.hypot(srcPts[1].x - srcPts[0].x, srcPts[1].y - srcPts[0].y);
        const w2 = Math.hypot(srcPts[2].x - srcPts[3].x, srcPts[2].y - srcPts[3].y);
        const h1 = Math.hypot(srcPts[3].x - srcPts[0].x, srcPts[3].y - srcPts[0].y);
        const h2 = Math.hypot(srcPts[2].x - srcPts[1].x, srcPts[2].y - srcPts[1].y);
        const maxW = Math.max(w1, w2);
        const maxH = Math.max(h1, h2);

        const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0,0, maxW,0, maxW,maxH, 0,maxH]);
        const M = cv.getPerspectiveTransform(srcTri, dstTri);
        const srcMat = cv.imread(this.previewImg);
        const dstMat = new cv.Mat();
        
        cv.warpPerspective(srcMat, dstMat, M, new cv.Size(maxW, maxH));
        
        const finalCanvas = document.createElement('canvas');
        cv.imshow(finalCanvas, dstMat);
        const resultUrl = finalCanvas.toDataURL('image/jpeg', 0.9);
        
        srcMat.delete(); dstMat.delete(); M.delete(); srcTri.delete(); dstTri.delete();
        this.saveScan(resultUrl);
    },

    saveScan: function(url) {
        this.scannedDocs.push(url);
        this.elements['crop-modal'].style.display = 'none';
        this.processing = false;
        this.elements['last-scan-img'].src = url;
        this.elements['last-scan-img'].style.display = 'block';
        document.querySelector('.placeholder-icon').style.display = 'none';
        this.elements['scan-count'].style.display = 'block';
        this.elements['scan-count'].innerText = this.scannedDocs.length;
        this.elements['status-msg'].innerText = "Saved";
        this.processFrame();
    },
    
    sortPoints: function(pts) {
        pts.sort((a,b) => a.y - b.y);
        const top = pts.slice(0, 2).sort((a,b) => a.x - b.x);
        const bot = pts.slice(2, 4).sort((a,b) => b.x - a.x);
        return [top[0], top[1], bot[0], bot[1]];
    },
    
    openGallery: function() {
        const grid = this.elements['gallery-grid'];
        grid.innerHTML = '';
        this.scannedDocs.forEach((doc, i) => {
            const img = document.createElement('img');
            img.src = doc;
            img.onclick = () => {
                this.currentDocIndex = i;
                document.getElementById('editor-img').src = doc;
                this.elements['editor-modal'].style.display = 'flex';
            };
            grid.appendChild(img);
        });
        this.elements['gallery-modal'].style.display = 'flex';
    },

    applyFilter: function(type) {
        const img = document.getElementById('editor-img');
        const src = cv.imread(img);
        const dst = new cv.Mat();
        
        if (type === 'bw') {
            cv.cvtColor(src, src, cv.COLOR_RGBA2GRAY);
            cv.threshold(src, dst, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
        } else if (type === 'magic') {
            cv.cvtColor(src, src, cv.COLOR_RGBA2GRAY);
            cv.adaptiveThreshold(src, dst, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 15, 12);
        } else {
            src.copyTo(dst);
        }
        
        const canvas = document.createElement('canvas');
        cv.imshow(canvas, dst);
        img.src = canvas.toDataURL();
        this.scannedDocs[this.currentDocIndex] = img.src;
        src.delete(); dst.delete();
    },

    rotateImage: function(deg) {
        const img = document.getElementById('editor-img');
        const c = document.createElement('canvas');
        const ctx = c.getContext('2d');
        const i = new Image();
        i.onload = () => {
            c.width = i.height; c.height = i.width;
            ctx.translate(c.width/2, c.height/2);
            ctx.rotate(deg * Math.PI / 180);
            ctx.drawImage(i, -i.width/2, -i.height/2);
            img.src = c.toDataURL();
            this.scannedDocs[this.currentDocIndex] = img.src;
        };
        i.src = img.src;
    },
    
    extractText: async function() {
        const img = document.getElementById('editor-img');
        this.elements['status-msg'].innerText = "OCR Running...";
        try {
            const res = await Tesseract.recognize(img.src, 'eng');
            document.getElementById('ocr-result-area').value = res.data.text;
            document.getElementById('text-result-modal').style.display = 'flex';
            this.elements['status-msg'].innerText = "Done";
        } catch(e) { alert("OCR Failed"); }
    },
    
    copyOCRText: function() {
        navigator.clipboard.writeText(document.getElementById('ocr-result-area').value);
    },
    
    deleteCurrentPage: function() {
        if(confirm("Delete this scan?")) {
            this.scannedDocs.splice(this.currentDocIndex, 1);
            this.elements['editor-modal'].style.display = 'none';
            this.openGallery();
            this.elements['scan-count'].innerText = this.scannedDocs.length;
        }
    },
    
    exportPDF: function() {
        if(this.scannedDocs.length === 0) return alert("Scan something first");
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        this.scannedDocs.forEach((imgData, i) => {
            if(i > 0) doc.addPage();
            const imgProps = doc.getImageProperties(imgData);
            const pdfWidth = doc.internal.pageSize.getWidth();
            const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
            doc.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
        });
        doc.save('OpenScan_Doc.pdf');
    }
};

document.addEventListener('DOMContentLoaded', () => app.init());
