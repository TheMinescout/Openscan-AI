/**
 * OpenScan-AI v8.2 - Crash Fix
 */

import { FireManager } from "./fire-manager.js";

const app = {
    // State
    cvReady: false, streaming: false, autoCapture: true, processing: false,
    scannedDocs: [], currentDocIndex: -1, detectWidth: 600,
    
    // Config
    stabilityCounter: 0, stabilityThreshold: 30,
    detectedQuad: null,
    mat: { src: null, dst: null, binary: null, contours: null, hierarchy: null, poly: null },
    elements: {},

    init: async function() {
        console.log("🚀 OpenScan-AI v8.2 Starting...");
        this.cacheElements();
        this.bindEvents();
        await this.startCamera();
        try { FireManager.init((user) => this.onAuthChange(user)); } catch(e) { console.warn("Cloud Skipped", e); }
        if (typeof cv !== 'undefined' && cv.getBuildInformation) this.onOpenCVReady();
        else { const c=setInterval(()=>{if(typeof cv!=='undefined'&&cv.getBuildInformation){clearInterval(c);this.onOpenCVReady();}},100); }
    },

    cacheElements: function() {
        this.video = document.getElementById('video-feed');
        this.canvas = document.getElementById('overlay-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.elements = {};
        // Add 'status-msg' to the list so we can check it later
        ['status-msg', 'capture-btn', 'crop-modal', 'editor-modal', 'editor-img', 'flash-layer', 
         'gallery-modal', 'gallery-grid', 'scan-count', 'last-scan-img', 'login-view', 'profile-view', 'auth-modal']
         .forEach(id => {
             const el = document.getElementById(id);
             if(el) this.elements[id] = el;
             else console.warn("Element missing:", id);
         });
        this.progressCircle = document.querySelector('.progress-ring__circle');
    },

    bindEvents: function() {
        if(this.elements['capture-btn']) this.elements['capture-btn'].onclick = () => this.triggerCapture(true);
        if(document.getElementById('gallery-trigger')) document.getElementById('gallery-trigger').onclick = () => this.openGallery();
        document.getElementById('settings-btn').onclick = () => document.getElementById('settings-modal').style.display = 'flex';
        document.getElementById('close-settings').onclick = () => document.getElementById('settings-modal').style.display = 'none';
        document.getElementById('done-crop').onclick = () => this.finishCrop();
        document.getElementById('cancel-crop').onclick = () => { this.elements['crop-modal'].style.display = 'none'; this.processing = false; this.ctx.clearRect(0,0,9999,9999); };
        document.getElementById('close-gallery').onclick = () => this.elements['gallery-modal'].style.display = 'none';
        document.getElementById('close-editor').onclick = () => this.elements['editor-modal'].style.display = 'none';
        document.getElementById('save-editor').onclick = () => { this.elements['editor-modal'].style.display = 'none'; this.openGallery(); };
        document.getElementById('account-btn').onclick = () => document.getElementById('auth-modal').style.display = 'flex';
        document.getElementById('close-auth').onclick = () => document.getElementById('auth-modal').style.display = 'none';
        document.getElementById('auto-toggle').onclick = () => { this.autoCapture = !this.autoCapture; document.getElementById('auto-text').innerText = this.autoCapture ? "Auto: ON" : "Auto: OFF"; document.getElementById('auto-toggle').style.opacity = this.autoCapture ? "1" : "0.5"; };
        document.getElementById('do-login').onclick = async () => { const e=document.getElementById('email-input').value, p=document.getElementById('pass-input').value; const r=await FireManager.login(e,p); if(!r.success)alert(r.error); };
        document.getElementById('do-signup').onclick = async () => { const e=document.getElementById('email-input').value, p=document.getElementById('pass-input').value; const r=await FireManager.signup(e,p); if(!r.success)alert(r.error); };
        document.getElementById('do-logout').onclick = () => FireManager.logout();
        document.getElementById('export-btn').onclick = () => this.exportPDF();
        document.getElementById('quality-select').onchange = () => this.startCamera();
        document.getElementById('about-btn').onclick = () => { document.getElementById('settings-modal').style.display='none'; document.getElementById('about-modal').style.display='flex'; };
        document.getElementById('close-about').onclick = () => document.getElementById('about-modal').style.display='none';
        window.addEventListener('resize', () => this.resizeOverlay());
    },

    startCamera: async function() {
        const q = document.getElementById('quality-select').value;
        const w = q==='4k'?3840:(q==='720p'?1280:1920), h = q==='4k'?2160:(q==='720p'?720:1080);
        try { this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: w }, height: { ideal: h } }, audio: false }); }
        catch(e) { try { this.stream = await navigator.mediaDevices.getUserMedia({ video: true }); } catch(e2){ alert("Camera Failed"); return; } }
        this.video.srcObject = this.stream;
        this.video.onloadedmetadata = () => { this.video.play(); this.resizeOverlay(); this.streaming = true; this.initCVMats(); this.processFrame(); };
    },

    processFrame: function() {
        if (!this.streaming || !this.cvReady || this.processing) { requestAnimationFrame(() => this.processFrame()); return; }
        try {
            const w = this.detectWidth, h = Math.round(w * (this.video.videoHeight / this.video.videoWidth));
            const pc = document.getElementById('proc-canvas'); if(pc.width!==w) {pc.width=w;pc.height=h;}
            const pCtx = pc.getContext('2d'); pCtx.drawImage(this.video, 0, 0, w, h);
            
            let src = this.mat.src; src.data.set(pCtx.getImageData(0, 0, w, h).data);
            cv.cvtColor(src, this.mat.dst, cv.COLOR_RGBA2GRAY);
            cv.GaussianBlur(this.mat.dst, this.mat.dst, new cv.Size(5, 5), 0);
            cv.threshold(this.mat.dst, this.mat.binary, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
            let cnts = new cv.MatVector(); cv.findContours(this.mat.binary, cnts, this.mat.hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
            
            let maxA=0, best=null, minA=(w*h)*0.15;
            for(let i=0; i<cnts.size(); ++i) {
                let c = cnts.get(i), a = cv.contourArea(c);
                if(a>minA) {
                    let p = cv.arcLength(c, true); cv.approxPolyDP(c, this.mat.poly, 0.02*p, true);
                    if(cv.isContourConvex(this.mat.poly) && (this.mat.poly.rows===4 || a>minA*2)) { if(a>maxA) { maxA=a; best=this.mat.poly.data32S; } }
                }
            }
            cnts.delete(); this.drawOverlay(best, w, h);
        } catch(e) { this.initCVMats(); }
        requestAnimationFrame(() => this.processFrame());
    },

    drawOverlay: function(pts, pW, pH) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        if(pts) {
            const sx = this.canvas.width/pW, sy = this.canvas.height/pH;
            let p = pts.length===8 ? [{x:pts[0],y:pts[1]},{x:pts[2],y:pts[3]},{x:pts[4],y:pts[5]},{x:pts[6],y:pts[7]}] : [{x:0,y:0},{x:pW,y:0},{x:pW,y:pH},{x:0,y:pH}];
            p = this.sortPoints(p);
            this.detectedQuad = p.map(pt => ({ x: pt.x/pW, y: pt.y/pH }));
            
            this.ctx.beginPath(); this.ctx.lineWidth=4; this.ctx.strokeStyle='#D0BCFF';
            this.ctx.moveTo(p[0].x*sx, p[0].y*sy); for(let i=1; i<4; i++) this.ctx.lineTo(p[i].x*sx, p[i].y*sy);
            this.ctx.closePath(); this.ctx.stroke();

            if(this.autoCapture && !this.processing) {
                this.updateStatus("Hold Still", "rgba(0,200,0,0.5)");
                this.stabilityCounter++;
                if(this.progressCircle) this.progressCircle.style.strokeDashoffset = 251 - (251 * Math.min(this.stabilityCounter/this.stabilityThreshold, 1));
                if(this.stabilityCounter >= this.stabilityThreshold) this.triggerCapture(false);
            }
        } else {
            this.detectedQuad=null; this.stabilityCounter=0;
            if(this.progressCircle) this.progressCircle.style.strokeDashoffset = 251;
            this.updateStatus("Searching...", "rgba(0,0,0,0.4)");
        }
    },
    
    // SAFE STATUS UPDATE (Prevents Crash)
    updateStatus: function(text, bg) {
        const el = this.elements['status-msg'];
        if(el) { el.innerText = text; el.style.background = bg; }
    },

    triggerCapture: function(isManual) {
        if (this.processing) return;
        this.processing = true; this.stabilityCounter = 0;
        this.elements['flash-layer'].style.opacity = 0.8; setTimeout(() => this.elements['flash-layer'].style.opacity = 0, 150);
        
        const c = document.createElement('canvas'); c.width=this.video.videoWidth; c.height=this.video.videoHeight;
        c.getContext('2d').drawImage(this.video, 0, 0);
        
        // Safety Check: Is canvas empty?
        const check = c.getContext('2d').getImageData(0,0,1,1).data;
        if(check[3] === 0) { console.error("Empty Capture"); this.processing = false; return; }

        let pts = this.detectedQuad || [{x:0.1, y:0.1}, {x:0.9, y:0.1}, {x:0.9, y:0.9}, {x:0.1, y:0.9}];
        const fullPts = pts.map(p => ({ x: p.x * c.width, y: p.y * c.height }));
        this.rawCapture = c.toDataURL('image/jpeg');
        this.openCropModal(this.rawCapture, fullPts);
    },

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
             this.cropPoints = this.sortPoints(pts).map(p => ({x:p.x*s, y:p.y*s}));
             this.updateCropUI(s);
        };
        this.previewImg.src = src;
    },

    updateCropUI: function(s) {
        const ctx = document.getElementById('crop-canvas').getContext('2d');
        const h = document.querySelectorAll('.crop-handle');
        ctx.drawImage(this.previewImg,0,0,ctx.canvas.width,ctx.canvas.height);
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
        const c = document.createElement('canvas');
        const s = this.previewImg.width / document.getElementById('crop-canvas').width;
        const pts = this.sortPoints(this.cropPoints).map(p=>p.x*s);
        const w = Math.max(Math.hypot(pts[1].x-pts[0].x, pts[1].y-pts[0].y), Math.hypot(pts[2].x-pts[3].x, pts[2].y-pts[3].y));
        const h = Math.max(Math.hypot(pts[3].x-pts[0].x, pts[3].y-pts[0].y), Math.hypot(pts[2].x-pts[1].x, pts[2].y-pts[1].y));
        const srcTri = cv.matFromArray(4,1,cv.CV_32FC2, [pts[0].x,pts[0].y, pts[1].x,pts[1].y, pts[2].x,pts[2].y, pts[3].x,pts[3].y]);
        const dstTri = cv.matFromArray(4,1,cv.CV_32FC2, [0,0, w,0, w,h, 0,h]);
        const M = cv.getPerspectiveTransform(srcTri, dstTri);
        const src = cv.imread(this.previewImg), dst = new cv.Mat();
        cv.warpPerspective(src, dst, M, new cv.Size(w, h));
        cv.imshow(c, dst);
        const url = c.toDataURL('image/jpeg', 0.85);
        src.delete(); dst.delete(); M.delete(); srcTri.delete(); dstTri.delete();
        this.saveScan(url);
    },

    saveScan: function(url) {
        if(!url || url.length < 100) return alert("Save Error");
        this.scannedDocs.push(url);
        try { FireManager.compressAndSaveScan(url); } catch(e){}
        this.elements['crop-modal'].style.display = 'none';
        this.processing = false;
        this.elements['scan-count'].innerText = this.scannedDocs.length;
        this.elements['scan-count'].style.display = 'block';
        this.elements['last-scan-img'].src = url; 
        this.elements['last-scan-img'].style.display = 'block';
        document.querySelector('.placeholder-icon').style.display = 'none';
        this.processFrame();
    },

    sortPoints: function(pts) {
        pts.sort((a,b)=>a.y-b.y);
        const t = pts.slice(0,2).sort((a,b)=>a.x-b.x);
        const b = pts.slice(2,4).sort((a,b)=>b.x-a.x);
        return [t[0],t[1],b[0],b[1]];
    },
    
    openGallery: function() {
        const grid = this.elements['gallery-grid']; grid.innerHTML='';
        if(this.scannedDocs.length===0) grid.innerHTML='<p style="text-align:center;width:100%;color:#666;">No scans</p>';
        this.scannedDocs.forEach((d,i)=>{
            const img = document.createElement('img'); img.src=d;
            img.onclick = () => { this.currentDocIndex=i; document.getElementById('editor-img').src=d; this.elements['editor-modal'].style.display='flex'; };
            grid.appendChild(img);
        });
        this.elements['gallery-modal'].style.display='flex';
    },

    onAuthChange: async function(user) {
        if (user) {
            this.elements['login-view'].style.display = 'none'; this.elements['profile-view'].style.display = 'block';
            document.getElementById('user-email-display').innerText = user.email; document.getElementById('account-btn').style.color = '#D0BCFF';
            try { const s = await FireManager.loadCloudScans(); if(s.length>0) { const n=s.filter(u=>!this.scannedDocs.includes(u)); if(n.length>0){this.scannedDocs=[...this.scannedDocs,...n]; this.elements['scan-count'].innerText=this.scannedDocs.length; this.elements['scan-count'].style.display='block';} } } catch(e){}
        } else { this.elements['login-view'].style.display = 'block'; this.elements['profile-view'].style.display = 'none'; document.getElementById('account-btn').style.color = 'white'; }
    },
    
    onOpenCVReady: function() { this.cvReady = true; this.initCVMats(); },
    initCVMats: function() { const h = Math.round(this.detectWidth * (this.video.videoHeight/this.video.videoWidth)); if(this.mat.src) this.mat.src.delete(); this.mat.src = new cv.Mat(h, this.detectWidth, cv.CV_8UC4); this.mat.dst = new cv.Mat(h, this.detectWidth, cv.CV_8UC1); this.mat.binary = new cv.Mat(h, this.detectWidth, cv.CV_8UC1); this.mat.hierarchy = new cv.Mat(); this.mat.poly = new cv.Mat(); },
    resizeOverlay: function() { this.canvas.width=this.video.clientWidth; this.canvas.height=this.video.clientHeight; },
    applyFilter: function(type) { const img=document.getElementById('editor-img'); const src=cv.imread(img),dst=new cv.Mat(); if(type==='bw'){cv.cvtColor(src,src,cv.COLOR_RGBA2GRAY);cv.threshold(src,dst,0,255,cv.THRESH_BINARY|cv.THRESH_OTSU);}else if(type==='magic'){cv.cvtColor(src,src,cv.COLOR_RGBA2GRAY);cv.adaptiveThreshold(src,dst,255,cv.ADAPTIVE_THRESH_GAUSSIAN_C,cv.THRESH_BINARY,15,12);}else{src.copyTo(dst);} const c=document.createElement('canvas');cv.imshow(c,dst);img.src=c.toDataURL();this.scannedDocs[this.currentDocIndex]=img.src;src.delete();dst.delete(); },
    deleteCurrentPage: function() { if(confirm("Delete?")){this.scannedDocs.splice(this.currentDocIndex,1);this.elements['editor-modal'].style.display='none';this.openGallery();this.elements['scan-count'].innerText=this.scannedDocs.length;} },
    exportPDF: function() { if(this.scannedDocs.length===0)return alert("Empty"); const {jsPDF}=window.jspdf; const doc=new jsPDF(); this.scannedDocs.forEach((img,i)=>{if(i>0)doc.addPage();const p=doc.getImageProperties(img);doc.addImage(img,'JPEG',0,0,doc.internal.pageSize.getWidth(),(p.height*doc.internal.pageSize.getWidth())/p.width);}); doc.save('scan.pdf'); }
};

window.app = app;
document.addEventListener('DOMContentLoaded', () => app.init());
