OpenScan-AI Cloud ☁️📷
OpenScan-AI is a professional, privacy-first document scanner that runs entirely in the browser. It combines On-Device AI (OpenCV) for edge detection with optional Firebase Cloud Sync to save your scans across devices.
No app store downloads required. Works on iOS, Android, and Desktop.
✨ New in v8.0
🚀 Instant-Start Camera: Camera loads immediately without waiting for AI models.
☁️ Cloud Sync: Log in to save scans to your account forever. Access them on any device.
🧠 Robust Detection: New threshold-based AI finds documents even on cluttered desks.
🛡️ "Nuclear" Fallback: Automatically finds any working camera if the main one fails (great for laptops/older phones).
⚡ Compression Engine: Automatically shrinks images to store them efficiently in the Cloud.
📱 Features
Smart Scanning
Auto-Capture: Recognizes document corners and snaps the photo automatically when steady.
Perspective Warp: Flattens angled photos into perfect PDFs.
Filters: Magic Color, Black & White, and Grayscale modes.
OCR: Extract text from images using Tesseract.js.
Cloud & Privacy
Offline-First: The app works 100% offline. Cloud features only activate if you log in.
Cross-Device: Scan on your phone, download the PDF on your computer.
Secure: Firebase Authentication & Realtime Database storage.
🛠️ Setup & Installation
Prerequisite: Firebase
Go to Firebase Console and create a project.
Enable Authentication (Email/Password).
Enable Realtime Database.
Get your config object from Project Settings.
Option 1: Local Development
Clone the repo:
code
Bash
git clone https://github.com/YourUsername/OpenScan-AI.git
Create a file js/firebase-config.js:
code
JavaScript
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "...",
  appId: "..."
};
Run with Live Server (VS Code extension) or any local HTTP server.
Note: Camera requires localhost or HTTPS.
Option 2: Deploying to GitHub Pages (Secure)
To keep your API keys hidden from the public code, this project uses GitHub Actions to inject the config during deployment.
Push the code to GitHub (ensure js/firebase-config.js is in .gitignore).
Go to your Repository Settings > Secrets and variables > Actions.
Create a New Repository Secret:
Name: FIREBASE_CONFIG
Value: Paste the entire content of your firebase-config.js file.
Go to Settings > Pages.
Change Source to GitHub Actions.
The deploy.yml workflow will automatically build and publish your site securely.
🧰 Tech Stack
Frontend: HTML5, CSS3, Vanilla JS (ES Modules)
Computer Vision: OpenCV.js (WASM)
Backend: Firebase (Auth + Realtime Database)
PDF Engine: jsPDF
OCR: Tesseract.js
🤝 Support
This project is open-source. If it helped you, consider buying me a book!
<a href="https://buymeacoffee.com/theminescout" target="_blank">
<img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Book" style="height: 60px !important;width: 217px !important;" >
</a>
📄 License
Apache-2.0 License. Free for personal and commercial use.
