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
    if (url.hostname === 'upload.uploadcare.com') { state.uploads.push(req.postDataBuffer()?.length || 0); return route.fulfill({ json: { file: '22222222-2222-2222-2222-' + String(state.uploads.length).padStart(12, '0') } }); }
    if (url.hostname === 'ucarecdn.com') return route.fulfill({ contentType: 'application/pdf', body: paperPdf });
    if (url.pathname === '/.netlify/functions/offline-test') {
      const body = req.postDataJSON(); state.calls.push(body);
      if (body.action === 'start') return route.fulfill({ json: { attemptId: body.testId + '__student-demo', status: 'started', startedAt: new Date().toISOString(), deadline: new Date(Date.now() + 3600000).toISOString(), serverNow: new Date().toISOString(), uploadGraceMin: 15, questionPdfUrl: 'https://ucarecdn.com/33333333-3333-3333-3333-333333333333/' } });
      if (body.action === 'submit') return route.fulfill({ json: { ok: true, status: 'checking', lateByMin: 0 } });
      return route.fulfill({ json: { ok: true } });
    }
    if (url.hostname === 'firestore.googleapis.com') {
      const p = decodeURIComponent(url.pathname.split('/documents/')[1] || '');
      if (req.method() !== 'GET') { state.writes.push({ path: p, method: req.method(), mask: url.searchParams.getAll('updateMask.fieldPaths'), body: req.postDataJSON() }); return route.fulfill({ json: { name: p } }); }
      if (p === 'students/student-demo') return route.fulfill({ json: docOf(p, { uid: 'student-demo', name: 'Riya Sharma', studentId: 'NTC001', class: '11', board: 'CBSE', subjects: ['Physics'], enrollmentType: 'normal' }) });
      if (p === 'teachers/teacher-demo') return route.fulfill({ json: docOf(p, { uid: 'teacher-demo', name: 'Aarav Sen', email: 'teacher@example.test', subjects: ['Physics'] }) });
      if (p === 'offlineTests') return route.fulfill({ json: { documents: tests.map(t => docOf('offlineTests/' + t.id, t)) } });
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
      await page.fill('#otName', 'Unit Test 3');
      await page.fill('#otMarks', '40');
      await page.fill('#otDuration', '90');
      await page.setInputFiles('#otQuestionPdf', path.join(out, 'question.pdf'));
      await page.setInputFiles('#otAnswerPdf', path.join(out, 'question.pdf'));
      await page.click('#otPublishBtn');
      await page.waitForFunction(() => /is live/.test(document.getElementById('otMsg').textContent));
      assert.equal(state.uploads.length, 2, 'both PDFs uploaded');
      const key = state.writes.find(w => w.path.startsWith('offlineTestKeys/'));
      const test = state.writes.find(w => w.path.startsWith('offlineTests/'));
      assert(key && key.body.fields.questionPdfUrl && key.body.fields.answerPdfUrl, 'PDF links saved in the staff-only key doc');
      assert(test && !test.body.fields.questionPdfUrl && !test.body.fields.answerPdfUrl, 'student-visible test doc has no PDF links');
      assert.equal(test.body.fields.chapter.stringValue, 'Electric Charges and Fields');
      assert.equal(test.body.fields.durationMin.integerValue, '90');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'no sideways scroll on phone');
      await page.screenshot({ path: path.join(out, 'teacher-create-390.png'), fullPage: true });
      console.log('✓ teacher publishes a test: two PDFs uploaded, answer key kept out of the student-visible doc');

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
      await page.screenshot({ path: path.join(out, 'teacher-review-390.png'), fullPage: true });
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
      await page.waitForSelector('[data-report]');
      assert(await page.isVisible('[data-start="otsphy1"]'), 'new test offers Start');
      await page.click('[data-start="otsphy1"]');
      await page.waitForSelector('#otsExam:not([hidden]) #otsPaper canvas');
      assert(/^\d+:\d\d/.test(await page.textContent('#otsTimer')), 'timer running');
      assert.equal(state.calls[0].action, 'start');
      await page.screenshot({ path: path.join(out, `student-exam-${viewport.width}.png`) });
      await page.click('text=Submit answers');
      await page.setInputFiles('#otsFile', path.join(out, 'answer-script.pdf'));
      await page.waitForFunction(() => !document.getElementById('otsUpSubmit').disabled);
      assert.equal(await page.$$eval('#otsThumbs canvas', c => c.length), 3, 'page previews shown');
      await page.screenshot({ path: path.join(out, `student-upload-${viewport.width}.png`) });
      await page.click('#otsUpSubmit');
      await page.waitForFunction(() => /Submitted/.test(document.getElementById('otsUpMsg').textContent));
      const submit = state.calls.find(c => c.action === 'submit');
      assert(submit && /^https:\/\/ucarecdn\.com\//.test(submit.scriptPdfUrl) && submit.pageUrls.length === 3, 'PDF + 3 page images submitted');
      assert.equal(state.uploads.length, 4, 'PDF and each page uploaded');
      await page.waitForFunction(() => document.getElementById('otsExam').hidden, null, { timeout: 8000 });

      // Approved report from the test card
      await page.click('[data-report="otsphy2__student-demo"]');
      await page.waitForSelector('#otsReport:not([hidden]) .orp-sheet');
      const text = await page.textContent('#otsReportBody');
      assert(/Checked using Trained AI models & Approved by Aarav Sen/.test(text), 'approval line on the report');
      assert(await page.evaluate(() => document.querySelectorAll('#otsReportBody .orp-sheet').length >= 4), 'summary, marks, script and corrections pages');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'report fits the screen width');
      await page.screenshot({ path: path.join(out, `student-report-${viewport.width}.png`) });
      await page.click('#otsReport .ots-bar-btn.ghost');
      assert(await page.evaluate(() => document.getElementById('otsReport').hidden), 'report closes');
      assert.deepEqual(errors, [], 'student runtime errors');
      await page.close();
      console.log(`✓ student ${viewport.width}px: subject → chapter → start → paper + timer → PDF upload → approved report`);
    }
  } finally {
    await browser.close(); server.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
