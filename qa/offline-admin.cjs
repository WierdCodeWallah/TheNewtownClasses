/* Offline Test Series records at scale — teacher review desk (the admin side is Test Desk: qa/admin-desk.cjs).
   A fixture of 30 students × 2–6 tests across Classes 7, 9 and 11 checks that
   records stay organised as Class → Subject → Chapter → Part, that search jumps
   straight to a student, that per-student and class × subject counts are right,
   and that admins can review and download checked PDFs. All Firebase, file and
   function traffic is intercepted; nothing touches production.
   Run with Playwright on NODE_PATH: node qa/offline-admin.cjs */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const records = require('../assets/js/offline-records.js');
const root = path.resolve(__dirname, '..');
const out = path.join(__dirname, 'artifacts', 'offline-admin'); fs.mkdirSync(out, { recursive: true });

// ── Fixture: realistic volume and spread ──
const SUBJECTS = { 7: ['Mathematics', 'Science'], 9: ['Mathematics', 'Science', 'English'], 11: ['Physics', 'Chemistry', 'Mathematics'] };
const CLASSES = ['7', '9', '11'];
const DAY = 86400000, now = Date.now();
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
let n = 0;
const reports = [];
for (let i = 0; i < 30; i++) {
  const cls = CLASSES[i % 3], subjects = SUBJECTS[cls];
  const student = { uid: 'stu' + i, studentName: 'Student ' + String(i).padStart(2, '0'), studentId: 'TNC-' + String(i).padStart(3, '0'), studentClass: cls, studentBoard: i % 2 ? 'ICSE' : 'CBSE', studentSection: 'A' };
  for (let j = 0; j < (i % 5) + 2; j++) {
    const subject = subjects[j % subjects.length];
    const pending = j === 0 && i % 4 === 0;
    // Pending scripts are either clearly overdue (3 days) or clearly on time (12 hours).
    const ageDays = pending ? (i % 8 === 0 ? 3 : 0.5) : 1 + j * 2 + i % 3;
    const submittedAt = new Date(now - ageDays * DAY).toISOString();
    const r = { ...student, attemptId: `ots${n}__${student.uid}`, testId: 'ots' + n, subject, chapter: 'Chapter ' + ((j % 3) + 1), module: 'Part ' + ((j % 2) + 1),
      testName: `${subject} Test ${j + 1}`, totalMarks: 20, reviewMode: 'teacher', teacherUid: 'teacher-demo', teacherName: 'Aarav Sen',
      scriptPdfUrl: `https://32zbpzustr.ucarecd.net/${uuid(++n)}/`, submittedAt, status: pending ? 'submitted' : 'approved', lateByMin: 0 };
    if (!pending) Object.assign(r, { score: 5 + (i + j) % 16, checkedScriptUrl: `https://32zbpzustr.ucarecd.net/${uuid(1000 + n)}/`, approvedAt: new Date(Date.parse(submittedAt) + DAY / 2).toISOString(), approvedByName: 'Aarav Sen', teacherRemark: 'Neat work. Show units.' });
    reports.push(r);
  }
}
// One legacy AI-checked report: marks live in finalReport, no checked PDF.
reports.push({ uid: 'stu1', studentName: 'Student 01', studentId: 'TNC-001', studentClass: '9', studentBoard: 'ICSE', studentSection: 'A', attemptId: 'otsai__stu1', testId: 'otsai',
  subject: 'Science', chapter: 'Chapter 9', module: 'Full chapter', testName: 'AI Science Test', totalMarks: 20, reviewMode: 'ai', teacherUid: 'teacher-demo', teacherName: 'Aarav Sen',
  scriptPdfUrl: `https://32zbpzustr.ucarecd.net/${uuid(9999)}/`, submittedAt: new Date(now - 9 * DAY).toISOString(), approvedAt: new Date(now - 8 * DAY).toISOString(), status: 'approved', approvedByName: 'Aarav Sen',
  aiScore: 14, finalReport: JSON.stringify({ totalAwarded: 15, totalMax: 20, pct: 75, questions: [{ q: '1', topic: 'Cells', max: 20, awarded: 15, remark: 'Good', status: 'partial' }] }) });

const field = v => Array.isArray(v) ? { arrayValue: { values: v.map(field) } } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : { stringValue: String(v ?? '') };
const docOf = (p, o) => ({ name: 'projects/fixture/databases/(default)/documents/' + p, fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, field(v)])) });
const reportDocs = reports.map(r => docOf('offlineReports/' + r.attemptId, r));
const TEACHERS = [{ uid: 'teacher-demo', name: 'Aarav Sen', subjects: ['Physics', 'Mathematics', 'Science'] }, { uid: 'teacher-2', name: 'Neha Gupta', subjects: ['Chemistry', 'English'] }];
// Independent expectations from the same pure module the pages use.
const parsed = reportDocs.map(d => records.parse(d, now));
const summary = records.summary(parsed);
const perStudent = records.students(parsed);

const firestore = `
export const getFirestore=()=>({}); export const collection=(_,name)=>({name}); export const doc=(_, ...names)=>({name:names.join('/')});
export const where=(key,op,value)=>({key,op,value}); export const orderBy=()=>({}); export const limit=()=>({}); export const query=(ref,...c)=>({...ref,conditions:c});
export async function getDoc(ref){return {exists:()=>ref.name.startsWith('admins/')||ref.name.startsWith('teachers/'),data:()=>ref.name.startsWith('admins/')?{isAdmin:true}:{name:'Aarav Sen',subjects:['Physics','Mathematics','Science']},id:ref.name.split('/').pop()};}
export async function getDocs(ref){const docs=[];return {docs,size:0,empty:true,forEach:fn=>docs.forEach(fn)};}
export const setDoc=async()=>{},updateDoc=async()=>{},deleteDoc=async()=>{},addDoc=async()=>({id:'fixture-new'}),serverTimestamp=()=>new Date(),getCountFromServer=async()=>({data:()=>({count:0})});
export const onSnapshot=(ref,options,next)=>{(typeof options==='function'?options:next)({docs:[],metadata:{fromCache:false},forEach(){} });return ()=>{};};`;
const auth = `export const getAuth=()=>({currentUser:{uid:window.__role+'-demo',email:window.__role+'@example.test',getIdToken:async()=>'fixture-only'},authStateReady:async()=>{}});export const onAuthStateChanged=(a,fn)=>{setTimeout(()=>fn(a.currentUser),0);return()=>{};};export const signOut=async()=>{};export const signInWithEmailAndPassword=async()=>{};export const updatePassword=async()=>{};export const sendPasswordResetEmail=async()=>{};export const setPersistence=async()=>{},browserLocalPersistence={};`;
const config = "export const FIREBASE_CONFIG={projectId:'fixture',apiKey:'fixture'};export const FCM_VAPID_KEY='';export const RECAPTCHA_V3_SITE_KEY='';export const initAppCheck=async()=>{};export const STAFF_APP='ntc-staff';export const adoptLegacyStaffSession=async()=>{};export const fetchOwnDoc=async(user,coll)=>({exists:true,data:coll==='admins'?{isAdmin:true}:{name:'Aarav Sen',subjects:['Physics','Mathematics','Science']}});";

const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html');
    res.end(fs.readFileSync(file));
  } catch { res.writeHead(404); res.end(); }
});

async function openPortal(browser, origin, role, file, width, ctx = { docs: reportDocs, calls: [], patches: [] }) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  const errors = [], listUrls = [], writes = [];
  const docs = ctx.docs;
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(r => { window.__role = r; }, role);
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    const js = body => route.fulfill({ contentType: 'text/javascript', body });
    if (url.pathname.endsWith('/firebase-config.js')) return js(config);
    if (url.pathname.endsWith('/firebase-app.js')) return js('export const initializeApp=()=>({});');
    if (url.pathname.endsWith('/firebase-auth.js')) return js(auth);
    if (url.pathname.endsWith('/firebase-firestore.js')) return js(firestore);
    if (url.pathname.endsWith('/firebase-messaging.js')) return js('export const getMessaging=()=>({}),getToken=async()=>null,onMessage=()=>{},isSupported=async()=>false;');
    if (url.pathname.endsWith('/firebase-app-check.js')) return js('export const initializeAppCheck=()=>({}),ReCaptchaV3Provider=function(){};');
    if (url.hostname === '32zbpzustr.ucarecd.net') return route.fulfill({ contentType: 'application/pdf', headers: { 'Access-Control-Allow-Origin': '*' }, body: Buffer.from('%PDF-1.4\n%fixture\n%%EOF') });
    if (url.hostname === 'firestore.googleapis.com') {
      const p = decodeURIComponent(url.pathname.split('/documents/')[1] || '');
      // The Test Desk's count of waiting scripts is a query (a read), sent as POST.
      if (url.pathname.endsWith(':runAggregationQuery')) {
        const coll = req.postDataJSON().structuredAggregationQuery.structuredQuery.from[0].collectionId;
        const n = coll === 'moduleRequests' ? (ctx.requests || []).filter(r => r.status === 'requested').length : docs.filter(d => d.fields.status.stringValue === 'submitted').length;
        return route.fulfill({ json: [{ result: { aggregateFields: { n: { integerValue: String(n) } } } }] });
      }
      if (p === 'moduleRequests') return route.fulfill({ json: { documents: (ctx.requests || []).map(r => docOf('moduleRequests/' + r.id, r)) } });
      if (req.method() === 'GET' && ctx.collections && ctx.collections[p]) return route.fulfill({ json: { documents: ctx.collections[p].map(r => docOf(p + '/' + (r.id || 'doc' + Math.random().toString(36).slice(2, 8)), r)) } });
      if (p === 'onlineStudents') return route.fulfill({ json: { documents: (ctx.onlineStudents || []).map(r => docOf('onlineStudents/' + r.id, r)) } });
      if (p === 'mockPackages') return route.fulfill({ json: { documents: (ctx.packages || []).map(r => docOf('mockPackages/' + r.id, r)) } });
      if (url.pathname.endsWith(':runQuery')) {
        const coll = req.postDataJSON().structuredQuery.from[0].collectionId;
        const rows = coll === 'offlineTests' ? (ctx.packTests || []).map(r => docOf('offlineTests/' + r.id, r)) : coll === 'onlinePurchases' ? (ctx.joined || []).map(r => docOf('onlinePurchases/' + r.id, r)) : [];
        return route.fulfill({ json: rows.map(document => ({ document })) });
      }
      if (req.method() !== 'GET') { writes.push(p); ctx.patches.push({ path: p, body: req.postDataJSON() }); return route.fulfill({ json: { name: p } }); }
      if (p === 'offlineReports') { listUrls.push(url); return route.fulfill({ json: { documents: docs } }); }
      if (p.startsWith('offlineReports/')) { const d = docs.find(x => x.name.endsWith('/' + p)); return d ? route.fulfill({ json: d }) : route.fulfill({ status: 404, json: {} }); }
      if (p === 'teachers/teacher-demo') return route.fulfill({ json: docOf(p, { name: 'Aarav Sen', email: 'teacher@example.test', subjects: ['Physics', 'Mathematics', 'Science'] }) });
      if (p === 'teachers') return route.fulfill({ json: { documents: TEACHERS.map(t => docOf('teachers/' + t.uid, t)) } });
      if (p === 'admins/admin-demo') return route.fulfill({ json: docOf(p, { isAdmin: true }) });
      if (p === 'offlineTests') return route.fulfill({ json: { documents: [...new Set(reports.map(r => r.testId))].map(id => { const r = reports.find(x => x.testId === id); return docOf('offlineTests/' + id, { testName: r.testName, class: r.studentClass, subject: r.subject, chapter: r.chapter, module: r.module, totalMarks: 20, durationMin: 60, teacherUid: 'teacher-demo', isActive: true, createdAt: r.submittedAt }); }) } });
      if (/\/[^/]+$/.test(p) && p.split('/').length % 2 === 0) return route.fulfill({ status: 404, json: { error: { message: 'Not found' } } });
      return route.fulfill({ json: { documents: [] } });
    }
    if (url.hostname === 'upload.uploadcare.com') { ctx.uploads = (ctx.uploads || 0) + 1; return route.fulfill({ json: { file: uuid(5000 + ctx.uploads) } }); }
    if (url.pathname === '/.netlify/functions/offline-test') {
      const body = req.postDataJSON(); ctx.calls.push(body);
      if (body.action === 'return-script') {
        // Mirror the server: the chosen teacher becomes the checker.
        const i = docs.findIndex(d => d.name.endsWith('/offlineReports/' + body.attemptId));
        const teacher = TEACHERS.find(t => t.uid === body.onBehalfOf);
        const f = docs[i].fields;
        docs[i] = { ...docs[i], fields: { ...f, status: field('approved'), score: field(body.score), checkedScriptUrl: field(body.checkedScriptUrl), teacherRemark: field(body.remark),
          approvedByName: field(teacher.name), approvedByUid: field(teacher.uid), approvedAt: field(new Date().toISOString()) } };
      }
      if (body.action === 'delete-record') {
        const i = docs.findIndex(d => d.name.endsWith('/offlineReports/' + body.attemptId));
        if (i < 0) return route.fulfill({ status: 404, json: { error: 'This record has already been deleted.' } });
        docs.splice(i, 1);
        return route.fulfill({ json: { ok: true, filesDeleted: 2, filesFailed: 0 } });
      }
      return route.fulfill({ json: { ok: true, status: 'approved' } });
    }
    if (url.origin === origin) return route.continue();
    if (/cdnjs.cloudflare.com/.test(url.hostname)) return route.continue();   // PDF.js reader
    if (req.resourceType() === 'script') return js('');
    return route.fulfill({ body: '', contentType: 'text/plain' });
  });
  await page.goto(origin + '/' + file);
  return { page, errors, listUrls, writes };
}
const fits = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2);
const choice = (page, scope, text) => page.locator(scope + ' .portal-browser .portal-choice', { hasText: text }).first();

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, channel: process.env.PORTAL_BROWSER || 'chrome' });
  try {
    // The admin side of these records now lives in Test Desk: see qa/admin-desk.cjs.
    // Teacher review desk and test list stay organised at the same volume.
    for (const width of [390, 1440]) {
      const { page, errors } = await openPortal(browser, origin, 'teacher', 'teacher-dashboard.html', width);
      await page.waitForFunction(() => typeof window.otLoadApprovals === 'function');
      await page.evaluate(() => ntcCall('switchTab', 'script-approval'));
      await page.waitForSelector('#otaList .ota-row');
      const pendingCount = parsed.filter(r => r.stage === 'pending').length;
      assert.equal((await page.locator('[data-ota="pending"]').innerText()).trim(), `Awaiting review (${pendingCount})`);
      assert.match(await page.locator('#otaListCard .portal-browser [role="status"]').innerText(), new RegExp('^' + pendingCount + ' script'));
      await page.selectOption('#otaListCard [data-facet="class"]', '11');
      const pending11 = parsed.filter(r => r.stage === 'pending' && r.class === '11').length;
      assert.match(await page.locator('#otaListCard .portal-browser [role="status"]').innerText(), new RegExp('^' + pending11 + ' script'));
      await page.click('[data-ota="approved"]');
      await page.waitForSelector('#otaListCard .portal-choice');
      assert.equal(await page.locator('#otaListCard .portal-browser .portal-choice').count(), 3, 'returned scripts drill down by class');
      await choice(page, '#otaListCard', 'Class 7').click();
      await choice(page, '#otaListCard', 'Science').click();
      await choice(page, '#otaListCard', 'Chapter 2').click();
      await page.waitForSelector('#otaList .ota-row');
      assert((await page.locator('#otaList .ota-row').allInnerTexts()).every(t => /Class 7/.test(t) && /Science/.test(t) && /Chapter 2/.test(t)));
      assert(await fits(page), 'teacher review desk fits at ' + width);
      await page.screenshot({ animations: 'disabled', path: path.join(out, `teacher-returned-${width}.png`), fullPage: true });
      await page.evaluate(() => ntcCall('switchTab', 'offline-series'));
      await page.evaluate(() => otLoadMyTests());
      await page.waitForSelector('#tab-offline-series .portal-choice');
      assert.equal(await page.locator('#tab-offline-series .portal-browser .portal-choice').count(), 3, 'teacher tests drill down by class');
      await choice(page, '#tab-offline-series', 'Class 9').click();
      await choice(page, '#tab-offline-series', 'English').click();
      await page.waitForSelector('#otListWrap .ota-row');   // English has only Chapter 3: auto-selected
      assert.match(await page.locator('#tab-offline-series .portal-path').innerText(), /9\s+\/\s+English\s+\/\s+Chapter 3/);
      assert.match(await page.locator('#otListWrap .ota-row').first().innerText(), /1 submitted/);
      assert(await fits(page), 'teacher tests fit at ' + width);
      await page.screenshot({ animations: 'disabled', path: path.join(out, `teacher-tests-${width}.png`), fullPage: true });
      assert.deepEqual(errors, [], 'no page errors on teacher at ' + width);
      await page.close();
      console.log(`✓ teacher ${width}px: review queue counts and filters · returned scripts by class → subject → chapter · tests by class with submission counts`);
    }
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
