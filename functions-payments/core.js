// core.js — pure payment logic (no Firebase imports) so it can be tested without a network.
const crypto = require("crypto");

// ====== PRICES — SERVER IS THE ONLY SOURCE OF TRUTH FOR WHAT A PLAN COSTS ======
// Amounts are in the smallest unit: paisa for PKR (Rs 1,500 = 150000), cents for USD ($5 = 500).
// !!! These are PLACEHOLDERS. Nothing can be charged until PRICES_CONFIRMED is set to true. !!!
// plans.json (the public Plans page) must show the same prices — change both together.
const PRICES_CONFIRMED = false;
const PLANS = {
  pro_monthly: { title: "Pro — 1 month",   days: 30,  aiLimit: 300, prices: { PKR: 150000,  USD: 500 } },
  pro_yearly:  { title: "Pro — 12 months", days: 365, aiLimit: 300, prices: { PKR: 1500000, USD: 5000 } }
};

const DAY_MS = 86400000;

function newExpiry(existingExpiryMs, nowMs, days) {
  // Renewing early adds time on top of what is left, so nobody loses paid days.
  const base = Math.max(Number(existingExpiryMs) || 0, nowMs);
  return base + days * DAY_MS;
}

function isValidSignature(rawBody, signatureHeader, secret) {
  if (!secret || !signatureHeader) return false;
  const expected = crypto.createHmac("sha512", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "hex");
  let b;
  try { b = Buffer.from(String(signatureHeader).trim(), "hex"); } catch (e) { return false; }
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

// The webhook body shape is not relied on for "paid or not". We only pull the tracker id out
// of it, then ask Safepay's API directly whether that tracker really ended successfully.
function extractTracker(rawBody) {
  const m = /track_[0-9a-fA-F-]{8,}/.exec(String(rawBody || ""));
  return m ? m[0] : null;
}

function trackerEnded(report) {
  return !!(report && report.data && report.data.tracker && report.data.tracker.state === "TRACKER_ENDED");
}

// Marks an order paid and extends the doctor's subscription. Safe to call twice (webhook and
// the return page may both arrive): the second call changes nothing.
async function activateOrder(db, orderId, nowMs, serverTs) {
  const orderRef = db.collection("orders").doc(orderId);
  return db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) return { status: "not_found" };
    const order = orderSnap.data();
    if (order.state === "paid") return { status: "already_paid" };
    const plan = PLANS[order.planId];
    if (!plan) return { status: "unknown_plan" };
    const subRef = db.collection("subscriptions").doc(order.uid);
    const subSnap = await tx.get(subRef);
    const existing = subSnap.exists && subSnap.data().expiresAtMs ? subSnap.data().expiresAtMs : 0;
    const expiresAtMs = newExpiry(existing, nowMs, plan.days);
    tx.set(subRef, {
      plan: "pro", planId: order.planId, status: "active",
      aiLimit: plan.aiLimit, expiresAtMs, updatedAt: serverTs, lastOrderId: orderId
    }, { merge: true });
    tx.update(orderRef, { state: "paid", paidAtMs: nowMs });
    return { status: "paid", expiresAtMs };
  });
}

module.exports = { PRICES_CONFIRMED, PLANS, newExpiry, isValidSignature, extractTracker, trackerEnded, activateOrder };
