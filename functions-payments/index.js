// index.js — Safepay payments for Expertia. Deploy ONLY this codebase:
//   firebase deploy --only functions:payments
// (a separate codebase, so your existing aiNormalize function is never touched or deleted).
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("crypto");
const core = require("./core");

admin.initializeApp();
const db = admin.firestore();

const SAFEPAY_SECRET_KEY = defineSecret("SAFEPAY_SECRET_KEY");       // secret API key
const SAFEPAY_WEBHOOK_SECRET = defineSecret("SAFEPAY_WEBHOOK_SECRET"); // shared secret of the webhook endpoint
const SAFEPAY_API_KEY = defineString("SAFEPAY_API_KEY");              // public API key (not secret)
const SAFEPAY_ENV = defineString("SAFEPAY_ENV", { default: "sandbox" }); // "sandbox" or "production"
const SITE_URL = defineString("SITE_URL", { default: "https://expertia-app.web.app" });

const BASES = { sandbox: "https://sandbox.api.getsafepay.com", production: "https://api.getsafepay.com" };
const baseUrl = () => BASES[SAFEPAY_ENV.value()] || BASES.sandbox;

async function safepay(path, secret, init) {
  const res = await fetch(baseUrl() + path, Object.assign({
    headers: { "Content-Type": "application/json", "X-SFPY-MERCHANT-SECRET": secret }
  }, init || {}));
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { /* keep null */ }
  if (!res.ok) { console.error("Safepay error", path, res.status, text.slice(0, 300)); throw new Error("safepay_" + res.status); }
  return json;
}

// Ask Safepay itself whether this payment really completed. Never trust the browser or the webhook body.
async function verifyTracker(tracker, secret) {
  const report = await safepay("/reporter/api/v1/payments/" + encodeURIComponent(tracker), secret);
  return core.trackerEnded(report);
}

exports.createCheckout = onCall({ secrets: [SAFEPAY_SECRET_KEY] }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Please log in first.");
  if (!core.PRICES_CONFIRMED) throw new HttpsError("failed-precondition", "Payments are not open yet.");
  const planId = request.data && request.data.planId;
  const currency = request.data && request.data.currency;
  const plan = core.PLANS[planId];
  if (!plan || !plan.prices[currency]) throw new HttpsError("invalid-argument", "Unknown plan or currency.");
  const secret = SAFEPAY_SECRET_KEY.value();
  const orderId = "ord_" + crypto.randomUUID();
  try {
    const created = await safepay("/order/payments/v3/", secret, {
      method: "POST",
      body: JSON.stringify({
        merchant_api_key: SAFEPAY_API_KEY.value(),
        intent: "CYBERSOURCE", mode: "payment", entry_mode: "raw",
        currency, amount: plan.prices[currency],
        metadata: { order_id: orderId, uid: request.auth.uid, plan: planId },
        include_fees: false
      })
    });
    const tracker = created && created.data && created.data.tracker && created.data.tracker.token;
    if (!tracker) throw new Error("no_tracker");
    const auth = await safepay("/client/passport/v1/token", secret, { method: "POST" });
    const tbt = auth && auth.data;
    if (!tbt) throw new Error("no_token");
    const { Safepay } = require("@sfpy/node-sdk");
    const sdk = new Safepay({ environment: SAFEPAY_ENV.value(), apiKey: SAFEPAY_API_KEY.value(), v1Secret: secret, webhookSecret: "unused" });
    const site = SITE_URL.value().replace(/\/$/, "");
    const url = sdk.checkouts.payment.create({
      tracker, tbt, environment: SAFEPAY_ENV.value(), source: "hosted",
      redirect_url: site + "/index.html?payment=return&order=" + orderId,
      cancel_url: site + "/index.html?payment=cancel"
    });
    await db.collection("orders").doc(orderId).set({
      uid: request.auth.uid, planId, currency, amount: plan.prices[currency],
      tracker, state: "created", createdAtMs: Date.now()
    });
    return { url, orderId };
  } catch (e) {
    console.error("createCheckout failed", e && e.message);
    throw new HttpsError("internal", "Could not start the payment. Please try again.");
  }
});

// Called by the app when the doctor returns from Safepay. Works even if the webhook is late.
exports.confirmCheckout = onCall({ secrets: [SAFEPAY_SECRET_KEY] }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Please log in first.");
  const orderId = request.data && request.data.orderId;
  if (typeof orderId !== "string" || !/^ord_[0-9a-f-]{36}$/.test(orderId)) throw new HttpsError("invalid-argument", "Bad order.");
  const snap = await db.collection("orders").doc(orderId).get();
  if (!snap.exists || snap.data().uid !== request.auth.uid) throw new HttpsError("not-found", "Order not found.");
  if (snap.data().state === "paid") return { status: "paid" };
  let ended = false;
  try { ended = await verifyTracker(snap.data().tracker, SAFEPAY_SECRET_KEY.value()); }
  catch (e) { return { status: "pending" }; }
  if (!ended) return { status: "pending" };
  const r = await core.activateOrder(db, orderId, Date.now(), admin.firestore.FieldValue.serverTimestamp());
  return { status: r.status === "paid" || r.status === "already_paid" ? "paid" : "pending" };
});

// Safepay calls this when a payment finishes. Register its URL in the Safepay dashboard
// (Developers > Endpoints). We verify the signature, then re-check the payment with Safepay.
exports.safepayWebhook = onRequest({ secrets: [SAFEPAY_SECRET_KEY, SAFEPAY_WEBHOOK_SECRET] }, async (req, res) => {
  const raw = req.rawBody ? req.rawBody.toString("utf8") : "";
  if (!core.isValidSignature(raw, req.headers["x-sfpy-signature"], SAFEPAY_WEBHOOK_SECRET.value())) {
    res.status(400).send("Invalid signature"); return;
  }
  try {
    const tracker = core.extractTracker(raw);
    if (tracker) {
      const q = await db.collection("orders").where("tracker", "==", tracker).limit(1).get();
      if (!q.empty && await verifyTracker(tracker, SAFEPAY_SECRET_KEY.value())) {
        await core.activateOrder(db, q.docs[0].id, Date.now(), admin.firestore.FieldValue.serverTimestamp());
      }
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("webhook failed", e && e.message);
    res.status(500).send("error"); // Safepay will retry
  }
});
