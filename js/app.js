/**
 * OpenScan-AI v7.1 - Resilient Mode
 * Loads Camera FIRST, then attempts Cloud Sync.
 * If Cloud fails, the app continues in Offline Mode.
 */

const app = {
    cvReady: false, streaming: false, autoCapture: true, processing: false,
    scannedDocs: [], currentDocIndex: -1, detectWidth: 600,
    stabilityCounter: 0, stabilityThreshold: 30, detectedQuad: null,
    mat: { src: null, dst: null, gray: null, binary: null, contours: null, hierarchy: null, poly: null },
    elements: {},
    
    // Cloud State
    FireManager: null,
    isCloudActive: false,

    init: async function() {
        console.log("🚀 OpenScan-AI v7.1 Initializing...");
        this.cacheElements();
        this.bindEvents();
        
        // 1. START OPENCV/CAMERA IMMEDIATELY (Don't wait for cloud)
        if (typeof cv !== 'undefined' && cv.getBuildInformation) this.onOpenCVReady();
        else document.addEventListener('opencv_ready', () => this.onOpenCVReady());

        // 2. ATTEMPT TO LOAD FIREBASE (Safely)
        try {
            console.log("☁️ Attempting to connect to Cloud...");
            const module = await import("./fire-manager.js");
            this.FireManager = module.FireManager;
            
            // Initialize Firebase
            this.FireManager.init((user) => this.onAuthChange(user));
            this.isCloudActive = true;
            console.log("✅ Cloud Connected");
        } catch (e) {
            console.error("⚠️ CLOUD SYNC FAILED (Offline Mode Active):", e);
            document.getElementById('account-btn').style.opacity = "0.3";
            document.getElementById('account-btn').onclick = () => alert("Cloud Sync Unavailable.\n\nReason: " + e.message + "\n\n(Check console for details)");
        }
    },

    onAuthChange: async function(user) {
        if(!this.isCloudActive) return;
        
        const loginView = document.getElementById('login-view');
        const profileView = document.getElementById('profile-view');
        const btn = document.getElementById('account-btn');

        if (user) {
            console.log("Logged in: " + user.email);
            loginView.style.display = 'none';
            profileView.style.display = 'block';
            document.getElementById('user-email-display').innerText = user.email;
            btn.style.color = '#D0BCFF'; 

            try {
                const cloudScans = await this.FireManager.loadCloudScans();
                if(cloudScans.length > 0) {
                    // Filter duplicates based on image data
                    const newScans = cloudScans.filter(img => !this.scannedDocs.includes(img));
                    if (newScans.length > 0) {
                        this.scannedDocs = [...this.scannedDocs, ...newScans];
                        this.updateGalleryCount();
                        alert(`Synced ${newScans.length} new scans from cloud!`);
                    }
                }
            } catch(e) { console.warn("Sync error", e); }
        } else {
            loginView.style.display = 'block';
            profileView.style.display = 'none';
            btn.style.color = 'white';
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
        // --- AUTH EVENTS (Safe Wrappers) ---
        const safeAuth = (action) => {
            if(!this.isCloudActive) return alert("Cloud not available (Check Config)");
            action();
        };

        document.getElementById('account-btn').onclick = () => {
             if(this.isCloudActive) document.getElementById('auth-modal').style.display = 'flex';
        };
        document.getElementById('close-auth').onclick = () => document.getElementById('auth-modal').style.display = 'none';
        
        document.getElementById('do-signup').onclick = async () => {
            safeAuth(async () => {
                const e = document.getElementById('email-input').value;
                const p = document.getElementById('pass-input').value;
                if(!e || !p) return alert("Enter email & password");
                const res = await this.FireManager.signup(e, p);
                if(!res.success) alert(res.error);
            });
        };

        document.getElementById('do-login').onclick = async () => {
            safeAuth(async () => {
                const e = document.getElementById('email-input').value;
                const p = document.getElementById('pass-input').value;
                if(!e || !p) return alert("Enter email & password");
                const res = await this.FireManager.login(e, p);
                if(!res.success) alert(res.error);
            });
        };

        document.getElementById('do-logout').onclick = () => safeAuth(() => this.FireManager.logout());

        // --- STANDARD EVENTS ---
        document.getElementById('settings-btn').onclick = () => document.getElementById('settings-modal').style.display = 'flex';
        document.getElementById('close-settings').onclick = () => document.getElementById('settings-modal').style.display = 'none';
        document.getElementById('auto-toggle').onclick = () => { this.autoCapture = !this.autoCapture; document.getElementById('auto-text').innerText = this.autoCapture ? "Auto: ON" : "Auto: OFF"; document.getElementById('auto-toggle').style.opacity = this.autoCapture ? "1" : "0.5"; };
        this.elements['capture-btn'].onclick = () => this.triggerCapture(true);
        document.getElementById('gallery-trigger').onclick = () => this.openGallery();
        document.getElementById('close-gallery').onclick = () => this.elements['gallery-modal'].style.display = 'none';
        document.getElementById('close-editor').onclick = () => this.elements['editor-modal'].style.display = 'none';
        document.getElementById('save-editor').onclick = () => { this.elements['editor-modal'].style.display = 'none'; this.openGallery(); };
        document.getElementById('done-crop').onclick = () => this.finishCrop();
        document.getElementById('cancel-crop').onclick = () => { this.elements['crop-modal'].style.display = 'none'; this.processing = false; this.detectedQuad = null; this.ctxOverlay.clearRect(0,0,1000,1000); };
        document.getElementById('export-btn').onclick = () => this.exportPDF();
        document.getElementById('quality-select').onchange = () => this.startCamera();
        window.addEventListener('resize', () => this.resizeOverlay());
    },

    onOpenCVReady: function() {
        if(this.cvReady) return;
        this.cvReady = true;
        this.elements['status-msg'].innerText = "Cam Start...";
        this.startCamera();
    },

    startCamera: async function() {
        if (this.stream) this.stream.getTracks().forEach(track => track.stop());
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        } catch (e) {
             try { this.stream = await navigator.mediaDevices.getUserMedia({ video: true }); } catch(e2) { alert("Cam Error"); return; }
        }
        this.elements['video-feed'].srcObject = this.stream;
        this.elements['video-feed'].onloadedmetadata = () => { this.elements['video-feed'].play(); this.resizeOverlay(); this.streaming = true; this.initCVMats(); this.processFrame(); };
    },

    resizeOverlay: function() {
        const video = this.elements['video-feed'];
        const canvas = this.elements['overlay-canvas'];
        if(video.videoWidth === 0) return;
        canvas.width = video.clientWidth; canvas.height = video.clientHeight;
    },

    initCVMats: function() {
        const video = this.elements['video-feed'];
        const aspect = video.videoHeight / video.videoWidth;
        const h = Math.round(this.detectWidth * aspect);
        const w = this.detectWidth;
        if(this.mat.src) this.mat.src.delete();
        this.mat.src = new cv.Mat(h, w, cv.CV_8UC4); this.mat.dst = new cv.Mat(h, w, cv.CV_8UC1); this.mat.binary = new cv.Mat(h, w, cv.CV_8UC1);
        this.mat.hierarchy = new cv.Mat(); this.mat.poly = new cv.Mat();
    },

    processFrame: function() {
        if (!this.streaming || !this.cvReady) return;
        const video = this.elements['video-feed'];
        const procCvs = this.elements['proc-canvas'];
        if(procCvs.width !== this.detectWidth) { procCvs.width = this.detectWidth; procCvs.height = Math.round(this.detectWidth * (video.videoHeight / video.videoWidth)); }
        this.ctxProc.drawImage(video, 0, 0, procCvs.width, procCvs.height);
        
        try {
            let src = this.mat.src;
            src.data.set(this.ctxProc.getImageData(0, 0, procCvs.width, procCvs.height).data);
            cv.cvtColor(src, this.mat.dst, cv.COLOR_RGBA2GRAY);
            cv.GaussianBlur(this.mat.dst, this.mat.dst, new cv.Size(5, 5), 0);
            cv.threshold(this.mat.dst, this.mat.binary, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
            let contours = new cv.MatVector();
            cv.findContours(this.mat.binary, contours, this.mat.hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
            
            let maxArea = 0, bestContour = null;
            let minArea = (procCvs.width * procCvs.height) * 0.15;
            for (let i = 0; i < contours.size(); ++i) {
                let cnt = contours.get(i);
                let area = cv.contourArea(cnt);
                if (area > minArea) {
                    let peri = cv.arcLength(cnt, true);
                    cv.approxPolyDP(cnt, this.mat.poly, 0.02 * peri, true);
                    if (cv.isContourConvex(this.mat.poly) && (this.mat.poly.rows === 4 || area > minArea * 2) && area > maxArea) {
                        maxArea = area; bestContour = this.mat.poly.data32S;
                    }
                }
            }
            contours.delete();
            this.drawOverlay(bestContour, procCvs.width, procCvs.height);
        } catch (e) { this.initCVMats(); }
        if (!this.processing) requestAnimationFrame(() => this.processFrame());
    },

    drawOverlay: function(pointsData, pW, pH) {
        const ctx = this.ctxOverlay;
        const w = this.elements['overlay-canvas'].width;
        const h = this.elements['overlay-canvas'].height;
        ctx.clearRect(0, 0, w, h);
        if (pointsData) {
            const scaleX = w / pW, scaleY = h / pH;
            let pts = pointsData.length === 8 ? 
                [{x:pointsData[0],y:pointsData[1]}, {x:pointsData[2],y:pointsData[3]}, {x:pointsData[4],y:pointsData[5]}, {x:pointsData[6],y:pointsData[7]}] : 
                [{x:0,y:0},{x:pW,y:0},{x:pW,y:pH},{x:0,y:pH}];
            
            pts = this.sortPoints(pts);
            this.detectedQuad = pts.map(p => ({ x: p.x / pW, y: p.y / pH }));
            ctx.beginPath(); ctx.lineWidth = 5; ctx.strokeStyle = '#D0BCFF';
            ctx.moveTo(pts[0].x * scaleX, pts[0].y * scaleY);
            for(let i=1; i<4; i++) ctx.lineTo(pts[i].x * scaleX, pts[i].y * scaleY);
            ctx.closePath(); ctx.stroke();

            if (this.autoCapture && !this.processing) {
                this.elements['status-msg'].innerText = "Hold Still";
                this.elements['status-msg'].style.background = "rgba(0,200,0,0.5)";
                this.stabilityCounter++;
                this.progressCircle.style.strokeDashoffset = 251 - (251 * Math.min(this.stabilityCounter / this.stabilityThreshold, 1));
                if (this.stabilityCounter >= this.stabilityThreshold) this.triggerCapture(false);
            }
        } else {
            this.detectedQuad = null; this.stabilityCounter = 0; this.progressCircle.style.strokeDashoffset = 251;
            this.elements['status-msg'].innerText = "Searching...";
            this.elements['status-msg'].style.background = "rgba(0,0,0,0.4)";
        }
    },

    triggerCapture: function(isManual) {
        if (this.processing) return;
        this.processing = true; this.stabilityCounter = 0;
        this.elements['flash-layer'].style.opacity = 0.8; setTimeout(() => this.elements['flash-layer'].style.opacity = 0, 150);
        
        const video = this.elements['video-feed'];
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        
        let points = this.detectedQuad || [{x:0.15, y:0.15}, {x:0.85, y:0.15}, {x:0.85, y:0.85}, {x:0.15, y:0.85}];
        const fullPoints = points.map(p => ({ x: p.x * canvas.width, y: p.y * canvas.height }));
        this.rawCapture = canvas.toDataURL('image/jpeg');
        this.openCropModal(this.rawCapture, fullPoints);
    },

    openCropModal: function(imgSrc, points) {
        this.elements['crop-modal'].style.display = 'flex';
        const canvas = document.getElementById('crop-canvas');
        const container = document.getElementById('crop-ui-container');
        this.previewImg = new Image();
        this.previewImg.onload = () => {
            const scale = Math.min((window.innerWidth - 48)/this.previewImg.width, (window.innerHeight * 0.7)/this.previewImg.height);
            canvas.width = this.previewImg.width * scale; canvas.height = this.previewImg.height * scale;
            container.style.width = canvas.width+"px"; container.style.height = canvas.height+"px";
            canvas.getContext('2d').drawImage(this.previewImg, 0, 0, canvas.width, canvas.height);
            this.cropPoints = points.map(p => ({ x: p.x * scale, y: p.y * scale }));
            this.updateCropUI(scale);
        };
        this.previewImg.src = imgSrc;
    },

    updateCropUI: function(scale) {
        const ctx = document.getElementById('crop-canvas').getContext('2d');
        const handles = document.querySelectorAll('.crop-handle');
        ctx.drawImage(this.previewImg, 0, 0, ctx.canvas.width, ctx.canvas.height);
        
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath();
        ctx.moveTo(0,0); ctx.lineTo(ctx.canvas.width, 0); ctx.lineTo(ctx.canvas.width, ctx.canvas.height); ctx.lineTo(0, ctx.canvas.height); ctx.closePath();
        ctx.moveTo(this.cropPoints[0].x, this.cropPoints[0].y); ctx.lineTo(this.cropPoints[1].x, this.cropPoints[1].y); ctx.lineTo(this.cropPoints[2].x, this.cropPoints[2].y); ctx.lineTo(this.cropPoints[3].x, this.cropPoints[3].y); ctx.closePath(); ctx.fill('evenodd');
        ctx.strokeStyle = '#D0BCFF'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(this.cropPoints[0].x, this.cropPoints[0].y); this.cropPoints.forEach(p => ctx.lineTo(p.x, p.y)); ctx.closePath(); ctx.stroke();

        handles.forEach((h, i) => {
            h.style.left = this.cropPoints[i].x + 'px'; h.style.top = this.cropPoints[i].y + 'px';
            const move = (e) => {
                const r = document.getElementById('crop-ui-container').getBoundingClientRect();
                const cx = e.touches?e.touches[0].clientX:e.clientX, cy = e.touches?e.touches[0].clientY:e.clientY;
                this.cropPoints[i].x = Math.max(0,Math.min(ctx.canvas.width, cx-r.left)); this.cropPoints[i].y = Math.max(0,Math.min(ctx.canvas.height, cy-r.top));
                this.updateCropUI(scale);
            };
            const stop = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', stop); document.removeEventListener('touchmove', move); document.removeEventListener('touchend', stop); };
            h.onmousedown = () => { document.addEventListener('mousemove', move); document.addEventListener('mouseup', stop); };
            h.ontouchstart = () => { document.addEventListener('touchmove', move); document.addEventListener('touchend', stop); };
        });
    },

    finishCrop: function() {
        const canvas = document.createElement('canvas');
        const cCanvas = document.getElementById('crop-canvas');
        const scale = this.previewImg.width / cCanvas.width;
        const srcPts = this.cropPoints.map(p => p.x * scale);
        const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [srcPts[0].x, srcPts[0].y, srcPts[1].x, srcPts[1].y, srcPts[2].x, srcPts[2].y, srcPts[3].x, srcPts[3].y]);
        const w1 = Math.hypot(srcPts[1].x-srcPts[0].x, srcPts[1].y-srcPts[0].y), w2 = Math.hypot(srcPts[2].x-srcPts[3].x, srcPts[2].y-srcPts[3].y);
        const h1 = Math.hypot(srcPts[3].x-srcPts[0].x, srcPts[3].y-srcPts[0].y), h2 = Math.hypot(srcPts[2].x-srcPts[1].x, srcPts[2].y-srcPts[1].y);
        const maxW = Math.max(w1, w2), maxH = Math.max(h1, h2);
        const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0,0, maxW,0, maxW,maxH, 0,maxH]);
        const M = cv.getPerspectiveTransform(srcTri, dstTri);
        const srcMat = cv.imread(this.previewImg), dstMat = new cv.Mat();
        cv.warpPerspective(srcMat, dstMat, M, new cv.Size(maxW, maxH));
        cv.imshow(canvas, dstMat);
        const resultUrl = canvas.toDataURL('image/jpeg', 0.9);
        srcMat.delete(); dstMat.delete(); M.delete(); srcTri.delete(); dstTri.delete();

        this.saveScan(resultUrl);
    },

    saveScan: function(url) {
        this.scannedDocs.push(url);
        // Only attempt save if cloud is actually active
        if(this.isCloudActive && this.FireManager) {
            this.FireManager.compressAndSaveScan(url);
        }
        
        this.elements['crop-modal'].style.display = 'none';
        this.processing = false;
        this.updateGalleryCount();
        this.elements['last-scan-img'].src = url; this.elements['last-scan-img'].style.display = 'block'; document.querySelector('.placeholder-icon').style.display = 'none';
        this.processFrame();
    },

    updateGalleryCount: function() {
        this.elements['scan-count'].innerText = this.scannedDocs.length;
        this.elements['scan-count'].style.display = 'block';
    },

    sortPoints: function(pts) {
        pts.sort((a,b) => a.y - b.y);
        const top = pts.slice(0, 2).sort((a,b) => a.x - b.x);
        const bot = pts.slice(2, 4).sort((a,b) => b.x - a.x);
        return [top[0], top[1], bot[0], bot[1]];
    },

    openGallery: function() {
        const grid = this.elements['gallery-grid']; grid.innerHTML = '';
        this.scannedDocs.forEach((doc, i) => {
            const img = document.createElement('img'); img.src = doc;
            img.onclick = () => { this.currentDocIndex = i; document.getElementById('editor-img').src = doc; this.elements['editor-modal'].style.display = 'flex'; };
            grid.appendChild(img);
        });
        this.elements['gallery-modal'].style.display = 'flex';
    },
    
    applyFilter: function(type) {
         const img = document.getElementById('editor-img');
         const src = cv.imread(img), dst = new cv.Mat();
         if (type === 'bw') { cv.cvtColor(src, src, cv.COLOR_RGBA2GRAY); cv.threshold(src, dst, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU); }
         else if (type === 'magic') { cv.cvtColor(src, src, cv.COLOR_RGBA2GRAY); cv.adaptiveThreshold(src, dst, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 15, 12); }
         else { src.copyTo(dst); }
         const canvas = document.createElement('canvas'); cv.imshow(canvas, dst); img.src = canvas.toDataURL(); this.scannedDocs[this.currentDocIndex] = img.src; src.delete(); dst.delete();
         // Sync update if needed
    },
    
    deleteCurrentPage: function() {
        if(confirm("Delete?")) { this.scannedDocs.splice(this.currentDocIndex, 1); this.elements['editor-modal'].style.display = 'none'; this.openGallery(); }
    },

    exportPDF: function() {
        if(this.scannedDocs.length === 0) return alert("Empty");
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        this.scannedDocs.forEach((img, i) => {
            if(i>0) doc.addPage();
            const p = doc.getImageProperties(img);
            doc.addImage(img, 'JPEG', 0, 0, doc.internal.pageSize.getWidth(), (p.height * doc.internal.pageSize.getWidth()) / p.width);
        });
        doc.save('scan.pdf');
    }
};

window.app = app;
document.addEventListener('DOMContentLoaded', () => app.init());
