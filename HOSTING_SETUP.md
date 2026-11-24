# Move Expertia to Firebase Hosting

Your new address will be: https://expertia-app.web.app

## One-time steps (on your Windows PC)
1. Install Node.js (LTS) from nodejs.org.
2. Open "Command Prompt" and run:  npm install -g firebase-tools
3. Run:  firebase login        (sign in with the Google account that owns the Firebase project)
4. Download this repo folder (GitHub > Code > Download ZIP) and unzip it.
5. In Command Prompt, go into that folder:  cd path\to\remedy-app-latest
6. Run:  firebase deploy --only hosting
7. Open https://expertia-app.web.app and check that it loads.

## IMPORTANT — do this BEFORE you test login
Firebase Console > Authentication > Settings > Authorized domains > Add domain:
  expertia-app.web.app
(The "web.app" and "firebaseapp.com" domains are usually already there — if so, nothing to add.)

## After a code change
Run steps 4-6 again (or:  git pull  then  firebase deploy --only hosting).

## Notes
- This deploys the website files only. It does NOT touch your database rules or your AI function.
- Keep the GitHub Pages site until the new address works, then you can turn it off.
- Files like .py, .md, tests and firestore.rules are not published.
