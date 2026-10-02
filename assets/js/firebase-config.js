/**
 * ════════════════════════════════════════════════════
 *  THE NEWTOWN CLASSES — Firebase Configuration
 * ════════════════════════════════════════════════════
 *
 *  Firestore security rules now live in `./firestore.rules` (deploy via
 *  `firebase deploy --only firestore:rules` or paste into the console).
 *
 *  Console-side hardening steps (API key restriction, App Check, billing
 *  alerts) are documented in `./SECURITY_SETUP.md`.
 * ════════════════════════════════════════════════════
 */

// The Firebase web config below is PUBLIC by design. Anyone visiting the
// site can read it from the network panel. Real protection comes from:
//   1. Firestore security rules (see firestore.rules)
//   2. HTTP-referrer restriction on the API key in Google Cloud Console
//   3. Firebase App Check (initialised below — needs a reCAPTCHA v3 site key)
// See SECURITY_SETUP.md for the step-by-step on items 2 and 3.
export const FIREBASE_CONFIG = {
    apiKey: "AIzaSyB-aTXaWLduMaB9lw6lxGcOWzhzKcH2B0E",
    authDomain: "the-newtown-classes-d98e8.firebaseapp.com",
    projectId: "the-newtown-classes-d98e8",
    storageBucket: "the-newtown-classes-d98e8.firebasestorage.app",
    messagingSenderId: "644697936619",
    appId: "1:644697936619:web:f8a8769cd6c51846f3e4ae",
    measurementId: "G-2DZ9X3X35M"
};

// ════════════════════════════════════════════════════
//  APP CHECK — reCAPTCHA v3
// ════════════════════════════════════════════════════
//
//  Once you've registered the site in Firebase Console → App Check (see
//  SECURITY_SETUP.md), paste the reCAPTCHA v3 *site key* below. It's a
//  public token (starts with "6L..."), safe to commit.
//
//  Leave it as the empty string in local development — initAppCheck()
//  will skip initialisation so you don't have to run a debug token dance
//  on `localhost`.
//
export const RECAPTCHA_V3_SITE_KEY = "6LcGAdYsAAAAAAv2_DFaO7xNxZZYVFwpL8GpGlww"; // ← paste your reCAPTCHA v3 site key here

// ════════════════════════════════════════════════════
//  CLOUD MESSAGING (Web Push) — VAPID public key
// ════════════════════════════════════════════════════
//  Needed so the student dashboard can register for push notifications.
//  Firebase Console → ⚙ Project settings → Cloud Messaging →
//  "Web Push certificates" → Generate key pair → copy the key (long string,
//  usually starts with "B…"). It's a PUBLIC key, safe to commit.
//  Leave it blank to disable push (the dashboard simply won't prompt).
export const FCM_VAPID_KEY = "BLui_XogBooElyLNssnrjqrMLK9yn-Fm7_QEq0cTxY8ttEkpjK_1n92xJcIG_IZH0PHUIDxOJw6pgySx4Frj2jk"; // ← paste your Web Push certificate (VAPID) key here

/**
 * Call this ONCE per page, immediately after `initializeApp(FIREBASE_CONFIG)`,
 * before getAuth() or getFirestore().
 *
 *   import { initializeApp }   from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
 *   import { FIREBASE_CONFIG, initAppCheck } from "./firebase-config.js";
 *
 *   const app = initializeApp(FIREBASE_CONFIG);
 *   await initAppCheck(app);          // ← add this line
 *   const auth = getAuth(app);
 *   const db   = getFirestore(app);
 *
 * The function is safe to call without a key set — it simply returns null
 * and logs a one-line warning.
 */
export async function initAppCheck(app) {
  if (!RECAPTCHA_V3_SITE_KEY) {
    console.info('[AppCheck] No site key set — skipping (set RECAPTCHA_V3_SITE_KEY in firebase-config.js to enable).');
    return null;
  }
  try {
    const { initializeAppCheck, ReCaptchaV3Provider } =
      await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js');
    return initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(RECAPTCHA_V3_SITE_KEY),
      isTokenAutoRefreshEnabled: true
    });
  } catch (e) {
    console.warn('[AppCheck] init failed:', e?.message || e);
    return null;
  }
}

// ════════════════════════════════════════════════════
//  SEPARATE STUDENT AND STAFF SIGN-INS
// ════════════════════════════════════════════════════
//
//  Firebase keeps one signed-in user per app name per browser. Students use
//  the default app; teacher and admin pages use STAFF_APP. Without this,
//  signing in on one portal replaced the session on every other open portal
//  (and the admin panel then signed that user out), which looked like being
//  logged out at random.
//
//    const app  = initializeApp(FIREBASE_CONFIG, STAFF_APP);
//    await initAppCheck(app);
//    const auth = getAuth(app);
//    await adoptLegacyStaffSession(auth);
//
export const STAFF_APP = 'ntc-staff';

// Staff signed in before the split are stored under the default app. Copy that
// session across once per browser so nobody has to sign in again after deploy.
// Student accounts (…@ntcportal.local) are left where they are.
export async function adoptLegacyStaffSession(staffAuth) {
  const DONE = 'ntc:staff-session-split';
  try { if (localStorage.getItem(DONE)) return; } catch (_) { return; }
  try {
    await staffAuth.authStateReady();
    if (!staffAuth.currentUser) {
      const [{ initializeApp, getApps }, { getAuth, updateCurrentUser }] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js')
      ]);
      const legacyApp = getApps().find(a => a.name === '[DEFAULT]') || initializeApp(FIREBASE_CONFIG);
      const legacy = getAuth(legacyApp);
      await legacy.authStateReady();
      const user = legacy.currentUser;
      if (user && !/@ntcportal\.local$/i.test(user.email || '')) await updateCurrentUser(staffAuth, user);
    }
    localStorage.setItem(DONE, '1');
  } catch (e) {
    console.warn('[Auth] Could not carry over the earlier staff sign-in:', e?.message || e);
  }
}

// ════════════════════════════════════════════════════
//  LOGIN PAGES — read the signed-in user's own profile
// ════════════════════════════════════════════════════
//
//  One plain HTTPS request instead of the Firestore SDK. The SDK is ~440 KB
//  and has to open a streaming connection before its first read; on a weak
//  mobile connection that read could fail after sign-in had already
//  succeeded, so people saw an error and had to press Login again.
//  Retries network failures by itself. Resolves to the document's fields
//  (strings, numbers, booleans) or null when the document doesn't exist.
export async function fetchOwnDoc(user, collection) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}` +
    `/databases/(default)/documents/${collection}/${user.uid}?key=${FIREBASE_CONFIG.apiKey}`;
  let error;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 1000 * attempt));
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 12000);
    try {
      const token = await user.getIdToken();
      const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token }, signal: abort.signal });
      if (res.status === 404) return null;
      if (res.ok) {
        const fields = (await res.json()).fields || {};
        return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k,
          'stringValue' in v ? v.stringValue :
          'booleanValue' in v ? v.booleanValue :
          'integerValue' in v ? Number(v.integerValue) :
          'doubleValue' in v ? v.doubleValue : v]));
      }
      error = Object.assign(new Error('Could not load your profile (HTTP ' + res.status + ').'),
        { code: res.status === 403 ? 'permission-denied' : 'unavailable' });
      if (res.status < 500 && res.status !== 429) break;   // retrying won't change the answer
    } catch (e) {
      error = Object.assign(new Error('Network error. Check your internet connection.'),
        { code: 'auth/network-request-failed' });
    } finally {
      clearTimeout(timer);
    }
  }
  throw error;
}

/**
 *  ADMIN SETUP (one-time):
 *  ────────────────────────
 *  After setting up Firebase, go to admin-panel.html in your browser.
 *  Use the "First-Time Admin Setup" section to create your admin account.
 *  Your admin email: thenewtownclasses@gmail.com
 *
 *  HOW STUDENT IDs WORK:
 *  ───────────────────────
 *  Student ID (e.g. NTC-2026-001) is converted to an email internally:
 *    ntc-2026-001@ntcportal.local
 *  Students only ever type their Student ID and Password — no emails.
 */
