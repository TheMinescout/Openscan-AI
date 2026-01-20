it needs this type of styling:

OpenScan-AI Pro 📱📄

OpenScan-AI Pro is a powerful, privacy-focused document scanner application that runs entirely in your web browser. It utilizes OpenCV.js for real-time edge detection and perspective correction, and Tesseract.js for on-device OCR (Optical Character Recognition).

Unlike traditional scanner apps, OpenScan-AI Pro performs all processing locally on your device. No images are uploaded to the cloud.

✨ Features
📷 Smart Scanning

Live Edge Detection: Uses OpenCV to identify document corners in real-time using convex hull and contour analysis.

Touch-to-Focus Target: Tap any object on the screen to force the AI to focus on that specific area.

Auto-Capture: A stability ring fills up when the camera is steady, automatically snapping the photo to reduce blur.

Resolution Control: Choose between 4K, 1080p, or 720p (dependent on hardware support) via Settings.

📐 Processing & Editing

Perspective Warp: Automatically flattens angled photos into perfect 2D rectangles.

Manual Crop: Interactive drag handles to fine-tune the corners if the AI misses.

Filters:

Original: Keeps true colors.

B&W: High-contrast document mode for clear text.

Rotation: Rotate scans if taken in the wrong orientation.

🧠 Intelligent Tools

On-Device OCR: Extract text from scanned images using Tesseract.js. Copy text directly to your clipboard.

PDF Export: Compile multiple scans into a single PDF file using jsPDF.

PDF Security: Option to encrypt exported PDFs with a custom password.

Cloud Integration (Web Share): Uses the native Android/iOS Share Sheet to send files to Drive, Email, or WhatsApp.

🚀 How to Run
Option 1: Live Demo (GitHub Pages)

This app is designed to run as a Progressive Web App (PWA) via GitHub Pages.

Go to Settings > Pages in your repository.

Set the source to main branch.

Visit the generated link on your mobile device.

Option 2: Local Development

Clone the repository:

code
Bash
download
content_copy
expand_less
git clone [https://github.com/TheMinescout/OpenScan-AI.git](https://github.com/TheMinescout/OpenScan-AI.git)

Open the folder in VS Code.

Install the "Live Server" extension.

Right-click index.html and select "Open with Live Server".

⚠️ Note on Camera Access: Modern browsers block camera access (getUserMedia) on non-secure contexts. You must run this via HTTPS (GitHub Pages) or localhost. It will not work if you just open the index.html file path directly.

🛠️ Tech Stack

Frontend: HTML5, CSS3, Vanilla JavaScript.

Computer Vision: OpenCV.js (v4.x).

PDF Generation: jsPDF.

OCR Engine: Tesseract.js.

Hosting: GitHub Pages.

🔒 Privacy Policy

OpenScan-AI Pro is a client-side only application.

All image processing happens inside your phone's browser memory.

No images, text, or data are ever sent to an external server.

We do not use cookies or tracking analytics.

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

License: MIT
