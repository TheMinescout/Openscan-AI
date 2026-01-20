// js/fire-manager.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getDatabase, ref, set, push, get, child } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

export const FireManager = {
    user: null,

    init(onLoginStatusChange) {
        onAuthStateChanged(auth, (user) => {
            this.user = user;
            onLoginStatusChange(user);
        });
    },

    // --- AUTH ---
    async signup(email, password) {
        try {
            await createUserWithEmailAndPassword(auth, email, password);
            return { success: true };
        } catch (e) { return { success: false, error: e.message }; }
    },

    async login(email, password) {
        try {
            await signInWithEmailAndPassword(auth, email, password);
            return { success: true };
        } catch (e) { return { success: false, error: e.message }; }
    },

    async logout() {
        await signOut(auth);
    },

    // --- DATABASE (The "String of Letters" Logic) ---
    
    // Compresses image to avoid crashing Firebase RTDB
    async compressAndSaveScan(imgDataUrl) {
        if (!this.user) return; // Offline mode

        // 1. Shrink image using Canvas before upload
        const img = new Image();
        img.src = imgDataUrl;
        await new Promise(r => img.onload = r);

        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1000; // Limit width to keep string size low
        const scale = MAX_WIDTH / img.width;
        canvas.width = MAX_WIDTH;
        canvas.height = img.height * scale;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        // 2. Convert to JPEG quality 0.6 (Good balance)
        const compressedString = canvas.toDataURL('image/jpeg', 0.6);

        // 3. Push to Firebase
        const newScanRef = push(ref(db, 'users/' + this.user.uid + '/scans'));
        await set(newScanRef, {
            image: compressedString,
            date: Date.now()
        });
        console.log("Cloud Save Complete");
    },

    async loadCloudScans() {
        if (!this.user) return [];
        const snapshot = await get(child(ref(db), `users/${this.user.uid}/scans`));
        if (snapshot.exists()) {
            const data = snapshot.val();
            // Convert Object {id: data} to Array [data, data]
            return Object.values(data).map(item => item.image);
        }
        return [];
    },

    // --- SETTINGS SYNC ---
    async saveSettings(settings) {
        if (!this.user) return;
        await set(ref(db, 'users/' + this.user.uid + '/settings'), settings);
    },

    async loadSettings() {
        if (!this.user) return null;
        const snapshot = await get(child(ref(db), `users/${this.user.uid}/settings`));
        return snapshot.exists() ? snapshot.val() : null;
    }
};
