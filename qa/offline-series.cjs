/* Offline Test Series — end-to-end browser check with fixtures.
   Teacher publishes a test (two PDFs) → student browses subject → chapter,
   starts it, sees the question paper + timer, uploads a PDF answer script →
   teacher reviews the AI report, edits a mark and approves → student opens
   the approved report from My Results. Firebase, Uploadcare and the Netlify
   functions are all intercepted; nothing touches production.
   Run with Playwright on NODE_PATH: node qa/offline-series.cjs */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const out = path.join(__dirname, 'artifacts', 'offline-series'); fs.mkdirSync(out, { recursive: true });

// ── A tiny valid multi-page PDF (text only) ──
function makePdf(pages) {
  const objs = [];
  const add = s => { objs.push(s); return objs.length; };
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pagesId = objs.length + 1; objs.push(null);
  const kids = pages.map(text => {
    const body = `BT /F1 18 Tf 60 760 Td (${text}) Tj ET`;
    const content = add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
    return add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`);
  });
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const info = add('<< /Producer (Fixture Scanner) /CreationDate (D:20261009101500+05\'30\') >>');
  let pdf = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}
const paperPdf = makePdf(['Q1. State Coulomb law. (2)', 'Q2. Field at centre of square. (3)']);
const scriptPdf = makePdf(['Answer 1 ...', 'Answer 2 ...', 'Answer 3 ...']);
fs.writeFileSync(path.join(out, 'answer-script.pdf'), scriptPdf);
fs.writeFileSync(path.join(out, 'question.pdf'), paperPdf);

const report = {
  totalAwarded: 3.5, totalMax: 5, pct: 70, choiceNote: '',
  sections: [{ name: 'Section A', label: 'Short answer · Q1–2', awarded: 3.5, max: 5 }],
  questions: [
    { q: '1', section: 'A', topic: 'Coulomb’s law', max: 2, awarded: 2, status: 'full', remark: 'Correct with vector form.' },
    { q: '2', section: 'A', topic: 'Field at the centre of a square', max: 3, awarded: 1.5, status: 'partial', remark: 'Magnitude right; direction missing.' }
  ],
  lossCategories: [{ category: 'Direction missing', refs: 'Q2', marks: 1.5 }],
  teacherRemark: 'Good attempt, Riya.', markingNotes: 'Step marking.',
  tips: [{ title: 'Give the direction', detail: 'of every vector.' }],
  corrections: [{ q: '2', title: 'Field at the centre', scored: 1.5, max: 3, whatWentWrong: 'Direction not stated.', solution: 'Resultant $E=\\sqrt2\\times1.8\\times10^6$ N C$^{-1}$, towards CD.' }],
  annotations: [{ page: 1, kind: 'tick', text: '', box: [100, 100, 140, 400] }, { page: 1, kind: 'score', text: '2/2', box: [60, 40, 90, 120] }]
};
const integrity = { level: 'medium', flags: [{ type: 'Matches an online source', severity: 'medium', detail: 'Q1 wording matches a solutions page', url: 'https://example.test/sol' }], web: { summary: 'One close match.', sources: [{ title: 'Example', url: 'https://example.test/sol' }] }, pdf: { producer: 'Fixture Scanner' }, timing: { usedMin: 40, durationMin: 60 } };

const field = v => Array.isArray(v) ? { arrayValue: { values: v.map(field) } } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : { stringValue: String(v ?? '') };
const docOf = (p, item) => ({ name: 'projects/fixture/databases/(default)/documents/' + p, fields: Object.fromEntries(Object.entries(item).map(([k, v]) => [k, field(v)])) });

const tests = [
  { id: 'otsphy1', testName: 'Unit Test 1', class: '11', board: '', subject: 'Physics', chapter: 'Electric Charges and Fields', totalMarks: 5, durationMin: 60, isActive: true, teacherUid: 'teacher-demo', teacherName: 'Aarav Sen', createdAt: '2026-10-01' },
  { id: 'otsphy2', testName: 'Unit Test 2', class: '11', board: '', subject: 'Physics', chapter: 'Electric Charges and Fields', totalMarks: 5, durationMin: 60, isActive: true, teacherUid: 'teacher-demo', teacherName: 'Aarav Sen', createdAt: '2026-10-02' },
  { id: 'otsmat1', testName: 'Sets quiz', class: '11', board: '', subject: 'Mathematics', chapter: 'Sets', totalMarks: 10, durationMin: 30, isActive: true, teacherUid: 'teacher-demo', teacherName: 'Aarav Sen', createdAt: '2026-10-01' },
  { id: 'otsicse', testName: 'ICSE only', class: '11', board: 'ICSE', subject: 'Physics', chapter: 'Other', totalMarks: 5, durationMin: 60, isActive: true, teacherUid: 'teacher-demo', createdAt: '2026-10-01' },
  { id: 'otscls12', testName: 'Class 12', class: '12', board: '', subject: 'Physics', chapter: 'Other', totalMarks: 5, durationMin: 60, isActive: true, teacherUid: 'teacher-demo', createdAt: '2026-10-01' }
];
const reportDoc = {
  attemptId: 'otsphy2__student-demo', uid: 'student-demo', testId: 'otsphy2', status: 'ai_checked',
  studentName: 'Riya Sharma', studentId: 'NTC001', studentClass: '11', board: '', subject: 'Physics', chapter: 'Electric Charges and Fields',
  testName: 'Unit Test 2', totalMarks: 5, durationMin: 60, teacherUid: 'teacher-demo', submittedAt: '2026-10-08T10:00:00Z', startedAt: '2026-10-08T09:00:00Z',
  lateByMin: 0, usedMin: 40, scriptPdfUrl: 'https://ucarecdn.com/11111111-1111-1111-1111-111111111111/', pageUrls: ['/assets/img/logo-mark-192.webp'],
  aiReport: JSON.stringify(report), finalReport: JSON.stringify(report), integrity: JSON.stringify(integrity), integrityLevel: 'medium', aiScore: 3.5, aiMax: 5, checkedAt: '2026-10-08T10:03:00Z'
};

const auth = `export const getAuth=()=>({currentUser:{uid:window.__role+'-demo',email:window.__role+'@example.test',getIdToken:async()=>'fixture-only'},authStateReady:async()=>{}});export const onAuthStateChanged=(a,fn)=>{setTimeout(()=>fn(a.currentUser),0);return()=>{};};export const signOut=async()=>{};export const updatePassword=async()=>{};export const setPersistence=async()=>{},browserLocalPersistence={};`;
const firestore = `export const getFirestore=()=>({});export const collection=(_,n)=>({name:n});export const doc=(_,...n)=>({name:n.join('/')});export const where=()=>({});export const orderBy=()=>({});export const limit=()=>({});export const query=r=>r;export async function getDoc(){return{exists:()=>false,data:()=>({})};}export async function getDocs(){return{docs:[],size:0,empty:true,forEach(){}};}export const setDoc=async()=>{},updateDoc=async()=>{},deleteDoc=async()=>{},addDoc=async()=>({id:'x'}),serverTimestamp=()=>new Date();export const onSnapshot=(r,o,n)=>{(typeof o==='function'?o:n)({docs:[],metadata:{fromCache:false}});return()=>{};};`;
const config = "export const FIREBASE_CONFIG={projectId:'fixture',apiKey:'fixture'};export const FCM_VAPID_KEY='';export const initAppCheck=async()=>{};export const STAFF_APP='ntc-staff';export const adoptLegacyStaffSession=async()=>{};export const fetchOwnDoc=async()=>({name:'x'});";

const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    const type = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' }[path.extname(file)] || 'text/html';
    res.setHeader('Content-Type', type); res.end(fs.readFileSync(file));
  } catch { res.writeHead(404); res.end(); }
});

async function openPortal(browser, origin, role, file, state, viewport) {
  const page = await browser.newPage({ viewport: viewport || { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
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
    if (url.hostname === 'upload.uploadcare.com') { if (state.badUpload) { state.badUpload = false; return route.fulfill({contentType:'text/plain', body:'unexpected response'}); } assert.match(req.postDataBuffer().toString(), /name="UPLOADCARE_STORE"\r\n\r\n1/, 'every upload requests permanent storage'); state.uploads.push(req.postDataBuffer()?.length || 0); return route.fulfill({ json: { file: '22222222-2222-2222-2222-' + String(state.uploads.length).padStart(12, '0') } }); }
    if (['ucarecdn.com', '32zbpzustr.ucarecd.net'].includes(url.hostname)) return route.fulfill({ contentType: 'application/pdf', body: paperPdf });
    if (url.pathname === '/.netlify/functions/offline-test') {
      const body = req.postDataJSON(); state.calls.push(body);
      if (state.manual && body.action === 'start') {
        state.attempt ||= { attemptId: body.testId + '__student-demo', status: 'started', startedAt: new Date().toISOString(), deadline: new Date(Date.now() + 3600000).toISOString(), serverNow: new Date().toISOString(), questionPdfUrl: 'https://ucarecdn.com/33333333-3333-3333-3333-333333333333/' };
        return route.fulfill({ json: { ...state.attempt, serverNow: new Date().toISOString() } });
      }
      if (state.manual && body.action === 'submit') {
        state.attempt.status = 'submitted';
        state.report = { ...reportDoc, attemptId: 'otsphy1__student-demo', testId: 'otsphy1', testName: 'Unit Test 1', status: 'submitted', reviewMode: 'teacher', studentSection: 'A', module: 'Part 1 · Electric charge', scriptPdfUrl: body.scriptPdfUrl, pageUrls: [], aiReport: '', finalReport: '' };
        if (state.failSubmit) { state.failSubmit = false; return route.fulfill({ status: 500, json: { error: 'Response lost after submission.' } }); }
        return route.fulfill({ json: { ok: true, status: 'submitted' } });
      }
      if (state.manual && body.action === 'return-script') {
        if (state.failReturn) { state.failReturn = false; return route.fulfill({ status: 500, json: { error: 'Temporary save failure.' } }); }
        Object.assign(state.report, { status: 'approved', checkedScriptUrl: body.checkedScriptUrl, score: body.score, teacherRemark: body.remark, approvedByName: 'Aarav Sen' });
        state.attempt.status = 'approved';
        state.result = { reportId: state.report.attemptId, testName: state.report.testName, subject: 'Physics', class: '11', score: body.score, totalMarks: 5, topic: 'Electric Charges and Fields', module: state.report.module, testDate: '2026-11-07', submittedAt: state.report.submittedAt, approvedAt: new Date().toISOString(), savedAt: new Date().toISOString(), answerSheetUrl: body.checkedScriptUrl, teacherName: 'Aarav Sen', remark: body.remark, reviewMode: 'teacher' };
        return route.fulfill({ json: { ok: true, status: 'approved' } });
      }
      if (body.action === 'start') return route.fulfill({ json: { attemptId: body.testId + '__student-demo', status: 'started', startedAt: new Date().toISOString(), deadline: new Date(Date.now() + 3600000).toISOString(), serverNow: new Date().toISOString(), uploadGraceMin: 15, questionPdfUrl: 'https://ucarecdn.com/33333333-3333-3333-3333-333333333333/' } });
      if (body.action === 'submit') return route.fulfill({ json: { ok: true, status: 'checking', lateByMin: 0 } });
      return route.fulfill({ json: { ok: true } });
    }
    if (url.hostname === 'firestore.googleapis.com') {
      const p = decodeURIComponent(url.pathname.split('/documents/')[1] || '');
      if (req.method() !== 'GET') { state.writes.push({ path: p, method: req.method(), mask: url.searchParams.getAll('updateMask.fieldPaths'), body: req.postDataJSON() }); return route.fulfill({ json: { name: p } }); }
      if (p === 'students/student-demo') return route.fulfill({ json: docOf(p, { uid: 'student-demo', name: 'Riya Sharma', studentId: 'NTC001', class: state.studentClass || '11', board: 'CBSE', subjects: ['Physics'], enrollmentType: 'normal' }) });
      if (p === 'teachers/teacher-demo') return route.fulfill({ json: docOf(p, { uid: 'teacher-demo', name: 'Aarav Sen', email: 'teacher@example.test', subjects: ['Physics'] }) });
      if (p === 'offlineTests') return route.fulfill({ json: { documents: (state.noTests ? [] : state.manual ? [{ ...tests[0], gradingMode: 'teacher', module: 'Part 1 · Electric charge' }] : tests).map(t => docOf('offlineTests/' + t.id, t)) } });
      if (p === 'students/student-demo/offlineHistory') return route.fulfill({json:{documents: state.report ? [docOf(p + '/history', {reportId:state.report.attemptId, submittedAt:state.report.submittedAt, status:state.report.status, chapter:'Electric Charges and Fields',subject:'Physics'})] : []}});
      if (state.manual && p === 'students/student-demo/offlineResults') {
        if (state.archivePagination && !url.searchParams.get('pageToken')) return route.fulfill({ json: { documents: [docOf(p + '/classroom', { testName: 'Ordinary classroom marks' })], nextPageToken: 'next-page' } });
        return route.fulfill({ json: { documents: state.result ? [docOf(p + '/ots_saved', state.result), ...(state.extraResults || []).map((r,i) => docOf(p + '/extra_' + i, r))] : [] } });
      }
      if (state.manual && p === 'offlineAttempts/otsphy1__student-demo' && state.attempt) return route.fulfill({ json: docOf(p, state.attempt) });
      if (state.manual && p === 'offlineReports') return route.fulfill({ json: { documents: state.report ? [docOf('offlineReports/otsphy1__student-demo', state.report)] : [] } });
      if (state.manual && p === 'offlineReports/otsphy1__student-demo') return route.fulfill({ json: docOf(p, state.report) });
      if (p === 'offlineTestKeys') return route.fulfill({ json: { documents: [docOf('offlineTestKeys/otsphy1', { questionPdfUrl: 'https://ucarecdn.com/q/', answerPdfUrl: 'https://ucarecdn.com/a/' })] } });
      if (p.startsWith('offlineTestKeys/')) return route.fulfill({ json: docOf(p, { questionPdfUrl: 'https://ucarecdn.com/q/', answerPdfUrl: 'https://ucarecdn.com/a/' }) });
      if (p === 'offlineAttempts/otsphy2__student-demo') return route.fulfill({ json: docOf(p, { uid: 'student-demo', status: state.approved ? 'approved' : 'ai_checked' }) });
      if (p.startsWith('offlineAttempts/')) return route.fulfill({ status: 403, json: { error: { message: 'Missing or insufficient permissions.' } } });
      if (p === 'offlineReports') return route.fulfill({ json: { documents: [docOf('offlineReports/' + reportDoc.attemptId, reportDoc)] } });
      if (p === 'offlineReports/otsphy2__student-demo') return route.fulfill({ json: docOf(p, { ...reportDoc, status: 'approved', approvedByName: 'Aarav Sen', approvedAt: '2026-10-08T12:00:00Z' }) });
      if (p === 'students/student-demo/offlineResults') return route.fulfill({ json: { documents: [docOf(p + '/ots_x', { resultId: 'ots_x', reportId: 'otsphy2__student-demo', testName: 'Unit Test 2', subject: 'Physics', topic: 'Electric Charges and Fields', testType: 'subjective', class: '11', score: 3.5, totalMarks: 5, pct: 70, testDate: '2026-10-08', teacherName: 'Aarav Sen', remark: 'Offline Test Series · AI-checked' })] } });
      if (url.pathname.split('/').length % 2 === 0) return route.fulfill({ json: { documents: [] } });
      return route.fulfill({ status: 404, json: { error: { message: 'Not found' } } });
    }
    if (url.origin === origin) return route.continue();
    if (/cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url.hostname)) return route.continue();
    if (req.resourceType() === 'script') return js('');
    return route.fulfill({ body: '', contentType: 'text/plain' });
  });
  await page.goto(origin + '/' + file);
  return { page, errors };
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, channel: process.env.PORTAL_BROWSER || 'chrome' });
  try {
    if (!process.env.MANUAL_ONLY) {
    // ── Teacher: publish a test ──
    {
      const state = { uploads: [], writes: [], calls: [] };
      const { page, errors } = await openPortal(browser, origin, 'teacher', 'teacher-dashboard.html', state);
      await page.waitForFunction(() => typeof window.otPublish === 'function');
      await page.evaluate(() => ntcCall('switchTab', 'offline-series'));
      await page.selectOption('#otClass', '11');
      await page.selectOption('#otSubject', 'Physics');
      const options = await page.$$eval('#otChapterList option', o => o.map(x => x.value));
      assert(options.includes('Units and Measurements'), 'NCERT chapters are suggested');
      await page.fill('#otChapter', 'Electric Charges and Fields');
      await page.fill('#otModule', 'Part 1 · Electric charge');
      await page.fill('#otName', 'Unit Test 3');
      await page.fill('#otMarks', '40');
      await page.fill('#otDuration', '90');
      await page.setInputFiles('#otQuestionPdf', path.join(out, 'question.pdf'));
      await page.click('#otPublishBtn');
      await page.waitForFunction(() => /is live/.test(document.getElementById('otMsg').textContent));
      assert.equal(state.uploads.length, 1, 'teacher checking needs only a question PDF');
      const key = state.writes.find(w => w.path.startsWith('offlineTestKeys/'));
      const test = state.writes.find(w => w.path.startsWith('offlineTests/'));
      assert(key && key.body.fields.questionPdfUrl && key.body.fields.answerPdfUrl, 'PDF links saved in the staff-only key doc');
      assert(test && !test.body.fields.questionPdfUrl && !test.body.fields.answerPdfUrl, 'student-visible test doc has no PDF links');
      assert.equal(test.body.fields.chapter.stringValue, 'Electric Charges and Fields');
      assert.equal(test.body.fields.module.stringValue, 'Part 1 · Electric charge');
      assert.equal(test.body.fields.durationMin.integerValue, '90');
      assert.equal(test.body.fields.gradingMode.stringValue, 'teacher');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'no sideways scroll on phone');
      await page.screenshot({ animations: 'disabled', path: path.join(out, 'teacher-create-390.png'), fullPage: true });
      console.log('✓ teacher publishes a test with only a question PDF; paper kept out of student-visible metadata');

      // ── Teacher: approve an AI-checked script ──
      await page.evaluate(() => ntcCall('switchTab', 'script-approval'));
      await page.waitForSelector('#otaList .ota-row');
      assert.equal(await page.textContent('#otaBadge'), '1', 'pending badge counts scripts awaiting approval');
      await page.click('#otaList .ota-row button');
      await page.waitForSelector('.ota-integrity.medium');
      assert(/Matches an online source/.test(await page.textContent('.ota-integrity')), 'integrity flags shown');
      await page.waitForSelector('#otaPreview .orp-sheet');
      assert(/awaiting teacher approval/.test(await page.textContent('#otaPreview')), 'preview is marked as a draft');
      await page.fill('[data-ota-q="1"]', '2.5');
      await page.fill('[data-ota-r="1"]', 'Magnitude right; direction stated late.');
      await page.click('text=Preview report');
      const scoreText = (await page.textContent('#otaPreview .orp-score .n')).replace(/\s+/g, ' ').trim();
      assert.equal(scoreText, '4½ / 5', 'preview total follows the edited mark');
      await page.screenshot({ animations: 'disabled', path: path.join(out, 'teacher-review-390.png'), fullPage: true });
      await page.click('#otaApproveBtn');
      await page.waitForFunction(() => /Approved/.test(document.getElementById('otaMsg')?.textContent || '') || document.querySelector('#otaPreview .orp-stamp:not(.draft)'));
      const rep = state.writes.find(w => w.path === 'offlineReports/otsphy2__student-demo');
      assert.deepEqual(rep.mask.sort(), ['approvedAt', 'approvedByName', 'approvedByUid', 'finalReport', 'status'], 'only allowed report fields are written');
      const final = JSON.parse(rep.body.fields.finalReport.stringValue);
      assert.equal(final.totalAwarded, 4.5); assert.equal(final.questions[1].awarded, 2.5);
      assert.equal(rep.body.fields.approvedByName.stringValue, 'Aarav Sen');
      assert(state.writes.some(w => w.path === 'offlineAttempts/otsphy2__student-demo' && w.body.fields.status.stringValue === 'approved'), 'attempt marked approved');
      const res = state.writes.find(w => w.path === 'students/student-demo/offlineResults/ots_otsphy2__student-demo');
      assert(res && res.body.fields.reportId.stringValue === 'otsphy2__student-demo' && res.body.fields.score.doubleValue === 4.5, 'result posted to My Results with the report link');
      assert(/Approved by Aarav Sen/.test(await page.textContent('#otaPreview')), 'approved preview carries the teacher name');
      assert.deepEqual(errors, [], 'teacher runtime errors');
      await page.close();
      console.log('✓ teacher reviews integrity flags, edits a mark, approves; report + attempt + My Results updated');
    }

    // ── Student: browse, start, upload, then open the approved report ──
    for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      const state = { uploads: [], writes: [], calls: [], approved: true };
      const { page, errors } = await openPortal(browser, origin, 'student', 'student-dashboard.html', state, viewport);
      await page.waitForFunction(() => typeof window.otsLoad === 'function');
      await page.evaluate(() => { const el = document.querySelector('[data-section="offlineseries"]'); switchSection(el, 'offlineseries'); return otsLoad(); });
      await page.waitForSelector('#otsBody [data-sub]');
      const subjects = await page.$$eval('#otsBody [data-sub]', b => b.map(x => x.dataset.sub));
      assert.deepEqual(subjects.sort(), ['Mathematics', 'Physics'], 'only this class & board');
      await page.click('#otsBody [data-sub="Physics"]');
      await page.click('#otsBody [data-ch="Electric Charges and Fields"]');
      await page.click('#otsBody [data-module="Full chapter"]');
      await page.waitForSelector('[data-report]');
      assert(await page.isVisible('[data-start="otsphy1"]'), 'new test offers Start');
      await page.click('[data-start="otsphy1"]');
      await page.waitForSelector('#otsExam:not([hidden]) #otsPaper canvas');
      assert(/^\d+:\d\d/.test(await page.textContent('#otsTimer')), 'timer running');
      assert.equal(state.calls[0].action, 'start');
      await page.screenshot({ animations: 'disabled', path: path.join(out, `student-exam-${viewport.width}.png`) });
      await page.click('text=Submit answers');
      await page.setInputFiles('#otsFile', path.join(out, 'answer-script.pdf'));
      await page.waitForFunction(() => !document.getElementById('otsUpSubmit').disabled);
      assert.equal(await page.$$eval('#otsThumbs canvas', c => c.length), 3, 'page previews shown');
      await page.screenshot({ animations: 'disabled', path: path.join(out, `student-upload-${viewport.width}.png`) });
      await page.click('#otsUpSubmit');
      await page.waitForFunction(() => /Submitted/.test(document.getElementById('otsUpMsg').textContent));
      const submit = state.calls.find(c => c.action === 'submit');
      assert(submit && /^https:\/\/32zbpzustr\.ucarecd\.net\//.test(submit.scriptPdfUrl) && submit.pageUrls.length === 3, 'PDF + 3 page images submitted on project CDN');
      assert.equal(state.uploads.length, 4, 'PDF and each page uploaded');
      await page.waitForFunction(() => document.getElementById('otsExam').hidden, null, { timeout: 8000 });

      // Approved report from the test card
      await page.click('[data-report="otsphy2__student-demo"]');
      await page.waitForSelector('#otsReport:not([hidden]) .orp-sheet');
      const text = await page.textContent('#otsReportBody');
      assert(/Checked using Trained AI models & Approved by Aarav Sen/.test(text), 'approval line on the report');
      assert(await page.evaluate(() => document.querySelectorAll('#otsReportBody .orp-sheet').length >= 4), 'summary, marks, script and corrections pages');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'report fits the screen width');
      await page.screenshot({ animations: 'disabled', path: path.join(out, `student-report-${viewport.width}.png`) });
      await page.click('#otsReport .ots-bar-btn.ghost');
      assert(await page.evaluate(() => document.getElementById('otsReport').hidden), 'report closes');
      assert.deepEqual(errors, [], 'student runtime errors');
      await page.close();
      console.log(`✓ student ${viewport.width}px: subject → chapter → start → paper + timer → PDF upload → approved report`);
    }

    // Manual workflow across real dashboard sessions, including real image
    // conversion/PDF.js decoding, photo order, retry and saved-script reopening.
    }
    for (const width of (process.env.OFFLINE_WIDTHS || '320,390,768,1440').split(',').map(Number)) {
      const height = width === 320 ? 640 : width === 390 ? 844 : 900;
      const state = { manual: true, uploads: [], writes: [], calls: [] };
      let { page, errors } = await openPortal(browser, origin, 'student', 'student-dashboard.html', state, { width, height });
      const browse = async page => {
        await page.waitForFunction(() => typeof window.otsLoad === 'function');
        await page.evaluate(() => { switchSection(document.querySelector('[data-section="offlineseries"]'), 'offlineseries'); return otsLoad(); });
        await page.click('#otsBody [data-sub="Physics"]');
        await page.click('#otsBody [data-ch="Electric Charges and Fields"]');
        await page.click('#otsBody [data-module="Part 1 · Electric charge"]');
      };
      await browse(page);
      if (width === 320) {
        const scenes = await page.evaluate(() => {
          const elements = [...document.querySelectorAll('.ots-mini-scene .ots-scene')];
          const sample = time => { elements.forEach(el => el.getAnimations().forEach(a => a.currentTime = time)); return elements.map(el => Number(getComputedStyle(el).opacity)); };
          const first = sample(1000), second = sample(5000); sample(0);
          return { first, second };
        });
        assert(scenes.first[0] > .9 && scenes.first[1] < .1, 'download figure is visible first');
        assert(scenes.second[1] > .9 && scenes.second[0] < .1, 'animation advances to the writing figure');
      }
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'test library fits screen');
      if (width <= 390) {
        const sizes = await page.evaluate(() => ({
          header: document.querySelector('#otsSection .ots-hero').getBoundingClientRect().height,
          action: document.querySelector('[data-start="otsphy1"]').getBoundingClientRect().bottom,
          nav: document.querySelector('.portal-bottom-nav').getBoundingClientRect().top
        }));
        console.log('Phone bounds', sizes);
        await page.screenshot({animations:'disabled',path:path.join(out, `test-library-${width}.png`),fullPage:true});
        assert(sizes.header <= 190, 'phone overview stays compact');
        assert(sizes.action < sizes.nav, 'first test action is visible above phone navigation without scrolling');
        console.log(`✓ compact ${width}×${height}: overview ${Math.round(sizes.header)}px, first test action at ${Math.round(sizes.action)}px`);
        await page.locator('.ots-guide summary').click();
        assert(await page.locator('.ots-guide .ots-journey').isVisible(), 'instructions remain available on demand');
        await page.locator('.ots-guide summary').click();
      }
      await page.screenshot({ animations: 'disabled', path: path.join(out, `test-library-${width}.png`), fullPage: true });
      const paperDownload = page.waitForEvent('download');
      await page.click('[data-start="otsphy1"]');
      assert.match((await paperDownload).suggestedFilename(), /question_paper.pdf$/);
      await page.waitForSelector('#otsPaper canvas');
      const deadline = state.attempt.deadline;
      await page.click('text=Minimise');
      await page.click('[data-open="otsphy1"]');
      await page.waitForFunction(() => !document.getElementById('otsExam').hidden);
      assert.equal(state.attempt.deadline, deadline, 'reopening preserves deadline');
      if (width === 320) {
        await page.evaluate(() => otsCloseExam());
        state.attempt.deadline = new Date(Date.now() - 1000).toISOString();
        await page.click('[data-open="otsphy1"]');
        await page.waitForFunction(() => !document.getElementById('otsUpload').hidden);
        assert.match(await page.textContent('#otsUpTime'), /Pens down/);
        await page.evaluate(() => otsCloseExam());
        state.attempt.deadline = new Date(Date.now() - 20 * 60000).toISOString();
        await page.click('[data-open="otsphy1"]');
        await page.waitForFunction(() => document.getElementById('otsTimer').textContent === 'LATE');
        assert.match(await page.textContent('#otsUpTime'), /teacher will see it was late/);
      } else await page.click('text=Submit answers');
      if (width === 320) {
        await page.setInputFiles('#otsFile', { name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') });
        await page.waitForFunction(() => /not a valid PDF/.test(document.getElementById('otsUpMsg').textContent));
        assert(await page.locator('#otsUpSubmit').isDisabled());
        await page.setInputFiles('#otsFile', { name: 'too-many.pdf', mimeType: 'application/pdf', buffer: makePdf(Array(26).fill('Page')) });
        await page.waitForFunction(() => /limit is 25/.test(document.getElementById('otsUpMsg').textContent));
        assert(await page.locator('#otsUpSubmit').isDisabled());
        const rejected = await page.evaluate(async () => {
          const results = [];
          for (const file of [new File([new Uint8Array(40 * 1024 * 1024 + 1)], 'huge.pdf', { type: 'application/pdf' }), new File(['text'], 'notes.txt')]) {
            try { await NTCOfflineFiles.validatePdf(file); results.push(false); } catch (_) { results.push(true); }
          }
          return results;
        });
        assert.deepEqual(rejected, [true, true], 'oversize and unsupported files rejected');
      }
      // Generate distinguishable photos without an image library.
      const photos = await page.evaluate(() => ['#ff0000', '#0000ff'].map(color => {
        const c = document.createElement('canvas'); c.width = 200; c.height = 300;
        const ctx = c.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 200, 300);
        return c.toDataURL('image/png').split(',')[1];
      }));
      await page.setInputFiles('#otsFile', photos.map((data, i) => ({ name: `page-${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') })));
      await page.waitForFunction(() => !document.getElementById('otsUpSubmit').disabled);
      assert.equal(await page.locator('#otsThumbs canvas').count(), 2, 'photos converted into two PDF pages');
      await page.click('[data-move="1"][data-dir="-1"]');
      await page.waitForFunction(() => !document.getElementById('otsUpSubmit').disabled);
      assert.match(await page.locator('.ots-photo-row').first().textContent(), /page-2.png/);
      const pixel = await page.locator('#otsThumbs canvas').first().evaluate(c => Array.from(c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data));
      assert(pixel[2] > 200 && pixel[0] < 20, 'converted PDF starts with reordered blue photo');
      if (width === 320) {
        await page.setInputFiles('#otsCamera', { name: 'camera.png', mimeType: 'image/png', buffer: Buffer.from(photos[0], 'base64') });
        await page.waitForFunction(() => !document.getElementById('otsUpSubmit').disabled);
        assert.equal(await page.locator('#otsThumbs canvas').count(), 3, 'camera capture appends a page');
        await page.click('[data-remove="2"]');
        await page.waitForFunction(() => !document.getElementById('otsUpSubmit').disabled);
        assert.equal(await page.locator('#otsThumbs canvas').count(), 2, 'unwanted photo removed from PDF');
      }
      const checkUploadLayout = async () => {
        const layout = await page.evaluate(() => {
          const footer = document.querySelector('.ots-up-actions').getBoundingClientRect();
          const btn = document.getElementById('otsUpSubmit').getBoundingClientRect();
          const content = document.querySelector('.ots-sheet-content');
          return { footerBottom: footer.bottom, viewport: innerHeight, buttonHeight: btn.height, scrollable: content.scrollHeight > content.clientHeight, overflow: document.querySelector('.ots-sheet').scrollWidth > innerWidth };
        });
        assert(layout.footerBottom <= layout.viewport + 1, 'upload actions stay on screen');
        assert(layout.buttonHeight >= 44, 'submit has a touch-sized target');
        assert(!layout.overflow, 'upload sheet has no horizontal overflow');
      };
      await checkUploadLayout();
      await page.screenshot({ animations: 'disabled', path: path.join(out, `manual-photos-${width}.png`) });
      if (width === 320) {
        await page.setViewportSize({ width: 740, height: 360 });
        await checkUploadLayout();
        await page.screenshot({ animations: 'disabled', path: path.join(out, 'manual-photos-landscape.png') });
        await page.setViewportSize({ width, height });
      }
      state.failSubmit = true;
      if (width === 320) {
        state.badUpload = true;
        await page.click('#otsUpSubmit');
        await page.waitForFunction(() => /invalid response/.test(document.getElementById('otsUpMsg').textContent));
        assert(await page.locator('#otsUpSubmit').isEnabled(), 'malformed upload response permits retry');
      }
      await page.click('#otsUpSubmit');
      await page.waitForFunction(() => /Response lost/.test(document.getElementById('otsUpMsg').textContent));
      await page.click('#otsUpSubmit');
      await page.waitForFunction(() => /Submitted!/.test(document.getElementById('otsUpMsg').textContent));
      assert.equal(state.uploads.length, 1, 'manual checking uploads only one PDF');
      assert.deepEqual(state.calls.find(c => c.action === 'submit').pageUrls, []);
      await page.waitForFunction(() => document.getElementById('otsExam').hidden);
      assert.deepEqual(errors, []);
      await page.close();

      ({ page, errors } = await openPortal(browser, origin, 'teacher', 'teacher-dashboard.html', state, { width, height }));
      await page.waitForFunction(() => typeof window.otPublish === 'function');
      await page.evaluate(() => ntcCall('switchTab', 'script-approval'));
      await page.waitForSelector('#otaList .ota-row');
      assert.match(await page.textContent('#otaList'), /Riya Sharma/);
      assert.match(await page.textContent('#otaList'), /Section A/);
      await page.click('#otaList .ota-row button');
      assert.equal(await page.locator('#otaReview .ota-open-link').getAttribute('href'), require('../assets/js/uploadcare-config').deliveryUrl(state.report.scriptPdfUrl));
      const scriptDownload = page.waitForEvent('download');
      await page.click('#otaReview [data-ota-download="script"]');
      assert.match((await scriptDownload).suggestedFilename(), /^Riya_Sharma_[A-Za-z0-9_-]*Unit_Test_1\.pdf$/, 'teacher download is named per student');
      if (width === 320) {
        await page.setInputFiles('#otaCheckedPdf', { name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\ncorrupt content') });
        await page.fill('#otaScore', '4');
        await page.click('#otaReturnBtn');
        await page.waitForFunction(() => /could not be read/.test(document.getElementById('otaMsg').textContent));
        assert.equal(state.uploads.length, 1, 'corrupt checked PDF never uploaded');
      }
      await page.setInputFiles('#otaCheckedPdf', path.join(out, 'answer-script.pdf'));
      await page.fill('#otaScore', '4');
      await page.fill('#otaReturnRemark', 'Good work. Show your calculation steps.');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'teacher form fits screen');
      await page.screenshot({ animations: 'disabled', path: path.join(out, `manual-teacher-form-${width}.png`), fullPage: true });
      state.failReturn = true;
      if (width === 320) {
        state.badUpload = true;
        await page.click('#otaReturnBtn');
        await page.waitForFunction(() => /invalid response/.test(document.getElementById('otaMsg').textContent));
        assert(await page.locator('#otaReturnBtn').isEnabled(), 'teacher can retry malformed upload response');
      }
      await page.click('#otaReturnBtn');
      await page.waitForFunction(() => /Temporary save failure/.test(document.getElementById('otaMsg').textContent));
      assert.equal(await page.inputValue('#otaScore'), '4', 'failed return preserves form');
      await page.click('#otaReturnBtn');
      await page.waitForFunction(() => document.querySelector('[data-ota="approved"]').classList.contains('on'));
      assert.equal(state.uploads.length, 2, 'retry reuses checked PDF upload');
      await page.click('#otaList .ota-row button');
      assert.match(await page.textContent('#otaReview'), /4 \/ 5 marks/);
      await page.screenshot({ animations: 'disabled', path: path.join(out, `manual-teacher-return-${width}.png`) });
      assert.deepEqual(errors, []); await page.close();

      ({ page, errors } = await openPortal(browser, origin, 'student', 'student-dashboard.html', state, { width, height }));
      await browse(page);
      await page.click('[data-report="otsphy1__student-demo"]');
      await page.waitForSelector('.ots-returned');
      assert.equal(await page.locator('.ots-returned a').getAttribute('href'), state.report.checkedScriptUrl);
      assert.match(await page.textContent('.ots-returned'), /Checked by Aarav Sen/);
      assert.match(await page.textContent('.ots-returned'), /Show your calculation steps/);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
      await page.screenshot({ animations: 'disabled', path: path.join(out, `manual-student-return-${width}.png`) });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await page.locator('.ots-returned').evaluate(el => getComputedStyle(el).animationName), 'none', 'reduced-motion setting respected');
      assert.deepEqual(errors, []); await page.close();
      console.log(`✓ teacher workflow ${width}px: photos → reordered PDF → named review → checked PDF → retry → saved student script`);
      state.studentClass = '12'; state.noTests = true; state.archivePagination = true;
      ({ page, errors } = await openPortal(browser, origin, 'student', 'student-dashboard.html', state, { width, height }));
      await page.waitForFunction(() => typeof window.otsLoad === 'function');
      await page.evaluate(() => { switchSection(document.querySelector('[data-section="offlineseries"]'), 'offlineseries'); return otsLoad(); });
      await page.click('[data-ots-view="results"]');
      await page.click('#otsBody [data-sub="Physics"]');
      await page.click('#otsBody [data-ch="Electric Charges and Fields"]');
      await page.click('#otsBody [data-module="Part 1 · Electric charge"]');
      assert.match(await page.textContent('#otsBody'), /Unit Test 1/);
      assert.match(await page.textContent('#otsBody'), /4 \/ 5 marks/);
      assert.match(await page.textContent('.ots-chapter-stats'), /80%/);
      assert.match(await page.textContent('#otsSummary'), /1Tests given/);
      assert(!/Ordinary classroom marks/.test(await page.textContent('#otsBody')), 'archive includes only test-series results');
      assert.equal(await page.locator('#otsBody a[download]').getAttribute('href'), require('../assets/js/uploadcare-config').deliveryUrl(state.result.answerSheetUrl));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'results archive fits phone');
      await page.screenshot({ animations: 'disabled', path: path.join(out, `results-archive-${width}.png`), fullPage: true });
      await page.click('#otsBody [data-report]');
      await page.waitForSelector('.ots-returned');
      assert.match(await page.textContent('.ots-returned'), /Show your calculation steps/);
      if (width === 320) {
        const day = 86400000;
        const older = days => new Date(Date.now() - days * day).toISOString();
        // Results are permanent: a script returned three years ago (even one
        // carrying old expiry fields) keeps its PDF, marks, averages and count.
        Object.assign(state.result, { approvedAt: older(1100), savedAt: older(1100), submittedAt: older(1101), recordExpiresAt: older(700), pdfExpiresAt: older(1000) });
        Object.assign(state.report, { approvedAt: older(1100), checkedAt: older(1100), submittedAt: older(1101), recordExpiresAt: older(700), pdfExpiresAt: older(1000) });
        await page.evaluate(async () => { otsCloseReport(); await otsLoad(); });
        assert.equal(await page.locator('#otsBody [data-report]').count(), 1, 'old results stay in Results');
        assert.equal(await page.locator('#otsBody a[download]').count(), 1, 'old checked PDFs stay downloadable');
        assert.match(await page.textContent('#otsBody'), /Saved permanently/);
        assert(!/expired|365|60 days/i.test(await page.textContent('#otsBody')), 'no expiry wording');
        assert.match(await page.textContent('#otsBody'), /4 \/ 5 marks/);
        assert.match(await page.textContent('.ots-chapter-stats'), /80%/);
        assert.match(await page.textContent('#otsSummary'), /1Tests given/);
        await page.click('#otsBody [data-report]');
        await page.waitForSelector('.ots-returned');
        assert.equal(await page.locator('.ots-returned a[download]').count(), 1);
        assert(!(await page.locator('#otsReport [onclick="otsDownloadReport()"]').isDisabled()));
        await page.screenshot({ animations:'disabled', path:path.join(out, 'result-after-3-years.png') });
        // The general My Results tab keeps test-series results past 12 months
        // and offers their feedback and checked PDF.
        await page.evaluate(() => { otsCloseReport(); switchSection(document.querySelector('[data-section="results"]'), 'results'); });
        // The fixture serves two pages here, so this also checks pagination.
        await page.waitForFunction(() => /Unit Test 1/.test(document.getElementById('testGrid').textContent));
        assert.equal(await page.locator('#testGrid button', { hasText: 'View marks' }).count(), 1, 'My Results shows the feedback button');
        assert.equal(await page.locator('#testGrid a', { hasText: 'Result PDF' }).count(), 1, 'My Results shows the checked PDF');
        console.log('✓ permanent results: a 3-year-old checked PDF, marks, chapter average and count all remain');
      }
      if (width === 390) {
        state.extraResults = [
          { ...state.result, reportId:'part_two', module:'Part 2', testName:'Part two exam', score:20, totalMarks:40 },
          { ...state.result, reportId:'other_chapter', topic:'Current Electricity', testName:'Current exam' },
          { ...state.result, reportId:'other_subject', subject:'Mathematics', topic:'Sets', testName:'Sets exam' }
        ];
        await page.evaluate(async () => { otsCloseReport(); await otsLoad(); otsSetView('results'); });
        assert.equal(await page.locator('#otsBody [data-sub]').count(), 2);
        await page.click('#otsBody [data-sub="Physics"]');
        assert.equal(await page.locator('#otsBody [data-ch]').count(), 2);
        await page.click('#otsBody [data-ch="Electric Charges and Fields"]');
        assert.equal(await page.locator('#otsBody [data-module]').count(), 2);
        await page.click('#otsBody [data-module="Part 1 · Electric charge"]');
        assert.equal(await page.locator('#otsBody [data-report]').count(), 1);
        assert.match(await page.textContent('.ots-chapter-stats'), /65%/, 'chapter average includes both parts');
        await page.click('#otsCrumbs [data-level="chapter"]');
        await page.click('#otsBody [data-module="Part 2"]');
        assert.match(await page.textContent('#otsBody'), /Part two exam/);
        assert(!/Unit Test 1|Current exam|Sets exam/.test(await page.textContent('#otsBody')));
        console.log('✓ results hierarchy: subjects, chapters and parts stay separate; chapter averages include all parts');
      }
      assert.deepEqual(errors, []); await page.close();
      console.log(`✓ results archive ${width}px: fresh sign-in, class promotion, removed test and paginated history`);
    }
  } finally {
    await browser.close(); server.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
