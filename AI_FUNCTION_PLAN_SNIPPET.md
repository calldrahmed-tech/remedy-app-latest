# Make `aiNormalize` honour the paid plan

I cannot see your existing `aiNormalize` code, so this is the rule to add. Where it currently uses
the fixed limit of 20, use this instead (Admin SDK, inside the function, after checking login):

```js
const subSnap = await admin.firestore().collection("subscriptions").doc(uid).get();
const sub = subSnap.exists ? subSnap.data() : null;
const paidActive = sub && sub.status === "active" && Number(sub.expiresAtMs) > Date.now() && sub.aiLimit;
const monthlyLimit = paidActive ? sub.aiLimit : 20;
// ...then compare the doctor's usage count for this month with monthlyLimit
```

Send me the file of your function (`index.js` from your Firebase functions folder) and I will make
the change for you and give you the exact deploy step.
