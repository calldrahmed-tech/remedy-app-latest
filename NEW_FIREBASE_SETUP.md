# Expertia — go live on the FREE Firebase plan (Spark)

AI Case Analysis shows "coming soon" for now. Everything else works:
login (Email + Google), patient records, remedies, repertory, masters, hosting.

## Do once (on a computer with Node.js installed)
```
npm install -g firebase-tools
firebase login
cd remedy-app-latest          (the folder of this app)
firebase use expertia-app
firebase deploy --only firestore:rules
firebase deploy --only hosting
```
IMPORTANT: always write `--only ...`. Never run plain `firebase deploy` on the free plan
(it would try to deploy the AI/payment functions and fail).

Your app will be at:  https://expertia-app.web.app

## After deploy
1. Firebase → Authentication → Settings → **Authorized domains**: check `expertia-app.web.app` is listed.
2. Open the app, sign up, add a test patient, log out, log in again. Check it works.
3. Firestore → Rules tab: should show the new rules.

## Turn AI on later (needs Blaze plan, $30 prepayment in Pakistan)
1. Upgrade to Blaze, set a budget alert.
2. Anthropic API key from console.anthropic.com.
3. `firebase functions:secrets:set ANTHROPIC_API_KEY`
4. `firebase deploy --only functions:ai`
5. Ask Claude to set `AI_ENABLED = true` in firebase-init.js, then `firebase deploy --only hosting`.

## Payments later
See PAYMENTS_SETUP.md (also needs Blaze).
