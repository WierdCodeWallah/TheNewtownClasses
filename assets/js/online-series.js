/* ════════════════════════════════════════════════════════════════════
   Online Test Series portal (/test-series) — app shell, phone first.
   Sign in (Google or TNC ID) → onboarding form → Home (subjects) →
   subject tests → unlock (Razorpay) → timed paper → upload → teacher
   returns the checked script → Results + all-India leaderboard.

   Reads use the Firestore REST API (rules allow only the student's own
   records); every write goes through Netlify functions:
     online-series  session, save-profile, create-order, verify-payment
     offline-test   start (timer + paper), submit (answer script)
   Last data is cached per student so the app opens instantly.
   ════════════════════════════════════════════════════════════════════ */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { FIREBASE_CONFIG, initAppCheck } from './firebase-config.js?v=0970664c';

const P = window.NTCOnlinePolicy;
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FS = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;
const KEY = FIREBASE_CONFIG.apiKey;
const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const WA = 'https://wa.me/919903461361';
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
const SUBJECT_ICON = { Physics: 'physics', Chemistry: 'chemistry', Biology: 'biology', Mathematics: 'mathematics', Maths: 'mathematics', Science: 'science', Computer: 'computer', English: 'english', 'Social Science': 'social', 'History & Civics': 'history', Geography: 'geography' };
const TINT = { Physics: ['#4f46e5', '#eef0ff'], Chemistry: ['#0e8a85', '#e2f5f4'], Biology: ['#2d8a3a', '#e7f5e9'], Mathematics: ['#c26a00', '#fff1dc'],
  Science: ['#7c3aed', '#f1ebff'], Computer: ['#30507f', '#e8eef7'], English: ['#c03d68', '#fdebf1'],
  'Social Science': ['#b4531a', '#fdf0e6'], 'History & Civics': ['#8a5a14', '#f8f0e1'], Geography: ['#0f7a5a', '#e3f4ee'] };
const ic = (id, cls) => `<svg class="ic${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#${id}"/></svg>`;
const subjIc = s => ic('s-' + (SUBJECT_ICON[s] || 'science'));
// Display name: the board papers are "Computer Applications" up to Class 10, "Computer Science" after.
const subjName = (s, cls) => s === 'Computer' ? ((parseInt(cls, 10) || 12) <= 10 ? 'Computer Applications' : 'Computer Science') : s;
const tint = s => { const t = TINT[s] || ['#1a56db', '#eaf1ff']; return `--tint:${t[0]};--tint-soft:${t[1]}`; };
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
const fmtDate = v => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); };
const fmtTime = ms => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const S = {
  user: null, session: null, tests: [], attempts: {}, results: [], boards: {}, errors: {},
  loading: null, offset: 0, segment: 'tests', rankSubject: '', resultSubject: '',
  exam: null, pdfjs: null, zoom: 1, up: { photos: [], file: null, pdf: null, version: 0, uploaded: null, busy: false },
  ob: null, view: '', modules: [], cust: null, packages: [], packSeg: 'packs', packSubject: ''
};
const now = () => Date.now() + S.offset;
const enrolled = () => !!(S.session && S.session.enrolled);
// TNC students: their institute subjects are free; other subjects are paid.
const enrolledSubs = () => (enrolled() ? (S.session.enrolledSubjects || []) : false);
const tncFree = subject => enrolled() && P.enrolledIn(subject, S.session.enrolledSubjects || []);
const priceOf = t => P.priceFor(t, S.session && S.session.prices, enrolledSubs());
// Regular price shown struck through (0 when there is none, e.g. free or TNC).
const listOf = t => P.listPriceFor(t, S.session && S.session.prices, S.session && S.session.listPrices, enrolledSubs());
const was = t => { const l = listOf(t); return l ? `<s>₹${l}</s>` : ''; };
const kindOf = t => P.kindOf(t);
// One free full mock per online student, on any subject they choose.
const freeLeft = () => (S.session && S.session.freeMock && S.session.freeMock.left) || 0;
const freeMocks = n => `${n} free mock${n === 1 ? '' : 's'}`;
const freeChoices = () => visibleTests().filter(t => kindOf(t) === 'mock' && stateOf(t).key === 'locked').sort(byOrder);

// ═══ Firebase ═══
const fbApp = initializeApp(FIREBASE_CONFIG, 'ntc-online');   // its own session: never replaces a portal login
await initAppCheck(fbApp);
const auth = getAuth(fbApp);
const google = new GoogleAuthProvider();
google.setCustomParameters({ prompt: 'select_account' });

// ═══ Network ═══
async function http(url, opts, ms) {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), ms || 20000);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  catch (_) { throw new Error(navigator.onLine === false ? "You're offline. Check your internet and try again." : 'Network problem. Please try again.'); }
  finally { clearTimeout(timer); }
}
const token = () => S.user.getIdToken();
async function fn(name, body) {
  const res = await http('/.netlify/functions/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: await token(), ...body }) }, 30000);
  let data = {}; try { data = await res.json(); } catch (_) {}
  if ([404, 405].includes(res.status) && LOCAL) throw Object.assign(new Error('The test-series backend needs Netlify Dev here: run "npx netlify-cli dev" and open http://localhost:8888/test-series.'), { status: res.status });
  if (!res.ok) throw Object.assign(new Error(data.error || `Something went wrong (${res.status}). Please try again.`), { status: res.status, data });
  return data;
}
function val(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(val);
  if ('mapValue' in v) return fields(v.mapValue.fields);
  return null;
}
function fields(f) { const o = {}; for (const k in f || {}) o[k] = val(f[k]); return o; }
const asDoc = d => ({ id: d.name.split('/').pop(), ...fields(d.fields) });
// Firestore's own reason (rules, App Check or API-key restriction) goes to the
// console so a 403 can be diagnosed; students see a plain message.
function logFsError(what, res, json) {
  const err = json && (Array.isArray(json) ? json[0] && json[0].error : json.error);
  console.warn(`[test-series] Firestore ${what} → ${res.status}${err && err.message ? ': ' + err.message : ''}`);
}
async function fsQuery(collectionId, equals) {
  const filters = Object.entries(equals).map(([fieldPath, v]) => ({ fieldFilter: { field: { fieldPath }, op: 'EQUAL', value: typeof v === 'boolean' ? { booleanValue: v } : { stringValue: String(v) } } }));
  const res = await http(`${FS}:runQuery?key=${KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await token() },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId }], where: filters.length === 1 ? filters[0] : { compositeFilter: { op: 'AND', filters } } } }) });
  const json = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(json)) { logFsError(collectionId, res, json); throw new Error('Could not load your tests. Pull down or tap refresh.'); }
  return json.filter(x => x.document).map(x => asDoc(x.document));
}
async function fsList(path) {
  const out = []; let pageToken = '';
  do {
    const res = await http(`${FS}/${path}?key=${KEY}&pageSize=300${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}`, { headers: { Authorization: 'Bearer ' + await token() } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { logFsError(path, res, json); throw new Error('Could not load your results. Tap refresh to try again.'); }
    out.push(...(json.documents || []).map(asDoc)); pageToken = json.nextPageToken || '';
  } while (pageToken);
  return out;
}

// ═══ Cache: open instantly with the last known data ═══
const cacheKey = () => 'ntc-online:v1:' + S.user.uid;
function saveCache() {
  try { localStorage.setItem(cacheKey(), JSON.stringify({ at: Date.now(), session: S.session, tests: S.tests, attempts: S.attempts, results: S.results, boards: S.boards, modules: S.modules, packages: S.packages })); } catch (_) {}
}
function loadCache() {
  try { const c = JSON.parse(localStorage.getItem(cacheKey()) || 'null'); if (c && c.session && c.session.uid === S.user.uid && Date.now() - c.at < 14 * 86400000) return c; } catch (_) {}
  return null;
}

// ═══ UI primitives ═══
function show(screen) {
  document.body.dataset.screen = screen;
  ['boot', 'auth', 'onboard', 'app'].forEach(id => { $(id).hidden = id !== screen; });
}
let toastTimer = 0;
function toast(msg, kind) {
  const el = $('toast');
  el.textContent = msg; el.className = 'tsx-toast on' + (kind ? ' ' + kind : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.className = 'tsx-toast' + (kind ? ' ' + kind : ''); }, kind === 'err' ? 5200 : 3200);
}
function haptic(ms) { if (!REDUCED.matches && navigator.vibrate) { try { navigator.vibrate(ms || 12); } catch (_) {} } }
function busy(btn, label) {
  if (!btn) return () => {};
  // Keep the button's size while it shows the spinner, so nothing around it jumps.
  const html = btn.innerHTML, w = btn.style.minWidth; btn.style.minWidth = btn.offsetWidth + 'px';
  btn.disabled = true; btn.classList.add('busy'); btn.innerHTML = `<span class="spin" aria-hidden="true"></span>${esc(label)}`;
  return () => { btn.disabled = false; btn.classList.remove('busy'); btn.innerHTML = html; btn.style.minWidth = w; };
}
function bootMessage(text, retry) {
  show('boot');
  let box = $('bootMsg');
  if (!box) { box = document.createElement('div'); box.id = 'bootMsg'; box.className = 'boot-msg'; $('boot').appendChild(box); }
  box.innerHTML = `<p>${esc(text)}</p>` + (retry ? '<button type="button" class="btn primary">Try again</button> <button type="button" class="btn ghost" data-out>Sign out</button>' : '');
  $('boot').classList.toggle('has-msg', !!text);
  const b = box.querySelector('.btn.primary'); if (b) b.onclick = () => { box.innerHTML = ''; $('boot').classList.remove('has-msg'); refresh(); };
  const o = box.querySelector('[data-out]'); if (o) o.onclick = () => signOutNow();
}

// Back button closes the top layer (sheet, upload, exam) instead of leaving.
const layers = [];
function pushLayer(name, close) { layers.push({ name, close }); history.pushState({ tsx: name }, ''); }
function popLayer(name, after) {
  const top = layers[layers.length - 1];
  if (top && top.name === name) { top.after = after; history.back(); }
  else if (after) after();
}
window.addEventListener('popstate', () => {
  const top = layers.pop();
  if (top) { top.close(); if (top.after) setTimeout(top.after, 0); }
});

// ═══ Sheet ═══
let sheetOpener = null;
function openSheet(html, bind) {
  const back = $('sheet'), wasOpen = !back.hidden, panel = back.firstElementChild, body = $('sheetBody');
  // Already open (Pay → confirming → done, promo applied…): glide to the new
  // height and fade the new content in, instead of jumping.
  const from = wasOpen && !REDUCED.matches ? panel.offsetHeight : 0;
  body.innerHTML = html;
  if (bind) bind(body);
  if (from) {
    const to = panel.offsetHeight;
    body.classList.remove('swap'); void body.offsetWidth; body.classList.add('swap');
    if (Math.abs(to - from) > 2 && panel.animate) panel.animate([{ height: from + 'px' }, { height: to + 'px' }], { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  if (!wasOpen) {
    sheetOpener = document.activeElement;
    back.hidden = false;
    requestAnimationFrame(() => back.classList.add('on'));
    pushLayer('sheet', closeSheetNow);
  }
  const first = $('sheetBody').querySelector('.btn:not([disabled]), a.btn');
  setTimeout(() => (first || $('sheetClose')).focus({ preventScroll: true }), wasOpen ? 0 : 220);
}
function closeSheetNow() {
  const back = $('sheet');
  back.classList.remove('on');
  setTimeout(() => { if (!back.classList.contains('on')) { back.hidden = true; $('sheetBody').innerHTML = ''; } }, REDUCED.matches ? 0 : 220);
  if (sheetOpener && document.contains(sheetOpener)) sheetOpener.focus({ preventScroll: true });
}
const closeSheet = after => popLayer('sheet', after);
$('sheetClose').onclick = () => closeSheet();
$('sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('exUpload').hidden && !S.up.busy) closeUpload();
  else if (!$('sheet').hidden) closeSheet();
});

// ═══ Sign in ═══
const inWebView = /FBAN|FBAV|Instagram|Line\/|WhatsApp|Snapchat|; wv\)/i.test(navigator.userAgent);
$('authWebview').hidden = !inWebView;
$('copyLink').onclick = async () => { try { await navigator.clipboard.writeText(location.origin + '/test-series'); toast('Link copied. Paste it in Chrome or Safari.'); } catch (_) { toast('Copy this address: ' + location.origin + '/test-series'); } };
const authErr = msg => { $('authErr').textContent = msg || ''; if (msg) haptic(30); };
$('googleBtn').disabled = false;
$('googleBtn').onclick = async () => {
  authErr('');
  const done = busy($('googleBtn'), 'Opening Google…');
  try { await signInWithPopup(auth, google); }
  catch (e) {
    const map = {
      'auth/popup-closed-by-user': '', 'auth/cancelled-popup-request': '',
      'auth/popup-blocked': 'Please allow pop-ups for this site, then try again.',
      'auth/network-request-failed': 'Check your internet connection and try again.',
      'auth/unauthorized-domain': 'Google sign-in is not enabled on this address yet.',
      'auth/operation-not-allowed': 'Google sign-in is not available yet. Please WhatsApp us.',
      'auth/account-exists-with-different-credential': 'This email uses another sign-in method. Choose another Google account.',
      'auth/web-storage-unsupported': 'Your browser is blocking sign-in. Open this page in Chrome or Safari.'
    };
    authErr(e.code in map ? map[e.code] : (inWebView ? 'Open this page in Chrome or Safari to continue with Google.' : 'Google sign-in failed. Please try again.'));
  } finally { done(); }
};
$('tncToggle').onclick = () => {
  const open = $('tncForm').hidden;
  $('tncForm').hidden = !open; $('tncToggle').setAttribute('aria-expanded', String(open));
  document.querySelector('.tsx-auth').classList.toggle('tnc-open', open);
  if (open) setTimeout(() => $('tncId').focus(), 60);
};
$('pwEye').onclick = () => { const i = $('tncPw'), s = i.type === 'password'; i.type = s ? 'text' : 'password'; $('pwEye').textContent = s ? 'Hide' : 'Show'; $('pwEye').setAttribute('aria-label', s ? 'Hide password' : 'Show password'); };
$('tncForm').onsubmit = async e => {
  e.preventDefault(); authErr('');
  const id = $('tncId').value.trim(), pw = $('tncPw').value;
  if (!id || !pw) return authErr('Enter your TNC ID and password.');
  const done = busy($('tncSubmit'), 'Signing in…');
  try { await signInWithEmailAndPassword(auth, id.toLowerCase().replace(/\s+/g, '') + '@ntcportal.local', pw); }
  catch (err) {
    authErr(['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email'].includes(err.code) ? 'Wrong TNC ID or password.'
      : err.code === 'auth/too-many-requests' ? 'Too many attempts. Please wait a few minutes.'
      : err.code === 'auth/network-request-failed' ? 'Check your internet connection and try again.' : 'Sign-in failed. Please try again.');
  } finally { done(); }
};
// After signing out, Back goes to the homepage instead of walking through old tabs
// behind the sign-in screen (same as the student / teacher / admin portals).
window.addEventListener('popstate', () => { if (S.leftAt && !S.user) location.replace('/'); });
let authGeneration = 0;
function clearStudentState() {
  authGeneration++;
  S.loading = null;
  S.user = null; S.session = null; S.tests = []; S.attempts = {}; S.results = []; S.boards = {};
  S.modules = []; S.packages = []; S.cust = null; S.promo = null; S.ob = null; S.errors = {};
  if (S.exam) clearInterval(S.exam.timer);
  S.exam = null; S.view = ''; layers.length = 0;
  $('exam').hidden = true; $('exUpload').hidden = true; $('exPaper').innerHTML = '';
  document.documentElement.classList.remove('locked');
  resetUpload();
  $('view').innerHTML = ''; $('sheetBody').innerHTML = '';
  $('sheet').hidden = true;
}
async function signOutNow(message) {
  S.leftAt = Date.now();
  // Go straight to the sign-in screen: no sheet left fading over it.
  const sh = $('sheet'); if (sh && !sh.hidden) { sh.classList.remove('on'); sh.hidden = true; $('sheetBody').innerHTML = ''; }
  try { history.replaceState(null, '', location.pathname); } catch (_) {}   // drop the old tab from the address bar
  try { localStorage.removeItem(cacheKey()); } catch (_) {}
  clearStudentState();
  show('auth');
  try { await signOut(auth); } catch (_) {}
  show('auth'); authErr(message || '');
}

onAuthStateChanged(auth, user => {
  if (!user) { clearStudentState(); show('auth'); return; }
  if (S.user && S.user.uid === user.uid) return;
  clearStudentState();
  S.user = user; S.leftAt = 0;
  const cache = loadCache();
  if (cache && cache.session.profile && cache.session.profile.profileComplete) {
    Object.assign(S, { session: cache.session, tests: cache.tests || [], attempts: cache.attempts || {}, results: cache.results || [], boards: cache.boards || {}, modules: cache.modules || [], packages: cache.packages || [] });
    show('app'); render();
    refresh().catch(() => {});
  } else {
    show('boot'); bootMessage('');
    refresh();
  }
});

// ═══ Load everything for the signed-in student ═══
function refresh() {
  if (!S.user) return Promise.resolve();
  if (S.loading) return S.loading;
  const generation = authGeneration, refreshUid = S.user.uid;
  const current = () => generation === authGeneration && S.user && S.user.uid === refreshUid;
  S.loading = (async () => {
    try {
      const session = await fn('online-series', { action: 'session' });
      if (!current() || session.uid !== refreshUid) return;
      S.session = session;
      S.offset = session.serverNow ? Date.parse(session.serverNow) - Date.now() : 0;
      if (!session.profile.profileComplete) { startOnboarding(false); return; }
      const uid = S.user.uid, cls = session.profile.class;
      const [tests, attempts, results, boards, modules, packs] = await Promise.allSettled([
        fsQuery('offlineTests', { series: 'online', class: cls }),
        fsQuery('offlineAttempts', { uid }),
        fsList(`onlineStudents/${uid}/results`),
        fsQuery('onlineLeaderboard', { class: cls }),
        moduleEligible() ? fsQuery('moduleRequests', { uid }) : Promise.resolve([]),
        packsEligible() ? fsQuery('mockPackages', { class: cls }) : Promise.resolve([])
      ]);
      if (!current()) return;
      S.errors = {};
      // A custom module paper is made for one student only.
      if (tests.status === 'fulfilled') S.tests = tests.value.map(normaliseTest).filter(t => (!t.forUid || t.forUid === uid) && (!t.board || !session.profile.board || t.board === session.profile.board));
      else S.errors.tests = tests.reason.message;
      if (attempts.status === 'fulfilled') S.attempts = Object.fromEntries(attempts.value.filter(a => a.testId).map(a => [a.testId, {
        status: a.status || '', deadline: a.deadline || '', startedAt: a.startedAt || '', submittedAt: a.submittedAt || '',
        questionPdfUrl: NTCUploadcare.deliveryUrl(a.questionPdfUrl || ''), uploadGraceMin: a.uploadGraceMin || 15
      }]));
      if (results.status === 'fulfilled') S.results = results.value.map(normaliseResult).sort((a, b) => (b.approvedAt || '').localeCompare(a.approvedAt || ''));
      else S.errors.results = results.reason.message;
      if (boards.status === 'fulfilled') S.boards = Object.fromEntries(boards.value.map(b => [b.subject, b]));
      if (modules.status === 'fulfilled') S.modules = modules.value;
      if (packs.status === 'fulfilled') S.packages = packs.value.map(normalisePack).filter(p => (!p.board || !session.profile.board || p.board === session.profile.board) && (ownsPack(p.id) || (p.active && P.subjectAllowed(p.subject, session.profile.board, session.profile.class))));
      saveCache();
      if (document.body.dataset.screen !== 'app') show('app');
      render();
      resumePendingPayment();
    } catch (e) {
      if (!current()) return;
      if (e.status === 401) return signOutNow('Please sign in again.');
      if (e.status === 403) return signOutNow(e.message);
      if (document.body.dataset.screen === 'app') toast(navigator.onLine === false ? "You're offline — showing your saved data." : e.message, 'err');
      else bootMessage(e.message, true);
    } finally { if (current()) S.loading = null; }
  })();
  return S.loading;
}
function normaliseTest(d) {
  return { id: d.id, testName: d.testName || 'Test', subject: d.subject || 'General', chapter: d.chapter || 'General', module: d.module || 'Full chapter',
    totalMarks: Number(d.totalMarks) || 0, durationMin: Number(d.durationMin) || 60, instructions: d.instructions || '',
    gradingMode: d.gradingMode || 'teacher', isActive: d.isActive !== false, isFree: d.isFree === true, board: d.board || '', createdAt: d.createdAt || '',
    kind: d.kind || '', forUid: d.forUid || '', requestId: d.requestId || '', packageId: d.packageId || '', slot: Number(d.slot) || 0, releaseAt: d.releaseAt || '',
    hasAnswerKey: d.hasAnswerKey === true, full: d.full === true };
}
function normalisePack(d) {
  return { id: d.id, title: d.title || `${d.subject} mock pack`, class: String(d.class || ''), board: d.board || '', subject: d.subject || 'General', schedule: Array.isArray(d.schedule) ? d.schedule : [],
    priceInr: Number(d.priceInr) || 0, active: d.active !== false, description: d.description || '', createdAt: d.createdAt || '' };
}
function normaliseResult(r) {
  return { id: r.id, testId: r.testId || String(r.reportId || '').split('__')[0], reportId: r.reportId || r.id, testName: r.testName || 'Test',
    subject: r.subject || 'General', chapter: r.chapter || r.topic || 'General', module: r.module || 'Full chapter', class: String(r.class || ''),
    score: Number(r.score), totalMarks: Number(r.totalMarks) || 0, remark: r.remark || '',
    pdf: NTCUploadcare.isFileUrl(r.answerSheetUrl || '') ? NTCUploadcare.deliveryUrl(r.answerSheetUrl) : '',
    submittedAt: r.submittedAt || '', approvedAt: r.approvedAt || r.savedAt || '' };
}

// ═══ Derived data ═══
// CBSE up to Class 10 sees Science (not Physics / Chemistry / Biology); ICSE sees
// the three sciences (not Science). A paper the student already took stays.
const boardOk = subject => !S.session || P.subjectAllowed(subject, S.session.profile.board, S.session.profile.class);
const visibleTests = () => S.tests.filter(t => S.attempts[t.id] || (t.isActive && (kindOf(t) === 'custom' || boardOk(t.subject))));
const resultFor = t => S.results.find(r => r.testId === t.id);
function stateOf(t) {
  const a = S.attempts[t.id];
  if (!a && kindOf(t) === 'package' && t.releaseAt && Date.parse(t.releaseAt) > now()) return { key: 'scheduled', at: t.releaseAt };
  if (a) {
    if (a.status === 'started') { const left = Date.parse(a.deadline) - now(); return { key: 'started', left, late: left < -(a.uploadGraceMin || 15) * 60000 }; }
    if (a.status === 'approved') return { key: 'checked', result: resultFor(t) };
    return { key: 'review' };
  }
  if (!t.isActive) return { key: 'closed' };
  if (priceOf(t) === 0) return { key: 'ready', why: 'free' };
  if ((S.session.unlocked || []).includes(t.id)) return { key: 'ready', why: 'paid' };
  return { key: 'locked' };
}
const byOrder = (a, b) => (b.isFree - a.isFree) || a.createdAt.localeCompare(b.createdAt) || a.testName.localeCompare(b.testName, undefined, { numeric: true });
function subjects() {
  const set = new Set([...visibleTests().map(t => t.subject), ...((S.session.profile.subjects) || []).filter(boardOk)]);
  const order = s => { const i = P.SUBJECTS.indexOf(s); return i < 0 ? 99 : i; };
  return [...set].sort((a, b) => order(a) - order(b) || a.localeCompare(b)).map(name => {
    const tests = visibleTests().filter(t => t.subject === name && !['custom', 'package'].includes(kindOf(t)));
    const done = tests.filter(t => ['review', 'checked'].includes(stateOf(t).key)).length;
    return { name, count: tests.length, mocks: tests.filter(t => kindOf(t) === 'mock').length, done };
  });
}
function standing(subject) {
  const b = S.boards[subject], cls = String(S.session.profile.class);
  const mine = S.results.filter(r => r.subject === subject && r.class === cls);
  const avg = P.averageOf(mine);
  return { board: b, avg, rank: b ? P.rankFrom(b.scores, avg) : null, of: b ? b.count : 0, tests: mine.length };
}
const pctOf = r => r.totalMarks > 0 && Number.isFinite(r.score) ? Math.round(r.score / r.totalMarks * 100) : null;
const tone = pct => pct == null ? '' : pct >= 75 ? 'good' : pct >= 50 ? 'mid' : 'low';

// ═══ Router ═══
function route() {
  const h = location.hash.replace(/^#\/?/, '').split('/');
  if (h[0] === 's' && h[1]) return { name: 'subject', subject: decodeURIComponent(h[1]) };
  if (h[0] === 'packs' && h[1]) return { name: 'packs', subject: decodeURIComponent(h[1]) };
  if (['ranks', 'results', 'me', 'packs', 'custom'].includes(h[0])) return { name: h[0] };
  return { name: 'home' };
}
window.addEventListener('hashchange', () => { if (S.session && document.body.dataset.screen === 'app') render(true); });
// More: the pages that are not on the phone tab bar, plus help.
function openMore() {
  const r = route(), rank = (() => { try { return subjects().map(x => ({ ...standing(x.name), subject: x.name })).filter(x => x.rank).sort((a, b) => a.rank - b.rank)[0]; } catch (_) { return null; } })();
  const item = (hash, icon, label, sub, cur) => `<a href="${hash}" data-more-go${cur ? ' aria-current="page"' : ''}>${ic(icon)}<span><b>${label}</b><small>${sub}</small></span>${ic('i-chev', 'chev')}</a>`;
  openSheet(`<div class="sh-head"><h2 id="sheetTitle">More</h2></div>
    <div class="menu more-menu">
      ${item('#/ranks', 'i-trophy', 'Leaderboard', rank ? `Your best: #${rank.rank} in ${esc(rank.subject || '')}` : 'All-India ranks by subject', r.name === 'ranks')}
      ${packsEligible() ? item('#/results', 'i-results', 'Results' + (newResults() ? ' <i class="dot" aria-label="new"></i>' : ''), 'Checked scripts and marks', r.name === 'results') : ''}
      ${item('#/me', 'i-user', 'Profile', S.session.profile.detailsComplete === false && !enrolled() ? 'Add your remaining details' : esc(S.session.profile.onlineId || S.session.profile.studentId || 'Your details'), r.name === 'me')}
      <a href="${WA}" target="_blank" rel="noopener">${ic('i-chat')}<span><b>Help on WhatsApp</b><small>Payments, papers, anything else</small></span>${ic('i-chev', 'chev')}</a>
      <a href="tel:${CONTACT.tel}">${ic('i-phone')}<span><b>Call us</b><small>${esc(CONTACT.show)}</small></span>${ic('i-chev', 'chev')}</a>
      <a href="/">${ic('i-home')}<span><b>TNC home page</b><small>thenewtownclasses.com</small></span>${ic('i-chev', 'chev')}</a>
    </div>`, root => root.querySelectorAll('[data-more-go]').forEach(a => a.onclick = e => {
      e.preventDefault(); const h = a.getAttribute('href');
      closeSheet(() => { if (location.hash !== h) location.hash = h; });
    }));
}
$('navMore').onclick = () => openMore();
$('topBack').onclick = () => { const r = route(); if (history.length > 1 && S.cameFromApp) history.back(); else location.hash = r.name === 'packs' ? '#/packs' : '#/'; };

// A checked script the student hasn't opened Results for yet.
function newResults() {
  const seen = (() => { try { return localStorage.getItem('ntc-online:seen:' + S.user.uid) || ''; } catch (_) { return ''; } })();
  return S.results.some(x => (x.approvedAt || '') > seen);
}
function render(navigated) {
  if (!S.session) return;
  const r = route(), p = S.session.profile;
  const titles = { home: 'Test Series', subject: r.subject, ranks: 'Leaderboard', results: 'Results', me: 'Profile', packs: 'Mock tests', custom: 'Custom test' };
  // Phone tab bar: Home · Custom · Mocks · More for Classes 9–12 (Results moves into More);
  // Classes 7–8 have no mock packs: Home · Custom · Results · More.
  $('navCustom').hidden = !moduleEligible();
  $('navPacks').hidden = !packsEligible();
  $('navPacks').classList.remove('nav-extra');
  $('navResults').classList.toggle('nav-extra', packsEligible());
  $('topTitle').textContent = titles[r.name];
  const sub = r.name === 'subject' || (r.name === 'packs' && r.subject);
  $('topBack').hidden = !sub;
  $('topMark').hidden = !!sub;
  $('topAvatar').textContent = initials(p.name);
  $('topAvatar').hidden = r.name === 'me';
  // Ranks and Profile live in More; so does Results when Mocks is on the bar.
  const tab = r.name === 'subject' ? 'home' : r.name, inMore = ['ranks', 'me', ...(packsEligible() ? ['results'] : [])].includes(tab);
  document.querySelectorAll('#nav [data-tab]').forEach(a => {
    const on = a.dataset.tab === tab || (a.dataset.tab === 'more' && inMore);
    a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  $('resultsDot').hidden = !newResults() || r.name === 'results';
  $('moreDot').hidden = !packsEligible() || $('resultsDot').hidden;
  if (r.name === 'results' && S.results[0]) { try { localStorage.setItem('ntc-online:seen:' + S.user.uid, S.results[0].approvedAt || ''); } catch (_) {} }
  if (r.name === 'subject' && S.view !== 'subject' + r.subject) {
    const hasMock = visibleTests().some(t => t.subject === r.subject && kindOf(t) === 'mock');
    const hasChapter = visibleTests().some(t => t.subject === r.subject && kindOf(t) === 'chapter');
    S.segment = S.forceSegment || ((hasMock && (freeLeft() || !hasChapter)) ? 'mock' : 'chapter');
    S.forceSegment = null;
  }
  const html = r.name === 'subject' ? viewSubject(r.subject) : r.name === 'ranks' ? viewRanks() : r.name === 'results' ? viewResults() : r.name === 'me' ? viewProfile() : r.name === 'packs' ? viewPacks() : r.name === 'custom' ? viewCustom() : viewHome();
  const main = $('view'), key = r.name + (r.subject || '');
  main.innerHTML = html;
  if (navigated || S.view !== key) {
    if (navigated) S.cameFromApp = true;
    main.scrollTop = 0;
    if (!REDUCED.matches) { main.classList.remove('enter'); void main.offsetWidth; main.classList.add('enter'); }
  }
  S.view = key;
  bindView(main);
}
const initials = name => (String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('') || '··').toUpperCase();
const firstName = () => String(S.session.profile.name || 'there').trim().split(/\s+/)[0];
function greeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }

function bindView(root) {
  root.querySelectorAll('[data-test]').forEach(b => b.onclick = () => {
    const t = S.tests.find(x => x.id === b.dataset.test);
    openTest(b.dataset.test, t && S.justUnlocked === t.id && stateOf(t).key === 'ready' ? 'confirm' : undefined);
  });
  root.querySelectorAll('[data-result]').forEach(b => b.onclick = () => openResult(b.dataset.result));
  root.querySelectorAll('[data-seg]').forEach(b => b.onclick = () => { S.segment = b.dataset.seg; render(); });
  root.querySelectorAll('[data-rank]').forEach(b => b.onclick = () => { S.rankSubject = b.dataset.rank; render(); });
  root.querySelectorAll('[data-rfilter]').forEach(b => b.onclick = () => { S.resultSubject = b.dataset.rfilter; render(); });
  root.querySelectorAll('[data-resume]').forEach(b => b.onclick = () => { const t = S.tests.find(x => x.id === b.dataset.resume); if (t) openExam(t, S.attempts[t.id], 0); });
  root.querySelectorAll('[data-free-pick]').forEach(b => b.onclick = openFreePicker);
  root.querySelectorAll('[data-packnote-x]').forEach(b => b.onclick = () => {
    try { localStorage.setItem(packNoteKey(), String(Date.now())); } catch (_) {}
    const note = b.closest('.mk-note'); if (!note) return;
    if (REDUCED.matches) return note.remove();
    note.style.height = note.offsetHeight + 'px'; note.classList.add('out');
    requestAnimationFrame(() => { note.style.height = '0px'; }); setTimeout(() => note.remove(), 260);
  });
  bindCustom(root);
  root.querySelectorAll('[data-refresh]').forEach(b => b.onclick = async () => { const done = busy(b, 'Refreshing'); await refresh(); done(); });
  const act = { edit: () => startOnboarding(true), signout: confirmSignOut };
  root.querySelectorAll('[data-act]').forEach(b => b.onclick = () => act[b.dataset.act] && act[b.dataset.act]());
  root.querySelectorAll('.chips-scroll .on').forEach(el => el.scrollIntoView({ block: 'nearest', inline: 'center' }));
}

// ═══ Views ═══
function pill(t, st) {
  switch (st.key) {
    case 'locked': return `<span class="pill lock">${ic('i-lock')}₹${priceOf(t)}${was(t)}</span>`;
    case 'ready': return st.why === 'free' && !['custom', 'package'].includes(kindOf(t)) ? '<span class="pill free">Free</span>' : `<span class="pill go">${ic('i-play')}Start</span>`;
    case 'started': return `<span class="pill warn">${ic('i-clock')}${st.left > 0 ? Math.ceil(st.left / 60000) + 'm left' : 'Upload'}</span>`;
    case 'review': return '<span class="pill wait">In review</span>';
    case 'scheduled': return `<span class="pill off">${ic('i-clock')}${esc(fmtShort(st.at))}</span>`;
    case 'checked': { const r = st.result; return r ? `<span class="pill done ${tone(pctOf(r))}">${r.score}/${r.totalMarks}</span>` : `<span class="pill done">${ic('i-check')}Checked</span>`; }
    default: return '<span class="pill off">Closed</span>';
  }
}
function emptyBlock(iconId, title, text, extra) {
  return `<div class="empty">${ic(iconId)}<b>${esc(title)}</b><p>${esc(text)}</p>${extra || ''}</div>`;
}

// Live "software checks → TNC teacher approves" card (Home). Same art as the sign-in screen.
function checkCard() {
  return `<div class="chk-card"><div class="chk-art">${(document.querySelector('#auth .chk-svg') || { outerHTML: '' }).outerHTML.replace(/chkBeam/g, 'chkBeamHome')}</div>
    <div class="chk-copy"><span class="eyebrow">How your paper is checked</span>
      <ol class="chk-steps"><li><b>You upload</b><small>Photos of your answer sheet</small></li><li><b>Software checks</b><small>Every answer, step by step</small></li><li><b>TNC teacher approves</b><small>Marks + feedback in 48 h</small></li></ol></div></div>`;
}
// Small Home notice about mock packs (Classes 9–12), until the student joins
// one or taps "Not now" (hidden for a week).
const packNoteKey = () => 'ntc-online:packnote:' + S.user.uid;
function packNotice() {
  if (!packsEligible() || ownedPacks().length) return '';
  const sale = S.packages.filter(p => p.active); if (!sale.length) return '';
  try { if (Date.now() - Number(localStorage.getItem(packNoteKey()) || 0) < 7 * 86400000) return ''; } catch (_) {}
  const subs = [...new Set(sale.map(p => p.subject))], from = Math.min(...sale.map(p => p.priceInr));
  return `<div class="mk-note" role="note"><a href="#/packs"><span class="mk-note-ic">${ic('i-calendar')}</span><span class="mk-note-txt"><b>Weekly mock packs are live</b><small>${esc(subs.slice(0, 3).join(', '))}${subs.length > 3 ? ' +' + (subs.length - 3) : ''} · from ₹${from}</small></span><span class="mk-note-go">View${ic('i-chev')}</span></a><button type="button" class="mk-note-x" data-packnote-x aria-label="Hide for now">${ic('i-x')}</button></div>`;
}
function viewHome() {
  const p = S.session.profile, ids = new Set(S.tests.map(t => t.id));
  const mine = Object.entries(S.attempts).filter(([id]) => ids.has(id)).map(([, a]) => a);
  const given = mine.filter(a => a.status !== 'started').length;
  const review = mine.filter(a => a.status && !['started', 'approved'].includes(a.status)).length;
  const list = subjects();
  const best = list.map(s => standing(s.name)).filter(s => s.rank).sort((a, b) => a.rank - b.rank)[0];
  const live = visibleTests().map(t => [t, stateOf(t)]).find(([, s]) => s.key === 'started');
  return `<section class="v v-home">
    <div class="hello">
      <div><p class="eyebrow">Class ${esc(p.class)}${p.board ? ' · ' + esc(p.board) : ''}</p><h2>${greeting()}, ${esc(firstName())}</h2></div>
      ${freeLeft() ? `<button type="button" class="plan" data-free-pick>${ic('i-gift')}${freeMocks(freeLeft())}</button>` : enrolled() ? `<span class="plan pro">${ic('i-shield')}TNC student</span>` : ''}
    </div>
    <div class="stats" role="list">
      <div role="listitem"><strong>${given}</strong><span>Tests given</span></div>
      <div role="listitem"><strong>${review}</strong><span>In review</span></div>
      <div role="listitem"><strong>${best ? '#' + best.rank : '—'}</strong><span>Best rank</span></div>
    </div>
    ${packNotice()}
    ${live ? `<button type="button" class="resume" data-resume="${esc(live[0].id)}"><span class="resume-ic">${ic('i-clock')}</span><span><b>${esc(live[0].testName)}</b><small>${live[1].left > 0 ? fmtTime(live[1].left).replace(/:\d\d$/, '') + ' left · tap to continue' : 'Time is up · upload your answers'}</small></span>${ic('i-chev', 'chev')}</button>` : ''}
    <div class="sec"><h3>Subjects</h3>${S.errors.tests ? '<button type="button" class="link" data-refresh>' + ic('i-refresh') + 'Retry</button>' : `<span>${list.length}</span>`}</div>
    ${list.length ? `<div class="subj-grid">${list.map(s => `<a class="subj" href="#/s/${encodeURIComponent(s.name)}" style="${tint(s.name)}">
        <span class="subj-ic">${subjIc(s.name)}</span>
        <span class="subj-txt"><b>${esc(s.name)}</b><small>${s.count ? (s.count - s.mocks ? plural(s.count - s.mocks, 'test') : '') + (s.count - s.mocks && s.mocks ? ' · ' : '') + (s.mocks ? plural(s.mocks, 'mock') : '') : 'Coming soon'}</small></span>
        <span class="subj-meter" aria-label="${s.done} of ${s.count} done"><i style="width:${s.count ? Math.round(s.done / s.count * 100) : 0}%"></i></span>
      </a>`).join('')}</div>` : emptyBlock('i-doc', 'Tests are on the way', 'TNC faculty are preparing papers for your class. Check back soon.')}
    ${/* One bottom slot so Home fits one phone screen: a mock that is open/next comes first, then the live
        "software checks → teacher approves" card until the first result, then the latest result.
        (The free mock is offered by the pill at the top; packs live in More.) */ ''}
    ${nextMock() ? nextMockCard(nextMock())
      : S.results[0] ? `<div class="sec"><h3>Latest result</h3><a class="link" href="#/results">See all</a></div>${resultRows(S.results.slice(0, 1))}`
      : checkCard()}
  </section>`;
}

function viewSubject(subject) {
  const tests = visibleTests().filter(t => t.subject === subject).sort(byOrder);
  const results = S.results.filter(r => r.subject === subject);
  const st = standing(subject), p = S.session.profile;
  const seg = ['chapter', 'mock', 'results'].includes(S.segment) ? S.segment : 'chapter';
  const chapters = tests.filter(t => kindOf(t) === 'chapter'), mocks = tests.filter(t => kindOf(t) === 'mock');
  const shown = seg === 'mock' ? mocks : chapters;
  const hint = seg === 'results' ? ''
    : tncFree(subject) ? `${subject} is one of your TNC subjects — every test here is free for you`
    : seg === 'mock' ? `₹${priceOf({ kind: 'mock' })} per full mock${listOf({ kind: 'mock' }) ? ` (regular ₹${listOf({ kind: 'mock' })})` : ''}${freeLeft() ? ` · ${freeMocks(freeLeft())} left — use on any subject` : ''}`
    : `₹${priceOf({ kind: 'chapter' })} per chapter test${listOf({ kind: 'chapter' }) ? ` (regular ₹${listOf({ kind: 'chapter' })})` : ''}`;
  const tncNote = enrolled() && seg !== 'results' && !tncFree(subject) ? `<p class="seg-hint tnc">${ic('i-shield')}Not one of your TNC subjects, so these tests are paid.</p>` : '';
  const rows = seg !== 'results'
    ? (shown.length ? `<ul class="rows">${shown.map((t, i) => { const s = stateOf(t), fresh = t.id === S.justUnlocked && s.key === 'ready'; return `<li><button type="button" class="row${fresh ? ' fresh' : ''}" data-test="${esc(t.id)}">
        <span class="row-ix">${fresh ? ic('i-unlock') : String(i + 1).padStart(2, '0')}</span>
        <span class="row-main"><b>${esc(t.testName)}</b><small>${fresh ? '<em>Unlocked · tap to start</em> · ' : ''}${esc(t.chapter)}${t.module && t.module !== 'Full chapter' ? ' · ' + esc(t.module) : ''} · ${t.totalMarks || '?'} marks · ${t.durationMin} min</small></span>
        ${pill(t, s)}</button></li>`; }).join('')}</ul>`
      : emptyBlock('i-doc', seg === 'mock' ? 'No full mocks yet' : 'No chapter tests yet', `${subject} ${seg === 'mock' ? 'full mock tests' : 'chapter-wise tests'} for Class ${p.class} will appear here.`))
    : (results.length ? resultRows(results) : emptyBlock('i-results', 'No checked scripts yet', 'Checked results arrive within 24 hours of submitting.'));
  return `<section class="v v-subject" style="${tint(subject)}">
    <div class="subj-head">
      <span class="subj-ic lg">${subjIc(subject)}</span>
      <div><h2>${esc(subject)}</h2><p>Class ${esc(p.class)} · ${plural(tests.length, 'test')}</p></div>
      <a class="rank-chip" href="#/ranks" data-rank-link="${esc(subject)}">${st.rank ? `<b>#${st.rank}</b><small>of ${st.of}</small>` : `${ic('i-trophy')}<small>Not ranked</small>`}</a>
    </div>
    <div class="seg three" role="tablist"><button type="button" role="tab" data-seg="chapter" aria-selected="${seg === 'chapter'}">Chapter-wise <i>${chapters.length}</i></button><button type="button" role="tab" data-seg="mock" aria-selected="${seg === 'mock'}">Full mocks <i>${mocks.length}</i></button><button type="button" role="tab" data-seg="results" aria-selected="${seg === 'results'}">Results <i>${results.length}</i></button></div>
    ${hint ? `<p class="seg-hint">${esc(hint)}</p>` : ''}${tncNote}
    ${rows}
  </section>`;
}
document.addEventListener('click', e => { const a = e.target.closest && e.target.closest('[data-rank-link]'); if (a) S.rankSubject = a.dataset.rankLink; });

function resultRows(list) {
  return `<ul class="rows">${list.map(r => { const pct = pctOf(r); return `<li><button type="button" class="row" data-result="${esc(r.id)}">
    <span class="row-score ${tone(pct)}">${pct == null ? '—' : pct + '%'}</span>
    <span class="row-main"><b>${esc(r.testName)}</b><small>${esc(r.subject)} · ${esc(r.chapter)}${r.approvedAt ? ' · ' + fmtDate(r.approvedAt) : ''}</small></span>
    <span class="pill done ${tone(pct)}">${Number.isFinite(r.score) ? r.score : '—'}/${r.totalMarks}</span></button></li>`; }).join('')}</ul>`;
}

function viewRanks() {
  const names = [...new Set([...subjects().filter(s => s.count).map(s => s.name), ...Object.keys(S.boards).filter(boardOk)])];
  if (!names.length) return `<section class="v">${emptyBlock('i-trophy', 'Leaderboard opens soon', 'Take a test — once it is checked you join the all-India ranking for your class.')}</section>`;
  if (!names.includes(S.rankSubject)) S.rankSubject = names.find(n => S.boards[n]) || names[0];
  const subject = S.rankSubject, st = standing(subject), b = st.board, cls = S.session.profile.class;
  const top = (b && b.top) || [];
  const slot = (n, cls2) => { const x = top.find(t => t.rank === n) || top[n - 1]; return `<li class="pod ${cls2}"><span class="medal">${n}</span><b>${x ? esc(x.name) : '—'}</b><small>${x && (x.city || x.state) ? esc(x.city || x.state) : x ? 'India' : 'Open spot'}</small><i></i></li>`; };
  return `<section class="v v-ranks" style="${tint(subject)}">
    <div class="chips-scroll" role="tablist">${names.map(n => `<button type="button" role="tab" class="chip-btn${n === subject ? ' on' : ''}" data-rank="${esc(n)}" aria-selected="${n === subject}">${subjIc(n)}${esc(n)}</button>`).join('')}</div>
    <div class="rank-card">
      <div class="rank-me">
        <span class="eyebrow">Your rank · Class ${esc(cls)}</span>
        <strong>${st.rank ? '#' + st.rank : '—'}</strong>
        <small>${b && b.count ? `of ${plural(b.count, 'student')} across India` : 'No one ranked yet'}</small>
        <span class="rank-avg">${st.avg != null ? `Your average <b>${Math.round(st.avg)}%</b> · ${plural(st.tests, 'test')}` : `Take a ${esc(subject)} test to get ranked`}</span>
      </div>
      <ol class="podium" aria-label="Top three in ${esc(subject)}">${slot(2, 'p2')}${slot(1, 'p1')}${slot(3, 'p3')}</ol>
    </div>
    <p class="fine center">Ranked by average marks across checked tests in ${esc(subject)}${b && b.updatedAt ? ' · updated ' + fmtDate(b.updatedAt) : ''}.</p>
  </section>`;
}

function viewResults() {
  const pending = visibleTests().filter(t => stateOf(t).key === 'review');
  const subs = [...new Set(S.results.map(r => r.subject))];
  if (S.resultSubject && !subs.includes(S.resultSubject)) S.resultSubject = '';
  const list = S.results.filter(r => !S.resultSubject || r.subject === S.resultSubject);
  return `<section class="v v-results">
    ${S.errors.results ? `<div class="banner err">${esc(S.errors.results)} <button type="button" class="link" data-refresh>Retry</button></div>` : ''}
    ${pending.length ? `<div class="sec"><h3>Being checked</h3><span>${pending.length}</span></div><ul class="rows">${pending.map(t => `<li><button type="button" class="row" data-test="${esc(t.id)}"><span class="row-score wait">${ic('i-clock')}</span><span class="row-main"><b>${esc(t.testName)}</b><small>${esc(t.subject)} · results within 24 hours</small></span><span class="pill wait">In review</span></button></li>`).join('')}</ul>` : ''}
    <div class="sec"><h3>Checked</h3><span>${S.results.length}</span></div>
    ${subs.length > 1 ? `<div class="chips-scroll"><button type="button" class="chip-btn${!S.resultSubject ? ' on' : ''}" data-rfilter="">All</button>${subs.map(s => `<button type="button" class="chip-btn${s === S.resultSubject ? ' on' : ''}" data-rfilter="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
    ${list.length ? resultRows(list) : emptyBlock('i-results', 'No checked scripts yet', 'Submit a test and your checked answer script appears here within 24 hours.')}
  </section>`;
}

function viewProfile() {
  const p = S.session.profile;
  const row = (k, v) => v ? `<div class="kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>` : '';
  const groups = [
    ['Personal', [['Date of birth', p.dob ? new Date(p.dob + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''], ['Gender', p.gender], ['Mobile', p.phone], ['Email', p.email]]],
    ['Studies', [['Class', p.class ? 'Class ' + p.class : ''], ['Board', p.board], ['School', p.school], ['Subjects', (p.subjects || []).join(', ')], ['Preparing for', p.target]]],
    ['Address', [['Address', p.address], ['City', p.city], ['State', p.state], ['PIN code', p.pincode]]],
    ['Parent / guardian', [['Name', p.guardianName], ['Relation', p.guardianRelation], ['Mobile', p.guardianPhone], ['Email', p.guardianEmail]]]
  ].map(([title, rows]) => [title, rows.map(([k, v]) => row(k, v)).join('')]).filter(([, html]) => html);
  const missing = enrolled() && !p.guardianPhone, later = !enrolled() && p.detailsComplete === false;
  return `<section class="v v-me">
    <div class="me-card">
      <span class="avatar lg">${esc(initials(p.name))}</span>
      <div><h2>${esc(p.name || 'Student')}</h2><p>${esc(p.onlineId || p.studentId || '')}</p></div>
      <span class="plan${enrolled() ? ' pro' : ''}">${enrolled() ? ic('i-shield') + 'TNC student' : ic('i-spark') + 'Online'}</span>
    </div>
    ${missing ? `<button type="button" class="banner info" data-act="edit">${ic('i-edit')}<span>Add your address and guardian details</span>${ic('i-chev', 'chev')}</button>` : ''}
    ${later ? `<button type="button" class="banner info" data-act="edit">${ic('i-edit')}<span><b>Complete your profile</b><small>Date of birth, school, address and guardian details — needed for certificates</small></span>${ic('i-chev', 'chev')}</button>` : ''}
    <div class="groups">${groups.map(([title, html], i) => `<details class="group"${i === 0 ? ' open' : ''}><summary>${esc(title)}${ic('i-down', 'chev')}</summary><div class="kvs">${html}</div></details>`).join('')}</div>
    <div class="menu">
      <button type="button" data-act="edit">${ic('i-edit')}<span>Edit details</span>${ic('i-chev', 'chev')}</button>
      <a href="${WA}" target="_blank" rel="noopener">${ic('i-chat')}<span>Help on WhatsApp</span>${ic('i-chev', 'chev')}</a>
      <a href="/">${ic('i-home')}<span>TNC home page</span>${ic('i-chev', 'chev')}</a>
      <button type="button" class="danger" data-act="signout">${ic('i-out')}<span>Sign out</span></button>
    </div>
    <p class="fine center">${esc(p.email || '')}</p>
  </section>`;
}
function confirmSignOut() {
  openSheet(`<div class="sh-head"><h2 id="sheetTitle">Sign out?</h2><p>Your tests, results and rank stay saved.</p></div>
    <div class="sh-actions"><button type="button" class="btn ghost" data-x>Cancel</button><button type="button" class="btn danger" data-out>Sign out</button></div>`,
  root => { root.querySelector('[data-x]').onclick = () => closeSheet(); root.querySelector('[data-out]').onclick = () => closeSheet(() => signOutNow()); });
}

// ═══ Test sheet: details, unlock, start ═══
function testHead(t) {
  return `<div class="sh-head" style="${tint(t.subject)}"><span class="sh-kicker">${subjIc(t.subject)}${esc(t.subject)} · ${esc(t.chapter)}</span><h2 id="sheetTitle">${esc(t.testName)}</h2>
    <div class="facts"><span class="kind">${kindOf(t) === 'mock' ? 'Full mock' : kindOf(t) === 'custom' ? (t.full ? 'Custom full mock' : 'Custom module') : kindOf(t) === 'package' ? 'Pack mock' + (/^Mock [0-9]/.test(t.module) ? ' · ' + esc(t.module.slice(5)) : '') : 'Chapter-wise'}</span><span>${ic('i-doc')}${t.totalMarks || '?'} marks</span><span>${ic('i-clock')}${t.durationMin} min</span>${t.module && t.module !== 'Full chapter' && kindOf(t) !== 'custom' ? `<span>${esc(t.module)}</span>` : ''}${t.isFree ? '<span class="free">Free test</span>' : ''}</div></div>`;
}
function openTest(id, mode) {
  const t = S.tests.find(x => x.id === id);
  if (!t) return;
  if (S.promo && S.promo.target !== id) S.promo = null;
  const st = stateOf(t);
  let body = '';
  if (mode === 'free-confirm') body = `<div class="free-confirm">${ic('i-gift')}<p><b>Use a free mock on ${esc(t.subject)}?</b> You have ${freeMocks(freeLeft())} left. Once used it can't be moved to another test or subject.</p></div>
    <div class="sh-actions"><button type="button" class="btn ghost" data-go="back">Not now</button><button type="button" class="btn primary" data-go="claim">Use free mock</button></div>`;
  else if (mode === 'unlocked') body = `<div class="celebrate">${ic('i-unlock')}<b>Test unlocked</b><p>It's yours. Start whenever you're ready — the timer begins only when you open the paper.</p></div>
    <button type="button" class="btn primary block" data-go="confirm">${ic('i-play')}Start test</button>`;
  else if (st.key === 'locked') { const promo = S.promo && S.promo.target === t.id;
    body = `${kindOf(t) === 'mock' && freeLeft() ? `<button type="button" class="free-card" data-go="free-confirm"><span class="free-ic">${ic('i-gift')}</span><span><b>Use a free mock here</b><small>${freeMocks(freeLeft())} left · any subject</small></span>${ic('i-chev', 'chev')}</button>` : ''}
    ${coPrice(promo ? 0 : priceOf(t), promo ? priceOf(t) : listOf(t), 'One-time · this test only')}
    ${coMore('What you get', `<ul class="co-list"><li>${ic('i-check')}Question paper with a fair timer</li><li>${ic('i-check')}Checked script &amp; marks within 24 hours</li><li>${ic('i-check')}Counts towards your all-India rank</li><li>${ic('i-check')}${t.totalMarks || '?'} marks · ${t.durationMin} min</li></ul>`)}
    ${promoBox(t.id, !S.session.paymentsReady)}
    ${promo ? coBar(0, `<button type="button" class="btn primary" data-go="promo-redeem">${ic('i-unlock')}Unlock for ₹0</button>`, false)
      : S.session.paymentsReady ? coBar(priceOf(t), `<button type="button" class="btn primary pay" data-go="pay">${ic('i-lock')}Unlock now</button>`, true)
      : contactCard(`"${t.testName}" (${t.subject})`)}`; }
  else if (st.key === 'ready' && mode === 'confirm') body = `<div class="warn-box">${ic('i-clock')}<p><b>Your ${t.durationMin}-minute timer starts as soon as the paper opens.</b> It can't be paused. Keep pen, paper and your phone camera ready.</p></div>
    <div class="sh-actions"><button type="button" class="btn ghost" data-go="back">Not now</button><button type="button" class="btn primary" data-go="start">Start now</button></div>`;
  else if (st.key === 'ready') body = `${kindOf(t) === 'custom' && t.module ? `<p class="instr"><b>Chapters:</b> ${esc(t.module)}</p>` : ''}${t.instructions ? `<p class="instr">${esc(t.instructions)}</p>` : ''}<ol class="how"><li>${ic('i-download')}<b>Download</b><small>Timer starts</small></li><li>${ic('i-pen')}<b>Write</b><small>On paper</small></li><li>${ic('i-camera')}<b>Upload</b><small>PDF or photos</small></li></ol>
    <button type="button" class="btn primary block" data-go="confirm">${ic('i-play')}Start test</button><p class="fine center">Software-checked · approved by a TNC teacher · results within 24 hours</p>`;
  else if (st.key === 'started') body = `<div class="warn-box">${ic('i-clock')}<p>${st.left > 0 ? `<b>${fmtTime(st.left).replace(/:\d\d$/, '')} left.</b> Your timer kept running while you were away.` : `<b>Time's up.</b> Upload your answers now${st.late ? ' — it will be marked late' : ''}.`}</p></div>
    <button type="button" class="btn primary block" data-go="resume">${st.left > 0 ? 'Continue test' : 'Upload answers'}</button>`;
  else if (st.key === 'scheduled') body = `<div class="warn-box">${ic('i-clock')}<p><b>This mock opens on ${esc(fmtWhen(st.at))}.</b> Come back then — the paper and your timer start only when you open it.</p></div>`;
  else if (st.key === 'review') { const a = S.attempts[t.id]; body = `<ol class="track"><li class="done">${ic('i-check')}<b>Submitted</b><small>${a.submittedAt ? fmtDate(a.submittedAt) : 'Received'}</small></li><li class="now">${ic('i-pen')}<b>Being checked</b><small>Software check, then a TNC teacher approves</small></li><li>${ic('i-results')}<b>Result</b><small>Within 24 hours</small></li></ol>${keyButton(t)}`; }
  else if (st.key === 'checked') { const r = st.result; body = r ? resultBody(r) : '<p class="instr">Your checked script is ready. Refresh to see it.</p>' + keyButton(t); }
  else body = '<p class="instr">This test is closed.</p>';
  openSheet(testHead(t) + body, root => {
    const go = root.querySelectorAll('[data-go]');
    go.forEach(b => b.onclick = () => {
      const a = b.dataset.go;
      if (a === 'confirm') openTest(t.id, 'confirm');
      else if (a === 'back') openTest(t.id);
      else if (a === 'start') startTest(t, b);
      else if (a === 'resume') closeSheet(() => openExam(t, S.attempts[t.id], 0));
      else if (a === 'pay') unlock(t, b);
      else if (a === 'free-confirm') openTest(t.id, 'free-confirm');
      else if (a === 'claim') claimFree(t, b);
      else if (a === 'promo-redeem') redeemPromo(t, b);
      else if (a === 'key') downloadKey(t, b);
    });
    if (st.key === 'locked') { bindPromo(root, t.id, { testId: t.id }, () => openTest(t.id)); if (S.session.paymentsReady) loadRazorpay().catch(() => {}); }
  });
}
// After submitting, the answer key (when the team shared one) — the server
// checks the submission before handing it out.
const keyPending = () => `<div class="key-card wait">${ic('i-clock')}<span><b>Answer key</b><small>It will be shared here soon — check back later</small></span></div>`;
const keyButton = t => t.hasAnswerKey ? `<div class="key-card">${ic('i-doc')}<span><b>Answer key</b><small>Check your answers now</small></span><button type="button" class="btn sm ghost" data-go="key">${ic('i-download')}Download</button></div>` : keyPending();
async function downloadKey(t, btn) {
  const done = busy(btn, 'Opening answer key…');
  try {
    const r = await fn('offline-test', { action: 'answer-key', testId: t.id });
    const url = NTCUploadcare.deliveryUrl(r.answerPdfUrl);
    try { await NTCOfflineFiles.downloadPdf(url, t.testName + '_answer_key.pdf'); } catch (_) { window.open(url, '_blank', 'noopener'); }
  } catch (e) { toast(e.message, 'err'); }
  finally { done(); }
}
function resultBody(r) {
  const pct = pctOf(r);
  return `<div class="score ${tone(pct)}"><div class="ring" style="--p:${pct || 0}"><b>${Number.isFinite(r.score) ? r.score : '—'}</b><small>of ${r.totalMarks}</small></div>
    <div><b>${pct == null ? '' : pct + '%'}</b><small>Approved by a TNC teacher${r.approvedAt ? ' · ' + fmtDate(r.approvedAt) : ''}</small></div></div>
    ${r.remark && !/^Offline Test Series|^Checked by TNC faculty$/.test(r.remark) ? `<div class="feedback"><span class="eyebrow">Feedback from TNC faculty</span><p>${esc(r.remark)}</p></div>` : ''}
    ${resultActions(r)}${(() => { const t = S.tests.find(x => x.id === r.testId); return t && !t.hasAnswerKey ? keyPending() : ''; })()}
    <p class="fine center">Saved permanently in your results.</p>`;
}
// Small side-by-side actions: checked script, and the answer key when one was shared.
function resultActions(r) {
  const t = S.tests.find(x => x.id === r.testId), key = t && t.hasAnswerKey;
  if (!r.pdf && !key) return '';
  return `<div class="sh-acts">${r.pdf ? `<a class="btn sm primary" href="${esc(r.pdf)}" target="_blank" rel="noopener noreferrer" download>${ic('i-download')}Checked script</a>` : ''}${key ? `<button type="button" class="btn sm ghost" data-key-test="${esc(t.id)}">${ic('i-doc')}Answer key</button>` : ''}</div>`;
}
function openResult(id) {
  const r = S.results.find(x => x.id === id);
  if (!r) return;
  openSheet(`<div class="sh-head" style="${tint(r.subject)}"><span class="sh-kicker">${subjIc(r.subject)}${esc(r.subject)} · ${esc(r.chapter)}</span><h2 id="sheetTitle">${esc(r.testName)}</h2></div>` + resultBody(r));
}
// Answer key buttons inside result sheets (wherever the sheet was opened from).
$('sheetBody').addEventListener('click', e => {
  const b = e.target.closest('[data-key-test]'); if (!b) return;
  const t = S.tests.find(x => x.id === b.dataset.keyTest); if (t) downloadKey(t, b);
});

// ═══ Free mock: pick a subject ═══
function openFreePicker() {
  const list = freeChoices(), seen = new Set();
  const order = s => { const i = P.SUBJECTS.indexOf(s); return i < 0 ? 99 : i; };
  const firstPerSubject = list.filter(t => !seen.has(t.subject) && seen.add(t.subject)).sort((a, b) => order(a.subject) - order(b.subject));
  openSheet(`<div class="sh-head"><span class="sh-kicker">${ic('i-gift')}${freeMocks(freeLeft())} left</span><h2 id="sheetTitle">Choose a subject</h2><p>Pick the subject for your free full mock test. Each free mock can be used once.</p></div>
    ${firstPerSubject.length ? `<ul class="rows">${firstPerSubject.map(t => `<li><button type="button" class="row" data-pick="${esc(t.id)}" style="${tint(t.subject)}"><span class="subj-ic">${subjIc(t.subject)}</span><span class="row-main"><b>${esc(t.subject)}</b><small>${esc(t.testName)} · ${t.totalMarks || '?'} marks · ${t.durationMin} min</small></span>${ic('i-chev', 'chev')}</button></li>`).join('')}</ul>`
      : emptyBlock('i-doc', 'No full mocks yet', 'Full mock tests for your class are on the way. Your free mock will be waiting.')}`,
  root => root.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => openTest(b.dataset.pick, 'free-confirm')));
}
async function claimFree(t, btn) {
  const done = busy(btn, 'Unlocking…');
  try {
    const r = await fn('online-series', { action: 'claim-free', testId: t.id });
    S.session.unlocked = [...new Set([...(S.session.unlocked || []), t.id])];
    S.session.freeMock = r.freeMock;
    saveCache(); haptic(30);
    returnToTest(t, 'Free mock unlocked');
  } catch (e) {
    done();
    if (e.data && (e.data.freeUsed || e.data.unlocked)) { await refresh(); openTest(t.id); }
    toast(e.message, 'err');
  }
}

// ── Promo codes (100% off one purchase) and the contact card shown until
// online payment is switched on. S.promo = { target, code } for the open sheet.
const CONTACT = { tel: '+919903461361', show: '+91 99034 61361' };
function promoBox(target, open) {
  const applied = S.promo && S.promo.target === target ? S.promo.code : '';
  if (applied) return `<div class="promo ok">${ic('i-check')}<span><b>${esc(applied)}</b> applied · this costs ₹0</span><button type="button" class="link" data-promo-remove>Remove</button></div>`;
  return `<details class="promo-box"${open ? ' open' : ''}><summary>${ic('i-spark')}Have a promo code?</summary>
    <div class="promo-row"><input id="promoInput" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="20" placeholder="Enter code" aria-label="Promo code"><button type="button" class="btn ghost" data-promo-apply>Apply</button></div>
    <p class="promo-msg" id="promoMsg" role="status"></p></details>`;
}
function contactCard(what) {
  const p = S.session.profile, text = `Hi, I'd like to buy ${what} on the Online Test Series (Class ${p.class}). My ID: ${p.onlineId || ''}`;
  return `<div class="contact-card"><b>Online payment opens soon</b><span>To buy now, call or WhatsApp us — we'll send you a code that unlocks it.</span>
    <div class="contact-act"><a class="btn ghost" href="tel:${CONTACT.tel}">${ic('i-phone')}${CONTACT.show}</a><a class="btn primary" href="${WA}?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">${ic('i-chat')}WhatsApp</a></div></div>`;
}
// Apply / remove a code in an open sheet; `check` is the server request body.
function bindPromo(root, target, check, rerender) {
  const apply = root.querySelector('[data-promo-apply]'), input = root.querySelector('#promoInput');
  if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); apply.click(); } });
  if (apply) apply.onclick = async () => {
    const code = input.value.trim().toUpperCase(), msg = root.querySelector('#promoMsg');
    if (!code) { msg.className = 'promo-msg bad'; msg.textContent = 'Enter your promo code.'; return input.focus(); }
    const done = busy(apply, 'Checking');
    try {
      const r = await fn('online-series', { action: 'check-promo', code, ...check });
      S.promo = { target, code: r.code, limits: r.limits || {} }; haptic(20); rerender();
    } catch (e) { done(); msg.className = 'promo-msg bad'; msg.textContent = e.message; }
  };
  const remove = root.querySelector('[data-promo-remove]');
  if (remove) remove.onclick = () => { S.promo = null; rerender(); };
}
async function redeemPromo(t, btn) {
  const done = busy(btn, 'Unlocking…');
  try {
    await fn('online-series', { action: 'redeem-promo', code: S.promo.code, testId: t.id });
    S.promo = null; markUnlocked(t); haptic(30);
    returnToTest(t, 'Promo applied — test unlocked');
  } catch (e) {
    done();
    if (e.data && e.data.unlocked) { S.promo = null; markUnlocked(t); return returnToTest(t, 'This test is already unlocked.'); }
    toast(e.message, 'err');
  }
}

// ── Checkout pieces: everything fits one screen; extra info sits behind "Details". ──
// Price summary: big price, the regular price struck through, the saving.
function coPrice(price, was, note) {
  return `<div class="price co-price"><div class="price-top"><b>₹${price}</b>${was > price ? `<s>₹${was}</s><span class="save">${price ? 'Save ₹' + (was - price) : 'Free with code'}</span>` : ''}</div><small class="co-note">${esc(note)}</small></div>`;
}
// A one-line row that opens to show more ("Details").
const coMore = (title, html) => `<details class="co-more"><summary>${ic('i-doc')}<span>${esc(title)}</span><em>Details</em>${ic('i-down', 'chev')}</summary><div class="co-more-body">${html}</div></details>`;
// Pay bar: total on the left, the button on the right, one line of trust below.
function coBar(total, button, paid, sub) {
  return `<div class="co-bar"><div class="co-total"><small>${sub ? esc(sub) : 'Total'}</small><b>₹${total}</b></div>${button}</div>
    ${paid ? `<p class="co-trust">${ic('i-shield')}<span>Secure payment by Razorpay · UPI, cards, net banking</span></p>${noRefund()}` : ''}`;
}
// Shown with every Pay button: a successful payment is not refunded.
const noRefund = () => `<p class="no-refund">${ic('i-shield')}<span><b>Non-refundable.</b> Once paid, the amount is not refunded or exchanged.</span></p>`;

// ═══ Payments (Razorpay Checkout) ═══
let razorpayLoader = null;
function loadRazorpay() {
  return razorpayLoader || (razorpayLoader = new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.async = true;
    s.onload = resolve; s.onerror = () => { razorpayLoader = null; reject(new Error('Could not open the payment window. Check your internet and try again.')); };
    document.head.appendChild(s);
  }));
}
async function unlock(t, btn) {
  const done = busy(btn, 'Opening payment…');
  try {
    const [order] = await Promise.all([fn('online-series', { action: 'create-order', testId: t.id }), loadRazorpay()]);
    const rz = new window.Razorpay({
      key: order.keyId, amount: order.amountPaise, currency: 'INR', order_id: order.orderId,
      name: 'The NewTown Classes', description: (order.testName || t.testName) + ' · Non-refundable', prefill: order.prefill || {},
      notes: { testId: t.id }, image: location.origin + '/assets/img/logo-mark.png', theme: { color: '#0b2a6b', backdrop_color: 'rgba(7, 18, 40, 0.72)' }, retry: { enabled: true, max_count: 3 },
      modal: { ondismiss: () => { S.checkoutOpen = false; clearPending(); done(); }, escape: true, backdropclose: false },
      handler: resp => { S.checkoutOpen = false; confirmPayment(t, resp); }
    });
    rz.on('payment.failed', r => toast((r && r.error && r.error.description) || 'Payment failed. No money was taken — please try again.', 'err'));
    // If the phone reloads the page during a UPI payment, this brings the
    // student back to the same test once the server confirms it.
    setPending({ orderId: order.orderId, testId: t.id });
    S.checkoutOpen = true;
    rz.open();
  } catch (e) {
    done();
    if (e.data && e.data.unlocked) { markUnlocked(t); return returnToTest(t, 'This test is already unlocked.'); }
    toast(e.message, 'err');
  }
}
const markUnlocked = t => { S.session.unlocked = [...new Set([...(S.session.unlocked || []), t.id])]; saveCache(); };
const pendKey = () => 'ntc-online:pending-pay:' + S.user.uid;
function setPending(p) { try { localStorage.setItem(pendKey(), JSON.stringify({ ...p, at: Date.now() })); } catch (_) {} }
function getPending() { try { return JSON.parse(localStorage.getItem(pendKey()) || 'null'); } catch (_) { return null; } }
function clearPending() { try { localStorage.removeItem(pendKey()); } catch (_) {} }

// Back to the subject's list with the unlocked test highlighted; tapping it
// shows the timer warning and "Start now" opens the exam.
function returnToTest(t, message) {
  S.justUnlocked = t.id;
  const go = () => {
    if (S.exam) return;
    const hash = '#/s/' + encodeURIComponent(t.subject);
    S.forceSegment = kindOf(t);
    if (location.hash === hash) { S.view = ''; render(); } else location.hash = hash;
    if (message) toast(message);
    setTimeout(() => { const row = document.querySelector(`.row.fresh`); if (row) row.scrollIntoView({ block: 'center', behavior: REDUCED.matches ? 'auto' : 'smooth' }); }, 150);
    clearTimeout(S.freshTimer);
    S.freshTimer = setTimeout(() => { S.justUnlocked = ''; if (route().name === 'subject' && $('sheet').hidden && !S.exam) render(); }, 60000);
  };
  if (!$('sheet').hidden) closeSheet(go); else go();
}

// After a reload: finish a payment that was in progress.
let pendingBusy = false;
async function resumePendingPayment() {
  const p = getPending();
  if (!p || pendingBusy || S.checkoutOpen || !S.session || S.exam) return;
  if (p.module) return resumeModulePayment(p);
  if (p.packageId) return resumePackPayment(p);
  const t = S.tests.find(x => x.id === p.testId);
  if (t && (S.session.unlocked || []).includes(p.testId)) { clearPending(); return returnToTest(t, 'Payment successful — test unlocked'); }
  if (!t || Date.now() - p.at > 15 * 60000) return clearPending();
  pendingBusy = true;
  toast('Confirming your payment…');
  try {
    for (let i = 0; i < 4; i++) {
      await sleep(2500);
      try {
        const s = await fn('online-series', { action: 'session' });
        S.session.unlocked = s.unlocked;
        if (s.unlocked.includes(t.id)) { clearPending(); saveCache(); return returnToTest(t, 'Payment successful — test unlocked'); }
      } catch (_) {}
    }
    toast('Payment not confirmed yet. If money was deducted, the test unlocks automatically within a few minutes.', 'err');
  } finally { pendingBusy = false; }
}
// Animated check drawn once (no loop) for a finished payment.
const successMark = () => '<svg class="ok-mark" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg>';
async function confirmPayment(t, resp) {
  openSheet(testHead(t) + '<div class="celebrate wait"><span class="pay-loader" aria-hidden="true"></span><b>Confirming your payment…</b><p>Secured by Razorpay · please keep this screen open.</p></div>');
  let unlocked = false;
  try {
    await fn('online-series', { action: 'verify-payment', orderId: resp.razorpay_order_id, paymentId: resp.razorpay_payment_id, signature: resp.razorpay_signature });
    unlocked = true;
  } catch (_) {
    // Razorpay also tells our server directly (webhook); give it a moment.
    for (let i = 0; i < 5 && !unlocked; i++) {
      await sleep(2500);
      try { const s = await fn('online-series', { action: 'session' }); S.session.unlocked = s.unlocked; unlocked = s.unlocked.includes(t.id); } catch (_) {}
    }
  }
  if (unlocked) {
    clearPending(); markUnlocked(t); haptic(30);
    openSheet(testHead(t) + `<div class="celebrate ok">${successMark()}<b>Payment successful</b><p>${esc(t.testName)} is unlocked. Taking you there…</p></div>`);
    await sleep(REDUCED.matches ? 300 : 1200);
    returnToTest(t, 'Payment successful — test unlocked');
  } else {
    openSheet(testHead(t) + `<div class="celebrate err">${ic('i-shield')}<b>We're still confirming your payment</b><p>If money was deducted, the test unlocks automatically within a few minutes. If the payment did not go through, your bank returns any amount it held. Payment ID: <code>${esc(resp.razorpay_payment_id)}</code></p></div>
      <div class="sh-actions"><a class="btn ghost" href="${WA}?text=${encodeURIComponent('Payment help: ' + resp.razorpay_payment_id)}" target="_blank" rel="noopener">WhatsApp us</a><button type="button" class="btn primary" data-check>Check again</button></div>`,
    root => { root.querySelector('[data-check]').onclick = async () => { await refresh(); if ((S.session.unlocked || []).includes(t.id)) { clearPending(); returnToTest(t, 'Payment successful — test unlocked'); } else toast('Not confirmed yet. Please try again in a minute.'); }; });
  }
}

// ═══ Custom module test (Classes 7–12) ═══
// Pick chapters (CBSE or ICSE / ISC) → cart → pay → one paper per subject,
// made by the team within a day → appears under My tests to start.
const moduleEligible = () => !!(S.session && P.MODULE.classes.includes(String(S.session.profile.class)));
// Mock packs: Classes 9–12 only (Classes 7–8 don't see them anywhere).
const packsEligible = () => !!(S.session && P.PACK_CLASSES.includes(String(S.session.profile.class)));
const cartKey = () => 'ntc-online:cart:' + S.user.uid;
const fmtWhen = v => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); };
function cust() {
  if (!S.cust) {
    let saved = {}; try { saved = JSON.parse(localStorage.getItem(cartKey()) || '{}'); } catch (_) {}
    S.cust = { board: NTCSyllabus.boardFor(S.session.profile.board), subject: '', seg: 'build', carts: { CBSE: saved.CBSE || {}, CISCE: saved.CISCE || {} } };
  }
  // CBSE students build from the CBSE syllabus only, ICSE students from ICSE / ISC only.
  const own = P.customBoard(S.session.profile.board); if (own) S.cust.board = own;
  return S.cust;
}
function saveCart() { try { localStorage.setItem(cartKey(), JSON.stringify(S.cust.carts)); } catch (_) {} }
function cartItems(board) {
  const picked = S.cust.carts[board] || {};
  return NTCSyllabus.subjects(board, S.session.profile.class)
    .map(s => { const chapters = s.chapters.filter(c => (picked[s.subject] || []).includes(c)); return { subject: s.subject, chapters, full: P.isFullMock(chapters.length, s.chapters.length), tnc: tncFree(s.subject) }; })
    .filter(i => i.chapters.length);
}
const cartCount = board => cartItems(board).reduce((n, i) => n + i.chapters.length, 0);
// Subjects in the cart with too few chapters for a paper (minimum 2 each).
const cartShort = board => cartItems(board).filter(i => i.chapters.length < P.MODULE.minPerPaper);
const shortMsg = list => `Add ${list.map(i => `${P.MODULE.minPerPaper - i.chapters.length} more ${i.subject}`).join(', ')} chapter${list.length === 1 && P.MODULE.minPerPaper - list[0].chapters.length === 1 ? '' : 's'} · min ${P.MODULE.minPerPaper} per paper`;
// Cart bill: subjects with every chapter picked are Custom full mocks at a flat
// price; all other chapters are priced together (₹199 × 4, then ₹150).
function cartBill(board) {
  const M = P.MODULE, items = cartItems(board), c = P.cartPrice(items.map(i => ({ count: i.chapters.length, full: i.full, tnc: i.tnc })));
  const first = Math.min(c.chapters, M.firstCount), rest = c.chapters - first;
  return { ...c, first, rest, total: c.totalInr, save: (c.chapters * M.first - c.chapterInr) + (c.fullListInr - c.fullInr), full: items.filter(i => i.full && !i.tnc), tnc: items.filter(i => i.tnc) };
}
// Banner under the chapter list: this subject is (or can become) a Custom full mock.
function fullMockNote(c) {
  const list = NTCSyllabus.chapters(c.board, S.session.profile.class, c.subject), picked = (c.carts[c.board][c.subject] || []).length, M = P.MODULE;
  const listInr = P.modulePrice(list.length);
  if (!(listInr > M.fullMock)) return '';
  const price = tncFree(c.subject) ? '<b>Free</b>' : `<b>₹${M.fullMock}</b><s>₹${listInr}</s>`;
  return picked === list.length
    ? `<div class="fm-note on">${ic('i-check')}<span><b>Custom full mock</b> · all ${list.length} ${esc(c.subject)} chapters</span><span class="fm-price">${price}</span></div>`
    : `<div class="fm-note">${ic('i-spark')}<span>Pick all ${list.length} chapters for a <b>Custom full mock</b></span><span class="fm-price">${price}</span></div>`;
}

// ═══ Test packs: weekly mock packs + custom tests + what the student owns ═══
const fmtShort = v => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); };
const fmtDay = v => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); };
const ownsPack = id => (S.session && (S.session.unlocked || []).includes('pkg_' + id));
const ownedPacks = () => S.packages.filter(p => ownsPack(p.id));
const packWhen = (p, short) => { const d = new Date(p.schedule[0] || ''); return Number.isNaN(d.getTime()) ? '' : `Every ${d.toLocaleDateString('en-IN', { weekday: short ? 'short' : 'long' })} · ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`; };
function packSlots(p) {
  const tests = S.tests.filter(t => kindOf(t) === 'package' && t.packageId === p.id);
  return p.schedule.map((at, i) => {
    const t = tests.find(x => x.slot === i + 1), opensAt = (t && t.releaseAt) || at, open = Date.parse(opensAt) <= now();
    const st = t ? stateOf(t) : null;
    return { n: i + 1, at: opensAt, t, st, key: t && open ? 'open' : !t && open ? 'prep' : 'soon', done: !!(st && ['review', 'checked'].includes(st.key)) };
  });
}
function nextMock() {
  let best = null;
  ownedPacks().forEach(p => packSlots(p).forEach(s => {
    if (s.done) return;
    const startable = s.key === 'open' && ['ready', 'started'].includes(s.st && s.st.key);
    if (!startable && s.key !== 'soon') return;
    const score = startable ? 0 : Date.parse(s.at);
    if (!best || score < best.score) best = { p, s, score };
  }));
  return best;
}
function nextMockCard(nm) {
  const { p, s } = nm, open = s.key === 'open';
  return `<button type="button" class="free-card next-mock" data-pack="${esc(p.id)}" style="${tint(p.subject)}"><span class="free-ic">${ic(open ? 'i-play' : 'i-clock')}</span>
    <span><b>${open ? 'Mock ready' : 'Next mock'} · ${esc(p.subject)} ${s.n}/${p.schedule.length}</b><small>${open ? 'Open now — start any time' : 'Opens ' + esc(fmtShort(s.at))}</small></span>${ic('i-chev', 'chev')}</button>`;
}
function packPill(s) {
  if (s.key === 'open') return pill(s.t, s.st);
  if (s.key === 'prep') return '<span class="pill wait">Being prepared</span>';
  return `<span class="pill off">${ic('i-lock')}${esc(fmtDay(s.at))}</span>`;
}
function packCard(p) {
  const own = ownsPack(p.id), slots = own ? packSlots(p) : [], done = slots.filter(s => s.done).length, n = p.schedule.length;
  return `<button type="button" class="pack-card" data-pack="${esc(p.id)}" style="${tint(p.subject)}">
    <span class="subj-ic">${subjIc(p.subject)}</span>
    <span class="pk-main"><span class="pk-sub">${esc(p.subject)} · Class ${esc(p.class)}${p.board ? ' · ' + esc(p.board) : ''}</span><b>${esc(p.title)}</b><small>${plural(n, 'mock')} · ${esc(packWhen(p, true))}</small>
      ${own ? `<span class="pk-meter" aria-label="${done} of ${n} done"><i style="width:${n ? Math.round(done / n * 100) : 0}%"></i></span><small>${done} of ${n} done</small>` : `<small>Starts ${esc(fmtDay(p.schedule[0]))}</small>`}</span>
    ${own ? `<span class="pill done">${ic('i-check')}Joined</span>` : `<span class="pk-price"><b>₹${p.priceInr}</b><small>${'₹' + Math.round(p.priceInr / Math.max(1, n)) + '/mock'}</small></span>`}</button>`;
}

function viewPacks() {
  if (!packsEligible()) return `<section class="v">${emptyBlock('i-calendar', 'For Classes 9 to 12', 'Weekly mock packs are for Classes 9 to 12. Your chapter tests, full mocks and custom tests are on Home.')}</section>`;
  const r = route();
  if (r.subject) return viewPackSubject(r.subject);
  const owned = ownedPacks();
  if (!['packs', 'mine'].includes(S.packSeg)) S.packSeg = 'packs';
  const seg = S.packSeg;
  // The top bar already says "Mock tests": no big header card here.
  const head = `<div class="seg" role="tablist"><button type="button" role="tab" data-pseg="packs" aria-selected="${seg === 'packs'}">All subjects</button><button type="button" role="tab" data-pseg="mine" aria-selected="${seg === 'mine'}">My packs <i>${owned.length}</i></button></div>`;
  let body = '';
  if (seg === 'mine') {
    body = owned.length ? `<div class="pack-list">${owned.map(packCard).join('')}</div>`
      : emptyBlock('i-calendar', 'No packs yet', 'Join a mock pack — your weekly mocks and their dates show up here.', '<button type="button" class="btn primary" data-pseg="packs">See all subjects</button>');
  } else {
    const sale = S.packages.filter(p => p.active || ownsPack(p.id));
    body = sale.length ? `<p class="seg-hint">Pick a subject · a full-syllabus mock every week, teacher-approved</p>${packTiles(sale)}`
      : emptyBlock('i-layers', 'Mock packs are on the way', `Weekly mock packs for Class ${S.session.profile.class} will appear here soon.`);
  }
  return `<section class="v v-custom v-packs">${head}${body}</section>`;
}
// One tile per subject (icon first), like Home: tap to see that subject's packs.
function packTiles(list) {
  const order = s => { const i = P.SUBJECTS.indexOf(s); return i < 0 ? 99 : i; };
  const subs = [...new Set(list.map(p => p.subject))].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  return `<div class="mk-grid">${subs.map((s, i) => { const g = list.filter(p => p.subject === s), from = Math.min(...g.map(p => p.priceInr)), joined = g.some(p => ownsPack(p.id));
    return `<a class="mk-tile" href="#/packs/${encodeURIComponent(s)}" style="${tint(s)};--i:${i}"><span class="mk-ic">${subjIc(s)}</span><b>${esc(s)}</b>
      <small>${plural(g.length, 'pack')} · from ₹${from}</small>${joined ? `<span class="mk-badge">${ic('i-check')}Joined</span>` : ''}</a>`; }).join('')}</div>`;
}
// A subject's pack types (e.g. 8 mocks and 4 mocks), with the better value marked.
function viewPackSubject(subject) {
  const list = S.packages.filter(p => p.subject === subject && (p.active || ownsPack(p.id))).sort((a, b) => b.schedule.length - a.schedule.length);
  if (!list.length) return `<section class="v">${emptyBlock('i-calendar', 'No packs here yet', `${subject} mock packs will appear here soon.`, '<a class="btn primary" href="#/packs">All subjects</a>')}</section>`;
  const per = p => Math.round(p.priceInr / Math.max(1, p.schedule.length)), best = list.length > 1 ? list.reduce((a, b) => per(b) < per(a) ? b : a) : null, p0 = S.session.profile;
  return `<section class="v v-packs mk-sub" style="${tint(subject)}">
    <div class="mk-head"><span class="subj-ic lg">${subjIc(subject)}</span><div><h2>${esc(subject)} mock packs</h2><p>Class ${esc(p0.class)}${p0.board ? ' · ' + esc(p0.board) : ''} · ${plural(list.length, 'type')}</p></div></div>
    <div class="mk-types">${list.map((p, i) => { const own = ownsPack(p.id), n = p.schedule.length;
      return `<button type="button" class="mk-type${own ? ' own' : ''}${best === p ? ' best' : ''}" data-pack="${esc(p.id)}" style="--i:${i}">
        ${best === p && !own ? '<span class="mk-flag">Best value</span>' : own ? `<span class="mk-flag own">${ic('i-check')}Joined</span>` : ''}
        <span class="mk-n"><b>${n}</b><small>mocks</small></span>
        <span class="mk-info"><b>${esc(p.title)}</b><small>${esc(packWhen(p, true))} · starts ${esc(fmtDay(p.schedule[0]))}</small><small>Board pattern · teacher-approved</small></span>
        <span class="mk-price"><b>₹${p.priceInr}</b><small>₹${per(p)}/mock</small></span></button>`; }).join('')}</div>
    <p class="fine center">${ic('i-shield')}Secure payment by Razorpay · results within 24 hours</p>
  </section>`;
}

// Packs organised by subject: subject chips on top (when there are several),
// then one titled group per subject.
function bySubject(list) {
  const order = s => { const i = P.SUBJECTS.indexOf(s); return i < 0 ? 99 : i; };
  const subs = [...new Set(list.map(p => p.subject))].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  if (!subs.includes(S.packSubject)) S.packSubject = '';
  const chips = subs.length > 1 ? `<div class="chips-scroll" role="tablist" aria-label="Subject"><button type="button" role="tab" class="chip-btn${!S.packSubject ? ' on' : ''}" data-psub="" aria-selected="${!S.packSubject}">All</button>${subs.map(s => `<button type="button" role="tab" class="chip-btn${s === S.packSubject ? ' on' : ''}" data-psub="${esc(s)}" aria-selected="${s === S.packSubject}">${subjIc(s)}${esc(s)}<i>${list.filter(p => p.subject === s).length}</i></button>`).join('')}</div>` : '';
  return chips + subs.filter(s => !S.packSubject || s === S.packSubject).map(s => { const g = list.filter(p => p.subject === s);
    return `<div class="sec pk-sec" style="${tint(s)}"><h3>${subjIc(s)}${esc(s)}</h3><span>${plural(g.length, 'pack')}</span></div><div class="pack-list">${g.map(packCard).join('')}</div>`; }).join('');
}

// Custom module test tab (Classes 7–12): Build a test | My tests.
function viewCustom() {
  if (!moduleEligible()) return `<section class="v">${emptyBlock('i-layers', 'For Classes 7 to 12', 'Custom module tests are for Classes 7 to 12. Your chapter tests and full mocks are on Home.')}</section>`;
  const c = cust(), mods = S.modules.slice().sort((x, y) => (y.createdAt || '').localeCompare(x.createdAt || ''));
  const head = `<div class="cm-hero"><span class="cm-ic">${ic('i-layers')}</span><div><h2>Custom module test</h2><p>Pick any chapters — we make your paper</p></div></div>
    <div class="seg" role="tablist"><button type="button" role="tab" data-cseg="build" aria-selected="${c.seg !== 'mine'}">Build a test</button><button type="button" role="tab" data-cseg="mine" aria-selected="${c.seg === 'mine'}">My tests <i>${mods.length}</i></button></div>`;
  const body = c.seg === 'mine'
    ? (mods.length ? customMineRows(mods) : emptyBlock('i-layers', 'No custom tests yet', 'Build one from any chapters. Your paper is ready within a day.', '<button type="button" class="btn primary" data-cseg="build">Build a test</button>'))
    : customBuild();
  return `<section class="v v-custom">${head}${body}</section>`;
}

function customMineRows(mods) {
  return `<ul class="rows">${mods.map(m => {
    const t = m.testId && S.tests.find(x => x.id === m.testId), st = t && stateOf(t);
    return `<li><button type="button" class="row" data-cmod="${esc(m.id)}" style="${tint(m.subject)}"><span class="subj-ic">${subjIc(m.subject)}</span>
      <span class="row-main"><b>${esc(m.subject)} · ${m.full ? 'Custom full mock' : plural(m.chapterCount, 'chapter')}${m.level ? ' · ' + esc(P.LEVELS[P.levelOf(m.level)]) : ''}</b><small>${t ? esc((m.chapters || []).slice(0, 2).join(', ')) + (m.chapterCount > 2 ? ` +${m.chapterCount - 2}` : '') : 'Ready by ' + esc(fmtWhen(m.dueAt))}</small></span>
      ${t ? pill(t, st) : '<span class="pill wait">Preparing</span>'}</button></li>`; }).join('')}</ul>`;
}

function customBuild() {
  if (!moduleEligible()) return emptyBlock('i-layers', 'For Classes 7 to 12', 'Custom module tests are for Classes 7 to 12.');
  const c = cust(), cls = String(S.session.profile.class), subs = NTCSyllabus.subjects(c.board, cls), M = P.MODULE;
  if (!subs.some(s => s.subject === c.subject)) c.subject = subs[0].subject;
  const picked = (c.carts[c.board][c.subject]) || [];
  const chapters = NTCSyllabus.chapters(c.board, cls, c.subject);
  const boardTabs = P.customBoard(S.session.profile.board) ? '' : ['CBSE', 'CISCE'].map(bd => `<button type="button" role="tab" data-cboard="${bd}" aria-selected="${c.board === bd}">${NTCSyllabus.boardLabel(bd, cls)}${cartCount(bd) ? ` <i>${cartCount(bd)}</i>` : ''}</button>`).join('');
  return `<div class="cm-price">${enrolled() ? ic('i-shield') + (tncFree(c.subject) ? `${esc(c.subject)} is free for you (TNC subject)` : `${esc(c.subject)} isn’t a TNC subject for you: ₹${M.first} a chapter`) + ' · at least ' + M.minPerPaper + ' chapters per subject' : `${ic('i-spark')}₹${M.first} a chapter · ₹${M.rest} from the ${M.firstCount + 1}th · all chapters = Custom full mock ₹${M.fullMock}`}</div>
    <div class="cm-pick">
      ${boardTabs ? `<div class="seg small" role="tablist" aria-label="Board">${boardTabs}</div>` : ''}
      <div class="chips-scroll" role="tablist" aria-label="Subject">${subs.map(s => { const k = ((c.carts[c.board][s.subject]) || []).length; return `<button type="button" role="tab" class="chip-btn${s.subject === c.subject ? ' on' : ''}" data-csub="${esc(s.subject)}" aria-selected="${s.subject === c.subject}">${subjIc(s.subject)}${esc(subjName(s.subject, cls))}${k ? `<i>${k}</i>` : ''}</button>`; }).join('')}</div>
    </div>
    <div class="sec"><h3>${esc(subjName(c.subject, cls))} · Class ${esc(cls)} ${esc(NTCSyllabus.boardLabel(c.board, cls))}</h3><button type="button" class="link" data-call>${picked.length === chapters.length ? 'Clear' : 'Select all'}</button></div>
    ${fullMockNote(c)}<ul class="rows picks" style="${tint(c.subject)}">${chapters.map((ch, i) => { const on = picked.includes(ch); return `<li><button type="button" class="row pick" data-ch="${i}" aria-pressed="${on}">
      <span class="row-ix">${String(i + 1).padStart(2, '0')}</span><span class="row-main"><b>${esc(ch)}</b></span><span class="tick" aria-hidden="true">${ic(on ? 'i-check' : 'i-plus')}</span></button></li>`; }).join('')}</ul>
    ${cartBarHtml(c)}`;
}
function cartBarHtml(c) {
  const n = cartCount(c.board), b = cartBill(c.board); if (!n) return '';
  const short = cartShort(c.board), papers = cartItems(c.board).length;
  const what = b.fullCount ? `${b.fullCount} full mock${b.fullCount === 1 ? '' : 's'}${b.chapters ? ' + ' + plural(b.chapters, 'chapter') : ''}` : plural(n, 'chapter');
  return `<div class="cart-bar${short.length ? ' short' : ''}" role="region" aria-label="Cart"><div><b>${what} · ${b.total ? '₹' + b.total : 'Free'}</b><small>${short.length ? esc(shortMsg(short)) : b.save && b.total ? `You save ₹${b.save}` : `${papers} paper${papers === 1 ? '' : 's'}`}</small></div><button type="button" class="btn" data-cart${short.length ? ' disabled aria-disabled="true"' : ''}>${ic('i-cart')}Review</button></div>`;
}
// Picking chapters updates only what changed (ticks, counts, cart bar): no full redraw, no blink.
function syncPicks() {
  const root = $('view'), c = cust(), list = NTCSyllabus.chapters(c.board, S.session.profile.class, c.subject), picked = c.carts[c.board][c.subject] || [];
  root.querySelectorAll('.row.pick[data-ch]').forEach(b => {
    const on = picked.includes(list[+b.dataset.ch]);
    if ((b.getAttribute('aria-pressed') === 'true') !== on) { b.setAttribute('aria-pressed', String(on)); const t = b.querySelector('.tick'); if (t) t.innerHTML = ic(on ? 'i-check' : 'i-plus'); }
  });
  const count = (el, k) => { if (!el) return; let i = el.querySelector('i'); if (k && !i) { i = document.createElement('i'); el.appendChild(i); } if (i) { if (k) i.textContent = k; else i.remove(); } };
  root.querySelectorAll('[data-csub]').forEach(el => count(el, ((c.carts[c.board][el.dataset.csub]) || []).length));
  root.querySelectorAll('[data-cboard]').forEach(el => count(el, cartCount(el.dataset.cboard)));
  const all = root.querySelector('[data-call]'); if (all) all.textContent = picked.length === list.length ? 'Clear' : 'Select all';
  const note = root.querySelector('.fm-note'), noteHtml = fullMockNote(c);
  if (note && note.outerHTML !== noteHtml) { if (noteHtml) note.outerHTML = noteHtml; else note.remove(); }
  else if (!note && noteHtml) { const host = root.querySelector('.rows.picks'); if (host) host.insertAdjacentHTML('beforebegin', noteHtml); }
  if (!REDUCED.matches && picked.length === list.length && noteHtml) { const on = root.querySelector('.fm-note.on'); if (on && !note?.classList.contains('on')) on.classList.add('pop'); }
  const old = root.querySelector('.cart-bar'), html = cartBarHtml(c);
  if (old && html) old.outerHTML = html; else if (old) old.remove(); else if (html) { const host = root.querySelector('.rows.picks'); if (host) host.insertAdjacentHTML('afterend', html); }
  const bar = root.querySelector('.cart-bar [data-cart]'); if (bar) bar.onclick = openCart;
}

// ── One mock pack: details, schedule, join / pay; or progress if joined ──
function openPackage(id) {
  const p = S.packages.find(x => x.id === id); if (!p) return;
  if (S.promo && S.promo.target !== 'pkg:' + id) S.promo = null;
  const own = ownsPack(id), n = p.schedule.length, slots = packSlots(p), promo = S.promo && S.promo.target === 'pkg:' + id ? S.promo.code : '';
  const head = `<div class="sh-head" style="${tint(p.subject)}"><span class="sh-kicker">${subjIc(p.subject)}${esc(p.subject)} · Class ${esc(p.class)}${p.board ? ' · ' + esc(p.board) : ''}</span><h2 id="sheetTitle">${esc(p.title)}</h2>
    <div class="facts"><span class="kind">${plural(n, 'mock')}</span><span>${ic('i-clock')}${esc(packWhen(p))}</span><span>From ${esc(fmtDay(p.schedule[0]))}</span></div></div>`;
  const schedule = `<div class="sec"><h3>Schedule</h3><span>${n}</span></div><ul class="rows sched" style="${tint(p.subject)}">${slots.map(s => `<li><button type="button" class="row"${own && s.t ? ` data-slot-test="${esc(s.t.id)}"` : ' disabled'}>
      <span class="row-ix">${String(s.n).padStart(2, '0')}</span><span class="row-main"><b>Mock ${s.n}</b><small>${esc(fmtShort(s.at))}</small></span>${own ? packPill(s) : ''}</button></li>`).join('')}</ul>`;
  let body;
  if (own) {
    const done = slots.filter(s => s.done).length, nm = slots.find(s => !s.done && (s.key === 'soon' || (s.key === 'open' && ['ready', 'started'].includes(s.st && s.st.key))));
    body = `<div class="pk-progress"><div><b>${done} of ${n} done</b><small>${nm ? (nm.key === 'open' ? `Mock ${nm.n} is open — start any time` : `Mock ${nm.n} opens ${esc(fmtShort(nm.at))}`) : 'All mocks taken — great work'}</small></div><span class="pk-meter"><i style="width:${n ? Math.round(done / n * 100) : 0}%"></i></span></div>${schedule}`;
  } else {
    const per = Math.round(p.priceInr / Math.max(1, n));
    body = `${coPrice(promo ? 0 : p.priceInr, promo ? p.priceInr : 0, `${plural(n, 'mock')} · ₹${per} a mock`)}
      ${coMore('What’s included · schedule', `<ul class="co-list"><li>${ic('i-check')}One full-syllabus mock every week</li><li>${ic('i-check')}Opens at the set time — take it any time after</li><li>${ic('i-check')}Software-checked, approved by a TNC teacher within 24 hours</li><li>${ic('i-check')}Counts towards your all-India rank</li></ul>${p.description ? `<p class="instr">${esc(p.description)}</p>` : ''}${schedule}`)}
      ${promoBox('pkg:' + id, !S.session.paymentsReady)}
      ${promo ? coBar(0, `<button type="button" class="btn primary" data-pjoin>${ic('i-unlock')}Join for ₹0</button>`, false)
          : S.session.paymentsReady ? coBar(p.priceInr, `<button type="button" class="btn primary pay" data-ppay>${ic('i-lock')}Join for ₹${p.priceInr}</button>`, true)
          : contactCard(`the "${p.title}" (${plural(n, 'mock')})`)}`;
  }
  openSheet(head + body, root => {
    root.querySelectorAll('[data-slot-test]').forEach(b => b.onclick = () => openTest(b.dataset.slotTest));
    const join = root.querySelector('[data-pjoin]'); if (join) join.onclick = () => joinPack(p, join);
    const pay = root.querySelector('[data-ppay]'); if (pay) pay.onclick = () => payPack(p, pay);
    if (!own) { bindPromo(root, 'pkg:' + id, { packageId: id }, () => openPackage(id)); if (S.session.paymentsReady && !promo) loadRazorpay().catch(() => {}); }
  });
}
function packJoined(p, message) {
  S.session.unlocked = [...new Set([...(S.session.unlocked || []), 'pkg_' + p.id])];
  S.promo = null; S.packSeg = 'mine'; saveCache(); render(); haptic(30); toast(message);
  openPackage(p.id);
}
async function joinPack(p, btn) {
  const done = busy(btn, 'Joining…');
  try {
    const promoCode = S.promo && S.promo.target === 'pkg:' + p.id ? S.promo.code : '';
    const r = await fn('online-series', { action: 'package-order', packageId: p.id, ...(promoCode ? { promoCode } : {}) });
    packJoined(p, r.promo ? 'Promo applied — you have joined the pack' : 'You have joined the pack');
  } catch (e) {
    done();
    if (e.data && e.data.unlocked) return packJoined(p, 'You are already in this pack.');
    toast(e.message, 'err');
  }
}
async function payPack(p, btn) {
  const done = busy(btn, 'Opening payment…');
  try {
    const [order] = await Promise.all([fn('online-series', { action: 'package-order', packageId: p.id }), loadRazorpay()]);
    const rz = new window.Razorpay({
      key: order.keyId, amount: order.amountPaise, currency: 'INR', order_id: order.orderId,
      name: 'The NewTown Classes', description: order.testName + ' · Non-refundable', prefill: order.prefill || {}, image: location.origin + '/assets/img/logo-mark.png', theme: { color: '#0b2a6b', backdrop_color: 'rgba(7, 18, 40, 0.72)' }, retry: { enabled: true, max_count: 3 },
      modal: { ondismiss: () => { S.checkoutOpen = false; clearPending(); done(); }, escape: true, backdropclose: false },
      handler: async resp => {
        S.checkoutOpen = false;
        openSheet('<div class="celebrate wait"><span class="spin lg" aria-hidden="true"></span><b>Confirming your payment…</b><p>Please keep this screen open.</p></div>');
        let ok = false;
        try { await fn('online-series', { action: 'verify-payment', orderId: resp.razorpay_order_id, paymentId: resp.razorpay_payment_id, signature: resp.razorpay_signature }); ok = true; }
        catch (_) { for (let i = 0; i < 5 && !ok; i++) { await sleep(2500); try { ok = (await fn('online-series', { action: 'session' })).unlocked.includes('pkg_' + p.id); } catch (_) {} } }
        if (ok) { clearPending(); return packJoined(p, 'Payment successful — you have joined the pack'); }
        openSheet(`<div class="celebrate err">${ic('i-shield')}<b>We're still confirming your payment</b><p>If money was deducted, you join the pack automatically within a few minutes. If the payment did not go through, your bank returns any amount it held. Payment ID: <code>${esc(resp.razorpay_payment_id)}</code></p></div>`);
      }
    });
    rz.on('payment.failed', r => toast((r && r.error && r.error.description) || 'Payment failed. No money was taken — please try again.', 'err'));
    setPending({ orderId: order.orderId, packageId: p.id });
    S.checkoutOpen = true; rz.open();
  } catch (e) { done(); if (e.data && e.data.unlocked) return packJoined(p, 'You are already in this pack.'); toast(e.message, 'err'); }
}
async function resumePackPayment(p) {
  const pack = S.packages.find(x => x.id === p.packageId);
  if (pack && ownsPack(pack.id)) { clearPending(); return packJoined(pack, 'Payment successful — you have joined the pack'); }
  if (!pack || Date.now() - p.at > 15 * 60000) return clearPending();
  pendingBusy = true; toast('Confirming your payment…');
  try {
    for (let i = 0; i < 4; i++) {
      await sleep(2500);
      try { const s = await fn('online-series', { action: 'session' }); S.session.unlocked = s.unlocked; if (ownsPack(pack.id)) { clearPending(); return packJoined(pack, 'Payment successful — you have joined the pack'); } } catch (_) {}
    }
    toast('Payment not confirmed yet. If money was deducted, you join the pack automatically within a few minutes.', 'err');
  } finally { pendingBusy = false; }
}

function bindCustom(root) {
  root.querySelectorAll('[data-cseg]').forEach(b => b.onclick = () => { cust().seg = b.dataset.cseg; render(); });
  root.querySelectorAll('[data-pseg]').forEach(b => b.onclick = () => { S.packSeg = b.dataset.pseg; render(); });
  root.querySelectorAll('[data-psub]').forEach(b => b.onclick = () => { S.packSubject = b.dataset.psub; render(); });
  root.querySelectorAll('[data-pseg-link]').forEach(b => b.addEventListener('click', () => { S.packSeg = b.dataset.psegLink; }));
  root.querySelectorAll('[data-pack]').forEach(b => b.onclick = () => openPackage(b.dataset.pack));
  root.querySelectorAll('[data-cboard]').forEach(b => b.onclick = () => { cust().board = b.dataset.cboard; render(); });
  root.querySelectorAll('[data-csub]').forEach(b => b.onclick = () => { cust().subject = b.dataset.csub; render(); });
  root.querySelectorAll('[data-ch]').forEach(b => b.onclick = () => {
    const c = cust(), list = NTCSyllabus.chapters(c.board, S.session.profile.class, c.subject), ch = list[+b.dataset.ch];
    const cart = c.carts[c.board], cur = new Set(cart[c.subject] || []);
    if (cur.has(ch)) cur.delete(ch);
    else { if (cartCount(c.board) >= P.MODULE.maxChapters) return toast(`Up to ${P.MODULE.maxChapters} chapters at a time.`); cur.add(ch); haptic(8); }
    cart[c.subject] = list.filter(x => cur.has(x)); saveCart();
    syncPicks();
  });
  root.querySelectorAll('[data-call]').forEach(b => b.onclick = () => {
    const c = cust(), list = NTCSyllabus.chapters(c.board, S.session.profile.class, c.subject), cart = c.carts[c.board];
    const all = (cart[c.subject] || []).length === list.length;
    const others = cartCount(c.board) - (cart[c.subject] || []).length;
    if (!all && others + list.length > P.MODULE.maxChapters) return toast(`Up to ${P.MODULE.maxChapters} chapters at a time.`);
    cart[c.subject] = all ? [] : list.slice(); saveCart();
    syncPicks();
  });
  root.querySelectorAll('[data-cart]').forEach(b => b.onclick = openCart);
  root.querySelectorAll('[data-cmod]').forEach(b => b.onclick = () => {
    const m = S.modules.find(x => x.id === b.dataset.cmod); if (!m) return;
    const t = m.testId && S.tests.find(x => x.id === m.testId);
    if (t) openTest(t.id); else openModuleSheet(m);
  });
}

function openCart() {
  if (S.promo && S.cust && S.promo.target !== 'cart:' + S.cust.board) S.promo = null;
  const c = cust(), cls = String(S.session.profile.class), items = cartItems(c.board), n = cartCount(c.board), b = cartBill(c.board), M = P.MODULE, short = cartShort(c.board);
  if (!n) return closeSheet();
  const billHtml = `<div class="bill">${b.tnc.map(it => `<div><span>${esc(it.subject)} · TNC subject</span><b class="free">Free</b></div>`).join('')}${b.full.map(it => `<div><span>Custom full mock · ${esc(it.subject)}</span><span><s>₹${P.modulePrice(it.chapters.length)}</s> ₹${M.fullMock}</span></div>`).join('')}${b.first ? `<div><span>${b.first} × ₹${M.first}</span><span>₹${b.first * M.first}</span></div>` : ''}${b.rest ? `<div><span>${b.rest} × ₹${M.rest}</span><span>₹${b.rest * M.rest}</span></div>` : ''}${b.save ? `<div class="save"><span>You save</span><span>−₹${b.save}</span></div>` : ''}
      ${cartPromo() ? `<div class="save"><span>Promo ${esc(cartPromo())}</span><span>−₹${b.total}</span></div>` : ''}
      <div class="total"><span>Total</span><span>${!b.total || cartPromo() ? '₹0' : '₹' + b.total}</span></div></div>`;
  const howHtml = `<ol class="track"><li class="done">${ic('i-check')}<b>Pay &amp; confirm</b><small>Your chapters are locked in</small></li><li>${ic('i-pen')}<b>We make your paper</b><small>One per subject, within ${M.readyHours} hours</small></li><li>${ic('i-play')}<b>Start any time</b><small>Software-checked, teacher-approved</small></li></ol>`;
  const itemPrice = it => it.tnc ? '<b class="free">Free</b>' : it.full ? `<b>₹${M.fullMock}</b>` : '';
  openSheet(`<div class="sh-head co-head"><span class="sh-kicker">${ic('i-cart')}Your cart · Class ${esc(cls)} ${esc(NTCSyllabus.boardLabel(c.board, cls))}</span><h2 id="sheetTitle">Custom module test</h2></div>
    <div class="cart-list co-items">${items.map(it => `<details class="cg" style="${tint(it.subject)}"><summary class="cg-h"><span class="subj-ic">${subjIc(it.subject)}</span><span class="cg-name">${esc(subjName(it.subject, cls))}<small>${it.full ? `Custom full mock · all ${it.chapters.length}` : plural(it.chapters.length, 'chapter') + ' · 1 paper'}</small></span>${itemPrice(it)}${ic('i-down', 'chev')}</summary>
      <ul>${it.full ? `<li><span>All ${it.chapters.length} chapters · full syllabus</span><button type="button" data-rmall="${esc(it.subject)}" aria-label="Remove ${esc(it.subject)}">${ic('i-x')}</button></li>`
        : it.chapters.map(ch => `<li><span>${esc(ch)}</span><button type="button" data-rm="${esc(it.subject)}" data-rmch="${esc(ch)}" aria-label="Remove ${esc(ch)}">${ic('i-x')}</button></li>`).join('')}</ul></details>`).join('')}</div>
    ${cartOptions(c)}
    ${b.total ? (cartPromoMiss() ? `<div class="promo warn">${ic('i-spark')}<span>${esc(cartPromoMiss())}</span><button type="button" class="link" data-promo-remove>Remove code</button></div>` : promoBox('cart:' + c.board, !S.session.paymentsReady)) : ''}
    ${coMore('Price breakdown · how it works', billHtml + (b.total && b.chapters && b.chapters < M.firstCount + 1 ? `<p class="fine">Add ${M.firstCount + 1 - b.chapters} more chapter${M.firstCount + 1 - b.chapters === 1 ? '' : 's'} and each extra one costs just ₹${M.rest}.</p>` : '') + howHtml)}
    ${short.length ? `<div class="warn-box">${ic('i-layers')}<p><b>${esc(shortMsg(short))}.</b> One chapter on its own is a chapter-wise test — add another or remove it.</p></div>${coBar(b.total, `<button type="button" class="btn primary" data-buy disabled aria-disabled="true">${ic('i-lock')}Pay ₹${b.total}</button>`, false)}`
      : !b.total ? coBar(0, `<button type="button" class="btn primary" data-buy>${ic('i-unlock')}Request my tests · free</button>`, false)
      : cartPromo() ? coBar(0, `<button type="button" class="btn primary" data-buy>${ic('i-unlock')}Confirm order · ₹0</button>`, false)
      : S.session.paymentsReady ? coBar(b.total, `<button type="button" class="btn primary pay" data-buy>${ic('i-lock')}Pay ₹${b.total}</button>`, true, b.save ? `You save ₹${b.save}` : '')
      : contactCard(`a custom module test (${plural(n, 'chapter')}: ${items.map(i => i.subject).join(', ')})`)}`,
  root => {
    root.querySelectorAll('[data-rmall]').forEach(btn => btn.onclick = () => {
      cust().carts[cust().board][btn.dataset.rmall] = []; saveCart();
      render(); if (cartCount(cust().board)) openCart(); else closeSheet();
    });
    root.querySelectorAll('[data-rm]').forEach(btn => btn.onclick = () => {
      const cart = cust().carts[cust().board]; cart[btn.dataset.rm] = (cart[btn.dataset.rm] || []).filter(x => x !== btn.dataset.rmch); saveCart();
      render(); if (cartCount(cust().board)) openCart(); else closeSheet();
    });
    bindCartOptions(root);
    const buy = root.querySelector('[data-buy]'); if (buy && !buy.disabled) buy.onclick = () => buyModules(buy);
    bindPromo(root, 'cart:' + c.board, { kind: 'custom', board: c.board, items: cartItems(c.board) }, openCart);
  });
}
// Paper level + request for the teacher: two compact rows. Level opens a small
// popup list (like a picker); the request row opens a text box in place.
const LEVEL_INFO = { easy: 'Basics and direct questions', medium: 'Board-exam standard', high: 'Tough, application-based' };
function cartOptions(c) {
  const lv = P.levelOf(c.level), note = (c.note || '').trim();
  return `<div class="cm-opts">
    <button type="button" class="cm-row" id="cmLevelBtn" aria-haspopup="listbox" aria-expanded="false" aria-controls="cmLevelPop">
      <span class="cm-ic lv-${lv}" id="cmLevelIc">${ic('i-layers')}</span><span class="cm-txt"><b>Paper level</b><small id="cmLevelHint">${esc(LEVEL_INFO[lv])}</small></span>
      <span class="cm-val"><span id="cmLevelVal">${esc(P.LEVELS[lv])}</span>${ic('i-down', 'cm-caret')}</span></button>
    <div class="cm-pop" id="cmLevelPop" role="listbox" aria-label="Paper level" hidden>${Object.entries(P.LEVELS).map(([k, l]) => `<button type="button" role="option" class="cm-opt" data-level="${k}" aria-selected="${k === lv}"><span class="lv-dot lv-${k}" aria-hidden="true"></span><span class="cm-txt"><b>${esc(l)}</b><small>${esc(LEVEL_INFO[k])}</small></span>${ic('i-check', 'cm-tick')}</button>`).join('')}</div>
    <button type="button" class="cm-row" id="cmNoteBtn" aria-expanded="${!!note}" aria-controls="cmNoteBox">
      <span class="cm-ic">${ic('i-pen')}</span><span class="cm-txt"><b>Request for the teacher</b><small id="cmNoteHint">${note ? esc(note) : 'Optional · e.g. more numericals'}</small></span>
      <span class="cm-val"><span id="cmNoteVal">${note ? 'Edit' : 'Add'}</span>${ic('i-chev', 'cm-caret')}</span></button>
    <div class="cm-notebox" id="cmNoteBox"${note ? '' : ' hidden'}><textarea id="cmNote" rows="2" maxlength="${P.NOTE_MAX}" aria-label="Request for the teacher" placeholder="e.g. More numericals, include diagram questions">${esc(c.note || '')}</textarea><small class="cm-count" id="cmNoteCount">${(c.note || '').length}/${P.NOTE_MAX}</small></div>
  </div>`;
}
function bindCartOptions(root) {
  const btn = root.querySelector('#cmLevelBtn'), pop = root.querySelector('#cmLevelPop'); if (!btn || !pop) return;
  const close = () => {
    if (pop.hidden) return; btn.setAttribute('aria-expanded', 'false'); pop.classList.remove('on');
    setTimeout(() => { if (!pop.classList.contains('on')) pop.hidden = true; }, REDUCED.matches ? 0 : 160);
  };
  const open = () => { pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); requestAnimationFrame(() => pop.classList.add('on')); (pop.querySelector('[aria-selected=true]') || pop.firstElementChild).focus({ preventScroll: true }); };
  btn.onclick = () => (pop.hidden ? open() : close());
  pop.querySelectorAll('[data-level]').forEach(o => o.onclick = () => {
    const k = o.dataset.level; cust().level = k; haptic(8);
    pop.querySelectorAll('[data-level]').forEach(x => x.setAttribute('aria-selected', String(x === o)));
    root.querySelector('#cmLevelVal').textContent = P.LEVELS[k]; root.querySelector('#cmLevelHint').textContent = LEVEL_INFO[k];
    root.querySelector('#cmLevelIc').className = 'cm-ic lv-' + k;
    close(); btn.focus({ preventScroll: true });
  });
  // Tap outside or Escape closes the list (Escape doesn't close the whole sheet).
  root.addEventListener('click', e => { if (!pop.hidden && !e.target.closest('#cmLevelPop, #cmLevelBtn')) close(); });
  root.addEventListener('keydown', e => { if (e.key === 'Escape' && !pop.hidden) { e.stopPropagation(); close(); btn.focus({ preventScroll: true }); } });
  const nbtn = root.querySelector('#cmNoteBtn'), box = root.querySelector('#cmNoteBox'), note = root.querySelector('#cmNote');
  nbtn.onclick = () => {
    const show = box.hidden; box.hidden = !show; nbtn.setAttribute('aria-expanded', String(show));
    if (show) { box.classList.remove('in'); void box.offsetWidth; box.classList.add('in'); note.focus({ preventScroll: false }); }
  };
  note.oninput = () => {
    const v = note.value.slice(0, P.NOTE_MAX); cust().note = v;
    root.querySelector('#cmNoteHint').textContent = v.trim() || 'Optional · e.g. more numericals';
    root.querySelector('#cmNoteVal').textContent = v.trim() ? 'Edit' : 'Add';
    root.querySelector('#cmNoteCount').textContent = `${v.length}/${P.NOTE_MAX}`;
  };
}
const cartPromoRaw = () => S.promo && S.cust && S.promo.target === 'cart:' + S.cust.board ? S.promo : null;
// Why an applied code no longer covers the cart (chapters added after applying it), or ''.
function cartPromoMiss() {
  const p = cartPromoRaw(); if (!p) return '';
  const l = p.limits || {}, n = cartCount(S.cust.board), total = cartBill(S.cust.board).total;
  if (l.maxChapters && n > l.maxChapters) return `${p.code} covers up to ${plural(l.maxChapters, 'chapter')} — remove ${n - l.maxChapters} to use it.`;
  if (l.maxValueInr && total > l.maxValueInr) return `${p.code} covers up to ₹${l.maxValueInr} — this cart is ₹${total}.`;
  return '';
}
const cartPromo = () => { const p = cartPromoRaw(); return p && !cartPromoMiss() ? p.code : ''; };

function openModuleSheet(m) {
  openSheet(`<div class="sh-head" style="${tint(m.subject)}"><span class="sh-kicker">${subjIc(m.subject)}${esc(m.subject)} · Class ${esc(m.class)} ${esc(m.boardLabel || '')}</span><h2 id="sheetTitle">${m.full ? 'Custom full mock' : 'Custom module test'}</h2>
      <div class="facts"><span class="kind">${plural(m.chapterCount, 'chapter')}</span>${m.level ? `<span>${esc(P.LEVELS[P.levelOf(m.level)])}</span>` : ''}<span>${ic('i-clock')}Ready by ${esc(fmtWhen(m.dueAt))}</span></div></div>
    <ol class="track"><li class="done">${ic('i-check')}<b>Ordered</b><small>${esc(fmtWhen(m.createdAt))}</small></li><li class="now">${ic('i-pen')}<b>Making your paper</b><small>TNC faculty are setting it</small></li><li>${ic('i-play')}<b>Ready to start</b><small>You'll see it here</small></li></ol>
    ${m.note ? `<div class="feedback"><span class="eyebrow">Your request to the teacher</span><p>${esc(m.note)}</p></div>` : ''}
    <div class="cg"><div class="cg-h">Chapters</div><ul>${(m.chapters || []).map(ch => `<li><span>${esc(ch)}</span></li>`).join('')}</ul></div>`);
}

function finishModules(message) {
  const c = cust(); c.carts[c.board] = {}; c.note = ''; c.level = ''; saveCart(); c.seg = 'mine'; saveCache();
  closeSheet(() => { if (location.hash !== '#/custom') location.hash = '#/custom'; else { S.view = ''; render(); } toast(message); haptic(30); });
}
async function loadModules() {
  try { S.modules = await fsQuery('moduleRequests', { uid: S.user.uid }); saveCache(); } catch (_) {}
  return S.modules;
}
async function buyModules(btn) {
  const c = cust(), items = cartItems(c.board), free = !cartBill(c.board).total;
  const done = busy(btn, free ? 'Requesting…' : cartPromo() ? 'Confirming…' : 'Opening payment…');
  try {
    const promoCode = cartPromo();
    const [order] = await Promise.all([fn('online-series', { action: 'module-order', board: c.board, items, level: P.levelOf(c.level), note: (c.note || '').trim(), ...(promoCode ? { promoCode } : {}) }), promoCode || free ? null : loadRazorpay()]);
    if (order.free) { S.promo = null; S.modules = [...(order.requests || []), ...S.modules]; return finishModules(order.promo ? `Promo applied · your paper${(order.requests || []).length === 1 ? '' : 's'} will be ready within ${P.MODULE.readyHours} hours` : `Requested · your paper${(order.requests || []).length === 1 ? '' : 's'} will be ready within ${P.MODULE.readyHours} hours`); }
    const rz = new window.Razorpay({
      key: order.keyId, amount: order.amountPaise, currency: 'INR', order_id: order.orderId,
      name: 'The NewTown Classes', description: order.testName + ' · Non-refundable', prefill: order.prefill || {}, image: location.origin + '/assets/img/logo-mark.png', theme: { color: '#0b2a6b', backdrop_color: 'rgba(7, 18, 40, 0.72)' }, retry: { enabled: true, max_count: 3 },
      modal: { ondismiss: () => { S.checkoutOpen = false; clearPending(); done(); }, escape: true, backdropclose: false },
      handler: resp => { S.checkoutOpen = false; confirmModulePayment(order, resp); }
    });
    rz.on('payment.failed', r => toast((r && r.error && r.error.description) || 'Payment failed. No money was taken — please try again.', 'err'));
    setPending({ orderId: order.orderId, module: true });
    S.checkoutOpen = true;
    rz.open();
  } catch (e) { done(); toast(e.message, 'err'); }
}
async function confirmModulePayment(order, resp) {
  openSheet('<div class="celebrate wait"><span class="spin lg" aria-hidden="true"></span><b>Confirming your payment…</b><p>Please keep this screen open.</p></div>');
  let ok = false;
  try {
    await fn('online-series', { action: 'verify-payment', orderId: resp.razorpay_order_id, paymentId: resp.razorpay_payment_id, signature: resp.razorpay_signature });
    ok = true;
  } catch (_) {
    for (let i = 0; i < 5 && !ok; i++) { await sleep(2500); ok = (await loadModules()).some(m => m.orderId === order.orderId); }
  }
  if (ok) { clearPending(); await loadModules(); return finishModules(`Payment successful · your paper${S.modules.filter(m => m.orderId === order.orderId).length === 1 ? ' is' : 's are'} being made`); }
  openSheet(`<div class="celebrate err">${ic('i-shield')}<b>We're still confirming your payment</b><p>If money was deducted, your order is confirmed automatically within a few minutes. If the payment did not go through, your bank returns any amount it held. Payment ID: <code>${esc(resp.razorpay_payment_id)}</code></p></div>
    <div class="sh-actions"><a class="btn ghost" href="${WA}?text=${encodeURIComponent('Payment help: ' + resp.razorpay_payment_id)}" target="_blank" rel="noopener">WhatsApp us</a><button type="button" class="btn primary" data-check>Check again</button></div>`,
  root => { root.querySelector('[data-check]').onclick = async () => { if ((await loadModules()).some(m => m.orderId === order.orderId)) { clearPending(); finishModules('Payment successful · your papers are being made'); } else toast('Not confirmed yet. Please try again in a minute.'); }; });
}
async function resumeModulePayment(p) {
  if (S.modules.some(m => m.orderId === p.orderId)) { clearPending(); return finishModules('Payment successful · your papers are being made'); }
  if (Date.now() - p.at > 15 * 60000) return clearPending();
  pendingBusy = true; toast('Confirming your payment…');
  try {
    for (let i = 0; i < 4; i++) { await sleep(2500); if ((await loadModules()).some(m => m.orderId === p.orderId)) { clearPending(); return finishModules('Payment successful · your papers are being made'); } }
    toast('Payment not confirmed yet. If money was deducted, your order is confirmed automatically within a few minutes.', 'err');
  } finally { pendingBusy = false; }
}

// ═══ Timed test ═══
async function startTest(t, btn) {
  const done = busy(btn, 'Opening paper…');
  const fresh = !S.attempts[t.id];
  try {
    const a = await fn('offline-test', { action: 'start', testId: t.id });
    if (a.status && a.status !== 'started') { done(); await refresh(); return openTest(t.id); }
    S.attempts[t.id] = { status: 'started', deadline: a.deadline, startedAt: a.startedAt, questionPdfUrl: NTCUploadcare.deliveryUrl(a.questionPdfUrl), uploadGraceMin: a.uploadGraceMin || 15 };
    saveCache();
    const offset = a.serverNow ? Date.parse(a.serverNow) - Date.now() : 0;
    closeSheet(() => {
      openExam(t, S.attempts[t.id], offset);
      if (fresh) NTCOfflineFiles.downloadPdf(S.attempts[t.id].questionPdfUrl, t.testName + '_question_paper.pdf').catch(() => toast('Your paper is open here. Tap the download button to save a copy.'));
    });
  } catch (e) {
    done();
    if (e.status === 402) { await refresh(); openTest(t.id); }
    toast(e.message, 'err');
  }
}
function loadPdfJs() {
  if (S.pdfjs) return Promise.resolve(S.pdfjs);
  return new Promise((resolve, reject) => {
    if (window.pdfjsLib) { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; S.pdfjs = window.pdfjsLib; return resolve(S.pdfjs); }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; S.pdfjs = window.pdfjsLib; resolve(S.pdfjs); };
    s.onerror = () => reject(new Error('Could not load the PDF viewer. Check your internet connection.'));
    document.head.appendChild(s);
  });
}
function openExam(t, a, offset) {
  if (!a) return;
  if (offset) S.offset = offset;
  S.exam = { test: t, attempt: a, timer: 0, warned: false, timeUp: false };
  $('exTitle').textContent = t.testName;
  $('exSub').textContent = `${t.subject} · ${t.totalMarks || '?'} marks`;
  $('exPaperLink').href = a.questionPdfUrl;
  $('exam').hidden = false;
  document.documentElement.classList.add('locked');
  resetUpload();
  tick(); S.exam.timer = setInterval(tick, 1000);
  pushLayer('exam', closeExamNow);
  renderPaper(a.questionPdfUrl);
  if (Date.parse(a.deadline) - now() <= 0) openUpload();
}
function closeExamNow() {
  if (S.exam) clearInterval(S.exam.timer);
  S.exam = null;
  $('exam').hidden = true; $('exUpload').hidden = true;
  document.documentElement.classList.remove('locked');
  render();
}
$('exMin').onclick = () => { if (!S.up.busy) { if (!$('exUpload').hidden) closeUpload(() => popLayer('exam')); else popLayer('exam'); } };
function tick() {
  const ex = S.exam; if (!ex) return;
  const left = Date.parse(ex.attempt.deadline) - now(), total = Date.parse(ex.attempt.deadline) - Date.parse(ex.attempt.startedAt);
  $('exProgress').style.transform = `scaleX(${Math.max(0, Math.min(1, left / Math.max(1, total)))})`;
  const el = $('exTimer'), grace = (ex.attempt.uploadGraceMin || 15) * 60000 + left;
  if (left > 0) {
    el.textContent = fmtTime(left); el.className = 'ex-timer' + (left < 5 * 60000 ? ' warn' : '');
    if (left < 5 * 60000 && !ex.warned) { ex.warned = true; haptic(250); toast('5 minutes left. Start wrapping up.'); }
  } else {
    el.textContent = grace > 0 ? 'Upload ' + fmtTime(grace) : 'Late'; el.className = 'ex-timer over';
    if (!ex.timeUp) { ex.timeUp = true; haptic(300); openUpload(); }
  }
  if (!$('exUpload').hidden) {
    const up = $('exUpTime');
    if (left > 0) { up.textContent = `${fmtTime(left)} of writing time left. You can submit early.`; up.className = 'ex-up-time'; }
    else { up.textContent = grace > 0 ? `Time's up — pens down. Upload within ${fmtTime(grace)}.` : 'The upload window has ended. Upload now — it will be marked late.'; up.className = 'ex-up-time late'; }
  }
}
function setZoom(dir) {
  S.zoom = Math.max(0.6, Math.min(3, Math.round((S.zoom + dir * 0.25) * 100) / 100));
  $('exZoom').textContent = Math.round(S.zoom * 100) + '%';
  document.querySelectorAll('#exPaper canvas').forEach(c => { c.style.width = (c.dataset.baseW * S.zoom) + 'px'; });
}
$('exZoomIn').onclick = () => setZoom(1);
$('exZoomOut').onclick = () => setZoom(-1);
async function renderPaper(url) {
  const wrap = $('exPaper');
  wrap.innerHTML = '<div class="ex-loading"><span class="spin lg" aria-hidden="true"></span>Loading question paper…</div>';
  try {
    const pdfjs = await loadPdfJs();
    const pdf = await pdfjs.getDocument({ url }).promise;
    wrap.innerHTML = '';
    const avail = Math.min(wrap.clientWidth - 20, 900), dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (let i = 1; i <= pdf.numPages; i++) {
      if (!S.exam) return;
      const page = await pdf.getPage(i), base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: (avail / base.width) * dpr * 1.4 });
      const c = document.createElement('canvas');
      c.width = vp.width; c.height = vp.height; c.dataset.baseW = avail; c.style.width = (avail * S.zoom) + 'px';
      c.setAttribute('role', 'img'); c.setAttribute('aria-label', 'Question paper page ' + i);
      wrap.appendChild(c);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    }
  } catch (_) {
    wrap.innerHTML = `<div class="ex-loading">Couldn't show the paper here.<a class="btn primary" href="${esc(url)}" target="_blank" rel="noopener">Open question paper</a></div>`;
  }
}

// ── Answer upload ──
function resetUpload() {
  Object.assign(S.up, { photos: [], file: null, pdf: null, uploaded: null, version: S.up.version + 1 });
  $('exFile').value = ''; $('exCamera').value = ''; $('exOrder').innerHTML = ''; $('exThumbs').innerHTML = '';
  $('exFile').disabled = false; $('exCamera').disabled = false;
  const m = $('exMsg'); m.textContent = ''; m.className = 'up-msg';
  const b = $('exUpSubmit'); b.disabled = true; b.textContent = 'Submit for checking';
  $('exUpBack').disabled = false;
}
function openUpload() { if (!$('exUpload').hidden) return; $('exUpload').hidden = false; pushLayer('upload', closeUploadNow); tick(); }
function closeUploadNow() { $('exUpload').hidden = true; }
function closeUpload(after) { if (!S.up.busy) popLayer('upload', after); }
$('exSubmitOpen').onclick = openUpload;
$('exUpBack').onclick = () => closeUpload();
$('exUpload').addEventListener('click', e => { if (e.target.id === 'exUpload') closeUpload(); });
$('exFile').onchange = e => pickFiles(e.target.files);
$('exCamera').onchange = e => { pickFiles(e.target.files, true); e.target.value = ''; };
function photoOrder() {
  const wrap = $('exOrder');
  wrap.innerHTML = S.up.photos.map((f, i) => `<div class="po"><span>Page ${i + 1}</span><small>${esc(f.name)}</small>
    <button type="button" data-mv="${i}" data-dir="-1" aria-label="Move page ${i + 1} up" ${i === 0 ? 'disabled' : ''}>${ic('i-up')}</button>
    <button type="button" data-mv="${i}" data-dir="1" aria-label="Move page ${i + 1} down" ${i === S.up.photos.length - 1 ? 'disabled' : ''}>${ic('i-dn')}</button>
    <button type="button" data-rm="${i}" aria-label="Remove page ${i + 1}">${ic('i-x')}</button></div>`).join('');
  wrap.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => { if (S.up.busy) return; const i = +b.dataset.mv, j = i + +b.dataset.dir; [S.up.photos[i], S.up.photos[j]] = [S.up.photos[j], S.up.photos[i]]; pickFiles(S.up.photos.slice()); });
  wrap.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { if (S.up.busy) return; S.up.photos.splice(+b.dataset.rm, 1); pickFiles(S.up.photos.slice()); });
}
async function pickFiles(files, append) {
  if (S.up.busy) return;
  const selected = Array.from(files || []), version = ++S.up.version, msg = $('exMsg');
  S.up.file = null; S.up.pdf = null; $('exUpSubmit').disabled = true; $('exThumbs').innerHTML = '';
  try {
    if (!selected.length) { S.up.photos = []; photoOrder(); msg.className = 'up-msg'; msg.textContent = 'Choose a PDF or photos of your pages.'; return; }
    if (selected.length === 1 && NTCOfflineFiles.isPdf(selected[0]) && !append) { S.up.photos = []; photoOrder(); return await pickPdf(selected[0], version); }
    const photos = append ? S.up.photos.concat(selected) : selected;
    if (photos.some(f => !NTCOfflineFiles.isPhoto(f))) throw new Error('Choose one PDF, or JPG / PNG / WebP photos — not both.');
    if (photos.length > 25 || photos.reduce((n, f) => n + f.size, 0) > 40 * 1024 * 1024) throw new Error('Up to 25 photos, 40 MB in total.');
    S.up.photos = photos; photoOrder();
    msg.className = 'up-msg';
    const pdf = await NTCOfflineFiles.photosToPdf(photos, (i, n) => { if (version === S.up.version) msg.textContent = `Preparing page ${i} of ${n}…`; });
    if (version !== S.up.version) return;
    await pickPdf(pdf, version);
  } catch (e) {
    if (version !== S.up.version) return;
    msg.className = 'up-msg err'; msg.textContent = e.message;
  }
}
async function pickPdf(file, version) {
  const msg = $('exMsg'), thumbs = $('exThumbs');
  msg.className = 'up-msg'; msg.textContent = 'Reading your pages…';
  try {
    await NTCOfflineFiles.validatePdf(file);
    const pdfjs = await loadPdfJs();
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    if (version !== S.up.version) return;
    if (pdf.numPages > 25) throw new Error(`Your PDF has ${pdf.numPages} pages — the limit is 25.`);
    for (let i = 1; i <= pdf.numPages; i++) {
      if (version !== S.up.version) return;
      const page = await pdf.getPage(i), vp = page.getViewport({ scale: 96 / page.getViewport({ scale: 1 }).width });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; c.setAttribute('aria-label', 'Page ' + i);
      thumbs.appendChild(c);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    }
    if (version !== S.up.version) return;
    S.up.file = file; S.up.pdf = pdf;
    msg.textContent = `${plural(pdf.numPages, 'page')} ready. Check every page is clear and in order.`;
    $('exUpSubmit').disabled = false;
  } catch (e) {
    if (version !== S.up.version) return;
    msg.className = 'up-msg err';
    msg.textContent = /password/i.test(e.message || '') ? 'This PDF is password-protected. Export it again without a password.' : (e.message || 'Could not read this PDF.');
  }
}
async function pageJpeg(pdf, n) {
  const page = await pdf.getPage(n), base = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: Math.min(1600 / base.width, 2200 / base.height, 3) });
  const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return new Promise(res => c.toBlob(b => res(b), 'image/jpeg', 0.82));
}
$('exUpSubmit').onclick = async () => {
  const ex = S.exam;
  if (!ex || !S.up.file || !S.up.pdf || S.up.busy || (S.attempts[ex.test.id] || {}).status !== 'started') return;
  S.up.busy = true;
  $('exFile').disabled = true; $('exCamera').disabled = true; $('exUpBack').disabled = true;
  const msg = $('exMsg'), btn = $('exUpSubmit');
  btn.disabled = true; msg.className = 'up-msg';
  try {
    if (!S.up.uploaded || S.up.uploaded.file !== S.up.file) S.up.uploaded = { file: S.up.file, pdfUrl: '', pages: [] };
    const up = S.up.uploaded;
    btn.textContent = 'Uploading…';
    if (!up.pdfUrl) up.pdfUrl = await NTCOfflineFiles.upload(new File([S.up.file], 'answer-script.pdf', { type: 'application/pdf' }), p => { msg.textContent = `Uploading your answers… ${Math.round(p * 100)}%`; });
    for (let i = up.pages.length + 1; ex.test.gradingMode === 'ai' && i <= S.up.pdf.numPages; i++) {
      msg.textContent = `Preparing page ${i} of ${S.up.pdf.numPages} — keep this screen open.`;
      up.pages.push(await NTCOfflineFiles.upload(new File([await pageJpeg(S.up.pdf, i)], `page-${i}.jpg`, { type: 'image/jpeg' })));
    }
    btn.textContent = 'Submitting…';
    const r = await fn('offline-test', { action: 'submit', testId: ex.test.id, scriptPdfUrl: up.pdfUrl, pageUrls: up.pages });
    S.attempts[ex.test.id] = { ...S.attempts[ex.test.id], status: r.status || 'submitted', submittedAt: new Date().toISOString() };
    saveCache(); haptic(40);
    msg.className = 'up-msg ok';
    msg.textContent = 'Submitted! Your checked script will be back within 24 hours.' + (r.lateByMin > (ex.attempt.uploadGraceMin || 15) ? ' (Marked as late.)' : '');
    btn.textContent = 'Submitted';
    clearInterval(ex.timer);
    // With an answer key, reopen the test so the student can download it straight away.
    const t = ex.test;
    setTimeout(() => { S.up.busy = false; closeUpload(() => { popLayer('exam', () => { toast('Submitted. Results within 24 hours.'); if (t.hasAnswerKey) openTest(t.id); refresh(); }); }); }, 1600);
    return;
  } catch (e) {
    msg.className = 'up-msg err';
    msg.textContent = (e.message || 'Upload failed') + ' Check your internet and tap Try again.';
    btn.disabled = false; btn.textContent = 'Try again';
    $('exUpBack').disabled = false;
  }
  S.up.busy = false;
  $('exFile').disabled = false; $('exCamera').disabled = false;
};
window.addEventListener('beforeunload', e => {
  if (S.exam && (S.attempts[S.exam.test.id] || {}).status === 'started') { e.preventDefault(); e.returnValue = ''; }
});

// ═══ Onboarding form ═══
const OB_STEPS = [
  { title: 'About you', sub: 'So TNC faculty know whose script it is.', fields: ['name', 'dob', 'gender', 'phone'] },
  { title: 'Your studies', sub: 'We show papers for your class and board.', fields: ['class', 'board', 'school', 'subjects', 'target'] },
  { title: 'Address & guardian', sub: 'For results, certificates and important updates.', fields: ['address', 'city', 'state', 'pincode', 'guardianName', 'guardianRelation', 'guardianPhone', 'guardianEmail'] }
];
// Sign-up asks only what is needed to start; everything else can be added later from Profile.
const QUICK_STEP = { title: 'Quick start', sub: 'Just these to begin — add school, address and the rest any time from Profile.', fields: ['name', 'phone', 'class', 'board', 'subjects', 'guardianPhone'] };
const obSteps = () => (S.ob && S.ob.quick ? [QUICK_STEP] : OB_STEPS);
const stepFields = () => { const f = obSteps()[S.ob.step].fields; return f.includes('city') ? f.concat(['pincode']) : f; };
const draftKey = () => 'ntc-online:draft:' + S.user.uid;
function startOnboarding(editing) {
  const p = S.session.profile || {};
  let draft = null;
  try { draft = JSON.parse(localStorage.getItem(draftKey()) || 'null'); } catch (_) {}
  const base = { name: p.name || (S.user.displayName || ''), dob: p.dob || '', gender: p.gender || '', phone: p.phone || '', class: p.class || '', board: p.board || '',
    school: p.school || '', subjects: p.subjects || [], target: p.target || '', address: p.address || '', city: p.city || '', state: p.state || '', pincode: p.pincode || '',
    guardianName: p.guardianName || '', guardianRelation: p.guardianRelation || '', guardianPhone: p.guardianPhone || '', guardianEmail: p.guardianEmail || '' };
  S.ob = { step: 0, editing, quick: !editing, data: !editing && draft ? { ...base, ...draft } : base, errors: {} };
  show('onboard'); renderOb();
}
function chips(name, options, multi, labels) {
  const cur = S.ob.data[name];
  return `<div class="chips" role="${multi ? 'group' : 'radiogroup'}">${options.map(o => `<label class="chip"><input type="${multi ? 'checkbox' : 'radio'}" name="${name}" value="${esc(o)}"${(multi ? cur.includes(o) : cur === o) ? ' checked' : ''} /><span>${esc(labels ? labels(o) : o)}</span></label>`).join('')}</div>`;
}
function field(name) {
  const d = S.ob.data, locked = enrolled() && ['name', 'class', 'board'].includes(name);
  const err = `<small class="fe" data-err="${name}">${esc(S.ob.errors[name] || '')}</small>`;
  const text = (label, attrs) => `<label class="fl${S.ob.errors[name] ? ' bad' : ''}"><span>${label}</span><input name="${name}" value="${esc(d[name])}" ${attrs || ''}${locked ? ' readonly' : ''} /></label>${err}`;
  const group = (label, html, optional) => `<fieldset class="fl${S.ob.errors[name] ? ' bad' : ''}"><legend>${label}${optional ? ' <i>optional</i>' : ''}</legend>${html}</fieldset>${err}`;
  const maxDob = new Date(Date.now() - 8 * 365.25 * 86400000).toISOString().slice(0, 10);
  switch (name) {
    case 'name': return text('Full name', 'autocomplete="name" autocapitalize="words" maxlength="80" placeholder="As on school records"');
    case 'dob': return text('Date of birth', `type="date" max="${maxDob}" min="1995-01-01"`);
    case 'gender': return group('Gender', chips('gender', P.GENDERS), true);
    case 'phone': return text('Your mobile number', 'type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="10-digit number"');
    case 'class': return locked ? `<div class="locked-row">${ic('i-shield')}Class ${esc(d.class)} · ${esc(d.board || '')} <small>from your TNC record</small></div>` : group('Class', chips('class', P.CLASSES, false, c => 'Class ' + c));
    case 'board': return locked ? '' : group('Board', chips('board', P.BOARDS));
    case 'school': return text('School name', 'autocomplete="organization" maxlength="120" placeholder="e.g. Delhi Public School, Newtown"');
    case 'subjects': return `<div data-f="subjects">${group('Subjects', chips('subjects', P.subjectsFor(d.board, d.class), true, s => s === 'Computer' ? 'Computer Science' : s))}${subjectHint(d)}</div>`;
    case 'target': return group('Preparing for', chips('target', P.TARGETS), true);
    case 'address': return text('Address', 'autocomplete="street-address" maxlength="200" placeholder="House / flat, street, area"');
    case 'city': return `<div class="fl-pair"><div>${text('City / town', 'autocomplete="address-level2" maxlength="60"')}</div><div>${(() => { const e = `<small class="fe" data-err="pincode">${esc(S.ob.errors.pincode || '')}</small>`; return `<label class="fl${S.ob.errors.pincode ? ' bad' : ''}"><span>PIN code</span><input name="pincode" value="${esc(d.pincode)}" inputmode="numeric" autocomplete="postal-code" /></label>${e}`; })()}</div></div>`;
    case 'pincode': return '';
    case 'state': return `<label class="fl${S.ob.errors.state ? ' bad' : ''}"><span>State / UT</span><select name="state" autocomplete="address-level1"><option value="">Choose</option>${P.STATES.map(s => `<option${d.state === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select></label>${err}`;
    case 'guardianName': return text("Parent / guardian's name", 'autocomplete="off" autocapitalize="words" maxlength="80"');
    case 'guardianRelation': return group('Relation', chips('guardianRelation', P.RELATIONS));
    case 'guardianPhone': return text("Parent / guardian's mobile", 'type="tel" inputmode="numeric" placeholder="10-digit number"');
    case 'guardianEmail': return text("Parent's email (optional)", 'type="email" inputmode="email" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="120" placeholder="Results are emailed here"');
    default: return '';
  }
}
// CBSE: one Science paper up to Class 10; ICSE / ISC: Physics, Chemistry, Biology.
function subjectHint(d) {
  const b = String(d.board || '').toUpperCase(), c = parseInt(d.class, 10) || 0;
  const t = b === 'CBSE' && c && c <= 10 ? 'CBSE up to Class 10 has one Science paper.' : b === 'ICSE' ? 'ICSE / ISC has Physics, Chemistry and Biology as separate papers.' : !b || !c ? 'Choose your class and board to see your subjects.' : '';
  return t ? `<p class="ob-hint">${esc(t)}</p>` : '';
}
function renderOb() {
  const steps = obSteps(), step = steps[S.ob.step], n = S.ob.step + 1;
  $('obTitle').textContent = step.title; $('obSub').textContent = step.sub;
  $('obStep').textContent = steps.length > 1 ? `${n}/${steps.length}` : '';
  $('obBar').style.transform = `scaleX(${n / steps.length})`;
  $('obBody').innerHTML = step.fields.map(field).join('')
    + (S.ob.quick ? '<button type="button" class="link ob-more" data-ob-full>Add all my details now</button>' : '');
  $('obNext').textContent = S.ob.quick ? 'Start my tests' : n === steps.length ? (S.ob.editing ? 'Save details' : 'Finish') : 'Continue';
  $('obBack').setAttribute('aria-label', S.ob.step === 0 && !S.ob.editing ? 'Use a different account' : 'Back');
  $('obErr').textContent = '';
  $('obBody').scrollTop = 0;
}
function readOb() {
  const d = S.ob.data, form = $('obForm');
  stepFields().forEach(name => {
    const els = form.querySelectorAll(`[name="${name}"]`);
    if (!els.length) return;
    if (name === 'subjects') d.subjects = [...els].filter(e => e.checked).map(e => e.value);
    else if (els[0].type === 'radio') { const c = [...els].find(e => e.checked); d[name] = c ? c.value : ''; }
    else d[name] = els[0].value;
  });
  try { if (!S.ob.editing) localStorage.setItem(draftKey(), JSON.stringify(d)); } catch (_) {}
}
$('obForm').addEventListener('change', e => {
  readOb();
  // Class or board changed: keep only that board's subjects and redraw the subject chips in place.
  if (['class', 'board'].includes(e.target.name)) {
    const d = S.ob.data, box = $('obBody').querySelector('[data-f="subjects"]');
    d.subjects = (d.subjects || []).filter(x => P.subjectAllowed(x, d.board, d.class));
    if (box) box.outerHTML = field('subjects');
    try { if (!S.ob.editing) localStorage.setItem(draftKey(), JSON.stringify(d)); } catch (_) {}
  }
});
$('obForm').addEventListener('click', e => {
  if (!e.target.closest('[data-ob-full]')) return;
  readOb(); S.ob.quick = false; S.ob.step = 0; S.ob.errors = {}; renderOb();
});
$('obForm').addEventListener('input', e => {
  // Digits only; a pasted "+91 98765 43210" or "098765 43210" keeps its 10 digits.
  if (e.target.name === 'phone' || e.target.name === 'guardianPhone') { let d = e.target.value.replace(/\D/g, ''); if (d.length > 10) d = d.replace(/^(91|0)/, ''); e.target.value = d.slice(0, 10); }
  if (e.target.name === 'pincode') e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
  const box = e.target.closest('.fl'); if (box && box.classList.contains('bad')) { box.classList.remove('bad'); const fe = $('obBody').querySelector(`[data-err="${e.target.name}"]`); if (fe) fe.textContent = ''; }
});
$('obBack').onclick = () => {
  readOb();
  if (S.ob.step > 0) { S.ob.step--; renderOb(); return; }
  if (!S.ob.editing && !S.ob.quick) { S.ob.quick = true; S.ob.errors = {}; renderOb(); return; }   // back to the quick page
  if (S.ob.editing) { show('app'); render(); return; }
  signOutNow();
};
$('obForm').onsubmit = async e => {
  e.preventDefault(); readOb();
  // Only the quick-start fields are required; anything else filled in must be valid.
  const check = P.validateProfile(S.ob.data, { enrolled: enrolled(), quick: true }), here = stepFields();
  S.ob.errors = Object.fromEntries(Object.entries(check.errors).filter(([k]) => here.includes(k)));
  if (Object.keys(S.ob.errors).length) {
    renderOb(); haptic(30);
    const first = $('obBody').querySelector('.bad input, .bad select, .bad'); if (first && first.focus) first.focus();
    return;
  }
  if (S.ob.step < obSteps().length - 1) { S.ob.step++; S.ob.errors = {}; renderOb(); return; }
  if (!check.ok) { const k = Object.keys(check.errors)[0]; S.ob.step = Math.max(0, obSteps().findIndex(s => s.fields.includes(k) || (k === 'pincode' && s.fields.includes('city')))); S.ob.errors = check.errors; renderOb(); return; }
  const done = busy($('obNext'), 'Saving…');
  try {
    const res = await fn('online-series', { action: 'save-profile', profile: S.ob.data });
    try { localStorage.removeItem(draftKey()); } catch (_) {}
    const editing = S.ob.editing, classChanged = S.session.profile.class !== res.profile.class;
    S.session.profile = res.profile; S.ob = null;
    if (editing && !classChanged) { saveCache(); show('app'); render(); toast('Details saved.'); }
    else { show('boot'); bootMessage(''); await refresh(); toast(editing ? 'Details saved.' : `Welcome, ${firstName()}! Pick a subject for your free mock test.${res.profile.detailsComplete ? '' : ' Add the rest of your details any time from Profile.'}`); }
  } catch (err) {
    $('obErr').textContent = err.message;
    if (err.data && err.data.fields) { S.ob.errors = err.data.fields; }
  } finally { done(); }
};

// ═══ Connection status and periodic refresh ═══
function net() { $('netBadge').hidden = navigator.onLine !== false; }
window.addEventListener('online', () => { net(); if (S.session) refresh(); });
window.addEventListener('offline', net);
net();
setInterval(() => {   // keep "minutes left" pills honest without a full reload
  if (S.session && !S.exam && $('sheet').hidden && document.body.dataset.screen === 'app' && Object.values(S.attempts).some(a => a.status === 'started')) render();
}, 30000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.session && !S.exam && Date.now() - (S.lastRefresh || 0) > 60000) { S.lastRefresh = Date.now(); refresh(); }
});
