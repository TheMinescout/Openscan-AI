let scannedDocs = [];
let currentEditIndex = -1;
let handlePoints = [{x: 50, y: 50}, {x: 250, y: 50}, {x: 250, y: 350}, {x: 50, y: 350}];

const video = document.getElementById('video-feed');
const canvas = document.getElementById('overlay-canvas');
const freezeLayer = document.getElementById('freeze-layer');
const lastScanImg = document.getElementById('last-scan-img');
const scanCountLabel = document.getElementById('scan-count');
const editorModal = document.getElementById('editor-modal');
const editorImg = document.getElementById('editor-img');

async function init() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        video.srcObject = stream;
        video.onloadedmetadata = () => video.play();
    } catch (e) { alert("Camera Error"); }
}

// CAPTURE
document.getElementById('capture-btn').addEventListener('click', () => {
    const hidden = document.getElementById('hidden-canvas');
    hidden.width = video.videoWidth;
    hidden.height = video.videoHeight;
    hidden.getContext('2d').drawImage(video, 0, 0);
    const imgData = hidden.toDataURL('image/jpeg', 0.9);
    
    // Auto-Crop Placeholder Logic
    showCropModal(imgData);
});

function showCropModal(src) {
    const modal = document.getElementById('crop-modal');
    const c = document.getElementById('crop-canvas');
    const img = new Image();
    img.onload = () => {
        c.width = img.width / 4; 
        c.height = img.height / 4;
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        modal.style.display = 'flex';
        setupDraggableHandles(c);
    };
    img.src = src;
    window.tempImg = src;
}

// DRAGGABLE HANDLES
function setupDraggableHandles(c) {
    const handles = [document.getElementById('handle-0'), document.getElementById('handle-1'), document.getElementById('handle-2'), document.getElementById('handle-3')];
    const rect = c.getBoundingClientRect();

    handles.forEach((h, i) => {
        h.style.left = (rect.left + handlePoints[i].x) + 'px';
        h.style.top = (rect.top + handlePoints[i].y) + 'px';

        h.onpointermove = (e) => {
            if (e.buttons > 0) {
                h.style.left = e.clientX + 'px';
                h.style.top = e.clientY + 'px';
                handlePoints[i] = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            }
        };
    });
}

// DONE CROPPING
document.getElementById('done-crop').addEventListener('click', () => {
    const img = window.tempImg;
    scannedDocs.push(img);
    document.getElementById('crop-modal').style.display = 'none';
    
    freezeLayer.style.backgroundImage = `url(${img})`;
    freezeLayer.classList.remove('fly-to-corner');
    void freezeLayer.offsetWidth;
    freezeLayer.classList.add('fly-to-corner');
    
    setTimeout(updateUI, 700);
});

function updateUI() {
    if (scannedDocs.length > 0) {
        lastScanImg.src = scannedDocs[scannedDocs.length - 1];
        lastScanImg.style.display = 'block';
    } else {
        lastScanImg.style.display = 'none';
    }
    scanCountLabel.innerText = scannedDocs.length;
}

// GALLERY & EDITOR
document.getElementById('gallery-trigger').addEventListener('click', () => {
    const grid = document.getElementById('gallery-content');
    grid.innerHTML = '';
    scannedDocs.forEach((img, i) => {
        const el = document.createElement('img');
        el.src = img;
        el.onclick = () => openEditor(i);
        grid.appendChild(el);
    });
    document.getElementById('gallery-modal').style.display = 'flex';
});

function openEditor(index) {
    currentEditIndex = index;
    editorImg.src = scannedDocs[index];
    editorModal.style.display = 'flex';
}

document.getElementById('delete-current-btn').addEventListener('click', () => {
    if (confirm("Delete this page?")) {
        scannedDocs.splice(currentEditIndex, 1);
        editorModal.style.display = 'none';
        document.getElementById('gallery-modal').style.display = 'none'; // Refresh gallery
        updateUI();
    }
});

document.getElementById('close-editor').addEventListener('click', () => editorModal.style.display = 'none');
document.getElementById('close-gallery').addEventListener('click', () => document.getElementById('gallery-modal').style.display = 'none');
document.getElementById('cancel-crop').addEventListener('click', () => document.getElementById('crop-modal').style.display = 'none');

document.getElementById('export-btn').onclick = () => {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF();
    scannedDocs.forEach((img, i) => {
        if (i > 0) pdf.addPage();
        pdf.addImage(img, 'JPEG', 0, 0, 210, 297);
    });
    pdf.save("Scan.pdf");
};

window.onload = init;
