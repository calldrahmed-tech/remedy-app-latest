# Payments (Safepay) — setup guide

Everything is built but LOCKED. Nobody can be charged until you finish the steps below.
Do them in order. Test in Safepay's SANDBOX first (fake money).

## What each part is
- `functions-payments/`  — server code: starts a payment, confirms it, receives Safepay's webhook.
- `plans.json` + `plans.js` — the "⭐ Plans" window in the app.
- `firestore.rules` — adds rules for `subscriptions` and `orders` (only the server can write them).
- `terms.html`, `refund.html`, `privacy.html` — legal pages (read them and change what you disagree with).

## Step 1 — Safepay
1. Create the Safepay merchant account (sandbox first). Copy: the **public API key** and the **secret key**.
2. Ask Safepay: JazzCash/Easypaisa support, payment in USD, and auto-renewal (we use fixed-period plans, no auto-renewal).

## Step 2 — Prices (you decide)
Edit prices in TWO places and keep them identical:
- `functions-payments/core.js`  (real prices, in paisa/cents: Rs 1,500 = 150000, $5 = 500)
- `plans.json`                   (what the Plans window shows)
Also set the AI limit you want for Pro (`aiLimit`, currently 300).

## Step 3 — Put the secrets and settings in Firebase
In Command Prompt, inside the app folder:
    firebase functions:secrets:set SAFEPAY_SECRET_KEY
    firebase functions:secrets:set SAFEPAY_WEBHOOK_SECRET
(paste each value when asked; the webhook secret appears after Step 5)
When you deploy, Firebase will ask for SAFEPAY_API_KEY, SAFEPAY_ENV (sandbox) and SITE_URL.
SITE_URL = the address where the app lives, for example https://expertia-d35e0.web.app

## Step 4 — Deploy the server code (ONLY this codebase)
    cd functions-payments
    npm install
    node test.js            (must print: ALL PAYMENT TESTS PASS)
    cd ..
    firebase deploy --only functions:payments
Do NOT run a plain "firebase deploy --only functions" — it could remove your AI function.

## Step 5 — Webhook
After the deploy, copy the URL printed for `safepayWebhook`.
In the Safepay dashboard: Developers > Endpoints > add that URL. Then "View shared secret"
and save it with Step 3's SAFEPAY_WEBHOOK_SECRET command, then deploy again.

## Step 6 — Database rules
Open Firebase Console > Firestore > Rules and COMPARE with `firestore.rules` first.
If they only differ by the new `subscriptions` and `orders` blocks, publish the new file.

## Step 7 — Make the AI function honour the paid limit
Your existing `aiNormalize` function must read the paid plan. See `AI_FUNCTION_PLAN_SNIPPET.md`.
Without this, a doctor can pay and still be stopped at 20 searches.

## Step 8 — Test with fake money (sandbox)
1. In `core.js` set PRICES_CONFIRMED = true, in `plans.json` set paymentsOpen = true, redeploy.
2. Log in, tap ⭐ Plans > Upgrade, pay with Safepay's sandbox test card.
3. You come back to the app: "Payment received. Pro is now active."
4. Check in Firestore: `subscriptions/<your uid>` has status "active" and `orders` shows state "paid".
5. Pay again: the days are added on top of the days left.
6. Cancel on the Safepay page: you come back with "Payment cancelled".

## Step 9 — Go live
Switch SAFEPAY_ENV to production, use the production keys and webhook secret, redeploy, and make one
small real payment yourself before telling doctors.

## Safety built in
- Prices come only from the server; the browser cannot change them.
- A payment counts only after the server asks Safepay directly and Safepay says it ended successfully.
- The webhook signature is checked (HMAC SHA-512) before anything is done.
- Paying twice by accident or two messages for one payment can never add days twice.
- Nobody can write their own plan: the rules block it.

## Not yet verified (I could not test against Safepay from here)
The exact checkout-link builder in the Safepay SDK. The sandbox test in Step 8 will show if it works.
If the Safepay page does not open, send me the error from Firebase Console > Functions > Logs.
