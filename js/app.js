const video = document.getElementById('video-feed');
const canvas = document.getElementById('overlay-canvas');
const statusMsg = document.getElementById('status-msg');
const captureBtn = document.getElementById('capture-btn');
const processingModal = document.getElementById('processing-modal');

let src, gray, blurred, edged, contours, hierarchy;

// Initialize Camera
async function initScanner() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: false 
        });
        video.srcObject = stream;
        video.onloadedmetadata = () => {
            video.play();
            startProcessingLoop();
        };
    } catch (err) {
        statusMsg.innerText = "Camera Error: " + err.message;
    }
}

// OpenCV Logic for Edge Detection
function startProcessingLoop() {
    if (typeof cv === 'undefined') {
        setTimeout(startProcessingLoop, 500);
        return;
    }

    // Set canvas size to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    src = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC4);
    let cap = new cv.VideoCapture(video);

    function process() {
        cap.read(src);
        let docContour = findContour(src);
        
        // Draw Overlay
        let ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        if (docContour) {
            statusMsg.innerText = "Ready to Scan";
            statusMsg.style.color = "#34C759";
            drawContourOverlay(ctx, docContour);
        } else {
            statusMsg.innerText = "Looking for document...";
            statusMsg.style.color = "white";
        }
        
        requestAnimationFrame(process);
    }
    process();
}

function findContour(input) {
    let tempGray = new cv.Mat();
    let tempBlurred = new cv.Mat();
    let tempEdged = new cv.Mat();
    let tempContours = new cv.MatVector();
    let tempHierarchy = new cv.Mat();

    cv.cvtColor(input, tempGray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(tempGray, tempBlurred, new cv.Size(5, 5), 0);
    cv.Canny(tempBlurred, tempEdged, 75, 200);
    cv.findContours(tempEdged, tempContours, tempHierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    let maxArea = 0;
    let maxContour = null;

    for (let i = 0; i < tempContours.size(); ++i) {
        let cnt = tempContours.get(i);
        let area = cv.contourArea(cnt);
        if (area > 50000) {
            let peri = cv.arcLength(cnt, true);
            let approx = new cv.Mat();
            cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
            if (approx.rows === 4 && area > maxArea) {
                maxArea = area;
                maxContour = approx;
            }
        }
    }
    
    // Clean up temporary Mats
    tempGray.delete(); tempBlurred.delete(); tempEdged.delete(); 
    tempContours.delete(); tempHierarchy.delete();
    
    return maxContour;
}

function drawContourOverlay(ctx, contour) {
    ctx.strokeStyle = "#007AFF";
    ctx.lineWidth = 10;
    ctx.beginPath();
    let points = contour.data32S;
    ctx.moveTo(points[0], points[1]);
    for(let i=1; i<4; i++) ctx.lineTo(points[i*2], points[i*2+1]);
    ctx.closePath();
    ctx.stroke();
}

// Capture and Export
captureBtn.onclick = async () => {
    processingModal.style.display = 'flex';
    
    // 1. Capture Image to Hidden Canvas
    const hiddenCanvas = document.getElementById('hidden-canvas');
    hiddenCanvas.width = video.videoWidth;
    hiddenCanvas.height = video.videoHeight;
    hiddenCanvas.getContext('2d').drawImage(video, 0, 0);

    // 2. Generate PDF using jsPDF
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const imgData = hiddenCanvas.toDataURL('image/jpeg', 0.9);
    
    pdf.addImage(imgData, 'JPEG', 0, 0, 210, 297);
    pdf.save("OpenScan_Document.pdf");

    processingModal.style.display = 'none';
};

window.onload = initScanner;
