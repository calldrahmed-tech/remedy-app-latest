// ============================================================
// FIREBASE SETUP — your actual project config is already filled in below
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile,
  GoogleAuthProvider, signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, serverTimestamp,
  collection, addDoc, updateDoc, query, where, orderBy, getDocs, arrayUnion
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
const googleProvider = new GoogleAuthProvider();

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

  // One-click Google login. Creates the same "users" doc as email signup does,
  // but only the first time — signInWithPopup returns the same account on
  // every later login, so we check first instead of overwriting createdAt.
  async signInWithGoogle() {
    const cred = await signInWithPopup(auth, googleProvider);
    const userRef = doc(db, "users", cred.user.uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        name: cred.user.displayName || "",
        email: cred.user.email || "",
        createdAt: serverTimestamp()
      });
    }
    return cred.user;
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
  // classicalRemedy is passed along so the backend can tell us whether the AI's
  // independent read of the case agrees with the rubric engine's pick.
  async requestAiAnalysis(caseText, classicalRemedy) {
    const result = await aiNormalizeCallable({ caseText, classicalRemedy });
    return result.data; // { aiRemedy, keySymptoms, reasoning, classicalRemedy, agreement, remaining }
  },

  onAuthChange(callback) {
    onAuthStateChanged(auth, (user) => {
      currentUser = user;
      callback(user);
    });
  },

  // ---------- Patient records (private to each doctor — see firestore.rules) ----------
  // patientData: { name, age, contact }. visitData: { date, symptoms, remedy }.
  // Matches an existing patient by exact name (case-insensitive) and appends a new
  // visit; otherwise creates a new patient record with this as the first visit.
  async savePatientVisit(patientData, visitData) {
    if (!currentUser) throw new Error("Please log in first.");
    const name = (patientData.name || "").trim();
    if (!name) throw new Error("Patient name is required.");
    const patientsRef = collection(db, "users", currentUser.uid, "patients");
    const existingSnap = await getDocs(query(patientsRef, where("nameLower", "==", name.toLowerCase())));
    if (!existingSnap.empty) {
      const existing = existingSnap.docs[0];
      await updateDoc(existing.ref, {
        age: patientData.age || existing.data().age || "",
        contact: patientData.contact || existing.data().contact || "",
        updatedAt: serverTimestamp(),
        visits: arrayUnion(visitData)
      });
      return existing.id;
    }
    const created = await addDoc(patientsRef, {
      name,
      nameLower: name.toLowerCase(),
      age: patientData.age || "",
      contact: patientData.contact || "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      visits: [visitData]
    });
    return created.id;
  },

  // Returns [{ id, name, age, contact, visits: [...] }, ...] for the logged-in doctor,
  // most recently updated first.
  async getMyPatients() {
    if (!currentUser) return [];
    const patientsRef = collection(db, "users", currentUser.uid, "patients");
    const snap = await getDocs(query(patientsRef, orderBy("updatedAt", "desc")));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
};
