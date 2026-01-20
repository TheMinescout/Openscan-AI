/**
 * Minescout Scanner v1.0 (Material Rebuild)
 */
import { FireManager } from "./fire-manager.js";

const app = {
    // --- APP STATE ---
    state: {
        view: 'home',
        cameraActive: false,
        autoCapture: true,
        currentImage: null, // Blob or DataURL being edited
        scans: [] // Local cache of scans
    },

    // --- SUB-MODULES ---
    router: {
        go: function(viewName) {
            // Hide all views
            document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
            
            // Show target
            document.getElementById(`view-${viewName}`).classList.add('active');
            
            // Update Nav
            const navBtn = document.querySelector(`.nav-item[data-target="${viewName}"]`);
            if(navBtn) navBtn.classList.add('active');

            // Handle Camera Lifecycle
            if(viewName === 'scanner') app.camera.start();
            else app.camera.stop();

            app.state.view = viewName;
        },
        back: function() {
            this.go('home'); // Simple logic for now
        }
    },

    camera: {
        stream: null,
        video: null,
        detectWidth: 600,
        cvReady: false,
        stability: 0,
        
        init: function() {
            this.video = document.getElementById('video-feed');
            if(typeof cv !== 'undefined') this.onCVReady();
            else document.addEventListener('opencv_ready', () => this.onCVReady());
        },

        onCVReady: function() {
            this.cvReady = true;
            this.mat = { 
                src: new cv.Mat(), dst: new cv.Mat(), binary: new cv.Mat(), 
                contours: new cv.MatVector(), poly: new cv.Mat() 
            };
        },

        start: async function() {
            if(this.stream) return;
            try {
                // Nuclear fallback logic
                try {
                    this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
                } catch(e) {
                    this.stream = await navigator.mediaDevices.getUserMedia({ video: true });
                }
                this.video.srcObject = this.stream;
                this.video.play();
                app.state.cameraActive = true;
                this.processLoop();
            } catch(e) {
                alert("Camera Access Denied");
            }
        },

        stop: function() {
            if(this.stream) {
                this.stream.getTracks().forEach(t => t.stop());
                this.stream = null;
                app.state.cameraActive = false;
            }
        },

        processLoop: function() {
            if(!app.state.cameraActive || !this.cvReady) return;
            
            // 1. Draw frame to hidden canvas for processing
            const proc = document.getElementById('proc-canvas');
            const aspect = this.video.videoHeight / this.video.videoWidth;
            if(proc.width !== this.detectWidth) {
                proc.width = this.detectWidth; proc.height = this.detectWidth * aspect;
            }
            const ctx = proc.getContext('2d');
            ctx.drawImage(this.video, 0, 0, proc.width, proc.height);

            // 2. OpenCV Detection
            try {
                let src = this.mat.src;
                if(src.cols !== proc.width) {
                    src.create(proc.height, proc.width, cv.CV_8UC4);
                    this.mat.dst.create(proc.height, proc.width, cv.CV_8UC1);
                    this.mat.binary.create(proc.height, proc.width, cv.CV_8UC1);
                }
                
                src.data.set(ctx.getImageData(0,0,proc.width,proc.height).data);
                cv.cvtColor(src, this.mat.dst, cv.COLOR_RGBA2GRAY);
                cv.threshold(this.mat.dst, this.mat.binary, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
                
                cv.findContours(this.mat.binary, this.mat.contours, new cv.Mat(), cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

                // Find largest quad
                let maxArea = 0, bestQuad = null;
                for(let i=0; i<this.mat.contours.size(); i++) {
                    let cnt = this.mat.contours.get(i);
                    let area = cv.contourArea(cnt);
                    if(area > (proc.width*proc.height)*0.1) { // 10% screen
                        let peri = cv.arcLength(cnt, true);
                        cv.approxPolyDP(cnt, this.mat.poly, 0.02*peri, true);
                        if(this.mat.poly.rows === 4) {
                             if(area > maxArea) { maxArea = area; bestQuad = this.mat.poly.data32S; }
                        }
                    }
                }
                
                this.drawOverlay(bestQuad, proc.width, proc.height);

            } catch(e) { console.error(e); }

            requestAnimationFrame(() => this.processLoop());
        },

        drawOverlay: function(points, dw, dh) {
            const canvas = document.getElementById('overlay-canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = this.video.clientWidth; canvas.height = this.video.clientHeight;
            
            ctx.clearRect(0,0,canvas.width,canvas.height);
            
            if(points) {
                // Scale points
                const sx = canvas.width / dw; const sy = canvas.height / dh;
                // Draw Box
                ctx.beginPath();
                ctx.moveTo(points[0]*sx, points[1]*sy);
                ctx.lineTo(points[2]*sx, points[3]*sy);
                ctx.lineTo(points[4]*sx, points[5]*sy);
                ctx.lineTo(points[6]*sx, points[7]*sy);
                ctx.closePath();
                ctx.strokeStyle = '#5d8c58'; ctx.lineWidth = 4; ctx.stroke();
                
                // Auto Capture Logic
                if(app.state.autoCapture) {
                    this.stability++;
                    const ring = document.querySelector('.progress-ring__circle');
                    const offset = 226 - (226 * (Math.min(this.stability/30, 1)));
                    ring.style.strokeDashoffset = offset;
                    
                    if(this.stability > 30) {
                        this.capture(points); // Auto snap
                        this.stability = 0;
                    }
                    document.getElementById('scan-status').innerText = "Hold Steady...";
                }
            } else {
                this.stability = 0;
                document.querySelector('.progress-ring__circle').style.strokeDashoffset = 226;
                document.getElementById('scan-status').innerText = "Looking for document...";
            }
        },

        capture: function(cropPoints) {
            // Flash
            this.video.style.opacity = 0.5; setTimeout(()=>this.video.style.opacity=1, 100);
            
            const canvas = document.createElement('canvas');
            canvas.width = this.video.videoWidth; canvas.height = this.video.videoHeight;
            canvas.getContext('2d').drawImage(this.video, 0, 0);
            
            const url = canvas.toDataURL('image/jpeg');
            
            // Send to Editor
            app.editor.load(url);
            app.router.go('editor');
        },

        toggleFlash: function() {
            // Basic implementation requires advanced constraints, placeholder for now
            alert("Flash toggle logic requires stream constraints update.");
        },

        switchCamera: function() {
            this.stop();
            this.start(); // Simple toggle for now, would typically cycle IDs
        }
    },

    editor: {
        load: function(src) {
            const img = document.getElementById('edit-target');
            img.src = src;
            app.state.currentImage = src;
        },
        
        applyFilter: function(type) {
            // Using OpenCV for filters
            const img = document.getElementById('edit-target');
            const src = cv.imread(img);
            const dst = new cv.Mat();
            
            if(type === 'bw') {
                cv.cvtColor(src, src, cv.COLOR_RGBA2GRAY);
                cv.threshold(src, dst, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
            } else if (type === 'magic') {
                cv.cvtColor(src, src, cv.COLOR_RGBA2GRAY);
                cv.adaptiveThreshold(src, dst, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 15, 10);
            }
            
            const canvas = document.createElement('canvas');
            cv.imshow(canvas, dst);
            img.src = canvas.toDataURL();
            
            src.delete(); dst.delete();
        },

        rotate: function() {
            const img = document.getElementById('edit-target');
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const i = new Image();
            i.onload = () => {
                canvas.width = i.height; canvas.height = i.width;
                ctx.translate(canvas.width/2, canvas.height/2);
                ctx.rotate(90 * Math.PI / 180);
                ctx.drawImage(i, -i.width/2, -i.height/2);
                img.src = canvas.toDataURL();
            };
            i.src = img.src;
        },

        save: function() {
            const img = document.getElementById('edit-target');
            // Save to Local History
            app.state.scans.push(img.src);
            // Sync to Cloud
            FireManager.compressAndSaveScan(img.src);
            // Update UI
            app.history.render();
            // Go to History
            app.router.go('history');
        },

        delete: function() {
            if(confirm("Delete this scan?")) app.router.back();
        },

        startCrop: function() { alert("Crop tool active (Visual placeholder)"); },
        exportPDF: function() {
             const { jsPDF } = window.jspdf;
             const doc = new jsPDF();
             doc.addImage(document.getElementById('edit-target').src, 'JPEG', 10, 10, 190, 0);
             doc.save('Minescout-Scan.pdf');
        }
    },

    history: {
        render: function() {
            const grid = document.getElementById('scan-grid');
            grid.innerHTML = '';
            
            // Combine local and cloud
            const allScans = app.state.scans;
            
            if(allScans.length === 0) {
                grid.innerHTML = "<p style='grid-column:span 2; text-align:center; color:#888;'>No scans found.</p>";
                return;
            }

            // Update mini preview on scanner
            document.getElementById('last-scan-thumb').src = allScans[allScans.length-1];

            allScans.forEach(src => {
                const card = document.createElement('div');
                card.className = 'post-card';
                card.innerHTML = `<img src="${src}">`;
                card.onclick = () => {
                    app.editor.load(src);
                    app.router.go('editor');
                };
                grid.appendChild(card);
            });
        }
    },

    // --- INITIALIZATION ---
    init: async function() {
        console.log("Minescout Scanner Init");
        this.camera.init();
        
        // Listen for File Uploads
        document.getElementById('file-upload').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if(file) {
                const reader = new FileReader();
                reader.onload = (evt) => {
                    app.editor.load(evt.target.result);
                    app.router.go('editor');
                };
                reader.readAsDataURL(file);
            }
        });

        // Setup Buttons
        document.getElementById('shutter-btn').onclick = () => app.camera.capture();
        document.getElementById('auto-chip').onclick = (e) => {
            app.state.autoCapture = !app.state.autoCapture;
            e.currentTarget.classList.toggle('active');
        };

        // Initialize Firebase
        try {
            FireManager.init((user) => {
                const gate = document.getElementById('auth-gate');
                const content = document.getElementById('history-content');
                if(user) {
                    gate.classList.add('hidden');
                    content.classList.remove('hidden');
                    document.getElementById('user-email').innerText = user.email;
                    document.getElementById('btn-logout').classList.remove('hidden');
                    
                    // Load cloud scans
                    FireManager.loadCloudScans().then(scans => {
                        app.state.scans = [...app.state.scans, ...scans];
                        app.history.render();
                    });
                } else {
                    gate.classList.remove('hidden');
                    content.classList.add('hidden');
                    document.getElementById('btn-logout').classList.add('hidden');
                }
            });
        } catch(e) { console.warn("Firebase offline"); }

        // Auth Buttons
        document.getElementById('btn-login').onclick = async () => {
            const e = document.getElementById('email-in').value;
            const p = document.getElementById('pass-in').value;
            const r = await FireManager.login(e,p);
            if(!r.success) alert(r.error);
        };
        document.getElementById('btn-signup').onclick = async () => {
            const e = document.getElementById('email-in').value;
            const p = document.getElementById('pass-in').value;
            const r = await FireManager.signup(e,p);
            if(!r.success) alert(r.error);
        };
        document.getElementById('btn-logout').onclick = () => FireManager.logout();
    }
};

window.app = app;
document.addEventListener('DOMContentLoaded', () => app.init());
