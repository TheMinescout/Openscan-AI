let cvReady = false;
const video = document.getElementById('video-feed');
const canvas = document.getElementById('overlay-canvas');
const statusMsg = document.getElementById('status-msg');
const captureBtn = document.getElementById('capture-btn');
const processingModal = document.getElementById('processing-modal');

// Wait for OpenCV to load
window.onOpenCvReady = () => {
    cvReady = true;
    statusMsg.innerText = "AI Engine Ready";
    initScanner();
};

// Check if OpenCV is already loaded (fallback)
if (typeof cv !== 'undefined') {
    window.onOpenCvReady();
} else {
    // Poll for OpenCV
    let checkCv = setInterval(() => {
        if (typeof cv !== 'undefined') {
            clearInterval(checkCv);
            window.onOpenCvReady();
        }
    }, 500);
}

async function initScanner() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false 
        });
        video.srcObject = stream;
        video.onloadedmetadata = () => {
            video.play();
            startLoop();
        };
    } catch (err) {
        statusMsg.innerText = "Error: Please allow camera access.";
        console.error(err);
    }
}

function startLoop() {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    
    let src = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC4);
    let cap = new cv.VideoCapture(video);

    function processFrame() {
        if (!cvReady) return;
        
        cap.read(src);
        let docContour = findDocument(src);
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        if (docContour) {
            statusMsg.innerText = "Document Found";
            drawOverlay(ctx, docContour);
            docContour.delete(); // Clean memory
        } else {
            statusMsg.innerText = "Aligning...";
        }
        
        requestAnimationFrame(processFrame);
    }
    processFrame();
}

function findDocument(input) {
    let gray = new cv.Mat();
    let blurred = new cv.Mat();
    let edged = new cv.Mat();
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();

    cv.cvtColor(input, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edged, 75, 200);
    cv.findContours(edged, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    let foundContour = null;
    let maxArea = 0;

    for (let i = 0; i < contours.size(); ++i) {
        let cnt = contours.get(i);
        let area = cv.contourArea(cnt);
        if (area > 40000) {
            let peri = cv.arcLength(cnt, true);
            let approx = new cv.Mat();
            cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
            if (approx.rows === 4 && area > maxArea) {
                maxArea = area;
                foundContour = approx.clone();
            }
            approx.delete();
        }
    }

    gray.delete(); blurred.delete(); edged.delete(); contours.delete(); hierarchy.delete();
    return foundContour;
}

function drawOverlay(ctx, contour) {
    ctx.strokeStyle = "#007AFF";
    ctx.lineWidth = 8;
    ctx.lineJoin = "round";
    ctx.beginPath();
    let pts = contour.data32S;
    ctx.moveTo(pts[0], pts[1]);
    ctx.lineTo(pts[2], pts[3]);
    ctx.lineTo(pts[4], pts[5]);
    ctx.lineTo(pts[6], pts[7]);
    ctx.closePath();
    ctx.stroke();
}

// THE FIX: Manual Capture Event
captureBtn.addEventListener('click', () => {
    console.log("Capture clicked!");
    processingModal.style.display = 'flex';
    
    // Capture from the video stream immediately
    const hiddenCanvas = document.getElementById('hidden-canvas');
    hiddenCanvas.width = video.videoWidth;
    hiddenCanvas.height = video.videoHeight;
    const hCtx = hiddenCanvas.getContext('2d');
    hCtx.drawImage(video, 0, 0);

    // Create PDF
    try {
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');
        const imgData = hiddenCanvas.toDataURL('image/jpeg', 0.8);
        pdf.addImage(imgData, 'JPEG', 0, 0, 210, 297);
        pdf.save("My_Scan.pdf");
        processingModal.style.display = 'none';
    } catch (e) {
        alert("PDF Error: " + e.message);
        processingModal.style.display = 'none';
    }
});
