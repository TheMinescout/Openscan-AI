const video = document.getElementById('video-feed');
const canvas = document.getElementById('overlay-canvas');

// 1. Access the Camera
async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "environment" }, // Use back camera
            audio: false 
        });
        video.srcObject = stream;
    } catch (err) {
        console.error("Error accessing camera: ", err);
    }
}

// 2. The Processing Loop (Simplified)
function processFrame() {
    let src = new cv.Mat(video.height, video.width, cv.CV_8UC4);
    cap.read(src);

    let docContour = Scanner.findDocumentContour(src);

    if (docContour) {
        // Draw the outline in blue for the user to see
        let color = new cv.Scalar(0, 255, 255, 255); // Cyan
        cv.drawContours(src, docContour, -1, color, 3);
        
        // If the user clicks capture, run the transform!
        // let finalDoc = Scanner.transformPerspective(src, docContour);
        // let cleanDoc = Scanner.applyMagicFilter(finalDoc);
    }

    cv.imshow('overlay-canvas', src);
    src.delete();
    requestAnimationFrame(processFrame);
}

startCamera();
