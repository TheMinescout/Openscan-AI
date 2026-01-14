let scannedDocs = [];
let handlePoints = [{x: 50, y: 50}, {x: 250, y: 50}, {x: 250, y: 350}, {x: 50, y: 350}];
let currentRawImg = null;

const video = document.getElementById('video-feed');
const canvas = document.getElementById('overlay-canvas');
const freezeLayer = document.getElementById('freeze-layer');

// Initialize Camera
async function init() {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    video.srcObject = stream;
    video.onloadedmetadata = () => {
        document.getElementById('status-msg').innerText = "Scanner Active";
        video.play();
    };
}

// Draggable Corner Logic
function setupDraggable() {
    const handles = document.querySelectorAll('.crop-handle');
    const container = document.getElementById('crop-ui-container');
    
    handles.forEach((h, i) => {
        h.onpointermove = (e) => {
            if (e.buttons > 0) {
                const rect = container.getBoundingClientRect();
                h.style.left = e.clientX + 'px';
                h.style.top = e.clientY + 'px';
                handlePoints[i] = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            }
        };
    });
}

// WARP PERSPECTIVE LOGIC (The "Genius" Feature)
function warpDocument() {
    let src = cv.imread('crop-canvas');
    let dst = new cv.Mat();
    
    // Convert our 4 handle points to a OpenCV Matrix
    let srcCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [
        handlePoints[0].x * 4, handlePoints[0].y * 4, // Scaled back up
        handlePoints[1].x * 4, handlePoints[1].y * 4,
        handlePoints[2].x * 4, handlePoints[2].y * 4,
        handlePoints[3].x * 4, handlePoints[3].y * 4
    ]);

    let dsize = new cv.Size(src.cols, src.rows);
    let dstCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, src.cols, 0, src.cols, src.rows, 0, src.rows]);

    let M = cv.getPerspectiveTransform(srcCoords, dstCoords);
    cv.warpPerspective(src, dst, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());
    
    cv.imshow('hidden-canvas', dst);
    const warpedData = document.getElementById('hidden-canvas').toDataURL();
    
    src.delete(); dst.delete(); M.delete(); srcCoords.delete(); dstCoords.delete();
    return warpedData;
}

document.getElementById('capture-btn').onclick = () => {
    const hidden = document.getElementById('hidden-canvas');
    hidden.width = video.videoWidth; hidden.height = video.videoHeight;
    hidden.getContext('2d').drawImage(video, 0, 0);
    currentRawImg = hidden.toDataURL();
    
    const img = new Image();
    img.onload = () => {
        const c = document.getElementById('crop-canvas');
        c.width = img.width / 4; c.height = img.height / 4;
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        document.getElementById('crop-modal').style.display = 'flex';
        setupDraggable();
    };
    img.src = currentRawImg;
};

document.getElementById('done-crop').onclick = () => {
    const finalImg = warpDocument();
    scannedDocs.push(finalImg);
    
    // Animation
    freezeLayer.style.backgroundImage = `url(${finalImg})`;
    freezeLayer.classList.add('fly-to-corner');
    
    document.getElementById('crop-modal').style.display = 'none';
    document.getElementById('scan-count').innerText = scannedDocs.length;
};

window.onload = init;
