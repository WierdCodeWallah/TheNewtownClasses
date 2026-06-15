# NewTown Classes — Security Setup

Companion to the code-side hardening (`firestore.rules`, `firebase-config.js` App Check helper, dashboard auth guards). Everything below is done in the Google Cloud / Firebase / reCAPTCHA consoles — there is no code change needed for these steps.

Project ID: `the-newtown-classes-d98e8`
Public site: `thenewtownclasses.com` (Netlify)

---

## 1. Audit findings — what was changed in code

| # | Area | Status | Notes |
|---|------|--------|-------|
| 1 | Firestore security rules | Fixed — see `firestore.rules` | Default-deny, owner-only access, role checks for admin/teacher, strict validation on `testResults` create. |
| 2 | API key restriction | **Action required in console** — see §3 | Web API keys are public by design; restrict by HTTP referrer instead. |
| 3 | App Check (reCAPTCHA v3) | Wired up — needs a site key — see §4 | Helper in `firebase-config.js` (`initAppCheck`); already called from every page that initialises Firebase. Add the site key to enable. |
| 4 | Auth checks in JS | Reviewed — all clean. One hardening tweak applied | Teacher dashboard now halts execution after a not-signed-in redirect (was racing with subsequent Firestore calls). |
| 5 | Billing alerts | **Action required in console** — see §5 | |
| 6 | Hardcoded secrets | No real secrets found | The Firebase web config and the Uploadcare *public* key are both public by design. There is **one critical data-handling issue** unrelated to secrets — see §7. |

---

## 2. Deploying the new Firestore rules

### Option A — Firebase CLI (recommended — keeps the rules in version control)

```bash
npm install -g firebase-tools
firebase login
firebase init firestore           # one-time; keep the existing firestore.rules when prompted
firebase deploy --only firestore:rules
```

### Option B — Console paste

1. Firebase Console → Firestore Database → **Rules** tab.
2. Replace the existing content with the body of `firestore.rules`.
3. Click **Publish**.

### Test before deploying

In the Rules tab, click **Rules Playground**. Try these scenarios — all should match the expected outcome:

| Scenario | Path | Auth | Expected |
|----|----|----|----|
| Anonymous read of any student | `/students/abc` | unauthenticated | **deny** |
| Student reads own profile | `/students/{their-uid}` | their uid | allow |
| Student reads another student | `/students/other-uid` | their uid | **deny** |
| Student updates own `photoUrl` only | `/students/{their-uid}` (update) | their uid, payload `{photoUrl: "x"}` | allow |
| Student updates own `class` field | `/students/{their-uid}` (update) | their uid, payload `{class: "12"}` | **deny** |
| Student writes a `testResult` for somebody else | `/testResults/test1__1__OTHERUID` | their uid | **deny** |
| Student writes their own `testResult` | `/testResults/test1__1__{their-uid}` with `uid={their-uid}` | their uid | allow |

---

## 3. Restrict the Firebase web API key (HTTP referrer)

The API key in `firebase-config.js` is meant to be public — restricting it just means "only requests originating from my domains may use this key." Without this, anybody who copies the key can run requests at your free-tier limit.

1. Open <https://console.cloud.google.com/apis/credentials?project=the-newtown-classes-d98e8>.
2. Find the key named **Browser key (auto created by Firebase)** — value `AIzaSyB-aTXaWLduMaB9lw6lxGcOWzhzKcH2B0E`. Click its name to edit.
3. Under **Application restrictions**, choose **Websites** (HTTP referrers).
4. Click **Add an item** for each entry below, exactly as shown. Trailing `/*` matters.

   ```
   https://thenewtownclasses.com/*
   https://www.thenewtownclasses.com/*
   https://*.netlify.app/*
   https://the-newtown-classes-d98e8.firebaseapp.com/*
   https://the-newtown-classes-d98e8.web.app/*
   ```

   The first two cover production. `*.netlify.app` covers Netlify deploy previews and branch deploys (drop it once you no longer use them). The last two are needed because Firebase Auth's sign-in flow can redirect through `firebaseapp.com`.

5. Under **API restrictions**, choose **Restrict key**, then enable only:

   - Identity Toolkit API
   - Token Service API
   - Cloud Firestore API
   - Firebase Installations API
   - Firebase App Check API
   - reCAPTCHA Enterprise API *(only if/when you switch to v3 Enterprise — see §4)*

6. Click **Save**.

> **Watch for breakage:** the change can take a couple of minutes to propagate. If you suddenly see `requests-from-referer-<empty>-are-blocked` in the browser console after the change, your live site URL isn't matched by any of the patterns above — add it.

---

## 4. Enable Firebase App Check (reCAPTCHA v3)

App Check ensures that requests to Firestore / Auth / Storage actually originate from your site (not curl, not a scraper). The code-side wiring is already in place (`initAppCheck` in `firebase-config.js`, called by every page). You just need a site key and to enable enforcement.

### 4a. Get a reCAPTCHA v3 site key

1. <https://www.google.com/recaptcha/admin/create>
2. Label: `NewTown Classes` · Type: **reCAPTCHA v3** · Domains: `thenewtownclasses.com`, `www.thenewtownclasses.com` (and any Netlify preview domains you want covered).
3. Submit. Copy the **Site key** (starts with `6L...`). The Secret key is *not* needed — App Check uses only the site key.

### 4b. Register the web app in Firebase App Check

1. Firebase Console → **Build → App Check**.
2. Pick your web app (the one with appId `1:644697936619:web:f8a8769cd6c51846f3e4ae`).
3. Choose provider **reCAPTCHA v3**, paste the site key from 4a, set token TTL to **1 hour** (default is fine), click **Save**.

### 4c. Paste the site key into the code

Edit `firebase-config.js`:

```js
export const RECAPTCHA_V3_SITE_KEY = "6L....paste it here....";
```

Commit, push, let Netlify deploy.

### 4d. Watch metrics, *then* enforce

1. App Check → **APIs** tab → click **Cloud Firestore**, **Authentication**, and (if you use it) **Cloud Storage**.
2. Each starts in **Unenforced** mode — this is intentional. Watch the **Metrics** for ~24 hours: you'll see "verified" vs "unverified" request counts.
3. Once "verified" is the overwhelming majority on every API, click **Enforce**. Now any request without a valid App Check token will be rejected.

> **Local development:** open the dashboard on `localhost`, look for the App Check debug token printed in the browser console, paste it into Firebase Console → App Check → Apps → your web app → **Manage debug tokens**. Without this, local pages can't talk to Firestore once enforcement is on.

---

## 5. Billing budget + alerts (Google Cloud)

Firestore has a free quota; abuse or a runaway loop could push you over. A budget won't *cap* spend (Google deliberately doesn't offer a hard cap on most APIs) but it'll alert you and you can wire it to auto-disable billing.

### 5a. Create a budget

1. <https://console.cloud.google.com/billing> → click your billing account.
2. Left rail → **Budgets & alerts** → **Create budget**.
3. **Scope**: select project `the-newtown-classes-d98e8` only (don't apply to all projects).
4. **Amount**: pick what makes sense. For a small coaching site, `₹500/month` is a sane starting point — Firestore free tier is generous.
5. **Threshold rules**: keep the defaults (50%, 90%, 100%) and *also* add a 25% one if you want an early warning.
6. **Email recipients**: tick **Email alerts to billing admins and users**. Make sure `thenewtownclasses@gmail.com` is a billing admin (Billing → Account management).
7. **Finish**.

### 5b. Auto-shutoff on overshoot (optional but recommended)

Google's documented pattern for a true cap: budget → Pub/Sub → Cloud Function that disables billing on the project.

1. In the same Budget, tick **Connect a Pub/Sub topic to this budget**. Create a topic e.g. `budget-alerts`.
2. Open <https://console.cloud.google.com/functions> → Create Function.
3. Trigger: Pub/Sub, topic `budget-alerts`. Runtime: Node 20.
4. Paste Google's official sample: <https://cloud.google.com/billing/docs/how-to/notify#cap_disable_billing_to_stop_usage>. The function disables billing on the project when spend hits 100%.
5. Grant the function's runtime service account the **Project Billing Manager** role on the project.

Once deployed, hitting 100% of the budget yanks billing — Firestore reverts to free-tier quotas (or returns errors if you've already exceeded those).

### 5c. Per-API quotas (cheaper insurance)

For Firestore specifically, you can also cap *operations* directly:

1. <https://console.cloud.google.com/apis/api/firestore.googleapis.com/quotas?project=the-newtown-classes-d98e8>
2. Look for **Reads per day** / **Writes per day** / **Deletes per day**.
3. Click the pencil → set a per-day limit comfortably above your current usage (check the chart). When traffic blows past it, requests fail instead of accruing cost.

---

## 6. One-shot verification checklist

After steps 2–5 are done, run through this in a private/incognito browser window:

- [ ] Hit `https://thenewtownclasses.com/student-login.html` → DevTools → Network → look for an `appcheck` request returning a token (App Check is wired in).
- [ ] Sign in as a student. Network panel: any Firestore request that returns `403 Permission denied` is a rules misconfiguration; copy the request path back into Rules Playground to debug.
- [ ] Open `https://thenewtownclasses.com/assets/js/firebase-config.js` directly. Confirm: API key is the only one in there, no secrets, no admin tokens. ✓ (this is by design.)
- [ ] In the Cloud Console API key page, confirm Application restrictions = Websites and the referrer list is set.
- [ ] In Firebase App Check → APIs, confirm "Verified" is the dominant column for at least 24h before clicking **Enforce**.
- [ ] In Cloud Console → Billing → Budgets & alerts, confirm the budget exists and you got a test email (you can manually trigger one from the budget detail page).

---

## 7. CRITICAL data-handling issue (separate from this audit's scope)

While reviewing the rules, I found that **`admin-panel.html` stores student passwords in plaintext** in each `students/{uid}` document, in a `password` field. The "Reset password" flow reads that field, signs in *as* the student over the REST API to mint a token, and then updates the auth password.

This means:

1. Anybody with read access to `students/{uid}` (which under the new rules is the student themselves, all teachers, and admins) can read that student's plaintext password from the document.
2. If a teacher account is ever compromised, every student's password is exposed.
3. Firestore rules are document-level, not field-level — there is no rule I can write that hides the `password` field while still letting teachers read attendance/profile fields on the same document.

**Recommended remediation, in order of effort:**

1. **Cheap:** stop offering "reset to a chosen password" entirely. Use Firebase Auth's built-in password-reset email — students click a link, set their own password. Delete the `password` field from every existing `students` doc.
2. **Medium:** if admins must be able to set passwords directly (because students can't always receive email), move the reset flow into a **Cloud Function** that uses the Admin SDK's `updateUser({ password })`. The plaintext password never leaves the function — Firestore stores nothing.
3. **Don't:** "encrypt the password before storing." That's still a reversible secret in the database — same risk class.

I'm flagging this here because it's the single biggest credential-exposure risk in the codebase, and the new rules can only mitigate it, not solve it.

---

## 8. What was NOT in scope of this audit

- Authentication brute-force protection (Firebase Auth has built-in rate limiting; you can also enable Identity Platform's account lockout).
- XSS / DOM injection review of the dashboards (`innerHTML = ...` patterns from Firestore data).
- Uploadcare bucket policy (file URLs are guessable UUIDs — fine for non-sensitive PDFs, not OK for anything private).
- CSP headers in `netlify.toml` (currently none — adding `Content-Security-Policy` would block any future XSS from running inline scripts).

These are good follow-up items but each is its own piece of work.
