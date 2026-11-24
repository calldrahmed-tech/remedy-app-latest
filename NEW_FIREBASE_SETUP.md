# New Firebase project — simple steps (Ahmed)

## Part A — you do (browser, hatim… or any Google account you own)
1. Go to console.firebase.google.com → **Add project** → name: `expertia-app`.
2. Project home → **</> Web** icon → app name `Expertia` → Register. **Copy the `firebaseConfig` box and send it to Claude.**
3. **Build → Authentication → Get started** → turn ON **Email/Password** and **Google**.
4. **Build → Firestore Database → Create database** → production mode → region: pick one near you (e.g. `europe-west1` or `asia-south1`).
5. **Upgrade to Blaze** (needed for AI function). Then Billing → **Budget alert** → set e.g. $10.
6. Get an **Anthropic API key** at console.anthropic.com (this pays for AI searches). Keep it secret.

## Part B — commands (run once, on a computer with Node installed)
```
npm install -g firebase-tools
firebase login
firebase use --add            # choose the new project
firebase functions:secrets:set ANTHROPIC_API_KEY
firebase deploy --only firestore:rules
firebase deploy --only functions:ai
firebase deploy --only hosting
```
(Payments later: `firebase deploy --only functions:payments` — see PAYMENTS_SETUP.md.)

## Part C — after deploy
- Authentication → Settings → **Authorized domains**: add your site domain (`<project>.web.app` is added automatically).
- Test: sign up, run one AI Case Analysis.
- Old accounts and patient records from the old project do not exist here. Everyone signs up again.
