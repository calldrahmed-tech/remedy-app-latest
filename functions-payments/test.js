// Run:  node test.js   (no network, no Firebase needed)
const assert = require("assert");
const crypto = require("crypto");
const c = require("./core");

// --- signature ---
const body = '{"data":{"tracker":"track_4f7d7e2d-ee05-44e3-81b7-6f6f2cca9727"}}';
const sig = crypto.createHmac("sha512", "s3cret").update(body).digest("hex");
assert(c.isValidSignature(body, sig, "s3cret"));
assert(!c.isValidSignature(body + " ", sig, "s3cret"), "changed body must fail");
assert(!c.isValidSignature(body, sig, "other"), "wrong secret must fail");
assert(!c.isValidSignature(body, "", "s3cret") && !c.isValidSignature(body, "zz", "s3cret") && !c.isValidSignature(body, sig, ""));
// --- tracker extraction / state ---
assert.strictEqual(c.extractTracker(body), "track_4f7d7e2d-ee05-44e3-81b7-6f6f2cca9727");
assert.strictEqual(c.extractTracker("nothing"), null);
assert(c.trackerEnded({ data: { tracker: { state: "TRACKER_ENDED" } } }));
assert(!c.trackerEnded({ data: { tracker: { state: "TRACKER_STARTED" } } }) && !c.trackerEnded(null));
// --- expiry ---
const now = 1_000_000_000_000, D = 86400000;
assert.strictEqual(c.newExpiry(0, now, 30), now + 30 * D);
assert.strictEqual(c.newExpiry(now + 10 * D, now, 30), now + 40 * D, "early renewal keeps remaining days");
assert.strictEqual(c.newExpiry(now - 5 * D, now, 30), now + 30 * D, "expired subscription restarts from now");
// --- activation with a fake Firestore ---
function fakeDb(data) {
  const ref = (col, id) => ({ col, id });
  return {
    store: data,
    collection: (col) => ({ doc: (id) => ref(col, id) }),
    runTransaction: async (fn) => fn({
      get: async (r) => { const v = data[r.col + "/" + r.id]; return { exists: !!v, data: () => v }; },
      set: (r, v, o) => { const k = r.col + "/" + r.id; data[k] = o && o.merge ? Object.assign({}, data[k], v) : v; },
      update: (r, v) => { const k = r.col + "/" + r.id; data[k] = Object.assign({}, data[k], v); }
    })
  };
}
(async () => {
  const db = fakeDb({ "orders/ord_1": { uid: "u1", planId: "pro_monthly", state: "created" } });
  let r = await c.activateOrder(db, "ord_1", now, "TS");
  assert.strictEqual(r.status, "paid");
  assert.strictEqual(db.store["subscriptions/u1"].status, "active");
  assert.strictEqual(db.store["subscriptions/u1"].aiLimit, 300);
  assert.strictEqual(db.store["subscriptions/u1"].expiresAtMs, now + 30 * D);
  assert.strictEqual(db.store["orders/ord_1"].state, "paid");
  r = await c.activateOrder(db, "ord_1", now + 5, "TS");           // webhook + return page both fire
  assert.strictEqual(r.status, "already_paid");
  assert.strictEqual(db.store["subscriptions/u1"].expiresAtMs, now + 30 * D, "second call must not add days again");
  assert.strictEqual((await c.activateOrder(db, "nope", now, "TS")).status, "not_found");
  assert.strictEqual(c.PRICES_CONFIRMED, false, "ships locked until the owner confirms prices");
  console.log("ALL PAYMENT TESTS PASS");
})().catch((e) => { console.error(e); process.exit(1); });
