if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then((reg) => console.log('Service Worker registered!', reg))
      .catch((err) => console.error('Service Worker failed:', err));
  });
}
let scannedDocs = [];
let handlePoints = [{x: 50, y: 50}, {x: 250, y: 50}, {x: 250, y: 350}, {x: 50, y: 350}];
let currentRawImg = null;

const video = document.getElementById('video-feed');
const canvas = document.getElementById('overlay-canvas');
const statusMsg = document.getElementById('status-msg');

async function init() {
    // Camera access requires a secure context (HTTPS or Localhost)
    if (!window.isSecureContext) {
        statusMsg.innerText = "Error: HTTPS required for camera";
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }, 
            audio: false 
        });
        video.srcObject = stream;
        
        // Wait for video to be ready before drawing
        video.onloadedmetadata = () => {
            statusMsg.innerText = "Camera Active";
            video.play();
            startAIOverlay(); 
        };
    } catch (e) {
        statusMsg.innerText = "Error: Camera access denied";
        console.error(e);
    }
}

function startAIOverlay() {
    if (typeof cv === 'undefined' || !video.videoWidth) {
        setTimeout(startAIOverlay, 500); // Wait for OpenCV to load
        return;
    }
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');

    function loop() {
        if (video.paused || video.ended) return;
        // AI edge detection logic can be added here
        requestAnimationFrame(loop);
    }
    loop();
}

// CAPTURE Logic
document.getElementById('capture-btn').onclick = () => {
    const hidden = document.getElementById('hidden-canvas');
    hidden.width = video.videoWidth;
    hidden.height = video.videoHeight;
    hidden.getContext('2d').drawImage(video, 0, 0);
    
    currentRawImg = hidden.toDataURL('image/jpeg', 0.9);
    
    const img = new Image();
    img.onload = () => {
        const c = document.getElementById('crop-canvas');
        c.width = img.width / 4;
        c.height = img.height / 4;
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        document.getElementById('crop-modal').style.display = 'flex';
    };
    img.src = currentRawImg;
};

// ... Remaining gallery and PDF export logic from previous steps ...

window.onload = init;
