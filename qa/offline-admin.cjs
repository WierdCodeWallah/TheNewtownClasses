/* Offline Test Series records at scale — admin section and teacher review desk.
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
    for (const width of [320, 390, 768, 1440]) {
      const { page, errors, listUrls, writes } = await openPortal(browser, origin, 'admin', 'admin-panel.html', width);
      await page.waitForFunction(() => typeof window.loadOfflineRecords === 'function' && typeof window.switchAdminTab === 'function');
      await page.evaluate(() => switchAdminTab('offline-series'));
      await page.waitForSelector('#oadKpis .oar-kpi');
      // Summary tiles match independently computed totals.
      const kpis = await page.locator('#oadKpis').innerText();
      assert.match(kpis, new RegExp(`${summary.total}\\s+Tests submitted`));
      assert.match(kpis, new RegExp(`${summary.students}\\s+Students`));
      assert.match(kpis, new RegExp(`${summary.returned}\\s+Returned`));
      assert.match(kpis, new RegExp(`${summary.pending + summary.checking}\\s+Awaiting review`));
      assert.match(kpis, new RegExp(`${summary.overdue}\\s+Overdue`));
      assert(summary.overdue > 0 && summary.pending > 0, 'fixture includes pending and overdue scripts');
      // List reads ask only for the needed fields (no large AI report text).
      assert(listUrls.length && listUrls.every(u => u.searchParams.getAll('mask.fieldPaths').includes('studentName') && !u.searchParams.getAll('mask.fieldPaths').includes('aiReport')), 'records list uses a field mask');

      // Records: Class → Subject → Chapter, then parts/tests/status filters.
      await page.waitForSelector('#oadRecordsPane .portal-choice');
      assert.equal(await page.locator('#oadRecordsPane .portal-browser .portal-choice').count(), 3, 'three classes at the first level');
      assert.match(await choice(page, '#oadRecordsPane', 'Class 11').innerText(), /\d+ submissions · \d+% avg/);
      // Class 11 Physics has a single chapter, so that level is skipped automatically.
      await choice(page, '#oadRecordsPane', 'Class 11').click();
      await choice(page, '#oadRecordsPane', 'Physics').click();
      await page.waitForSelector('#oadRecords .oar-row');
      assert.match(await page.locator('#oadRecordsPane .portal-path').innerText(), /11\s+\/\s+Physics\s+\/\s+Chapter 1/, 'single chapter auto-selected');
      // Class 7 Mathematics spans three chapters, so the chapter step is shown.
      await page.locator('#oadRecordsPane .portal-browser [data-reset]').first().click();
      await choice(page, '#oadRecordsPane', 'Class 7').click();
      await choice(page, '#oadRecordsPane', 'Mathematics').click();
      assert.equal(await page.locator('#oadRecordsPane .portal-browser .portal-choice').count(), new Set(parsed.filter(r => r.class === '7' && r.subject === 'Mathematics').map(r => r.chapter)).size, 'one card per chapter');
      await choice(page, '#oadRecordsPane', 'Chapter 1').click();
      await page.waitForSelector('#oadRecords .oar-row');
      const leaf = parsed.filter(r => r.class === '7' && r.subject === 'Mathematics' && r.chapter === 'Chapter 1');
      assert.match(await page.locator('#oadRecordsPane .portal-browser [role="status"]').innerText(), new RegExp('^' + leaf.length + ' submission'));
      assert.equal(await page.locator('#oadRecords .oar-row').count(), Math.min(leaf.length, width <= 600 ? 6 : 12));
      assert.match(await page.locator('#oadRecordsPane .portal-path').innerText(), /7\s+\/\s+Mathematics\s+\/\s+Chapter 1/);
      assert(await page.locator('#oadRecordsPane [data-facet="stage"]').isVisible(), 'status filter stays visible at the record level');
      assert(await fits(page), 'records fit at ' + width);
      await page.screenshot({ animations: 'disabled', path: path.join(out, `admin-records-${width}.png`), fullPage: true });

      // Search jumps straight to a student from anywhere.
      await page.locator('#oadRecordsPane .portal-browser [data-reset]').first().click();
      const target = perStudent.find(s => s.studentId === 'TNC-004');
      await page.fill('#oadRecordsPane .portal-search input', 'TNC-004');
      await page.waitForFunction(n => document.querySelectorAll('#oadRecords .oar-row').length === n, Math.min(target.total, width <= 600 ? 6 : 12));
      assert((await page.locator('#oadRecords .oar-row').allInnerTexts()).every(t => t.includes('Student 04')));

      // Review sheet: facts, feedback, open + named download, Escape restores focus.
      const reviewBtn = page.locator('#oadRecords .oar-row', { hasText: 'Student 04' }).filter({ has: page.locator('[data-kind="checked"]') }).first().locator('[data-oad-review]');
      await reviewBtn.click();
      await page.waitForSelector('#oadModal:not([hidden])');
      const sheet = await page.locator('#oadModalBody').innerText();
      assert.match(sheet, /TNC-004/); assert.match(sheet, /Neat work\. Show units\./); assert.match(sheet, /Checked by\s+Aarav Sen/);
      assert.match(await page.locator('#oadModalBody a', { hasText: 'Open checked PDF' }).getAttribute('href'), /^https:\/\/32zbpzustr\.ucarecd\.net\//);
      const download = page.waitForEvent('download');
      await page.locator('#oadModalBody [data-kind="checked"]').click();
      assert.match((await download).suggestedFilename(), /^Student_04_TNC-004_.+_checked\.pdf$/);
      assert(await fits(page), 'review sheet fits at ' + width);
      await page.screenshot({ animations: 'disabled', path: path.join(out, `admin-review-${width}.png`) });
      await page.keyboard.press('Escape');
      assert(await page.locator('#oadModal').isHidden());
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.oadReview || ''), await reviewBtn.getAttribute('data-oad-review'), 'focus returns to the Review button');

      // Students: totals and per-subject counts, sort, subject focus, jump to records.
      await page.click('[data-oad-view="students"]');
      await page.selectOption('#oadStudentSort', 'tests');
      await page.waitForSelector('#oadStudentsPane .portal-choice');
      assert.equal(await page.locator('#oadStudentsPane .portal-browser .portal-choice').count(), 3, 'students grouped by class');
      await choice(page, '#oadStudentsPane', 'Class 9').click();
      await page.waitForSelector('#oadStudents .oar-row');
      const class9 = perStudent.filter(s => s.class === '9').sort((a, b) => b.total - a.total || a.studentName.localeCompare(b.studentName));
      const first = await page.locator('#oadStudents .oar-row').first().innerText();
      assert.match(first, new RegExp(class9[0].studentName)); assert.match(first, new RegExp(class9[0].total + '\\s+tests'));
      class9[0].subjects.forEach(x => assert(first.includes(`${x.subject} · ${x.count}`), 'subject breakdown for ' + x.subject));
      await page.selectOption('#oadStudentsPane [data-facet="subject"]', 'English');
      await page.waitForFunction(() => /English test/.test(document.querySelector('#oadStudents .oar-row')?.innerText || ''));
      const english = perStudent.filter(s => s.class === '9' && s.subjectNames.includes('English'));
      assert.match(await page.locator('#oadStudentsPane .portal-browser [role="status"]').innerText(), new RegExp('^' + english.length + ' student'));
      assert(await fits(page), 'students fit at ' + width);
      await page.screenshot({ animations: 'disabled', path: path.join(out, `admin-students-${width}.png`), fullPage: true });
      await page.locator('#oadStudents [data-oad-student]').first().click();
      await page.waitForFunction(() => !document.getElementById('oadRecordsPane').hidden && document.querySelector('#oadRecordsPane .portal-search input').value.length > 0);
      assert.match(await page.inputValue('#oadRecordsPane .portal-search input'), /^tnc-\d{3}$/);

      // Class × Subject grid: every class row, correct totals, cells open records.
      await page.click('[data-oad-view="matrix"]');
      await page.waitForSelector('.oar-matrix');
      assert.equal(await page.locator('.oar-matrix tbody tr').count(), summary.classes.length);
      assert.equal((await page.locator('.oar-matrix tfoot td').last().innerText()).trim(), String(summary.total));
      const cell = summary.cell('11', 'Chemistry');
      const cellBtn = page.locator('.oar-cell[data-oad-cell-class="11"][data-oad-cell-subject="Chemistry"]');
      assert.match(await cellBtn.innerText(), new RegExp('^' + cell.count));
      assert(await fits(page), 'grid page fits at ' + width);
      await page.screenshot({ animations: 'disabled', path: path.join(out, `admin-matrix-${width}.png`), fullPage: true });
      await cellBtn.click();
      await page.waitForFunction(() => !document.getElementById('oadRecordsPane').hidden);
      assert.match(await page.locator('#oadRecordsPane .portal-path').innerText(), /11\s+\/\s+Chemistry/);

      // Legacy AI-checked record: marks come from the report; report opens in the sheet.
      await page.locator('#oadRecordsPane .portal-browser [data-reset]').first().click();
      await page.fill('#oadRecordsPane .portal-search input', 'AI Science');
      await page.waitForSelector('#oadRecords .oar-row');
      assert.match(await page.locator('#oadRecords .oar-row').first().innerText(), /15 \/ 20/);
      await page.locator('#oadRecords [data-oad-review]').first().click();
      await page.click('#oadAiReport');
      await page.waitForFunction(() => document.getElementById('oadAiReportBody').children.length > 0);
      await page.click('#oadModalClose');

      assert.deepEqual(writes, [], 'admin records are read-only');
      assert.deepEqual(errors, [], 'no page errors on admin at ' + width);
      await page.close();
      console.log(`✓ admin ${width}px: ${summary.total} records · drill-down · search · review + named download · student counts · class × subject grid`);
    }

    // Admin acts in a teacher's name: publish a test, then check and return a script.
    const pdfFile = path.join(out, 'checked.pdf');
    fs.writeFileSync(pdfFile, (() => { const b = 'BT /F1 18 Tf 60 760 Td (Checked) Tj ET'; const o = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', `<< /Length ${b.length} >>\nstream\n${b}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
      let p = '%PDF-1.4\n'; const f = []; o.forEach((x, i) => { f.push(p.length); p += `${i + 1} 0 obj\n${x}\nendobj\n`; }); const xr = p.length;
      return p + 'xref\n0 6\n0000000000 65535 f \n' + f.map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xr}\n%%EOF`; })());
    for (const width of [390, 1440]) {
      const ctx = { docs: reportDocs.map(d => JSON.parse(JSON.stringify(d))), calls: [], patches: [] };
      const { page, errors } = await openPortal(browser, origin, 'admin', 'admin-panel.html', width, ctx);
      await page.waitForFunction(() => typeof window.loadOfflineRecords === 'function' && typeof window.switchAdminTab === 'function');
      await page.evaluate(() => switchAdminTab('offline-series'));
      await page.waitForSelector('#oadKpis .oar-kpi');

      // Tests view: every teacher's tests, organised, with a teacher filter.
      await page.click('[data-oad-view="tests"]');
      await page.waitForSelector('#oadTestsPane .portal-choice');
      assert.equal(await page.locator('#oadTestsPane .portal-browser .portal-choice').count(), 3, 'tests drill down by class');
      await page.click('#oatPublishBox summary');
      assert.match(await page.locator('#oatTeacher').innerText(), /Aarav Sen[\s\S]*Neha Gupta/);
      await page.click('#oatPublishBtn');
      assert.match(await page.locator('#oatMsg').innerText(), /Choose the teacher/, 'publishing needs a teacher');
      await page.selectOption('#oatTeacher', 'teacher-2');
      await page.selectOption('#oatClass', '11');
      await page.selectOption('#oatSubject', 'Chemistry');
      await page.fill('#oatChapter', 'Solutions');
      await page.fill('#oatModule', 'Part 2 · Colligative properties');
      await page.fill('#oatName', 'Weekly Test 4');
      await page.fill('#oatMarks', '25');
      await page.fill('#oatDuration', '45');
      await page.setInputFiles('#oatQuestionPdf', pdfFile);
      assert(await fits(page), 'publish form fits at ' + width);
      await page.screenshot({ animations: 'disabled', path: path.join(out, `admin-publish-${width}.png`), fullPage: true });
      await page.click('#oatPublishBtn');
      await page.waitForFunction(() => /is live/.test(document.getElementById('oatMsg').textContent), null, { timeout: 20000 });
      assert.match(await page.locator('#oatMsg').innerText(), /published as Neha Gupta/);
      const testWrite = ctx.patches.find(w => /^offlineTests\/ots/.test(w.path));
      const keyWrite = ctx.patches.find(w => /^offlineTestKeys\/ots/.test(w.path));
      assert.equal(testWrite.body.fields.teacherUid.stringValue, 'teacher-2'); assert.equal(testWrite.body.fields.teacherName.stringValue, 'Neha Gupta');
      assert.equal(testWrite.body.fields.gradingMode.stringValue, 'teacher'); assert.equal(testWrite.body.fields.module.stringValue, 'Part 2 · Colligative properties');
      assert.equal(keyWrite.body.fields.teacherUid.stringValue, 'teacher-2');
      assert(!JSON.stringify(testWrite.body).includes('admin-demo'), 'student-visible test never names the admin');
      const auditWrite = ctx.patches.find(w => /^offlineAudit\/publish_ots/.test(w.path));
      assert.equal(auditWrite.body.fields.byAdminUid.stringValue, 'admin-demo'); assert.equal(auditWrite.body.fields.onBehalfOfUid.stringValue, 'teacher-2');

      // Check & return an awaiting script as a chosen teacher.
      await page.click('[data-oad-view="records"]');
      await page.fill('#oadRecordsPane .portal-search input', 'TNC-000');
      const pendingRow = page.locator('#oadRecords .oar-row', { hasText: 'Awaiting review' }).first();
      await pendingRow.waitFor();
      assert.equal((await pendingRow.locator('[data-oad-review]').innerText()).trim(), 'Check & return');
      const attemptId = await pendingRow.locator('[data-oad-review]').getAttribute('data-oad-review');
      await pendingRow.locator('[data-oad-review]').click();
      await page.waitForSelector('#oarReturnForm');
      assert.equal(await page.inputValue('#oarTeacher'), 'teacher-demo', 'assigned teacher is preselected');
      await page.click('#oarReturnBtn');
      assert.match(await page.locator('#oarMsg').innerText(), /checked PDF/i, 'return needs a PDF');
      await page.setInputFiles('#oarPdf', pdfFile);
      await page.fill('#oarScore', '25');
      await page.click('#oarReturnBtn');
      assert.match(await page.locator('#oarMsg').innerText(), /0 to 20/, 'marks above maximum refused');
      await page.selectOption('#oarTeacher', 'teacher-2');
      await page.fill('#oarScore', '12.5');
      await page.fill('#oarRemark', 'Good method. Check your units.');
      assert(await fits(page), 'return form fits at ' + width);
      await page.screenshot({ animations: 'disabled', path: path.join(out, `admin-return-form-${width}.png`) });
      await page.click('#oarReturnBtn');
      await page.waitForFunction(() => /Returned to/.test(document.getElementById('oadModalBody').textContent), null, { timeout: 20000 });
      const call = ctx.calls.find(c => c.action === 'return-script');
      assert.equal(call.attemptId, attemptId); assert.equal(call.onBehalfOf, 'teacher-2'); assert.equal(call.score, 12.5);
      assert.match(call.checkedScriptUrl, /^https:\/\/32zbpzustr\.ucarecd\.net\//); assert.equal(call.remark, 'Good method. Check your units.');
      const sheet = await page.locator('#oadModalBody').innerText();
      assert.match(sheet, /checked by Neha Gupta/i); assert.match(sheet, /Checked by\s+Neha Gupta/); assert.match(sheet, /12½ \/ 20/);
      assert.equal(await page.locator('#oarReturnForm').count(), 0, 'form disappears once returned');
      await page.screenshot({ animations: 'disabled', path: path.join(out, `admin-returned-${width}.png`) });
      assert.deepEqual(errors, [], 'no page errors on admin actions at ' + width);
      await page.close();
      console.log(`✓ admin ${width}px: publishes a test as Neha Gupta (audit kept privately) · checks and returns a script in her name`);
    }

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
