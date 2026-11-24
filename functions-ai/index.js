// index.js — aiNormalize: the AI second-opinion function. Deploy ONLY this codebase:
//   firebase deploy --only functions:ai
// Checks login, enforces the monthly limit on the server, asks Claude, then counts the use.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");
const admin = require("firebase-admin");
const core = require("./core");

admin.initializeApp();
const db = admin.firestore();

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
const AI_MODEL = defineString("AI_MODEL", { default: "claude-sonnet-5-5" });

exports.aiNormalize = onCall({ secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 60, memory: "256MiB" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Please log in first.");
  const uid = request.auth.uid;
  const caseText = core.cleanCase(request.data && request.data.caseText);
  if (!caseText) throw new HttpsError("invalid-argument", "Please type the case first.");
  const classicalRemedy = typeof (request.data && request.data.classicalRemedy) === "string"
    ? request.data.classicalRemedy.trim().slice(0, 80) : "";

  const now = new Date();
  const usageRef = db.collection("usage").doc(core.usageDocId(uid, now));
  const subSnap = await db.collection("subscriptions").doc(uid).get();
  const limit = core.monthlyLimit(subSnap.exists ? subSnap.data() : null, now.getTime());
  const usedNow = (await usageRef.get()).data();
  if (usedNow && (usedNow.count || 0) >= limit) {
    throw new HttpsError("resource-exhausted", "You have used all your AI searches for this month.");
  }

  let reply;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY.value(), "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: AI_MODEL.value(), max_tokens: 700, system: core.SYSTEM_PROMPT,
        messages: [{ role: "user", content: core.buildUserMessage(caseText, classicalRemedy) }]
      })
    });
    if (!res.ok) { console.error("Anthropic error", res.status, (await res.text()).slice(0, 300)); throw new Error("anthropic_" + res.status); }
    const json = await res.json();
    reply = core.parseAiReply((json.content || []).filter(b => b.type === "text").map(b => b.text).join(""));
    if (!reply) throw new Error("bad_reply");
  } catch (e) {
    console.error("aiNormalize failed", e && e.message);
    throw new HttpsError("internal", "AI assist unavailable right now.");   // nothing is counted on failure
  }

  // Count the use only after a good answer, atomically, and re-check the limit inside the transaction.
  const count = await db.runTransaction(async (tx) => {
    const snap = await tx.get(usageRef);
    const c = snap.exists ? (snap.data().count || 0) : 0;
    if (c >= limit) throw new HttpsError("resource-exhausted", "You have used all your AI searches for this month.");
    tx.set(usageRef, { uid, count: c + 1, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return c + 1;
  });

  return {
    aiRemedy: reply.aiRemedy, keySymptoms: reply.keySymptoms, reasoning: reply.reasoning,
    classicalRemedy, agreement: classicalRemedy ? core.remediesAgree(reply.aiRemedy, classicalRemedy) : false,
    remaining: Math.max(0, limit - count)
  };
});
