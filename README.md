# OpenScan-AI Cloud 📱☁️

**OpenScan-AI Cloud** is a powerful, privacy-first document scanner application that runs entirely in your web browser. It utilizes **OpenCV.js** for real-time edge detection and perspective correction, and optionally integrates with **Firebase** to sync your scans across devices.

Unlike traditional scanner apps, OpenScan-AI performs all image processing locally on your device. **Cloud storage is 100% optional**—you can use the app fully offline without ever logging in.

## ✨ Features

### 📷 Smart Scanning
* **Instant-Start Camera:** New v8.0 engine loads the video feed immediately without waiting for AI models to initialize.
* **Nuclear Fallback:** Automatically detects and switches to *any* available camera if the primary lens fails (great for laptops and older phones).
* **Live Edge Detection:** Uses OpenCV to identify document corners in real-time.
* **Auto-Capture:** A stability ring fills up when the camera is steady, automatically snapping the photo.
* **Resolution Control:** Choose between **4K**, **1080p**, or **720p** via Settings.

### ☁️ Cloud Sync (New)
* **Cross-Device Sync:** Log in with your email to save scans. Start on your phone, download on your computer.
* **Smart Compression:** Images are automatically optimized before uploading to ensure fast syncing on mobile networks.
* **Secure Auth:** Powered by Firebase Authentication to keep your documents private.

### 📐 Processing & Editing
* **Perspective Warp:** Automatically flattens angled photos into perfect 2D rectangles.
* **Manual Crop:** Interactive drag handles to fine-tune the corners if the AI misses.
* **Filters:**
    * **Original:** Keeps true colors.
    * **B&W:** High-contrast document mode for clear text.
    * **Magic:** Enhances text and whitens background.

### 🧠 Intelligent Tools
* **On-Device OCR:** Extract text from scanned images using Tesseract.js. Copy text directly to your clipboard.
* **PDF Export:** Compile multiple scans into a single PDF file using `jsPDF`.
🛠️ Tech Stack
Frontend: HTML5, CSS3, Vanilla JavaScript (ES Modules).
Computer Vision: OpenCV.js (v4.x).
Backend: Firebase (Auth + Realtime Database).
PDF Generation: jsPDF.
OCR Engine: Tesseract.js.
🔒 Privacy Policy
OpenScan-AI Cloud prioritizes your privacy:
Offline Mode: If you do not log in, all processing and data remain 100% on your device.
Cloud Mode: If you choose to log in, image data is stored securely in your private Firebase database path.
We do not sell data or use tracking analytics.
☕ Support the Project
This project is open-source and free to use. If you find it useful for your studies or work, consider supporting development!
<a href="https://buymeacoffee.com/theminescout" target="_blank">
<img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" >
</a>
🤝 Contributing
Fork the repository.
Create a new branch (git checkout -b feature/AmazingFeature).
Commit your changes (git commit -m 'Add some AmazingFeature').
Push to the branch (git push origin feature/AmazingFeature).
Open a Pull Request.
