// ============================================================
// FIREBASE SETUP — your actual project config is already filled in below
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, increment, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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

  // Atomically increments this month's count. Returns the new usage, or null if
  // not logged in. Call this ONLY right before actually making an AI request,
  // never speculatively, so the count always reflects real usage.
  async recordAiUse() {
    if (!currentUser) return null;
    const usageRef = doc(db, "usage", currentUser.uid + "_" + currentMonthKey());
    await setDoc(usageRef, { count: increment(1), lastUsed: serverTimestamp() }, { merge: true });
    return this.getUsage();
  },

  onAuthChange(callback) {
    onAuthStateChanged(auth, (user) => {
      currentUser = user;
      callback(user);
    });
  }
};
