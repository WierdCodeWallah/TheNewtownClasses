/**
 * ════════════════════════════════════════════════════
 *  Netlify Function: offline-test
 *  ────────────────────────────────────────────────
 *  Server side of the Offline Test Series (pen & paper tests).
 *
 *  POST { idToken, action, ... }
 *    action 'start'   (student) { testId }
 *        Opens the attempt: records the server start time + deadline and
 *        returns the question-paper PDF. Idempotent — reopening returns the
 *        same deadline, so a refresh never resets the timer.
 *    action 'submit'  (student) { testId, scriptPdfUrl, pageUrls[] }
 *        Accepts the answer-script PDF (+ page images rendered in the
 *        browser), then hands it to grade-offline-background for the AI check.
 *    action 'regrade' (staff)   { attemptId }
 *        Re-runs the AI check (e.g. after a failure).
 *
 *  The question paper and the answer key live in offlineTestKeys/{testId}
 *  (staff-only), so students never see either before they press Start, and
 *  never see the answer key at all. Every write here uses the SERVICE
 *  ACCOUNT, so a student cannot change their own timer or status.
 *
 *  REQUIRED ENV VARS: FIREBASE_PROJECT_ID, FIREBASE_SERVICE_ACCOUNT
 * ════════════════════════════════════════════════════
 */
const crypto = require('crypto');
const {
  request, verifyFirebaseIdToken, getServiceAccountAccessToken, fsGet, fsPatch, decFields
} = require('./_google');

const CORS = {
  'Access-Control-Allow-Origin' : '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type'                : 'application/json'
};
const ok  = obj => ({ statusCode: 200, headers: CORS, body: JSON.stringify(obj) });
const bad = (status, msg) => ({ statusCode: status, headers: CORS, body: JSON.stringify({ error: msg }) });

const MAX_PAGES = 25;
const UPLOAD_GRACE_MIN = 15;   // time to scan & upload after the timer ends
const UC = /^https:\/\/ucarecdn\.com\/[0-9a-f-]{36}\/[^\s"'<>]*$/i;

// Shared secret for the background grader, derived from the service account
// (both functions already have it), so no extra env var is needed. Keep in
// sync with graderSignature() in grade-offline-background.js.
function graderSignature(attemptId) {
  const secret = crypto.createHash('sha256').update(String(process.env.FIREBASE_SERVICE_ACCOUNT || '')).digest();
  return crypto.createHmac('sha256', secret).update('grade:' + attemptId).digest('hex');
}

async function triggerGrader(attemptId) {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || '';
  const u = new URL('/.netlify/functions/grade-offline-background', base);
  const r = await request(u.hostname, u.pathname, 'POST', { 'Content-Type': 'application/json' },
    { attemptId, sig: graderSignature(attemptId) });
  if (r.status !== 202 && r.status !== 200) throw new Error('Could not start the AI check (HTTP ' + r.status + ')');
}

async function isStaff(projectId, saToken, uid) {
  const [t, a] = await Promise.all([
    fsGet(projectId, saToken, `teachers/${uid}`),
    fsGet(projectId, saToken, `admins/${uid}`)
  ]);
  return !!t || !!(a && decFields(a).isAdmin);
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')    return bad(405, 'Method not allowed');
  const missing = ['FIREBASE_PROJECT_ID', 'FIREBASE_SERVICE_ACCOUNT'].filter(k => !process.env[k]);
  if (missing.length) return bad(500, 'Server is missing env vars: ' + missing.join(', '));
  const projectId = process.env.FIREBASE_PROJECT_ID;

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return bad(400, 'Invalid JSON'); }
  const { idToken, action } = body;

  try {
    const { uid } = await verifyFirebaseIdToken(idToken, projectId);
    const sa = await getServiceAccountAccessToken();

    // ── Staff: re-run the AI check ──
    if (action === 'regrade') {
      const attemptId = String(body.attemptId || '');
      if (!/^[A-Za-z0-9_-]+__[A-Za-z0-9]+$/.test(attemptId)) return bad(400, 'Invalid attempt');
      if (!(await isStaff(projectId, sa, uid))) return bad(403, 'Only teachers can re-check scripts');
      const att = await fsGet(projectId, sa, `offlineAttempts/${attemptId}`);
      if (!att) return bad(404, 'Attempt not found');
      const rep = await fsGet(projectId, sa, `offlineReports/${attemptId}`);
      // The report is approved first, so check it too, not just the attempt.
      if (decFields(att).status === 'approved' || (rep && decFields(rep).status === 'approved')) return bad(409, 'This script is already approved');
      await fsPatch(projectId, sa, `offlineAttempts/${attemptId}`, { ...decFields(att), status: 'checking' });
      if (rep) await fsPatch(projectId, sa, `offlineReports/${attemptId}`, { ...decFields(rep), status: 'checking', error: '', gradingStartedAt: '' });
      await triggerGrader(attemptId);
      return ok({ ok: true, status: 'checking' });
    }

    const testId = String(body.testId || '');
    if (!/^[A-Za-z0-9_-]{6,80}$/.test(testId)) return bad(400, 'Invalid test');
    const [testDoc, studentDoc] = await Promise.all([
      fsGet(projectId, sa, `offlineTests/${testId}`),
      fsGet(projectId, sa, `students/${uid}`)
    ]);
    if (!testDoc)    return bad(404, 'This test is no longer available.');
    if (!studentDoc) return bad(403, 'Only enrolled students can take tests.');
    const test = decFields(testDoc), student = decFields(studentDoc);
    if (String(test.class) !== String(student.class || '')) return bad(403, 'This test is for a different class.');
    const attemptId = `${testId}__${uid}`;
    const attDoc = await fsGet(projectId, sa, `offlineAttempts/${attemptId}`);
    const att = attDoc ? decFields(attDoc) : null;

    if (action === 'start') {
      if (att) return ok({ attemptId, ...att, serverNow: new Date().toISOString() });
      if (test.isActive === false) return bad(403, 'This test is closed.');
      const keyDoc = await fsGet(projectId, sa, `offlineTestKeys/${testId}`);
      const key = keyDoc ? decFields(keyDoc) : {};
      if (!key.questionPdfUrl) return bad(409, 'The question paper has not been uploaded yet.');
      const duration = Math.max(5, Math.min(600, parseInt(test.durationMin, 10) || 60));
      const now = new Date();
      const rec = {
        attemptId, testId, uid,
        studentName: student.name || '', studentId: student.studentId || '',
        durationMin: duration,
        startedAt: now.toISOString(),
        deadline: new Date(now.getTime() + duration * 60000).toISOString(),
        uploadGraceMin: UPLOAD_GRACE_MIN,
        questionPdfUrl: key.questionPdfUrl,
        status: 'started'
      };
      await fsPatch(projectId, sa, `offlineAttempts/${attemptId}`, rec);
      return ok({ ...rec, serverNow: now.toISOString() });
    }

    if (action === 'submit') {
      if (!att) return bad(409, 'Start the test before submitting.');
      if (att.status !== 'started') return bad(409, 'You have already submitted this test.');
      const scriptPdfUrl = String(body.scriptPdfUrl || '');
      const pageUrls = Array.isArray(body.pageUrls) ? body.pageUrls.map(String) : [];
      if (!UC.test(scriptPdfUrl)) return bad(400, 'Upload your answer script as a PDF.');
      if (!pageUrls.length || pageUrls.length > MAX_PAGES || !pageUrls.every(u => UC.test(u))) {
        return bad(400, `Your PDF must have between 1 and ${MAX_PAGES} pages.`);
      }
      const now = new Date();
      const lateByMin = Math.max(0, Math.round((now - new Date(att.deadline)) / 60000));
      const usedMin = Math.max(0, Math.round((now - new Date(att.startedAt)) / 60000));
      const submitted = { ...att, status: 'checking', submittedAt: now.toISOString(), lateByMin, usedMin, scriptPdfUrl, pageUrls };
      await fsPatch(projectId, sa, `offlineAttempts/${attemptId}`, submitted);
      await fsPatch(projectId, sa, `offlineReports/${attemptId}`, {
        attemptId, testId, uid,
        studentName: student.name || '', studentId: student.studentId || '',
        studentClass: String(student.class || ''), studentBoard: student.board || '', school: student.school || '',
        testName: test.testName || '', subject: test.subject || '', chapter: test.chapter || '',
        board: test.board || '', totalMarks: Number(test.totalMarks) || 0, durationMin: att.durationMin,
        teacherUid: test.teacherUid || '', teacherName: test.teacherName || '',
        startedAt: att.startedAt, deadline: att.deadline, submittedAt: now.toISOString(),
        lateByMin, usedMin, scriptPdfUrl, pageUrls,
        status: 'checking', aiReport: '', finalReport: '', integrity: '', error: '',
        approvedByUid: '', approvedByName: '', approvedAt: ''
      });
      try { await triggerGrader(attemptId); }
      catch (e) { console.error('[offline-test] trigger failed', e); }   // teacher can re-run from the approval list
      return ok({ ok: true, status: 'checking', lateByMin });
    }

    return bad(400, 'Unknown action');
  } catch (e) {
    const msg = (e && e.message) || String(e);
    if (/Invalid Firebase ID token|Missing idToken|expired/i.test(msg)) return bad(401, 'Please sign in again.');
    console.error('[offline-test]', e);
    return bad(500, msg);
  }
};

