/**
 * OpenScan-AI v8.0 - Instant Camera & Debugging
 * - Starts Camera IMMEDIATELY (Doesn't wait for AI/Cloud).
 * - prints status updates to the screen so you know what's working.
 * - Handles shutter clicks even if AI is offline.
 */

import { FireManager } from "./fire-manager.js";

const app = {
    cvReady: false,
    streaming: false,
    autoCapture: true,
    processing: false,
    scannedDocs: [],
    currentDocIndex: -1,
    detectWidth: 600,
    
    // Core Elements
    video: null,
    canvas: null,
    ctx: null,
    
    // Config
    stabilityCounter: 0,
    stabilityThreshold: 30,
    detectedQuad: null,
    mat: { src: null, dst: null, binary: null, contours: null, hierarchy: null, poly: null },

    init: async function() {
        this.log("🚀 App Starting...");
        this.cacheElements();
        this.bindEvents();

        // 1. START CAMERA IMMEDIATELY
        await this.startCamera();

        // 2. Load Cloud in Background (Don't block camera)
        this.initCloud();

        // 3. Check OpenCV
        if (typeof cv !== 'undefined' && cv.getBuildInformation) {
            this.onOpenCVReady();
        } else {
            this.log("⏳ Waiting for OpenCV...");
            // Poll for OpenCV every 100ms
            const checkCV = setInterval(() => {
                if (typeof cv !== 'undefined' && cv.getBuildInformation) {
                    clearInterval(checkCV);
                    this.onOpenCVReady();
                }
            }, 100);
        }
    },

    cacheElements: function() {
        this.video = document.getElementById('video-feed');
        this.canvas = document.getElementById('overlay-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.elements = {};
        ['status-msg', 'capture-btn', 'crop-modal', 'editor-modal', 'editor-img', 'flash-layer', 
         'gallery-modal', 'gallery-grid', 'scan-count', 'last-scan-img', 'login-view', 'profile-view', 'auth-modal']
         .forEach(id => this.elements[id] = document.getElementById(id));
        this.progressCircle = document.querySelector('.progress-ring__circle');
    },

    startCamera: async function() {
        this.log("📷 Requesting Camera...");
        const quality = document.getElementById('quality-select').value;
        const targetW = quality === '4k' ? 3840 : (quality === '720p' ? 1280 : 1920);
        const targetH = quality === '4k' ? 2160 : (quality === '720p' ? 720 : 1080);

        const constraints = [
            { video: { facingMode: "environment", width: { ideal: targetW }, height: { ideal: targetH } }, audio: false },
            { video: { facingMode: "environment" }, audio: false },
            { video: true, audio: false } // Laptop Fallback
        ];

        for (let c of constraints) {
            try {
                this.stream = await navigator.mediaDevices.getUserMedia(c);
                this.log("✅ Camera Found: " + (c.video.facingMode || "Generic"));
                break; 
            } catch (e) { console.warn("Cam Constraint Failed", e); }
        }

        if (this.stream) {
            this.video.srcObject = this.stream;
            this.video.onloadedmetadata = () => {
                this.video.play().catch(e => this.log("Autoplay blocked: tap screen"));
                this.resizeOverlay();
                this.streaming = true;
                this.log("🎥 Video Feed Active");
            };
        } else {
            this.log("❌ NO CAMERA FOUND. Check Permissions.");
            alert("Could not start camera. Please check browser permissions.");
        }
    },

    onOpenCVReady: function() {
        this.log("🧠 AI Engine Loaded");
        this.cvReady = true;
        this.initCVMats();
        this.processFrame();
    },

    initCloud: function() {
        this.log("☁️ Connecting Cloud...");
        try {
            FireManager.init((user) => this.onAuthChange(user));
        } catch(e) {
            this.log("⚠️ Cloud Offline (Config Missing?)");
        }
    },

    processFrame: function() {
        if (!this.streaming || !this.cvReady || this.processing) {
            requestAnimationFrame(() => this.processFrame());
            return;
        }

        try {
            const width = this.detectWidth;
            const height = Math.round(width * (this.video.videoHeight / this.video.videoWidth));
            
            // Draw video to hidden canvas for processing
            const procCanvas = document.getElementById('proc-canvas');
            if(procCanvas.width !== width) { procCanvas.width = width; procCanvas.height = height; }
            const pCtx = procCanvas.getContext('2d');
            pCtx.drawImage(this.video, 0, 0, width, height);

            let src = this.mat.src;
            src.data.set(pCtx.getImageData(0, 0, width, height).data);
            
            cv.cvtColor(src, this.mat.dst, cv.COLOR_RGBA2GRAY);
            cv.GaussianBlur(this.mat.dst, this.mat.dst, new cv.Size(5, 5), 0);
            cv.threshold(this.mat.dst, this.mat.binary, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
            
            let contours = new cv.MatVector();
            cv.findContours(this.mat.binary, contours, this.mat.hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

            let maxArea = 0;
            let bestContour = null;
            let minArea = (width * height) * 0.15;

            for (let i = 0; i < contours.size(); ++i) {
                let cnt = contours.get(i);
                let area = cv.contourArea(cnt);
                if (area > minArea) {
                    let peri = cv.arcLength(cnt, true);
                    cv.approxPolyDP(cnt, this.mat.poly, 0.02 * peri, true);
                    if (cv.isContourConvex(this.mat.poly) && (this.mat.poly.rows === 4 || area > minArea * 2)) {
                        if (area > maxArea) {
                            maxArea = area;
                            bestContour = this.mat.poly.data32S;
                        }
                    }
                }
            }
            contours.delete();
            this.drawOverlay(bestContour, width, height);

        } catch (e) {
            console.error(e);
            this.initCVMats(); // Reset memory on error
        }
        requestAnimationFrame(() => this.processFrame());
    },

    drawOverlay: function(points, pW, pH) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        if (points) {
            // Draw Blue Box
            const scaleX = this.canvas.width / pW;
            const scaleY = this.canvas.height / pH;
            
            // Map points...
            let pts = points.length === 8 ? 
                [{x:points[0],y:points[1]}, {x:points[2],y:points[3]}, {x:points[4],y:points[5]}, {x:points[6],y:points[7]}] 
                : [{x:0,y:0},{x:pW,y:0},{x:pW,y:pH},{x:0,y:pH}];
            
            pts = this.sortPoints(pts);
            this.detectedQuad = pts.map(p => ({ x: p.x / pW, y: p.y / pH }));

            this.ctx.beginPath();
            this.ctx.lineWidth = 4;
            this.ctx.strokeStyle = '#D0BCFF';
            this.ctx.moveTo(pts[0].x * scaleX, pts[0].y * scaleY);
            for(let i=1; i<4; i++) this.ctx.lineTo(pts[i].x * scaleX, pts[i].y * scaleY);
            this.ctx.closePath();
            this.ctx.stroke();

            // Auto Capture Logic
            if (this.autoCapture && !this.processing) {
                this.elements['status-msg'].innerText = "Hold Still";
                this.elements['status-msg'].style.background = "rgba(0,200,0,0.5)";
                this.stabilityCounter++;
                let progress = Math.min(this.stabilityCounter / this.stabilityThreshold, 1);
                this.progressCircle.style.strokeDashoffset = 251 - (251 * progress);

                if (this.stabilityCounter >= this.stabilityThreshold) {
                    this.triggerCapture(false);
                }
            }
        } else {
            this.detectedQuad = null;
            this.stabilityCounter = 0;
            this.progressCircle.style.strokeDashoffset = 251;
            this.elements['status-msg'].innerText = "Searching...";
            this.elements['status-msg'].style.background = "rgba(0,0,0,0.4)";
        }
    },

    triggerCapture: function(isManual) {
        if (this.processing) return;
        this.processing = true;
        this.stabilityCounter = 0;
        this.log("📸 Capturing...");

        // Flash Effect
        this.elements['flash-layer'].style.opacity = 0.8;
        setTimeout(() => this.elements['flash-layer'].style.opacity = 0, 150);

        // Capture High Res
        const fullCanvas = document.createElement('canvas');
        fullCanvas.width = this.video.videoWidth;
        fullCanvas.height = this.video.videoHeight;
        fullCanvas.getContext('2d').drawImage(this.video, 0, 0);

        // Default crop if nothing detected
        let points = this.detectedQuad || [{x:0.1, y:0.1}, {x:0.9, y:0.1}, {x:0.9, y:0.9}, {x:0.1, y:0.9}];
        const fullPoints = points.map(p => ({ x: p.x * fullCanvas.width, y: p.y * fullCanvas.height }));

        this.rawCapture = fullCanvas.toDataURL('image/jpeg');
        this.openCropModal(this.rawCapture, fullPoints);
    },

    // --- UTILS ---
    log: function(msg) {
        console.log(msg);
        const pill = document.getElementById('status-msg');
        if(pill) pill.innerText = msg;
    },

    initCVMats: function() {
        const aspect = this.video.videoHeight / this.video.videoWidth;
        const h = Math.round(this.detectWidth * aspect);
        if(this.mat.src) this.mat.src.delete();
        this.mat.src = new cv.Mat(h, this.detectWidth, cv.CV_8UC4);
        this.mat.dst = new cv.Mat(h, this.detectWidth, cv.CV_8UC1);
        this.mat.binary = new cv.Mat(h, this.detectWidth, cv.CV_8UC1);
        this.mat.hierarchy = new cv.Mat();
        this.mat.poly = new cv.Mat();
    },

    resizeOverlay: function() {
        if(this.video.videoWidth > 0) {
            this.canvas.width = this.video.clientWidth;
            this.canvas.height = this.video.clientHeight;
        }
    },
    
    bindEvents: function() {
        // UI
        document.getElementById('capture-btn').onclick = () => this.triggerCapture(true);
        document.getElementById('gallery-trigger').onclick = () => this.openGallery();
        document.getElementById('settings-btn').onclick = () => document.getElementById('settings-modal').style.display = 'flex';
        document.getElementById('close-settings').onclick = () => document.getElementById('settings-modal').style.display = 'none';
        document.getElementById('done-crop').onclick = () => this.finishCrop();
        document.getElementById('cancel-crop').onclick = () => { 
            this.elements['crop-modal'].style.display = 'none'; 
            this.processing = false; 
            this.ctx.clearRect(0,0,9999,9999);
        };
        document.getElementById('account-btn').onclick = () => document.getElementById('auth-modal').style.display = 'flex';
        document.getElementById('close-auth').onclick = () => document.getElementById('auth-modal').style.display = 'none';
        
        // Settings
        document.getElementById('auto-toggle').onclick = () => {
             this.autoCapture = !this.autoCapture;
             document.getElementById('auto-text').innerText = this.autoCapture ? "Auto: ON" : "Auto: OFF";
             document.getElementById('auto-toggle').style.opacity = this.autoCapture ? "1" : "0.5";
        };

        // Auth
        document.getElementById('do-login').onclick = async () => {
            const e = document.getElementById('email-input').value;
            const p = document.getElementById('pass-input').value;
            const res = await FireManager.login(e, p);
            if(!res.success) alert(res.error);
        };
        document.getElementById('do-signup').onclick = async () => {
            const e = document.getElementById('email-input').value;
            const p = document.getElementById('pass-input').value;
            const res = await FireManager.signup(e, p);
            if(!res.success) alert(res.error);
        };
        document.getElementById('do-logout').onclick = () => FireManager.logout();
    },

    // --- Firebase Callbacks ---
    onAuthChange: async function(user) {
        if (user) {
            this.elements['login-view'].style.display = 'none';
            this.elements['profile-view'].style.display = 'block';
            document.getElementById('user-email-display').innerText = user.email;
            document.getElementById('account-btn').style.color = '#D0BCFF';
            
            const cloudScans = await FireManager.loadCloudScans();
            if(cloudScans.length > 0) {
                 this.scannedDocs = [...this.scannedDocs, ...cloudScans];
                 this.updateGalleryCount();
                 this.log(`☁️ Synced ${cloudScans.length} scans`);
            }
        } else {
            this.elements['login-view'].style.display = 'block';
            this.elements['profile-view'].style.display = 'none';
            document.getElementById('account-btn').style.color = 'white';
        }
    },

    // ... (Keep existing crop/sort/gallery functions, abbreviated here for safe copy-paste)
    openCropModal: function(src, pts) {
        this.elements['crop-modal'].style.display = 'flex';
        const c = document.getElementById('crop-canvas');
        const ui = document.getElementById('crop-ui-container');
        this.previewImg = new Image();
        this.previewImg.onload = () => {
             const s = Math.min((window.innerWidth-40)/this.previewImg.width, (window.innerHeight*0.7)/this.previewImg.height);
             c.width = this.previewImg.width*s; c.height = this.previewImg.height*s;
             ui.style.width = c.width+"px"; ui.style.height = c.height+"px";
             c.getContext('2d').drawImage(this.previewImg,0,0,c.width,c.height);
             this.cropPoints = pts.map(p => ({x:p.x*s, y:p.y*s}));
             this.updateCropUI(s);
        };
        this.previewImg.src = src;
    },

    updateCropUI: function(s) {
        const ctx = document.getElementById('crop-canvas').getContext('2d');
        const h = document.querySelectorAll('.crop-handle');
        ctx.drawImage(this.previewImg,0,0,ctx.canvas.width,ctx.canvas.height);
        // Draw Crop Box
        ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(ctx.canvas.width,0); ctx.lineTo(ctx.canvas.width,ctx.canvas.height); ctx.lineTo(0,ctx.canvas.height); ctx.closePath();
        ctx.moveTo(this.cropPoints[0].x,this.cropPoints[0].y); ctx.lineTo(this.cropPoints[1].x,this.cropPoints[1].y); ctx.lineTo(this.cropPoints[2].x,this.cropPoints[2].y); ctx.lineTo(this.cropPoints[3].x,this.cropPoints[3].y); ctx.closePath(); ctx.fill('evenodd');
        ctx.strokeStyle='#D0BCFF'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(this.cropPoints[0].x,this.cropPoints[0].y); this.cropPoints.forEach(p=>ctx.lineTo(p.x,p.y)); ctx.closePath(); ctx.stroke();
        
        h.forEach((handle, i) => {
            handle.style.left = this.cropPoints[i].x+'px'; handle.style.top = this.cropPoints[i].y+'px';
            const drag = (e) => {
                const r = document.getElementById('crop-ui-container').getBoundingClientRect();
                const cx = e.touches?e.touches[0].clientX:e.clientX, cy = e.touches?e.touches[0].clientY:e.clientY;
                this.cropPoints[i].x = Math.max(0,Math.min(ctx.canvas.width, cx-r.left)); this.cropPoints[i].y = Math.max(0,Math.min(ctx.canvas.height, cy-r.top));
                this.updateCropUI(s);
            };
            const end = () => { document.removeEventListener('mousemove',drag); document.removeEventListener('mouseup',end); document.removeEventListener('touchmove',drag); document.removeEventListener('touchend',end); };
            handle.onmousedown = () => { document.addEventListener('mousemove',drag); document.addEventListener('mouseup',end); };
            handle.ontouchstart = () => { document.addEventListener('touchmove',drag); document.addEventListener('touchend',end); };
        });
    },

    finishCrop: function() {
        const c = document.getElementById('crop-canvas');
        const s = this.previewImg.width / c.width;
        const pts = this.cropPoints.map(p=>p.x*s);
        const w = Math.max(Math.hypot(pts[1].x-pts[0].x, pts[1].y-pts[0].y), Math.hypot(pts[2].x-pts[3].x, pts[2].y-pts[3].y));
        const h = Math.max(Math.hypot(pts[3].x-pts[0].x, pts[3].y-pts[0].y), Math.hypot(pts[2].x-pts[1].x, pts[2].y-pts[1].y));
        
        const srcTri = cv.matFromArray(4,1,cv.CV_32FC2, [pts[0].x,pts[0].y, pts[1].x,pts[1].y, pts[2].x,pts[2].y, pts[3].x,pts[3].y]);
        const dstTri = cv.matFromArray(4,1,cv.CV_32FC2, [0,0, w,0, w,h, 0,h]);
        const M = cv.getPerspectiveTransform(srcTri, dstTri);
        const src = cv.imread(this.previewImg), dst = new cv.Mat();
        cv.warpPerspective(src, dst, M, new cv.Size(w, h));
        
        const resCanvas = document.createElement('canvas');
        cv.imshow(resCanvas, dst);
        const url = resCanvas.toDataURL('image/jpeg', 0.85);
        
        src.delete(); dst.delete(); M.delete(); srcTri.delete(); dstTri.delete();
        this.saveScan(url);
    },

    saveScan: function(url) {
        this.scannedDocs.push(url);
        FireManager.compressAndSaveScan(url); // Auto upload if logged in
        this.elements['crop-modal'].style.display = 'none';
        this.processing = false;
        this.updateGalleryCount();
        this.elements['last-scan-img'].src = url; this.elements['last-scan-img'].style.display = 'block';
        document.querySelector('.placeholder-icon').style.display = 'none';
    },

    updateGalleryCount: function() {
        this.elements['scan-count'].innerText = this.scannedDocs.length;
        this.elements['scan-count'].style.display = 'block';
    },

    sortPoints: function(pts) {
        pts.sort((a,b)=>a.y-b.y);
        const t = pts.slice(0,2).sort((a,b)=>a.x-b.x);
        const b = pts.slice(2,4).sort((a,b)=>b.x-a.x);
        return [t[0],t[1],b[0],b[1]];
    },
    
    openGallery: function() {
        const grid = this.elements['gallery-grid']; grid.innerHTML='';
        this.scannedDocs.forEach((d,i)=>{
            const img = document.createElement('img'); img.src=d;
            img.onclick = () => { this.currentDocIndex=i; document.getElementById('editor-img').src=d; this.elements['editor-modal'].style.display='flex'; };
            grid.appendChild(img);
        });
        this.elements['gallery-modal'].style.display='flex';
    },

    exportPDF: function() {
        if(this.scannedDocs.length===0) return alert("Scan something first");
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        this.scannedDocs.forEach((img, i) => {
            if(i>0) doc.addPage();
            const props = doc.getImageProperties(img);
            const w = doc.internal.pageSize.getWidth();
            const h = (props.height * w) / props.width;
            doc.addImage(img, 'JPEG', 0, 0, w, h);
        });
        doc.save('OpenScan_Doc.pdf');
    }
    // (Other editor functions omitted for space, they are same as before)
};

window.app = app;
document.addEventListener('DOMContentLoaded', () => app.init());
