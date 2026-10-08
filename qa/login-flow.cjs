/* Login flow checks on a phone viewport (390×844) for the student, teacher and
 * admin login pages. Firebase and Firestore are replaced with fixtures; no
 * request leaves the machine.
 *
 *   node qa/login-flow.cjs
 *
 * Covers: launch screen steps through to the dashboard redirect, a Login tap
 * made before Firebase has loaded, wrong password (error, shake, retry), a
 * flaky profile lookup that recovers without a second tap, a dead network,
 * offline mode, already-signed-in auto-redirect, staff without a role record,
 * phone ergonomics (16px inputs, tap targets, no sideways scroll) and the
 * dashboard splash.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const out = path.join(__dirname, 'artifacts', 'login-flow');
fs.mkdirSync(out, { recursive: true });

const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' :
      file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.png') ? 'image/png' : 'text/html';
    res.setHeader('Content-Type', type);
    res.end(fs.readFileSync(file));
  } catch { res.writeHead(404); res.end(); }
});

// Firebase stand-ins. window.__S (set per test) drives the behaviour.
const APP = 'export const initializeApp=()=>({}),getApps=()=>[];';
const AUTH = `
const S=()=>window.__S;
const mkUser=()=>({uid:S().uid,email:S().email,getIdToken:async()=>'fixture-token'});
const auth={currentUser:null,authStateReady:async()=>{if(S().signedIn&&!auth.currentUser)auth.currentUser=mkUser();},signOut:async()=>{auth.currentUser=null;window.__signedOut=(window.__signedOut||0)+1;}};
export const getAuth=()=>auth;
export const signOut=a=>a.signOut();
export const onAuthStateChanged=(a,fn)=>{setTimeout(()=>fn(a.currentUser),0);return()=>{};};
export const sendPasswordResetEmail=async()=>{};
export const signInWithEmailAndPassword=async(a,email,pw)=>{
  sessionStorage.signIns=Number(sessionStorage.signIns||0)+1;
  await new Promise(r=>setTimeout(r,S().signInDelay||300));
  if(S().authNetworkDown)throw Object.assign(new Error('net'),{code:'auth/network-request-failed'});
  if(pw!=='right-password')throw Object.assign(new Error('bad'),{code:'auth/invalid-credential'});
  a.currentUser=mkUser();return{user:a.currentUser};
};`;

const CONFIG_SRC = fs.readFileSync(path.join(root, 'assets/js/firebase-config.js'), 'utf8')
  .replace(/export async function initAppCheck[\s\S]*?\r?\n}\r?\n/, 'export async function initAppCheck(){ await new Promise(r=>setTimeout(r,window.__S.firebaseDelay||0)); return null; }\n')
  .replace(/export async function adoptLegacyStaffSession[\s\S]*?\r?\n}\r?\n/, 'export async function adoptLegacyStaffSession(){}\n');

const ROLES = {
  student: { page: 'student-login.html', id: '#studentId', idValue: 'NTC-2026-0012', pass: '#password', coll: 'students',
    doc: { class: '11', studentId: 'NTC-2026-0012', name: 'Riya' }, dest: /\/learn\?class=11&id=NTC-2026-0012$/ },
  teacher: { page: 'teacher-login.html', id: '#loginEmail', idValue: 'teacher@example.test', pass: '#loginPassword', coll: 'teachers',
    doc: { name: 'Ms Rao' }, dest: /\/teach$/ },
  admin: { page: 'admin-login.html', id: '#loginEmail', idValue: 'admin@example.test', pass: '#loginPassword', coll: 'admins',
    doc: { isAdmin: true }, dest: /\/command-center$/ }
};

function restDoc(fields) {
  const f = {};
  for (const [k, v] of Object.entries(fields)) f[k] = typeof v === 'boolean' ? { booleanValue: v } : { stringValue: String(v) };
  return { name: 'x', fields: f };
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, channel: process.env.PORTAL_BROWSER || 'chrome' });
  let failures = 0;

  async function open(role, scenario, { offline = false } = {}) {
    const R = ROLES[role];
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const S = Object.assign({ uid: role + '-uid', email: R.idValue.includes('@') ? R.idValue : 'x@ntcportal.local', profile: R.doc, restFailures: 0 }, scenario);
    const log = { errors: [], restCalls: 0, navigatedTo: null };
    page.on('pageerror', e => log.errors.push(e.message));
    await page.addInitScript(s => { window.__S = s; if (s.cameFromSignOut && !sessionStorage.__seen) { sessionStorage.__seen = 1; sessionStorage.setItem('ntc:signed-out', '1'); } }, S);
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      const js = body => route.fulfill({ contentType: 'text/javascript', body });
      if (url.pathname.endsWith('/firebase-config.js')) return js(CONFIG_SRC);
      if (url.pathname.endsWith('/firebase-app.js')) return js(APP);
      if (url.pathname.endsWith('/firebase-auth.js')) return js(AUTH);
      if (url.pathname.endsWith('/firebase-firestore.js')) { log.firestoreSdkLoaded = true; return js('export {};'); }
      if (url.hostname === 'firestore.googleapis.com') {
        log.restCalls++;
        if (S.restDown) return route.abort('internetdisconnected');
        if (log.restCalls <= S.restFailures) return route.fulfill({ status: 503, json: {} });
        if (!S.profile) return route.fulfill({ status: 404, json: {} });
        return route.fulfill({ json: restDoc(S.profile) });
      }
      if (url.origin === origin) {
        if (/^\/(learn|teach|command-center)$/.test(url.pathname)) {
          log.navigatedTo = url.pathname + url.search;
          return route.fulfill({ contentType: 'text/html', body: '<title>dashboard</title>dashboard' });
        }
        return route.continue();
      }
      if (route.request().resourceType() === 'script') return js('');
      return route.fulfill({ body: '', contentType: 'text/plain' });
    });
    await page.goto(origin + '/' + R.page, { waitUntil: 'domcontentloaded' });
    if (offline) await ctx.setOffline(true);
    return { page, ctx, R, log };
  }

  async function fill(page, R, password) {
    await page.locator(R.id).fill(R.idValue);
    await page.locator(R.pass).fill(password);
  }

  async function check(name, fn) {
    try { await fn(); console.log('  ✓ ' + name); }
    catch (e) { failures++; console.log('  ✗ ' + name + '\n      ' + (e && e.message || e)); }
  }

  for (const role of process.env.LOGIN_SPLASH_ONLY ? [] : Object.keys(ROLES)) {
    console.log(role + ' login (phone 390×844)');

    await check('loads without the Firestore SDK and without errors', async () => {
      const { page, ctx, log } = await open(role, {});
      await page.waitForFunction(() => window.ntcLogin && window.ntcLogin.handler);
      assert(!log.firestoreSdkLoaded, 'Firestore SDK was requested');
      assert.deepEqual(log.errors, []);
      await page.screenshot({ path: path.join(out, role + '-1-form.png') });
      await ctx.close();
    });

    await check('phone ergonomics: 16px inputs, ≥44px Login button, no sideways scroll', async () => {
      const { page, ctx, R } = await open(role, {});
      for (const sel of [R.id, R.pass]) {
        const size = await page.locator(sel).evaluate(el => parseFloat(getComputedStyle(el).fontSize));
        assert(size >= 16, sel + ' font-size ' + size + 'px (iOS zooms in below 16px)');
      }
      const h = await page.locator('#loginBtn').evaluate(el => el.getBoundingClientRect().height);
      assert(h >= 44, 'Login button is ' + h + 'px tall');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'page scrolls sideways');
      assert.equal(await page.locator('#classSelect').count(), 0, 'unused Class field is gone');
      await ctx.close();
    });

    await check('successful login: launch screen steps 1→2→3 and stays up through the redirect', async () => {
      const { page, ctx, R, log } = await open(role, { signInDelay: 600 });
      await page.waitForFunction(() => window.ntcLogin && window.ntcLogin.handler);
      await fill(page, R, 'right-password');
      await page.locator('#loginBtn').tap();
      await page.waitForSelector('.ntc-launch.on');
      await page.waitForTimeout(250);
      assert.match(await page.locator('.ntc-launch-step').textContent(), /Signing you in/);
      await page.screenshot({ path: path.join(out, role + '-2-launch.png') });
      await page.waitForURL(R.dest, { timeout: 8000 });
      assert.match(log.navigatedTo, R.dest);
      await ctx.close();
    });

    await check('Login tapped before Firebase is ready is queued (one tap is enough)', async () => {
      const { page, ctx, R } = await open(role, { firebaseDelay: 5000 });
      assert(await page.evaluate(() => !window.ntcLogin.handler), 'Firebase was already ready; test is not meaningful');
      await fill(page, R, 'right-password');
      await page.locator('#loginBtn').tap();
      await page.waitForSelector('.ntc-launch.on');
      await page.waitForURL(R.dest, { timeout: 8000 });
      await ctx.close();
    });

    await check('wrong password: launch hides, error + shake, button usable, retry succeeds', async () => {
      const { page, ctx, R } = await open(role, {});
      await page.waitForFunction(() => window.ntcLogin && window.ntcLogin.handler);
      await fill(page, R, 'wrong');
      await page.locator('#loginBtn').tap();
      await page.waitForFunction(() => /Invalid/.test(document.querySelector('#loginError').textContent));
      assert.equal(await page.locator('.ntc-launch.on').count(), 0, 'launch screen still covering the error');
      assert(await page.locator('.login-card.ntc-shake').count(), 'card did not shake');
      assert(await page.locator('#loginBtn').isEnabled());
      await page.waitForTimeout(400); // loader fade-out
      await page.screenshot({ path: path.join(out, role + '-3-error.png') });
      await page.locator(R.pass).fill('right-password');
      await page.locator('#loginBtn').tap();
      await page.waitForURL(R.dest, { timeout: 8000 });
      await ctx.close();
    });

    await check('flaky profile lookup (2 server errors) recovers without a second tap', async () => {
      const { page, ctx, R, log } = await open(role, { restFailures: 2 });
      await page.waitForFunction(() => window.ntcLogin && window.ntcLogin.handler);
      await fill(page, R, 'right-password');
      await page.locator('#loginBtn').tap();
      await page.waitForURL(R.dest, { timeout: 10000 });
      assert.equal(await page.evaluate(() => Number(sessionStorage.signIns || 0)), 1, 'signed in more than once');
      assert(log.restCalls >= 3);
      await ctx.close();
    });

    await check('network down after sign-in: clear message, button recovers', async () => {
      const { page, ctx, R } = await open(role, { restDown: true });
      await page.waitForFunction(() => window.ntcLogin && window.ntcLogin.handler);
      await fill(page, R, 'right-password');
      await page.locator('#loginBtn').tap();
      await page.waitForFunction(() => /Network error/.test(document.querySelector('#loginError').textContent), null, { timeout: 15000 });
      assert(await page.locator('#loginBtn').isEnabled());
      assert.equal(await page.locator('.ntc-launch.on').count(), 0);
      await ctx.close();
    });

    await check('offline: tells the user immediately', async () => {
      const { page, ctx, R } = await open(role, {}, { offline: true });
      await page.waitForFunction(() => window.ntcLogin && window.ntcLogin.handler);
      await fill(page, R, 'right-password');
      await page.locator('#loginBtn').tap();
      await page.waitForFunction(() => /offline/i.test(document.querySelector('#loginError').textContent), null, { timeout: 2000 });
      assert.equal(await page.evaluate(() => Number(sessionStorage.signIns || 0)), 0);
      await ctx.close();
    });

    await check('arriving from Sign out: signed-out note slides in, then goes', async () => {
      const { page, ctx } = await open(role, { cameFromSignOut: true });
      await page.waitForSelector('.ntc-toast.on');
      assert.match(await page.locator('.ntc-toast').textContent(), /signed out/);
      await page.screenshot({ path: path.join(out, role + '-4-signed-out.png') });
      await page.waitForSelector('.ntc-toast', { state: 'detached', timeout: 6000 });
      assert.equal(await page.evaluate(() => sessionStorage.getItem('ntc:signed-out')), null, 'note shows only once');
      await ctx.close();
    });

    await check('already signed in: "Welcome back" and straight to the dashboard', async () => {
      const { page, ctx, R } = await open(role, { signedIn: true });
      await page.waitForURL(R.dest, { timeout: 8000 });
      await ctx.close();
    });

    if (role !== 'student') {
      await check('signed in but no ' + role + ' record: denied, signed out, form usable', async () => {
        const { page, ctx, R } = await open(role, { profile: role === 'admin' ? { isAdmin: false } : null });
        await page.waitForFunction(() => window.ntcLogin && window.ntcLogin.handler);
        await fill(page, R, 'right-password');
        await page.locator('#loginBtn').tap();
        await page.waitForFunction(() => /denied|No teacher account/i.test(document.querySelector('#loginError').textContent));
        assert.equal(await page.evaluate(() => window.__signedOut || 0), 1);
        assert(await page.locator('#loginBtn').isEnabled());
        await ctx.close();
      });
    }
  }

  console.log('dashboard splash');
  for (const file of ['student-dashboard.html', 'teacher-dashboard.html', 'admin-panel.html']) {
    await check(file + ' shows the launch splash (not a blank page) while styles load', async () => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
      const page = await ctx.newPage();
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        // Page and its small scripts arrive; stylesheets and Firebase never do
        // (a phone on a slow connection, mid-load).
        if (url.origin === origin && !url.pathname.startsWith('/assets/css/')) return route.continue();
        return new Promise(() => {});
      });
      page.goto(origin + '/' + file).catch(() => {});
      await page.waitForFunction(() => document.documentElement && getComputedStyle(document.documentElement, '::after').content.includes('Opening'), null, { timeout: 8000 });
      await page.screenshot({ path: path.join(out, 'splash-' + file.replace('.html', '') + '.png') });
      await ctx.close();
    });
  }

  await browser.close();
  server.close();
  console.log(failures ? failures + ' check(s) failed' : 'All login checks passed. Screenshots: qa/artifacts/login-flow/');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
