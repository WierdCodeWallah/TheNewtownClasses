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
