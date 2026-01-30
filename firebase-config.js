import { initializeApp } from "https://www.gstatic.com/firebasejs/11.2.0/firebase-app.js";
import {
    getFirestore, collection, addDoc, onSnapshot, query, orderBy, limit,
    where, getDocs, updateDoc, doc, serverTimestamp, setDoc, getDoc
} from "https://www.gstatic.com/firebasejs/11.2.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
    from "https://www.gstatic.com/firebasejs/11.2.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyALyy2QXaRNmOqCwbV2zVHwgy3CbR-HLAM",
    authDomain: "quiz-master-pro-2026.firebaseapp.com",
    projectId: "quiz-master-pro-2026",
    storageBucket: "quiz-master-pro-2026.firebasestorage.app",
    messagingSenderId: "783107565802",
    appId: "1:783107565802:web:f6a5e6226edaef6ed34f93"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

export { db, auth, provider, collection, addDoc, onSnapshot, query, orderBy, limit, where, getDocs, updateDoc, doc, serverTimestamp, setDoc, getDoc, signInWithPopup, signOut, onAuthStateChanged };
