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
  collection, addDoc, updateDoc, deleteDoc, query, where, orderBy, getDocs, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getFunctions, httpsCallable
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyDmZx-20Fz50qF6vVOnaPePBkQ8XNeteWs",
  authDomain: "expertia-app.firebaseapp.com",
  projectId: "expertia-app",
  storageBucket: "expertia-app.firebasestorage.app",
  messagingSenderId: "1064428795210",
  appId: "1:1064428795210:web:f7fb0e27758f301d8cfdb3",
  measurementId: "G-LRJ53WH8SN"
};

const MONTHLY_AI_LIMIT = 20;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);
const aiNormalizeCallable = httpsCallable(functions, "aiNormalize");
const createCheckoutCallable = httpsCallable(functions, "createCheckout");
const confirmCheckoutCallable = httpsCallable(functions, "confirmCheckout");
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

  // The doctor's paid-plan record, or null. Written only by the payment server.
  async getSubscription() {
    if (!currentUser) return null;
    try {
      const snap = await getDoc(doc(db, "subscriptions", currentUser.uid));
      if (!snap.exists()) return null;
      const s = snap.data();
      const active = s.status === "active" && Number(s.expiresAtMs) > Date.now();
      return { active, planId: s.planId || "", aiLimit: s.aiLimit || 0, expiresAtMs: s.expiresAtMs || 0 };
    } catch (e) { return null; }
  },

  // Returns { used, limit, remaining } for the CURRENT calendar month. A doctor with an
  // active paid plan gets that plan's limit (the AI function applies the same rule).
  async getUsage() {
    if (!currentUser) return null;
    const usageRef = doc(db, "usage", currentUser.uid + "_" + currentMonthKey());
    const snap = await getDoc(usageRef);
    const used = snap.exists() ? (snap.data().count || 0) : 0;
    const sub = await this.getSubscription();
    const limit = sub && sub.active && sub.aiLimit ? sub.aiLimit : MONTHLY_AI_LIMIT;
    return { used, limit, remaining: Math.max(0, limit - used) };
  },

  // Payments (Safepay). The server decides prices; the browser only names a plan.
  async startCheckout(planId, currency) {
    const result = await createCheckoutCallable({ planId, currency });
    return result.data; // { url, orderId }
  },
  async confirmCheckout(orderId) {
    const result = await confirmCheckoutCallable({ orderId });
    return result.data; // { status: "paid" | "pending" }
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
    // When the caller already knows exactly which record this is (e.g. "Quick update"
    // inside an opened patient), skip name matching entirely.
    if (patientData.id) {
      await updateDoc(doc(db, "users", currentUser.uid, "patients", patientData.id), {
        updatedAt: serverTimestamp(),
        visits: arrayUnion(visitData)
      });
      return patientData.id;
    }
    const existingSnap = await getDocs(query(patientsRef, where("nameLower", "==", name.toLowerCase())));
    // Names alone are not unique (e.g. two different "Muhammad Ali" patients), so
    // the contact number is used to tell same-name patients apart.
    const digits = (s) => String(s || "").replace(/\D/g, "");
    const newContact = digits(patientData.contact);
    let existing = null;
    if (!existingSnap.empty) {
      const sameName = existingSnap.docs;
      if (newContact) {
        // Match the record with the same number; otherwise adopt a same-name record
        // that has no number saved yet; otherwise this is a different patient.
        existing = sameName.find(d => digits(d.data().contact) === newContact)
                || sameName.find(d => !digits(d.data().contact))
                || null;
      } else if (sameName.length === 1) {
        existing = sameName[0];
      } else {
        throw new Error("More than one patient has this name — please enter the contact number to choose the right record.");
      }
    }
    if (existing) {
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
  },

  // Permanently removes one patient record (and its full visit history) for the
  // logged-in doctor. firestore.rules already restricts this to the doctor's own
  // patients — a doctor can never delete another doctor's record.
  async deletePatient(patientId) {
    if (!currentUser) throw new Error("Please log in first.");
    await deleteDoc(doc(db, "users", currentUser.uid, "patients", patientId));
  }
};
