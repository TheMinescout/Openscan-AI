<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>OpenScan-AI Cloud</title>
    <meta name="theme-color" content="#141218">
    <meta name="apple-mobile-web-app-capable" content="yes">
    
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0" />
    <link rel="stylesheet" href="css/style.css">

    <script async src="https://docs.opencv.org/4.8.0/opencv.js" type="text/javascript"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
    <script src="https://unpkg.com/tesseract.js@v2.1.0/dist/tesseract.min.js"></script>
</head>
<body>
    <div id="app-container">
        <!-- Z-0: Camera -->
        <video id="video-feed" autoplay playsinline muted></video>
        <!-- Z-1: Drawing -->
        <canvas id="overlay-canvas"></canvas>

        <!-- Z-10: UI Layer -->
        <div class="ui-layer">
            <div class="top-bar">
                <button id="settings-btn" class="icon-btn material-symbols-outlined">settings</button>
                <div id="auto-toggle" class="chip">
                    <span class="material-symbols-outlined">shutter_speed</span>
                    <span id="auto-text">Auto: ON</span>
                </div>
                <button id="account-btn" class="icon-btn material-symbols-outlined">person</button>
            </div>

            <!-- RESTORED: Status Message (Floating below top bar) -->
            <div class="status-container">
                <div id="status-msg" class="status-pill">Ready</div>
            </div>

            <div class="bottom-bar">
                <div class="bar-left">
                    <div id="gallery-trigger" class="thumbnail-btn">
                        <span class="material-symbols-outlined placeholder-icon">photo_library</span>
                        <img id="last-scan-img" src="" style="display:none;">
                        <span id="scan-count" class="badge" style="display:none;">0</span>
                    </div>
                </div>
                <div class="bar-center">
                    <div class="shutter-container">
                        <svg class="progress-ring" width="88" height="88">
                            <circle class="progress-ring__circle" stroke="#D0BCFF" stroke-width="4" fill="transparent" r="40" cx="44" cy="44"/>
                        </svg>
                        <button id="capture-btn"></button>
                    </div>
                </div>
                <div class="bar-right">
                    <button id="export-btn" class="fab-small">
                        <span class="material-symbols-outlined">picture_as_pdf</span>
                    </button>
                </div>
            </div>
        </div>

        <div id="flash-layer"></div>

        <!-- AUTH MODAL -->
        <div id="auth-modal" class="modal-sheet">
            <div class="sheet-header">
                <span class="sheet-title">Account</span>
                <button id="close-auth" class="text-btn">Close</button>
            </div>
            <div class="sheet-content">
                <div id="login-view">
                    <input type="email" id="email-input" class="m3-select" placeholder="Email" style="margin-bottom:10px;">
                    <input type="password" id="pass-input" class="m3-select" placeholder="Password" style="margin-bottom:20px;">
                    <div style="display:flex; gap:10px;">
                        <button id="do-login" class="btn-filled">Log In</button>
                        <button id="do-signup" class="btn-tonal">Sign Up</button>
                    </div>
                </div>
                <div id="profile-view" style="display:none; text-align:center;">
                    <h3 id="user-email-display"></h3>
                    <p style="color:#aaa; margin-bottom:20px;">Scans sync to cloud automatically.</p>
                    <button id="do-logout" class="btn-tonal" style="border:1px solid #ffb4ab; color:#ffb4ab;">Log Out</button>
                </div>
            </div>
        </div>

        <!-- CROP MODAL -->
        <div id="crop-modal" class="modal-sheet">
            <div class="sheet-header">
                <button id="cancel-crop" class="text-btn">Retake</button>
                <span class="sheet-title">Adjust</span>
                <button id="done-crop" class="text-btn primary">Save</button>
            </div>
            <div class="crop-area">
                <div class="crop-container" id="crop-ui-container">
                    <canvas id="crop-canvas"></canvas>
                    <div class="crop-handle"></div><div class="crop-handle"></div>
                    <div class="crop-handle"></div><div class="crop-handle"></div>
                </div>
            </div>
        </div>

        <!-- EDITOR MODAL -->
        <div id="editor-modal" class="modal-sheet full-height">
            <div class="sheet-header">
                <button id="close-editor" class="icon-btn material-symbols-outlined">arrow_back</button>
                <span class="sheet-title">Editor</span>
                <button id="save-editor" class="text-btn primary">Done</button>
            </div>
            <div class="editor-view"><img id="editor-img" src=""></div>
            <div class="editor-suite">
                <div class="scroll-toolbar">
                    <button class="tool-btn" onclick="window.app.applyFilter('magic')"><span class="material-symbols-outlined icon-box">auto_fix_high</span><label>Magic</label></button>
                    <button class="tool-btn" onclick="window.app.applyFilter('bw')"><span class="material-symbols-outlined icon-box">contrast</span><label>B&W</label></button>
                    <button class="tool-btn" onclick="window.app.applyFilter('original')"><span class="material-symbols-outlined icon-box">restart_alt</span><label>Reset</label></button>
                    <button class="tool-btn destuctive" onclick="window.app.deleteCurrentPage()"><span class="material-symbols-outlined icon-box" style="background:#3b1f1f;">delete</span><label>Delete</label></button>
                </div>
            </div>
        </div>

        <!-- GALLERY MODAL -->
        <div id="gallery-modal" class="modal-sheet full-height">
             <div class="sheet-header">
                <button id="close-gallery" class="icon-btn material-symbols-outlined">arrow_back</button>
                <span class="sheet-title">Scans</span>
                <div style="width:48px;"></div>
            </div>
            <div id="gallery-grid" class="gallery-grid"></div>
        </div>
        
        <!-- SETTINGS MODAL -->
        <div id="settings-modal" class="modal-sheet">
            <div class="sheet-content">
                <h2>Settings</h2>
                <div class="list-item"><span class="list-title">Resolution</span><select id="quality-select" class="m3-select"><option value="1080p">1080p</option><option value="720p">720p</option></select></div>
                <div class="list-item"><span class="list-title">About</span><button id="about-btn" class="btn-tonal">Info</button></div>
                <button id="close-settings" class="btn-filled">Done</button>
            </div>
        </div>
        
        <!-- ABOUT MODAL -->
        <div id="about-modal" class="modal-sheet">
            <div class="sheet-header"><span class="sheet-title">About</span><button id="close-about" class="text-btn">Close</button></div>
            <div class="sheet-content" style="text-align:center;">
                <p>OpenScan AI v8.2</p>
                <br>
                <!-- Buy me a coffee script placeholder -->
                 <script type="text/javascript" src="https://cdnjs.buymeacoffee.com/1.0.0/button.prod.min.js" data-name="bmc-button" data-slug="TheMinescout" data-color="#FFDD00" data-emoji="📖"  data-font="Cookie" data-text="Buy me a book" data-outline-color="#000000" data-font-color="#000000" data-coffee-color="#ffffff" ></script>
            </div>
        </div>
    </div>
    
    <canvas id="proc-canvas" style="display:none;"></canvas>
    <script type="module" src="js/app.js"></script>
</body>
</html>
