// ============================================================
// FIREBASE SETUP — your actual project config is already filled in below
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getFunctions, httpsCallable
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyA7nmJYyfognAAZS2j67GMgyB48ier4vaE",
  authDomain: "expertia-d35e0.firebaseapp.com",
  projectId: "expertia-d35e0",
  storageBucket: "expertia-d35e0.firebasestorage.app",
  messagingSenderId: "821351840734",
  appId: "1:821351840734:web:d9479a0cda7973879c3b4f"
};

const MONTHLY_AI_LIMIT = 20;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);
const aiNormalizeCallable = httpsCallable(functions, "aiNormalize");

let currentUser = null;

function currentMonthKey() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

// Exposed globally so script.js (a plain, non-module script) can use these
// without needing to become a module itself — keeps the change to script.js minimal.
window.RemedyAuth = {
  getCurrentUser: () => currentUser,

  async signUp(name, email, password) {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });
    await setDoc(doc(db, "users", cred.user.uid), {
      name, email, createdAt: serverTimestamp()
    });
    return cred.user;
  },

  async logIn(email, password) {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return cred.user;
  },

  async logOut() {
    await signOut(auth);
  },

  // Returns { used, limit, remaining } for the CURRENT calendar month.
  async getUsage() {
    if (!currentUser) return null;
    const usageRef = doc(db, "usage", currentUser.uid + "_" + currentMonthKey());
    const snap = await getDoc(usageRef);
    const used = snap.exists() ? (snap.data().count || 0) : 0;
    return { used, limit: MONTHLY_AI_LIMIT, remaining: Math.max(0, MONTHLY_AI_LIMIT - used) };
  },

  // Calls the secure backend function, which verifies login, enforces the monthly
  // limit, calls the AI model, and increments usage — all server-side. This
  // replaces any client-side counting, which could otherwise be bypassed.
  async requestAiNormalization(caseText) {
    const result = await aiNormalizeCallable({ caseText });
    return result.data; // { normalizedText, remaining }
  },

  onAuthChange(callback) {
    onAuthStateChanged(auth, (user) => {
      currentUser = user;
      callback(user);
    });
  }
};
