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

    async signup(email, password) {
        try { await createUserWithEmailAndPassword(auth, email, password); return { success: true }; } 
        catch (e) { return { success: false, error: e.message }; }
    },

    async login(email, password) {
        try { await signInWithEmailAndPassword(auth, email, password); return { success: true }; } 
        catch (e) { return { success: false, error: e.message }; }
    },

    async logout() { await signOut(auth); },

    async compressAndSaveScan(imgDataUrl) {
        if (!this.user) return;
        const img = new Image(); img.src = imgDataUrl;
        await new Promise(r => img.onload = r);
        const canvas = document.createElement('canvas');
        const scale = 1000 / img.width; canvas.width = 1000; canvas.height = img.height * scale;
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const compressedString = canvas.toDataURL('image/jpeg', 0.6);
        const newScanRef = push(ref(db, 'users/' + this.user.uid + '/scans'));
        await set(newScanRef, { image: compressedString, date: Date.now() });
    },

    async loadCloudScans() {
        if (!this.user) return [];
        const snapshot = await get(child(ref(db), `users/${this.user.uid}/scans`));
        return snapshot.exists() ? Object.values(snapshot.val()).map(item => item.image) : [];
    }
};
