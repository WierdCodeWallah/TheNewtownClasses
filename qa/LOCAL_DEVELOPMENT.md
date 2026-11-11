# Run the full dashboard locally

VS Code Live Server (`127.0.0.1:5500`) serves HTML only. It cannot run
`/.netlify/functions/offline-test`; a POST returns 405. Use Netlify Dev:

```powershell
cd C:\Users\91897\TheNewtownClassesCode1\NewtownClasses
npx netlify-cli login
npx netlify-cli link
npx netlify-cli dev
```

Choose the existing Newtown Classes project when linking. In Netlify's environment
variables, provide `FIREBASE_PROJECT_ID` and `FIREBASE_SERVICE_ACCOUNT` for the
**Local development / dev** context as well as production. Restart Netlify Dev
after changing environment values. Keep credentials in Netlify, not files under
this public website root. Local sessions still use the configured real Firebase
project; use a dedicated test student and teacher.

Open `http://localhost:8888/learn` or `/teach` and sign in again on this origin.
Netlify Dev serves the routes and backend functions together.

## Allowed local addresses

The Firebase web API key only accepts approved website referrers. As of
2026-11-10, `127.0.0.1:5500`, `localhost:5500` and `localhost:8888` are allowed;
`localhost:8080` and `127.0.0.1:8080` are blocked ("Requests from referer … are
blocked"), so sign-in fails there. To use port 8080, add `http://localhost:8080/*`
and `http://127.0.0.1:8080/*` in Google Cloud Console → APIs & Services →
Credentials → the browser API key → Website restrictions.

## App Check on local pages

reCAPTCHA does not run on loopback, and an unregistered App Check debug token
makes every sign-in fail with `auth/network-request-failed` ("Network error").
So on localhost, 127.0.0.1 and IPv6 loopback the Firebase helper skips App Check
by default. Production always uses reCAPTCHA. Sign-in and Firestore work locally
as long as App Check enforcement stays off for Authentication and Firestore.

If enforcement is ever turned on, opt this browser in: run
`localStorage.ntcAppCheckDebug = "1"` in DevTools Console, reload, copy the
printed `App Check debug token`, then Firebase Console → project
`the-newtown-classes-d98e8` → App Check → Apps → web app → menu → Manage debug
tokens → Add debug token. Each address (host and port) and browser has its own
token. Treat it as a credential and do not commit/share it. Run
`localStorage.removeItem("ntcAppCheckDebug")` to opt out again.

If Firestore returns 403, inspect the failed request in Network → Response.
App Check rejection, API-key referrer restrictions and Firestore rules are separate
causes. For a rules denial, verify the signed-in role and publish the repository
rules; do not replace rules with allow-all access.

## Uploadcare CDN errors

The current public key maps to `32zbpzustr.ucarecd.net`, using Uploadcare's official
cname-prefix algorithm. New uploads use this domain. Existing offline-test links
on `ucarecdn.com` are converted when displayed/downloaded; UUIDs remain unchanged.
The backend and retention cleanup recognize both forms. If the project key changes,
update both publicKey and cdnHost in `assets/js/uploadcare-config.js` together.

If a download still fails, compare the failed URL with Uploadcare → Files → file
details → Copy URL, and inspect Settings → Delivery → CDN domain names. A missing
file, delivery quota or project setting needs separate diagnosis. Uploadcare secret
keys authorize server-side deletion; adding them does not repair a delivery URL.

References:
- https://docs.netlify.com/api-and-cli-guides/cli-guides/local-development/
- https://firebase.google.com/docs/app-check/web/debug-provider
- https://uploadcare.com/docs/delivery/cdn/
- https://github.com/uploadcare/uploadcare-js-api-clients/tree/master/packages/cname-prefix

Local checks: `node --experimental-vm-modules qa/local-development.cjs`.
