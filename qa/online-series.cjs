/* Online Test Series portal (/test-series) — end-to-end browser check with fixtures.
   New Google student: sign-in screen → 3-step form (validation, draft) → Home.
   Returning student: Home → subject → locked test → Razorpay (fake) → unlocked →
   start → timer + paper → upload a PDF → submitted; Ranks, Results, Profile, TNC ID.
   Checks no horizontal overflow, fixed tab bar, no JS errors at 320/390/768/1440px.
   Firebase, Razorpay, Uploadcare and the Netlify functions are all intercepted.
   Run with Playwright on NODE_PATH: node qa/online-series.cjs */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const out = path.join(__dirname, 'artifacts', 'online-series'); fs.mkdirSync(out, { recursive: true });

function makePdf(pages) {
  const objs = []; const add = s => { objs.push(s); return objs.length; };
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pagesId = objs.length + 1; objs.push(null);
  const kids = pages.map(text => { const body = `BT /F1 18 Tf 60 760 Td (${text}) Tj ET`; const c = add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`); return add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Contents ${c} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`); });
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let pdf = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}
const paperPdf = makePdf(['Q1. State Snell law. (2)', 'Q2. A ray passes through a prism... (3)']);
const scriptFile = path.join(out, 'answers.pdf'); fs.writeFileSync(scriptFile, makePdf(['Answer 1', 'Answer 2']));

const field = v => v === null ? { nullValue: null } : Array.isArray(v) ? { arrayValue: { values: v.map(field) } } : typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, field(x)])) } }
  : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : { stringValue: String(v ?? '') };
const docOf = (p, item) => ({ name: 'projects/fixture/databases/(default)/documents/' + p, fields: Object.fromEntries(Object.entries(item).map(([k, v]) => [k, field(v)])) });

const profile = { uid: 'riya', onlineId: 'TNC-ON-RIYA', enrolled: false, provider: 'google', email: 'riya@example.test', name: 'Riya Sharma', dob: '2011-05-04', gender: 'Female', phone: '9874461218',
  class: '10', board: 'CBSE', school: 'DPS Newtown', subjects: ['Physics', 'Chemistry', 'Biology', 'Mathematics'], target: 'NEET', address: '12 Lake Road', city: 'Kolkata', state: 'West Bengal', pincode: '700156',
  guardianName: 'Anil Sharma', guardianRelation: 'Father', guardianPhone: '9830012345', profileComplete: true, createdAt: '2026-11-01T10:00:00Z' };
const T = (id, o) => ({ id, testName: 'Test', class: '10', board: '', subject: 'Physics', chapter: 'Light', module: 'Full chapter', totalMarks: 40, durationMin: 90, isActive: true, kind: 'chapter', teacherName: 'Aarav Sen', gradingMode: 'teacher', series: 'online', createdAt: '2026-11-01', ...o });
const tests = [
  T('phyfree', { testName: 'Full syllabus mock 1', chapter: 'Full syllabus', kind: 'mock', createdAt: '2026-11-03' }),
  T('phymock2', { testName: 'Full syllabus mock 2', chapter: 'Full syllabus', kind: 'mock', createdAt: '2026-11-05' }),
  T('phy1', { testName: 'Chapter test 1', chapter: 'Light — Reflection and Refraction', createdAt: '2026-11-01' }),
  T('phy2', { testName: 'Chapter test 2', chapter: 'Electricity', createdAt: '2026-11-02' }),
  T('phy3', { testName: 'Chapter test 3', chapter: 'Magnetic Effects of Electric Current', createdAt: '2026-11-04' }),
  T('chem1', { subject: 'Chemistry', testName: 'Chapter test 1', chapter: 'Chemical Reactions' }),
  T('chem2', { subject: 'Chemistry', testName: 'Full mock 1', chapter: 'Full syllabus', kind: 'mock' }),
  T('bio1', { subject: 'Biology', testName: 'Full mock 1', chapter: 'Full syllabus', kind: 'mock' }),
  T('mat1', { subject: 'Mathematics', testName: 'Real numbers', chapter: 'Real Numbers', durationMin: 60 }),
  T('icse', { board: 'ICSE', testName: 'ICSE only' })
];
const results = [{ id: 'chem1__riya', testId: 'chem1', reportId: 'chem1__riya', testName: 'Chapter test 1', subject: 'Chemistry', chapter: 'Chemical Reactions', class: '10', score: 34, totalMarks: 40,
  remark: 'Balanced equations well. Show state symbols every time.', teacherName: 'Priya Das', answerSheetUrl: 'https://32zbpzustr.ucarecd.net/44444444-4444-4444-4444-444444444444/', approvedAt: '2026-11-10T09:00:00Z', submittedAt: '2026-11-08T09:00:00Z' }];
const boards = [
  { id: 'c10_chemistry', class: '10', subject: 'Chemistry', count: 248, scores: [97, 95, 92, 90, 88, 85, 85, 84, 80, 79, 70], top: [{ rank: 1, name: 'Aditi R.', city: 'Pune' }, { rank: 2, name: 'Kabir S.', city: 'Lucknow' }, { rank: 3, name: 'Meera I.', city: 'Chennai' }], updatedAt: '2026-11-11T10:00:00Z' },
  { id: 'c10_physics', class: '10', subject: 'Physics', count: 3, scores: [90, 80, 60], top: [{ rank: 1, name: 'Aman G.', city: 'Kolkata' }, { rank: 2, name: 'Zoya K.', city: 'Delhi' }], updatedAt: '2026-11-11T10:00:00Z' }
];

const config = "export const FIREBASE_CONFIG={projectId:'fixture',apiKey:'fixture'};export const initAppCheck=async()=>null;";
const authMod = `
const L=[];let user=window.__fxUser||null;
const mk=u=>u&&({...u,getIdToken:async()=>'tok-'+u.uid});
export const getAuth=()=>({get currentUser(){return mk(user);}});
export class GoogleAuthProvider{setCustomParameters(){}}
const emit=()=>L.forEach(cb=>cb(mk(user)));
export const onAuthStateChanged=(a,cb)=>{L.push(cb);setTimeout(()=>cb(mk(user)),0);return()=>{};};
export const signInWithPopup=async()=>{user={uid:'meera',displayName:'Meera Iyer',email:'meera@example.test'};emit();};
export const signInWithEmailAndPassword=async(a,email,pw)=>{if(pw!=='secret'){const e=new Error('bad');e.code='auth/invalid-credential';throw e;}user={uid:'tnc1',displayName:'',email};emit();};
export const signOut=async()=>{user=null;emit();};`;
const razorpay = `window.Razorpay=function(o){this.o=o;};window.Razorpay.prototype.on=function(){};window.Razorpay.prototype.open=function(){window.__rzOpened=this.o;setTimeout(()=>this.o.handler({razorpay_order_id:this.o.order_id,razorpay_payment_id:'pay_Fx000001',razorpay_signature:'a'.repeat(64)}),150);};`;

const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    res.setHeader('Content-Type', { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }[path.extname(file)] || 'text/html');
    res.end(fs.readFileSync(file));
  } catch { res.writeHead(404); res.end(); }
});

async function open(browser, origin, state, viewport) {
  const page = await browser.newPage({ viewport: viewport || { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: (viewport || {}).width < 768 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(u => { window.__fxUser = u; }, state.user || null);
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    const js = body => route.fulfill({ contentType: 'text/javascript', body });
    if (url.pathname.endsWith('/firebase-config.js')) return js(config);
    if (url.pathname.endsWith('/firebase-app.js')) return js('export const initializeApp=()=>({});');
    if (url.pathname.endsWith('/firebase-auth.js')) return js(authMod);
    if (url.hostname === 'checkout.razorpay.com') return js(razorpay);
    if (url.hostname === 'upload.uploadcare.com') { state.uploads++; return route.fulfill({ json: { file: '55555555-5555-5555-5555-' + String(state.uploads).padStart(12, '0') } }); }
    if (['ucarecdn.com', '32zbpzustr.ucarecd.net'].includes(url.hostname)) return route.fulfill({ contentType: 'application/pdf', body: paperPdf });
    if (url.pathname === '/.netlify/functions/online-series') {
      const b = req.postDataJSON(); state.calls.push(b.action);
      if (state.slow) await new Promise(r => setTimeout(r, state.slow));
      const uid = b.idToken.replace('tok-', '');
      if (b.action === 'session') return route.fulfill({ json: { uid, enrolled: uid === 'tnc1', email: uid + '@example.test', profile: state.profiles[uid] || { uid, profileComplete: false }, unlocked: state.unlocked, prices: { chapter: 199, mock: 499 }, freeMock: { allowance: uid === 'tnc1' ? 0 : 1, usedCount: state.freeUsed ? 1 : 0, left: uid === 'tnc1' ? 0 : 1 - (state.freeUsed ? 1 : 0), claims: state.freeUsed ? [{ testId: state.freeUsed, subject: 'Physics' }] : [] }, paymentsReady: state.paymentsReady !== false, razorpayKeyId: 'rzp_test', serverNow: new Date().toISOString() } });
      if (b.action === 'save-profile') {
        if (state.failSave) { state.failSave = false; return route.fulfill({ status: 500, json: { error: 'Something went wrong. Please try again.' } }); }
        state.saved = b.profile; state.profiles[uid] = { ...b.profile, uid, onlineId: 'TNC-ON-MEERA', profileComplete: true, email: uid + '@example.test' };
        return route.fulfill({ json: { ok: true, profile: state.profiles[uid] } });
      }
      if (b.action === 'create-order') return route.fulfill({ json: { orderId: 'order_Fx000001', amountPaise: 49900, currency: 'INR', keyId: 'rzp_test', testName: 'Chapter test 1', prefill: { name: 'Riya Sharma', email: 'riya@example.test', contact: '9874461218' } } });
      if (b.action === 'claim-free') { state.unlocked.push(b.testId); state.freeUsed = b.testId; return route.fulfill({ json: { ok: true, testId: b.testId, freeMock: { allowance: 1, usedCount: 1, left: 0, claims: [{ testId: b.testId, subject: 'Physics' }] } } }); }
      if (b.action === 'create-order' && b.testId !== 'phy1') return route.fulfill({ status: 500, json: { error: 'unexpected order' } });
      if (b.action === 'check-promo') {
        state.promoChecks = (state.promoChecks || 0) + 1;
        if (String(b.code).toUpperCase() === 'TNCGIFT1') return route.fulfill({ json: { ok: true, code: 'TNCGIFT1', kind: b.kind || 'chapter' } });
        return route.fulfill({ status: 400, json: { error: 'This promo code is not valid.' } });
      }
      if (b.action === 'redeem-promo') { state.unlocked.push(b.testId); state.redeemed = b; return route.fulfill({ json: { ok: true, testId: b.testId, code: b.code } }); }
      if (b.action === 'module-order' && b.promoCode) {
        state.moduleOrder = b;
        state.modules = b.items.map(i => ({ id: 'promo_1_' + i.subject.toLowerCase(), orderId: 'promo_1', uid: 'riya', class: '10', board: b.board, boardLabel: 'CBSE', subject: i.subject, chapters: i.chapters, chapterCount: i.chapters.length,
          status: 'requested', testId: '', createdAt: new Date().toISOString(), dueAt: new Date(Date.now() + 86400000).toISOString() }));
        return route.fulfill({ json: { ok: true, free: true, promo: 'TNCGIFT1', orderId: 'promo_1', requests: state.modules } });
      }
      if (b.action === 'module-order') {
        state.moduleOrder = b; const n = b.items.reduce((k, i) => k + i.chapters.length, 0);
        return route.fulfill({ json: { orderId: 'order_Mod000001', amountPaise: onlinePolicy.modulePrice(n) * 100, currency: 'INR', keyId: 'rzp_test', testName: 'Custom module · ' + n + ' chapters', prefill: { name: 'Riya Sharma', contact: '9874461218' } } });
      }
      if (b.action === 'verify-payment' && b.orderId === 'order_Mod000001') {
        const now = Date.now();
        state.modules = state.moduleOrder.items.map(i => ({ id: 'order_Mod000001_' + i.subject.toLowerCase(), orderId: 'order_Mod000001', uid: 'riya', class: '10', board: state.moduleOrder.board, boardLabel: state.moduleOrder.board === 'CISCE' ? 'ICSE' : 'CBSE',
          subject: i.subject, chapters: i.chapters, chapterCount: i.chapters.length, status: 'requested', testId: '', createdAt: new Date(now).toISOString(), dueAt: new Date(now + 86400000).toISOString() }));
        return route.fulfill({ json: { ok: true, type: 'module' } });
      }
      if (b.action === 'package-order') {
        state.packOrder = b;
        if (b.promoCode) { state.unlocked.push('pkg_' + b.packageId); return route.fulfill({ json: { ok: true, free: true, promo: b.promoCode, packageId: b.packageId } }); }
        const pk = state.packages.find(x => x.id === b.packageId);
        return route.fulfill({ json: { orderId: 'order_Pkg000001', amountPaise: pk.priceInr * 100, currency: 'INR', keyId: 'rzp_test', testName: pk.title, prefill: { name: 'Riya Sharma' } } });
      }
      if (b.action === 'verify-payment' && b.orderId === 'order_Pkg000001') { state.unlocked.push('pkg_' + state.packOrder.packageId); return route.fulfill({ json: { ok: true, type: 'package' } }); }
      if (b.action === 'verify-payment') { state.unlocked.push('phy1'); return route.fulfill({ json: { ok: true, testId: 'phy1' } }); }
    }
    if (url.pathname === '/.netlify/functions/offline-test') {
      const b = req.postDataJSON(); state.calls.push(b.action);
      if (b.action === 'start') { state.attempts[b.testId] = { testId: b.testId, uid: 'riya', status: 'started', startedAt: new Date().toISOString(), deadline: new Date(Date.now() + 90 * 60000).toISOString(), uploadGraceMin: 15, questionPdfUrl: 'https://ucarecdn.com/66666666-6666-6666-6666-666666666666/' }; return route.fulfill({ json: { ...state.attempts[b.testId], serverNow: new Date().toISOString() } }); }
      if (b.action === 'submit') { state.submitted = b; state.attempts[b.testId].status = 'submitted'; return route.fulfill({ json: { ok: true, status: 'submitted', lateByMin: 0 } }); }
    }
    if (url.hostname === 'firestore.googleapis.com') {
      if (url.pathname.endsWith(':runQuery')) {
        const q = req.postDataJSON().structuredQuery, coll = q.from[0].collectionId;
        const rows = coll === 'mockPackages' ? (state.packages || []) : coll === 'moduleRequests' ? state.modules : coll === 'offlineTests' ? tests.concat(state.extraTests || []) : coll === 'offlineAttempts' ? Object.values(state.attempts).map(a => ({ id: a.testId + '__riya', ...a })) : coll === 'onlineLeaderboard' ? boards : [];
        return route.fulfill({ json: rows.length ? rows.map(r => ({ document: docOf(coll + '/' + r.id, r) })) : [{ readTime: 'x' }] });
      }
      const p = decodeURIComponent(url.pathname.split('/documents/')[1] || '');
      if (/^onlineStudents\/[^/]+\/results$/.test(p)) return route.fulfill({ json: { documents: state.results.map(r => docOf(p + '/' + r.id, r)) } });
      return route.fulfill({ status: 404, json: { error: { message: 'Not found' } } });
    }
    if (url.origin === origin) return route.continue();
    if (/cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com/.test(url.hostname)) return route.continue();
    if (req.resourceType() === 'script') return js('');
    return route.fulfill({ body: '', contentType: 'text/plain' });
  });
  await page.goto(origin + '/test-series.html');
  return { page, errors };
}
const newState = over => ({ user: null, profiles: { riya: profile }, unlocked: [], attempts: {}, results: [], calls: [], uploads: 0, modules: [], ...over });
const onlinePolicy = require('../assets/js/online-policy.js');
// Phone: Ranks / Custom / Profile are inside More; laptops show them in the side rail.
async function goTab(page, tab) {
  const direct = page.locator(`#nav [data-tab=${tab}]`);
  if (await direct.isVisible()) return direct.click();
  await page.click('#navMore'); await page.waitForSelector('#sheet.on .more-menu');
  await page.click(`.more-menu a[href="#/${tab === 'me' ? 'me' : tab}"]`);
  await page.waitForSelector('#sheet', { state: 'hidden' });
}
async function noOverflow(page, label) {
  const o = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth - innerWidth, wide: [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > innerWidth + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('.chips-scroll,.up-thumbs,.ex-paper,[hidden]'); }).slice(0, 3).map(e => e.className || e.tagName) }));
  assert.ok(o.doc <= 0 && !o.wide.length, `${label}: no horizontal overflow (${o.doc}px, ${o.wide.join(', ')})`);
}
const shot = async (page, name) => { await page.waitForTimeout(380); await page.screenshot({ path: path.join(out, name + '.png') }); };

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, channel: process.env.PORTAL_BROWSER === 'edge' ? 'msedge' : 'chrome' });
  try {
    // ── 1. Sign-in screen at phone + desktop sizes ──
    for (const [w, h] of [[320, 640], [390, 844], [1440, 900]]) {
      const { page, errors } = await open(browser, origin, newState(), { width: w, height: h });
      await page.waitForSelector('#auth:not([hidden])');
      await page.waitForSelector('#googleBtn:not([disabled])');
      const fits = await page.evaluate(() => { const a = document.querySelector('#auth'); return a.scrollHeight <= a.clientHeight + 1; });
      assert.ok(fits, `sign-in fits one screen at ${w}×${h}`);
      await noOverflow(page, 'sign-in ' + w);
      await shot(page, `01-signin-${w}`);
      if (w === 390) {
        await page.click('#tncToggle');
        await page.fill('#tncId', 'NTC-2026-001'); await page.fill('#tncPw', 'wrong');
        await page.click('#tncSubmit');
        await page.waitForFunction(() => /Wrong TNC ID/.test(document.querySelector('#authErr').textContent));
        await shot(page, '02-signin-tnc-error-390');
      }
      assert.deepEqual(errors, []); await page.close();
    }
    console.log('✓ sign-in: one screen at 320/390/1440, Google + TNC ID, wrong password message');

    // ── 2. New Google student fills the 3-step form ──
    {
      const state = newState({ failSave: true });
      const { page, errors } = await open(browser, origin, state, { width: 390, height: 844 });
      await page.click('#googleBtn');
      await page.waitForSelector('#onboard:not([hidden])');
      assert.equal(await page.inputValue('[name=name]'), 'Meera Iyer', 'name prefilled from Google');
      await shot(page, '03-form-step1-390');
      await page.click('#obNext');
      await page.waitForSelector('.fl.bad');
      assert.match(await page.textContent('[data-err=dob]'), /date of birth/);
      assert.match(await page.textContent('[data-err=phone]'), /10-digit/);
      await shot(page, '04-form-errors-390');
      await page.fill('[name=dob]', '2010-08-15'); await page.fill('[name=phone]', '98abc76543210');
      assert.equal(await page.inputValue('[name=phone]'), '9876543210', 'digits only, capped at 10');
      await page.fill('[name=phone]', ''); await page.type('[name=phone]', '+91 98765 43210');
      assert.equal(await page.inputValue('[name=phone]'), '9876543210', 'typed/pasted +91 number keeps its 10 digits');
      await page.click('label.chip:has-text("Female")');
      await page.click('#obNext');
      await page.waitForFunction(() => document.querySelector('#obTitle').textContent === 'Your studies');
      await page.click('label.chip:has-text("Class 10")'); await page.click('label.chip:has-text("CBSE")');
      await page.fill('[name=school]', 'Kendriya Vidyalaya, Chennai');
      await page.click('label.chip:has-text("Physics")'); await page.click('label.chip:has-text("Mathematics")');
      await shot(page, '05-form-step2-390');
      await page.click('#obNext');
      await page.waitForFunction(() => document.querySelector('#obTitle').textContent === 'Address & guardian');
      await page.fill('[name=address]', '4 Gandhi Street, T Nagar'); await page.fill('[name=city]', 'Chennai'); await page.fill('[name=pincode]', '600017');
      await page.selectOption('[name=state]', 'Tamil Nadu');
      await page.fill('[name=guardianName]', 'Lakshmi Iyer'); await page.click('label.chip:has-text("Mother")'); await page.fill('[name=guardianPhone]', '9444012345');
      await noOverflow(page, 'form step 3');
      await shot(page, '06-form-step3-390');
      // Back keeps answers.
      await page.click('#obBack'); await page.waitForFunction(() => document.querySelector('#obTitle').textContent === 'Your studies');
      assert.equal(await page.inputValue('[name=school]'), 'Kendriya Vidyalaya, Chennai');
      await page.click('#obNext'); await page.waitForFunction(() => document.querySelector('#obTitle').textContent === 'Address & guardian');
      assert.equal(await page.inputValue('[name=city]'), 'Chennai');
      await page.click('#obNext');
      await page.waitForFunction(() => /went wrong/.test(document.querySelector('#obErr').textContent));
      await page.click('#obNext');   // retry after a failed save
      await page.waitForSelector('#app:not([hidden]) .v-home');
      await page.waitForSelector('.free-card:has-text("Your free mock test")');
      await page.click('.free-card');
      await page.waitForSelector('#sheet.on [data-pick]');
      assert.equal(await page.locator('#sheet [data-pick]').count(), 3, 'one choice per subject with a full mock (Physics, Chemistry, Biology)');
      await shot(page, '07b-free-mock-picker-390');
      await page.click('#sheetClose'); await page.waitForSelector('#sheet', { state: 'hidden' });
      assert.equal(state.saved.state, 'Tamil Nadu'); assert.deepEqual(state.saved.subjects, ['Physics', 'Mathematics']); assert.equal(state.saved.guardianRelation, 'Mother');
      assert.match(await page.textContent('.hello h2'), /Meera/);
      await shot(page, '07-home-new-student-390');
      assert.deepEqual(errors, []); await page.close();
    }
    console.log('✓ form: Google name prefilled, inline errors, digit-only phone, back keeps answers, failed save retried, lands on Home');

    // ── 3. Returning student: Home → subject → unlock → test → upload ──
    for (const [w, h] of [[320, 640], [390, 844], [768, 1024], [1440, 900]]) {
      const state = newState({ user: { uid: 'riya', displayName: 'Riya Sharma', email: 'riya@example.test' }, results: results.slice(), attempts: { chem1: { testId: 'chem1', uid: 'riya', status: 'approved' } } });
      const { page, errors } = await open(browser, origin, state, { width: w, height: h });
      await page.waitForSelector('#app:not([hidden]) .v-home');
      await page.waitForSelector('.subj');
      assert.equal(await page.locator('.subj').count(), 4, 'four subjects for Class 10 CBSE');
      assert.ok(!(await page.textContent('#view')).includes('ICSE only'), 'other-board tests hidden');
      const nav = await page.evaluate(() => { const n = document.querySelector('#nav').getBoundingClientRect(); return { bottom: Math.round(n.bottom), h: innerHeight, left: Math.round(n.left), height: Math.round(n.height) }; });
      if (w < 960) assert.equal(nav.bottom, nav.h, 'bottom tab bar pinned to the bottom');
      else assert.ok(nav.height >= h - 1 && nav.left === 0, 'side rail on laptops');
      const homeFits = await page.evaluate(() => { const m = document.querySelector('#view'); return m.scrollHeight - m.clientHeight; });
      if (w >= 390) assert.ok(homeFits <= 0, `Home fits without scrolling at ${w}px (overflow ${homeFits}px)`);
      await noOverflow(page, 'home ' + w); await shot(page, `08-home-${w}`);

      await page.click('.subj:has-text("Physics")');
      await page.waitForSelector('.v-subject .row');
      assert.equal(await page.getAttribute('[data-seg=mock]', 'aria-selected'), 'true', 'opens on Full mocks while the free mock is unused');
      let rows = await page.locator('.v-subject .row').allTextContents();
      assert.equal(rows.length, 2); assert.match(rows[0], /Full syllabus mock 1[\s\S]*₹499/, 'full mocks ₹499');
      assert.match(await page.textContent('.seg-hint'), /1 free mock left — use on any subject/);
      await page.click('[data-seg=chapter]');
      rows = await page.locator('.v-subject .row').allTextContents();
      assert.equal(rows.length, 3); assert.ok(rows.every(r => /₹199/.test(r)), 'chapter-wise tests ₹199 each');
      assert.match(await page.textContent('.rank-chip'), /Not ranked/);
      await noOverflow(page, 'subject ' + w); await shot(page, `09-subject-${w}`);
      if (w !== 390) { assert.deepEqual(errors, []); await page.close(); continue; }

      // Free mock: chosen from a mock's sheet.
      await page.click('[data-seg=mock]');
      await page.click('.row:has-text("Full syllabus mock 1")');
      await page.waitForSelector('#sheet.on .free-card');
      await shot(page, '10a-mock-sheet-free-390');
      await page.click('#sheet .free-card'); await page.waitForSelector('.free-confirm:has-text("Physics")');
      await page.click('[data-go=claim]');
      await page.waitForSelector('#sheet', { state: 'hidden' });
      await page.waitForSelector('.row.fresh:has-text("Full syllabus mock 1")');
      assert.equal(state.freeUsed, 'phyfree');
      assert.match(await page.textContent('.row:has-text("Full syllabus mock 1")'), /Unlocked · tap to start[\s\S]*Start/);
      assert.match(await page.textContent('.row:has-text("Full syllabus mock 2")'), /₹499/, 'other mocks stay paid');
      assert.ok(!(await page.textContent('.seg-hint')).includes('free'), 'free mock offer gone once used');
      await page.click('.row:has-text("Full syllabus mock 2")'); await page.waitForSelector('#sheet.on .price');
      assert.equal(await page.locator('#sheet .free-card').count(), 0, 'no second free mock');
      await page.click('#sheetClose'); await page.waitForSelector('#sheet', { state: 'hidden' });
      // Chapter-wise test: ₹199 through Razorpay.
      await page.click('[data-seg=chapter]');
      await page.click('.row:has-text("Chapter test 1")');
      await page.waitForSelector('#sheet.on .price');
      assert.match(await page.textContent('.price-top'), /₹199/);
      assert.match(await page.textContent('#sheetBody .no-refund'), /Non-refundable\.\s*Once paid, the amount is not refunded/, 'non-refundable notice before paying');
      await shot(page, '10-unlock-sheet-390');
      await page.click('[data-go=pay]');
      // After Razorpay confirms: back on the subject list, the paid test highlighted as unlocked.
      await page.waitForSelector('#sheet', { state: 'hidden' });
      await page.waitForSelector('.row.fresh:has-text("Chapter test 1")');
      assert.equal(await page.evaluate(() => location.hash), '#/s/Physics');
      assert.equal(await page.getAttribute('[data-seg=chapter]', 'aria-selected'), 'true');
      assert.match(await page.textContent('#toast'), /Payment successful/);
      assert.equal(await page.evaluate(() => window.__rzOpened.amount), 49900, 'fixture order amount passed through');
      assert.match(await page.evaluate(() => window.__rzOpened.description), /Non-refundable/, 'Razorpay window says non-refundable');
      assert.equal(await page.evaluate(() => window.__rzOpened.prefill.contact), '9874461218');
      assert.ok(state.calls.includes('verify-payment'), 'payment signature verified on the server');
      await shot(page, '11-unlocked-390');
      // Tap the unlocked test → timer warning → Start now → exam.
      await page.click('.row.fresh');
      await page.waitForSelector('.warn-box:has-text("90-minute timer")');
      await shot(page, '12-start-confirm-390');
      await page.click('[data-go=start]');
      await page.waitForSelector('#exam:not([hidden])');
      await page.waitForSelector('#exPaper canvas', { timeout: 20000 }).catch(() => {});
      assert.match(await page.textContent('#exTimer'), /^(1:2\d|1:30):\d\d$/, 'timer counts down from 90 minutes');
      await shot(page, '13-exam-paper-390');
      // Back button minimises the test; the row shows time left.
      await page.goBack(); await page.waitForSelector('#exam', { state: 'hidden' });
      await page.waitForSelector('#sheet', { state: 'hidden' });
      await page.click('[data-seg=chapter]');
      assert.match(await page.textContent('.row:has-text("Chapter test 1")'), /\d+m left/);
      await page.click('a[data-tab=home]'); await page.waitForSelector('.resume');
      await shot(page, '14-home-resume-390');
      await page.click('.resume'); await page.waitForSelector('#exam:not([hidden])');
      await page.click('#exSubmitOpen'); await page.waitForSelector('#exUpload:not([hidden])');
      await page.setInputFiles('#exFile', scriptFile);
      await page.waitForFunction(() => !document.querySelector('#exUpSubmit').disabled, null, { timeout: 20000 });
      assert.match(await page.textContent('#exMsg'), /2 pages ready/);
      await shot(page, '15-upload-ready-390');
      await page.click('#exUpSubmit');
      await page.waitForFunction(() => /Submitted/.test(document.querySelector('#exMsg').textContent));
      assert.equal(state.submitted.testId, 'phy1'); assert.match(state.submitted.scriptPdfUrl, /^https:\/\/32zbpzustr\.ucarecd\.net\/55555555-/);
      await page.waitForSelector('#exam', { state: 'hidden', timeout: 8000 });
      await page.waitForSelector('#sheet', { state: 'hidden' });

      // Phone tab bar: 4 items; Ranks, Custom and Profile are in More.
      assert.deepEqual(await page.locator('#nav [data-tab]:visible').evaluateAll(els => els.map(e => e.dataset.tab)), ['home', 'packs', 'results', 'more'], 'four tabs on phones');
      await page.click('#navMore'); await page.waitForSelector('#sheet.on .more-menu');
      assert.match(await page.textContent('.more-menu'), /Leaderboard[\s\S]*Custom test[\s\S]*Profile[\s\S]*Help on WhatsApp[\s\S]*Call us/);
      await shot(page, '31-more-390');
      await page.click('#sheetClose'); await page.waitForSelector('#sheet', { state: 'hidden' });
      // Ranks, Results, Profile.
      await goTab(page, 'ranks'); await page.waitForSelector('.rank-card');
      assert.ok(await page.locator('#navMore.on').count(), 'More is highlighted on a page inside it');
      await page.click('[data-rank=Chemistry]');
      assert.match(await page.textContent('.rank-me strong'), /#6/, '85% average → #6 of 248 (five students above)');
      assert.match(await page.textContent('.podium'), /Aditi R\.[\s\S]*Kabir S\.|Kabir S\.[\s\S]*Aditi R\./);
      await noOverflow(page, 'ranks'); await shot(page, '16-ranks-390');
      await page.click('a[data-tab=results]'); await page.waitForSelector('.v-results');
      assert.match(await page.textContent('.v-results'), /Being checked[\s\S]*Chapter test 1/);
      assert.doesNotMatch(await page.locator('#app').innerText(), /Priya Das|Aarav Sen/, 'no teacher names shown to online students');
      await page.click('[data-result="chem1__riya"]'); await page.waitForSelector('#sheet.on .score');
      assert.match(await page.textContent('#sheetBody'), /State symbols|state symbols/);
      await shot(page, '17-result-sheet-390');
      await page.click('#sheetClose'); await page.waitForSelector('#sheet', { state: 'hidden' });
      await goTab(page, 'me'); await page.waitForSelector('.me-card');
      assert.match(await page.textContent('.me-card'), /TNC-ON-RIYA/);
      await noOverflow(page, 'profile'); await shot(page, '18-profile-390');
      assert.deepEqual(errors, []); await page.close();
    }
    console.log('✓ returning student: 4 subjects, Chapter-wise ₹199 / Full mocks ₹499 sections, one free mock claimed (others stay paid), Razorpay unlock, timer + paper, Back minimises, resume card, PDF upload + submit');
    console.log('✓ ranks (#6 of 248, podium), results (in review + checked feedback), profile; tab bar / side rail and no overflow at 320/390/768/1440');

    // ── 4. Phone reloaded mid-payment: back to the paid test once confirmed ──
    {
      const state = newState({ user: { uid: 'riya', displayName: 'Riya', email: 'riya@example.test' } });
      const { page, errors } = await open(browser, origin, state, { width: 390, height: 844 });
      await page.waitForSelector('.v-home .subj');
      await page.evaluate(() => localStorage.setItem('ntc-online:pending-pay:riya', JSON.stringify({ orderId: 'order_Fx000009', testId: 'phy1', at: Date.now() })));
      state.unlocked.push('phy1');   // the webhook confirmed it while the page was away
      await page.reload();
      await page.waitForSelector('.row.fresh:has-text("Chapter test 1")');
      assert.equal(await page.evaluate(() => location.hash), '#/s/Physics');
      assert.equal(await page.evaluate(() => localStorage.getItem('ntc-online:pending-pay:riya')), null, 'pending payment cleared');
      assert.deepEqual(errors, []); await page.close();
    }
    console.log('✓ payment return: Razorpay success → subject list with the test unlocked → Start now → exam; reload mid-payment recovers');

    // ── 5. Custom module test: pick chapters → cart → pay → My tests ──
    {
      const state = newState({ user: { uid: 'riya', displayName: 'Riya Sharma', email: 'riya@example.test' } });
      const { page, errors } = await open(browser, origin, state, { width: 390, height: 844 });
      await page.waitForSelector('.v-home .subj');
      await goTab(page, 'custom'); await page.waitForSelector('.v-custom .row.pick');
      assert.equal(await page.getAttribute('[data-cboard=CBSE]', 'aria-selected'), 'true', 'starts on the student’s board');
      assert.deepEqual(await page.locator('[data-csub]').allTextContents(), ['Science', 'Mathematics']);
      for (const i of [0, 1, 2]) await page.click(`.row.pick[data-ch="${i}"]`);
      await page.click('[data-csub=Mathematics]');
      await page.click('.row.pick[data-ch="0"]');
      assert.match(await page.textContent('.cart-bar'), /Add 1 more Mathematics chapter · min 2 per paper/, 'one chapter in a subject is not enough');
      assert.equal(await page.locator('[data-cart]').isDisabled(), true, 'Review blocked until 2 chapters');
      await shot(page, '30-custom-min2-390');
      await page.click('.row.pick[data-ch="3"]');
      assert.equal(await page.locator('[data-cart]').isDisabled(), false);
      assert.match(await page.textContent('.cart-bar'), /5 chapters · ₹946[\s\S]*You save ₹49/, '4 × ₹199 + 1 × ₹150');
      assert.match(await page.textContent('[data-csub=Science]'), /3/, 'subject chip shows its count');
      await noOverflow(page, 'custom build'); await shot(page, '20-custom-build-390');
      await page.click('[data-cboard=CISCE]');
      assert.deepEqual(await page.locator('[data-csub]').allTextContents(), ['Physics', 'Chemistry', 'Biology', 'Mathematics'], 'ICSE subjects for Class 10');
      assert.equal(await page.locator('.cart-bar').count(), 0, 'each board keeps its own cart');
      await page.click('[data-cboard=CBSE]'); await page.waitForSelector('.cart-bar');
      await page.click('[data-cart]'); await page.waitForSelector('#sheet.on .bill');
      assert.match(await page.textContent('.bill'), /4 × ₹199[\s\S]*₹796[\s\S]*1 × ₹150[\s\S]*₹150[\s\S]*You save[\s\S]*₹49[\s\S]*Total[\s\S]*₹946/);
      assert.match(await page.textContent('#sheetBody .no-refund'), /Non-refundable/, 'non-refundable notice in the cart');
      await shot(page, '21-custom-cart-390');
      await page.locator('#sheet [data-rm]').first().click();
      await page.waitForFunction(() => /Total\s*₹796/.test(document.querySelector('.bill').textContent));
      await page.click('[data-buy]');
      await page.waitForSelector('#sheet', { state: 'hidden' });
      await page.waitForSelector('.v-custom .row[data-cmod]');
      assert.equal(state.moduleOrder.board, 'CBSE'); assert.equal(state.moduleOrder.items.reduce((n, i) => n + i.chapters.length, 0), 4);
      assert.equal(await page.evaluate(() => window.__rzOpened.amount), 79600);
      const mine = await page.locator('.row[data-cmod]').allTextContents();
      assert.equal(mine.length, 2); assert.ok(mine.every(r => /Preparing/.test(r) && /Ready by/.test(r)), 'one paper per subject, being prepared');
      assert.match(await page.textContent('#toast'), /Payment successful/);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ntc-online:cart:riya')).CBSE.Science || []).then(x => x.length), 0, 'cart emptied');
      await shot(page, '22-custom-mine-390');
      await page.locator('.row[data-cmod]').first().click(); await page.waitForSelector('#sheet.on .track');
      assert.match(await page.textContent('#sheetBody'), /Making your paper/);
      await page.click('#sheetClose'); await page.waitForSelector('#sheet', { state: 'hidden' });
      // The team uploads the paper → it is ready to start, for this student only.
      state.modules[0] = { ...state.modules[0], status: 'ready', testId: 'cust1' };
      state.extraTests = [T('cust1', { kind: 'custom', forUid: 'riya', subject: state.modules[0].subject, testName: 'Custom module · ' + state.modules[0].subject, chapter: 'Custom module', module: state.modules[0].chapters.join('; '), durationMin: 60 }),
        T('cust2', { kind: 'custom', forUid: 'someone-else', subject: 'Science', testName: 'Not yours' })];
      await page.reload(); await page.waitForSelector('.v-custom'); await page.click('[data-cseg=mine]'); await page.waitForSelector('.v-custom .row[data-cmod]');
      await page.waitForFunction(() => /Start/.test(document.querySelector('.row[data-cmod]').textContent));
      assert.equal((await page.textContent('#view')).includes('Not yours'), false, "another student's paper never shows");
      await page.locator('.row[data-cmod]').first().click(); await page.waitForSelector('#sheet.on [data-go=confirm]');
      assert.match(await page.textContent('#sheetBody'), /Chapters:/);
      assert.deepEqual(errors, []); await page.close();
    }
    {
      const state = newState({ user: { uid: 'riya', displayName: 'Riya', email: 'riya@example.test' }, profiles: { riya: { ...profile, class: '8' } } });
      const { page, errors } = await open(browser, origin, state, { width: 390, height: 844 });
      await page.waitForSelector('.v-home .subj');
      await page.click('#navMore'); await page.waitForSelector('#sheet.on .more-menu');
      assert.equal(await page.locator('.more-menu a[href="#/custom"]').count(), 0, 'no Custom test below Class 9');
      assert.deepEqual(errors, []); await page.close();
    }
    console.log('✓ custom module: CBSE/ICSE chapters, per-board cart, ₹199 × 4 then ₹150, cart sheet + remove, Razorpay → one paper per subject, ready paper starts, only own papers, Classes 9–12');

    // ── 6. Before Razorpay: contact card + promo code makes a purchase ₹0 ──
    {
      const state = newState({ user: { uid: 'riya', displayName: 'Riya Sharma', email: 'riya@example.test' }, paymentsReady: false });
      const { page, errors } = await open(browser, origin, state, { width: 390, height: 844 });
      await page.waitForSelector('.v-home .subj');
      await page.click('.subj:has-text("Physics")'); await page.click('[data-seg=chapter]');
      await page.click('.row:has-text("Chapter test 2")'); await page.waitForSelector('#sheet.on .contact-card');
      assert.match(await page.textContent('.contact-card'), /Online payment opens soon[\s\S]*\+91 98744 61218[\s\S]*WhatsApp/);
      assert.equal(await page.getAttribute('.contact-card a[href^="tel:"]', 'href'), 'tel:+919874461218');
      assert.match(decodeURIComponent(await page.getAttribute('.contact-card a[href*="wa.me"]', 'href')), /Chapter test 2[\s\S]*Class 10[\s\S]*TNC-ON-RIYA/, 'WhatsApp message says what and who');
      assert.equal(await page.locator('[data-go=pay]').count(), 0, 'no pay button before Razorpay');
      assert.equal(await page.locator('.promo-box[open]').count(), 1, 'promo box open while payments are off');
      await page.fill('#promoInput', 'wrong1'); await page.click('[data-promo-apply]');
      await page.waitForFunction(() => /not valid/.test(document.querySelector('#promoMsg').textContent));
      await page.fill('#promoInput', 'tncgift1'); await page.press('#promoInput', 'Enter');
      await page.waitForSelector('#sheet .promo.ok');
      assert.match(await page.textContent('.price-top'), /₹0[\s\S]*₹199/, 'price shows ₹0 with the old price struck');
      await shot(page, '23-promo-applied-390');
      await page.click('[data-go=promo-redeem]');
      await page.waitForSelector('#sheet', { state: 'hidden' });
      await page.waitForSelector('.row.fresh:has-text("Chapter test 2")');
      assert.equal(state.redeemed.code, 'TNCGIFT1'); assert.equal(state.redeemed.testId, 'phy2');
      assert.match(await page.textContent('#toast'), /Promo applied/);
      // Custom module cart with a promo.
      await goTab(page, 'custom'); await page.waitForSelector('.v-custom .row.pick');
      await page.click('.row.pick[data-ch="0"]'); await page.click('.row.pick[data-ch="1"]');
      await page.click('[data-cart]'); await page.waitForSelector('#sheet.on .contact-card');
      await page.fill('#promoInput', 'TNCGIFT1'); await page.click('[data-promo-apply]');
      await page.waitForSelector('#sheet .promo.ok');
      assert.match(await page.textContent('.bill'), /Promo TNCGIFT1[\s\S]*−₹398[\s\S]*Total[\s\S]*₹0/);
      await shot(page, '24-promo-cart-390');
      await page.click('[data-buy]');
      await page.waitForSelector('#sheet', { state: 'hidden' }); await page.waitForSelector('.row[data-cmod]');
      assert.equal(state.moduleOrder.promoCode, 'TNCGIFT1');
      assert.match(await page.textContent('#toast'), /Promo applied/);
      assert.deepEqual(errors, []); await page.close();
    }
    console.log('✓ before Razorpay: contact card (call + WhatsApp with details), promo code checked, test unlocks at ₹0, custom cart ordered at ₹0');

    // ── 8. Mock packs: browse → pay for one → weekly schedule → open mock; join another with a promo ──
    {
      const DAY = 86400000, first = Math.floor((Date.now() - DAY) / 60000) * 60000;
      const week = (n, start) => Array.from({ length: n }, (_, i) => new Date(start + i * 7 * DAY).toISOString());
      const state = newState({ user: { uid: 'riya', displayName: 'Riya Sharma', email: 'riya@example.test' },
        packages: [
          { id: 'pkphy8', title: 'Physics · 8 weekly mocks', class: '10', board: '', subject: 'Physics', mocks: 8, priceInr: 3199, active: true, description: 'Board pattern · 80 marks · 3 hours', schedule: week(8, first) },
          { id: 'pkche4', title: 'Chemistry · 4 weekly mocks', class: '10', board: '', subject: 'Chemistry', mocks: 4, priceInr: 1699, active: true, description: '', schedule: week(4, first + 3 * DAY) },
          { id: 'pkold1', title: 'Old paused pack', class: '10', board: '', subject: 'Physics', mocks: 4, priceInr: 1699, active: false, description: '', schedule: week(4, first) }],
        extraTests: [T('pk1m1', { testName: 'Physics full mock 1', chapter: 'Full syllabus', module: 'Mock 1 of 8', kind: 'package', packageId: 'pkphy8', slot: 1, releaseAt: new Date(first).toISOString(), totalMarks: 80, durationMin: 180 })] });
      const { page, errors } = await open(browser, origin, state, { width: 390, height: 844 });
      await page.waitForSelector('.v-home .subj');
      assert.equal(await page.locator('.subj:has-text("Physics")').count(), 1);
      assert.match(await page.textContent('.pack-offer'), /pack/i, 'Home offers mock packs');
      await page.click('#navPacks'); await page.waitForSelector('.v-packs .pack-card');
      assert.equal(await page.locator('.v-packs .pack-card').count(), 2, 'paused packs are not on sale');
      assert.match(await page.textContent('.pack-card[data-pack=pkphy8]'), /Physics · 8 weekly mocks[\s\S]*8 mocks[\s\S]*₹3199[\s\S]*₹400\/mock/);
      assert.match(await page.textContent('.pack-card[data-pack=pkche4]'), /₹1699[\s\S]*₹425\/mock/);
      await noOverflow(page, 'packs 390');
      await shot(page, '25-packs-390');
      await page.click('.pack-card[data-pack=pkphy8]'); await page.waitForSelector('#sheet.on [data-ppay]');
      assert.equal(await page.locator('#sheet .rows.sched li').count(), 8, 'the 8 weekly dates are listed');
      assert.match(await page.textContent('#sheet'), /non-refundable/i);
      assert.match(await page.textContent('[data-ppay]'), /Join for ₹3199/);
      await shot(page, '26-pack-sheet-390');
      await page.click('[data-ppay]');
      await page.waitForSelector('#sheet.on .pk-progress');
      assert.equal(state.packOrder.packageId, 'pkphy8'); assert.ok(!state.packOrder.promoCode);
      assert.match(await page.textContent('.pk-progress'), /0 of 8 done[\s\S]*Mock 1 is open/);
      assert.match(await page.textContent('#toast'), /Payment successful/);
      assert.match(await page.locator('#sheet .rows.sched li').nth(1).textContent(), /Mock 2[\s\S]*(Being prepared|[0-9])/, 'later mocks show their date');
      await shot(page, '27-pack-joined-390');
      await page.click('[data-slot-test=pk1m1]'); await page.waitForSelector('#sheet.on [data-go=confirm]');
      assert.match(await page.textContent('#sheet .facts'), /Pack mock · 1 of 8[\s\S]*80 marks/);
      await page.click('#sheetClose'); await page.waitForSelector('#sheet', { state: 'hidden' });
      await page.waitForSelector('[data-pseg=mine][aria-selected=true]');
      assert.equal(await page.locator('.pack-card').count(), 1); assert.match(await page.textContent('.pack-card'), /Joined[\s\S]*|0 of 8 done/);
      // Chemistry pack with a promo code.
      await page.click('[data-pseg=packs]'); await page.click('.pack-card[data-pack=pkche4]'); await page.waitForSelector('#sheet.on [data-ppay]');
      await page.click('.promo-box summary'); await page.fill('#promoInput', 'tncgift1'); await page.click('[data-promo-apply]');
      await page.waitForSelector('#sheet .promo.ok');
      assert.match(await page.textContent('.price-top'), /₹0[\s\S]*₹1699/);
      await page.click('[data-pjoin]'); await page.waitForSelector('#sheet.on .pk-progress');
      assert.equal(state.packOrder.promoCode, 'TNCGIFT1'); assert.match(await page.textContent('#toast'), /Promo applied/);
      await page.click('#sheetClose'); await page.waitForSelector('#sheet', { state: 'hidden' });
      assert.match(await page.textContent('[data-pseg=mine]'), /2/);
      await page.click('.tsx-nav a[data-tab=home]'); await page.waitForSelector('.v-home .next-mock');
      assert.match(await page.textContent('.next-mock'), /Mock ready · Physics 1\/8/, 'Home shows the open pack mock');
      await shot(page, '28-home-next-mock-390');
      assert.deepEqual(errors, []); await page.close();
    }
    console.log('✓ mock packs: on-sale packs only, ₹/mock, schedule + non-refundable, Razorpay join → progress + open mock, promo join ₹0, My packs, Home next-mock card');

    // ── 7. Instant reopen from cache and TNC ID sign-in ──
    {
      const state = newState({ user: { uid: 'riya', displayName: 'Riya', email: 'riya@example.test' } });
      const { page, errors } = await open(browser, origin, state, { width: 390, height: 844 });
      await page.waitForSelector('.v-home .subj');
      state.slow = 3000;
      await page.reload();
      const t0 = Date.now();
      await page.waitForSelector('.v-home .subj');
      assert.ok(Date.now() - t0 < 2500, 'cached Home paints before the slow server answers');
      assert.deepEqual(errors, []); await page.close();
    }
    {
      const state = newState({ profiles: { tnc1: { ...profile, uid: 'tnc1', enrolled: true, provider: 'tnc', onlineId: 'NTC-2026-001', name: 'Aman Gupta' } },
        packages: [{ id: 'pkphy8', title: 'Physics · 8 weekly mocks', class: '10', board: '', subject: 'Physics', mocks: 8, priceInr: 3199, active: true, description: '', schedule: Array.from({ length: 8 }, (_, i) => new Date(Date.now() + (i * 7 + 2) * 86400000).toISOString()) }] });
      const { page, errors } = await open(browser, origin, state, { width: 390, height: 844 });
      await page.click('#tncToggle'); await page.fill('#tncId', 'NTC-2026-001'); await page.fill('#tncPw', 'secret');
      await page.click('#tncSubmit');
      await page.waitForSelector('.v-home .plan.pro:has-text("TNC student")');
      assert.equal(await page.locator('[data-free-pick]').count(), 0, 'no free-mock offer for TNC students');
      await page.click('.subj:has-text("Physics")');
      for (const seg of ['mock', 'chapter']) {
        await page.click('[data-seg=' + seg + ']');
        assert.match(await page.textContent('.seg-hint'), /Chapter-wise tests and full mocks are free for TNC students/);
        const rows = await page.locator('.v-subject .row').allTextContents();
        assert.ok(rows.length && rows.every(r => /Free/.test(r) && !/₹/.test(r)), 'every ' + seg + ' test free for TNC students');
      }
      await shot(page, '19-tnc-subject-390');
      // Mock packs and custom tests are paid for TNC students too (promo codes work there).
      await page.click('#navPacks'); await page.waitForSelector('.pack-card[data-pack=pkphy8]');
      assert.match(await page.textContent('.pack-card[data-pack=pkphy8]'), /₹3199[\s\S]*₹400\/mock/);
      await page.click('.pack-card[data-pack=pkphy8]'); await page.waitForSelector('#sheet.on [data-ppay]');
      assert.match(await page.textContent('[data-ppay]'), /Join for ₹3199/); assert.equal(await page.locator('#sheet .promo-box').count(), 1, 'promo box offered');
      await page.click('#sheetClose'); await page.waitForSelector('#sheet', { state: 'hidden' });
      await goTab(page, 'custom'); await page.waitForSelector('.v-custom .row.pick');
      assert.match(await page.textContent('.cm-price'), /₹199 a chapter/);
      await page.click('.row.pick[data-ch="0"]'); await page.click('.row.pick[data-ch="1"]'); assert.match(await page.textContent('.cart-bar'), /2 chapters · ₹398/);
      await page.click('[data-cart]'); await page.waitForSelector('#sheet.on [data-buy]');
      assert.match(await page.textContent('#sheet .bill'), /Total[\s\S]*₹398/); assert.match(await page.textContent('[data-buy]'), /Pay ₹398/);
      assert.equal(await page.locator('#sheet .promo-box').count(), 1);
      await shot(page, '29-tnc-custom-paid-390');
      assert.deepEqual(errors, []); await page.close();
    }
    console.log('✓ cached data opens Home instantly; TNC ID students: chapter-wise tests and full mocks free; mock packs and custom tests paid (with promo box)');
    console.log(`Screenshots: ${path.relative(root, out)}`);
  } finally {
    await browser.close(); server.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
