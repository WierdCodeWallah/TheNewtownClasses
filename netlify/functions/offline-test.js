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
 *        browser for AI tests). Teacher-checked tests enter the review inbox.
 *    action 'return-script' (assigned teacher or admin) { attemptId, checkedScriptUrl, score, remark, onBehalfOf? }
 *        Atomically saves the checked PDF to the report, attempt and results.
 *        An admin may pass onBehalfOf (a teacher uid): that teacher is shown as
 *        the checker, and offlineAudit/return_{attemptId} records the admin.
 *        Without it an admin's return shows "TNC <Subject> Faculty".
 *    action 'delete-record' (admin) { attemptId }
 *        Permanently deletes one submission (report, attempt, result, history)
 *        and its uploaded scripts/checked PDF; logs offlineAudit/delete_{id}.
 *    action 'regrade' (staff)   { attemptId }
 *        Re-runs the AI check (e.g. after a failure).
 *    action 'answer-key' (student) { testId }
 *        After the student has submitted: the answer key PDF, when the admin
 *        uploaded one for students (offlineTests.hasAnswerKey).
 *
 *  The question paper and the answer key live in offlineTestKeys/{testId}
 *  (staff-only), so students never see either before they press Start, and
 *  see an answer key only after submitting, and only one the admin shared. Every write here uses the SERVICE
 *  ACCOUNT, so a student cannot change their own timer or status.
 *
 *  Online Test Series (all-India, /test-series) tests are offlineTests with
 *  series 'online'. Google-signed-in students (onlineStudents/{uid}) may take
 *  them once unlocked: free tests, a Razorpay purchase, or an enrolled TNC ID.
 *  Their results go to onlineStudents/{uid}/results and every return
 *  refreshes that class + subject leaderboard.
 *
 *  REQUIRED ENV VARS: FIREBASE_PROJECT_ID, FIREBASE_SERVICE_ACCOUNT
 * ════════════════════════════════════════════════════
 */
const crypto = require('crypto');
const policy = require('../../assets/js/offline-policy');
const {
  request, verifyFirebaseIdToken, getServiceAccountAccessToken, fsGet, fsPatch, fsCommit, decFields
} = require('./_google');
const onlineSeries = require('./_online');
const onlinePolicy = require('../../assets/js/online-policy');

// Where a student's result and history live: the institute record for the
// offline series, the online profile for the all-India online series.
const resultPaths = (rep, attemptId) => rep.series === 'online'
  ? { result: `onlineStudents/${rep.uid}/results/${attemptId}`, history: `onlineStudents/${rep.uid}/history/${attemptId}` }
  : { result: `students/${rep.uid}/offlineResults/ots_${attemptId}`, history: `students/${rep.uid}/offlineHistory/${attemptId}` };

async function refreshBoard(projectId, sa, rep) {
  if (rep.series !== 'online') return;
  try { await onlineSeries.refreshLeaderboard(projectId, sa, rep.studentClass, rep.subject); }
  catch (e) { console.error('[offline-test] leaderboard refresh failed', e); }   // next return refreshes it again
}

const CORS = {
  'Access-Control-Allow-Origin' : '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type'                : 'application/json'
};
const ok  = obj => ({ statusCode: 200, headers: CORS, body: JSON.stringify(obj) });

// ── Result email to the parent (and the student) when a checked script is sent back ──
// Needs BREVO_API_KEY and RESULT_EMAIL_FROM (a sender verified in Brevo) in Netlify.
// Without them nothing is sent. A failed email never blocks the return itself.
const escHtml = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const realEmail = e => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(e || '')) && !/@ntcportal\.local$|@example\./i.test(String(e));
async function resultEmailTargets(projectId, sa, rep) {
  const [onl, stu] = await Promise.all([fsGet(projectId, sa, `onlineStudents/${rep.uid}`).catch(() => null), fsGet(projectId, sa, `students/${rep.uid}`).catch(() => null)]);
  const o = onl ? decFields(onl) : {}, s = stu ? decFields(stu) : {};
  const parent = [o.guardianEmail, s.guardianEmail, s.parentEmail].find(realEmail) || '';
  const student = [o.email, s.email].find(realEmail) || '';
  return { parent, student: student && student.toLowerCase() !== parent.toLowerCase() ? student : '', guardianName: o.guardianName || s.parentName || '' };
}
async function sendResultEmail(projectId, sa, rep, score, remark, checkedScriptUrl) {
  const key = process.env.BREVO_API_KEY, from = process.env.RESULT_EMAIL_FROM;
  if (!key || !from) return [];
  const t = await resultEmailTargets(projectId, sa, rep);
  const to = [t.parent, t.student].filter(Boolean);
  if (!to.length) return [];
  const total = Number(rep.totalMarks) || 0, pct = total > 0 ? Math.round(score / total * 100) : null;
  const online = rep.series === 'online';
  // TNC students see online results on their own dashboard too.
  const link = online && !rep.enrolled ? 'https://thenewtownclasses.com/test-series#/results' : 'https://thenewtownclasses.com/login/student';
  const name = rep.studentName || 'Your child';
  const subject = `${name}'s result: ${rep.testName || 'Test'} — ${score}/${total}`;
  const row = (k, v) => `<tr><td style="padding:6px 0;color:#64748b;font-size:14px">${escHtml(k)}</td><td style="padding:6px 0;font-size:14px;font-weight:600;color:#0f172a;text-align:right">${escHtml(v)}</td></tr>`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;background:#f3f6fb;padding:24px 12px"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e3e9f1">
    <div style="background:#003087;color:#fff;padding:18px 22px"><div style="font-size:12px;letter-spacing:2px;font-weight:700;opacity:.85">THE NEWTOWN CLASSES</div><div style="font-size:19px;font-weight:700;margin-top:4px">Test result</div></div>
    <div style="padding:20px 22px"><p style="margin:0 0 14px;font-size:15px;color:#0f172a">${t.guardianName ? 'Dear ' + escHtml(t.guardianName) + ',' : 'Hello,'}</p>
      <p style="margin:0 0 16px;font-size:15px;color:#334155">${escHtml(name)}'s answer sheet has been checked by our software and approved by a TNC teacher.</p>
      <div style="text-align:center;background:#eef4ff;border-radius:12px;padding:16px;margin-bottom:16px"><div style="font-size:32px;font-weight:800;color:#003087">${escHtml(score)} / ${escHtml(total)}</div>${pct == null ? '' : `<div style="font-size:14px;color:#475569">${pct}%</div>`}</div>
      <table style="width:100%;border-collapse:collapse">${row('Student', name)}${row('Test', rep.testName || '')}${row('Subject', rep.subject || '')}${rep.chapter ? row('Chapter', rep.chapter) : ''}${row('Class', rep.studentClass || '')}</table>
      ${remark ? `<div style="margin-top:16px;padding:12px 14px;background:#f8fafc;border-left:3px solid #19a3a0;border-radius:8px;font-size:14px;color:#334155"><b>Teacher's feedback</b><br>${escHtml(remark).replace(/\n/g, '<br>')}</div>` : ''}
      <div style="margin-top:20px">${checkedScriptUrl ? `<a href="${escHtml(checkedScriptUrl)}" style="display:inline-block;background:#003087;color:#fff;text-decoration:none;padding:11px 16px;border-radius:10px;font-weight:700;font-size:14px;margin:0 8px 8px 0">View checked answer sheet</a>` : ''}<a href="${link}" style="display:inline-block;background:#eef4ff;color:#003087;text-decoration:none;padding:11px 16px;border-radius:10px;font-weight:700;font-size:14px">Open all results</a></div>
      <p style="margin:20px 0 0;font-size:12px;color:#94a3b8">Questions? Call or WhatsApp +91 99034 61361 · thenewtownclasses.com</p></div></div></div>`;
  const text = `${subject}\n\nStudent: ${name}\nTest: ${rep.testName || ''} (${rep.subject || ''})\nMarks: ${score}/${total}${pct == null ? '' : ' (' + pct + '%)'}${remark ? '\nFeedback: ' + remark : ''}${checkedScriptUrl ? '\nChecked answer sheet: ' + checkedScriptUrl : ''}\nAll results: ${link}\n\nThe NewTown Classes · +91 99034 61361`;
  try {
    const r = await request('api.brevo.com', '/v3/smtp/email', 'POST', { 'api-key': key, 'Content-Type': 'application/json', accept: 'application/json' }, {
      sender: { name: process.env.RESULT_EMAIL_FROM_NAME || 'The NewTown Classes', email: from },
      to: to.map(email => ({ email })), subject, htmlContent: html, textContent: text, tags: ['result'] });
    if (r.status >= 200 && r.status < 300) return to;
    console.error('[offline-test] result email failed', r.status, r.body && r.body.message);
  } catch (e) { console.error('[offline-test] result email failed', e.message); }
  return [];
}
const bad = (status, msg) => ({ statusCode: status, headers: CORS, body: JSON.stringify({ error: msg }) });

const MAX_PAGES = 25;
const UPLOAD_GRACE_MIN = 15;   // time to scan & upload after the timer ends (papers without their own)
// New papers carry their own upload time (chapter-wise 10 min, full mock 20 min).
const graceFor = test => { const n = parseInt(test && test.uploadGraceMin, 10); return n >= 5 && n <= 60 ? n : UPLOAD_GRACE_MIN; };
const UC = { test: require('../../assets/js/uploadcare-config').isFileUrl };

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

// Permanently remove one uploaded file from Uploadcare storage (signed REST call).
// 404/410 mean it is already gone. Needs UPLOADCARE_SECRET_KEY (server-only).
async function deleteStoredFile(id) {
  const secret = process.env.UPLOADCARE_SECRET_KEY, pub = process.env.UPLOADCARE_PUBLIC_KEY || require('../../assets/js/uploadcare-config').publicKey;
  if (!secret || !/^[0-9a-f-]{36}$/.test(id)) return false;
  const uri = `/files/${id}/storage/`, date = new Date().toUTCString();
  const md5 = crypto.createHash('md5').update('').digest('hex');
  const signed = crypto.createHmac('sha1', secret).update(['DELETE', md5, 'application/json', date, uri].join('\n')).digest('hex');
  try {
    const r = await request('api.uploadcare.com', uri, 'DELETE', { Accept: 'application/vnd.uploadcare-v0.7+json', 'Content-Type': 'application/json', Date: date, Authorization: `Uploadcare ${pub}:${signed}` });
    return [200, 204, 404, 410].includes(r.status);
  } catch (_) { return false; }
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
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad(400, 'Expected a JSON object');
  const { idToken, action } = body;

  try {
    const { uid } = await verifyFirebaseIdToken(idToken, projectId);
    const sa = await getServiceAccountAccessToken();

    // A teacher returns their checked PDF. All three student-facing records
    // change atomically so a failed request cannot leave a half-published result.
    if (action === 'return-script') {
      const attemptId = String(body.attemptId || '');
      if (!/^[A-Za-z0-9_-]{1,210}$/.test(attemptId) || !attemptId.includes('__')) return bad(400, 'Invalid attempt');
      if (!(await isStaff(projectId, sa, uid))) return bad(403, 'Only teachers can return scripts.');
      const [repDoc, attDoc, teacherDoc, adminDoc] = await Promise.all([
        fsGet(projectId, sa, `offlineReports/${attemptId}`),
        fsGet(projectId, sa, `offlineAttempts/${attemptId}`),
        fsGet(projectId, sa, `teachers/${uid}`), fsGet(projectId, sa, `admins/${uid}`)
      ]);
      if (!repDoc || !attDoc) return bad(404, 'Submitted script not found.');
      const rep = decFields(repDoc), att = decFields(attDoc);
      const callerIsAdmin = !!(adminDoc && decFields(adminDoc).isAdmin);
      if (rep.teacherUid !== uid && !callerIsAdmin) return bad(403, 'Only the assigned teacher can return this script.');
      // Admins may return a script in a chosen teacher's name; that teacher is
      // shown as the checker. The real actor goes to the admin-only audit log.
      // An admin's own return shows "TNC <Subject> Faculty", never a person.
      let actorUid = uid, actorName = callerIsAdmin ? onlinePolicy.facultyName(rep.subject) : (teacherDoc && decFields(teacherDoc).name) || 'Teacher';
      if (body.onBehalfOf != null && body.onBehalfOf !== '') {
        const onBehalfOf = String(body.onBehalfOf);
        if (!callerIsAdmin) return bad(403, 'Only admins can return a script for another teacher.');
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(onBehalfOf)) return bad(400, 'Choose a valid teacher.');
        const chosen = onBehalfOf === uid ? teacherDoc : await fsGet(projectId, sa, `teachers/${onBehalfOf}`);
        if (!chosen) return bad(400, 'Choose a valid teacher.');
        actorUid = onBehalfOf; actorName = decFields(chosen).name || 'Teacher';
      }
      if (!rep.scriptPdfUrl || att.status === 'started') return bad(409, 'The student has not submitted yet.');
      if (['checking', 'grading'].includes(rep.status)) return bad(409, 'Wait for the current check to finish before returning this script.');
      const checkedScriptUrl = String(body.checkedScriptUrl || '');
      if (!UC.test(checkedScriptUrl)) return bad(400, 'Upload the checked script as a PDF.');
      const score = body.score;
      if (!Number.isFinite(Number(rep.totalMarks)) || Number(rep.totalMarks) <= 0 || typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > Number(rep.totalMarks)) return bad(400, 'Enter marks between 0 and the maximum marks.');
      const remark = String(body.remark || '').trim().slice(0, 3000);
      if (rep.status === 'approved') {
        if (rep.checkedScriptUrl === checkedScriptUrl && rep.score === score && rep.teacherRemark === remark) return ok({ ok: true, status: 'approved' });
        return bad(409, 'This script has already been returned.');
      }
      const now = new Date().toISOString();
      const name = actorName;
      const paths = resultPaths(rep, attemptId);
      const audit = actorUid !== uid
        ? [{ path: `offlineAudit/return_${attemptId}`, data: { action: 'return-script', attemptId, byAdminUid: uid, onBehalfOfUid: actorUid, onBehalfOfName: actorName, at: now } }]
        : [];
      await fsCommit(projectId, sa, [
        { path: `offlineReports/${attemptId}`, currentDocument: { updateTime: repDoc.updateTime }, data: {
          ...rep, status: 'approved', checkedScriptUrl, score, teacherRemark: remark,
          reviewMode: 'teacher', approvedAt: now, checkedAt: now, approvedByUid: actorUid, approvedByName: name
        } },
        { path: `offlineAttempts/${attemptId}`, currentDocument: { updateTime: attDoc.updateTime }, data: {
          ...att, status: 'approved', approvedAt: now, checkedScriptUrl
        } },
        { path: paths.result, data: {
          resultId: rep.series === 'online' ? attemptId : 'ots_' + attemptId, source: rep.series === 'online' ? 'online' : 'offline', reportId: attemptId,
          testId: rep.testId || '', chapter: rep.chapter || 'General', series: rep.series || 'offline',
          testName: rep.testName, subject: rep.subject, topic: rep.chapter, module: rep.module || 'Full chapter', testType: 'subjective', class: rep.studentClass,
          score, totalMarks: rep.totalMarks, pct: Math.round(score / rep.totalMarks * 100),
          testDate: (rep.submittedAt || now).slice(0, 10), remark: remark || (rep.series === 'online' ? 'Checked by TNC faculty' : 'Offline Test Series · Teacher checked'),
          // Online students see "TNC faculty", never the checker's name or ID (the report keeps it for admins).
          answerSheetUrl: checkedScriptUrl, reviewMode: 'teacher', teacherUid: rep.series === 'online' ? '' : actorUid, teacherName: rep.series === 'online' ? onlinePolicy.facultyName(rep.subject) : name,
          studentUid: rep.uid, studentName: rep.studentName, studentId: rep.studentId, savedAt: now,
          submittedAt: rep.submittedAt, approvedAt: now
        } }
        ,{ path: paths.history, data: { ...policy.history(rep), status: 'approved', score, totalMarks: rep.totalMarks } }
        , ...audit
      ]);
      await refreshBoard(projectId, sa, rep);
      const emailed = await sendResultEmail(projectId, sa, rep, score, remark, checkedScriptUrl).catch(() => []);
      return ok({ ok: true, status: 'approved', emailed });
    }

    // ── Admin: permanently delete one submission everywhere ──
    // Report, attempt, the student's result and history go in one atomic
    // commit; then the student's script, page images and checked PDF are
    // removed from storage. Question papers are shared and never touched.
    if (action === 'delete-record') {
      const attemptId = String(body.attemptId || '');
      if (!/^[A-Za-z0-9_-]{1,210}$/.test(attemptId) || !attemptId.includes('__')) return bad(400, 'Invalid record');
      const adminDoc = await fsGet(projectId, sa, `admins/${uid}`);
      if (!(adminDoc && decFields(adminDoc).isAdmin)) return bad(403, 'Only admins can delete records.');
      const [repDoc, attDoc] = await Promise.all([fsGet(projectId, sa, `offlineReports/${attemptId}`), fsGet(projectId, sa, `offlineAttempts/${attemptId}`)]);
      if (!repDoc && !attDoc) return bad(404, 'This record has already been deleted.');
      const rep = repDoc ? decFields(repDoc) : {}, att = attDoc ? decFields(attDoc) : {};
      if (['checking', 'grading'].includes(rep.status)) return bad(409, 'Wait for the current AI check to finish before deleting this record.');
      const studentUid = rep.uid || att.uid || attemptId.split('__').pop();
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(studentUid)) return bad(400, 'Invalid record');
      const now = new Date().toISOString();
      const paths = resultPaths({ ...rep, uid: studentUid }, attemptId);
      await fsCommit(projectId, sa, [
        ...(repDoc ? [{ path: `offlineReports/${attemptId}`, remove: true, currentDocument: { updateTime: repDoc.updateTime } }] : []),
        ...(attDoc ? [{ path: `offlineAttempts/${attemptId}`, remove: true, currentDocument: { updateTime: attDoc.updateTime } }] : []),
        { path: paths.result, remove: true },
        { path: paths.history, remove: true },
        // Minimal admin-only accountability record; no marks or files are kept.
        { path: `offlineAudit/delete_${attemptId}`, data: { action: 'delete-record', attemptId, studentId: rep.studentId || att.studentId || '', testName: rep.testName || '', byAdminUid: uid, at: now } }
      ]);
      const ids = [...new Set([rep.scriptPdfUrl || att.scriptPdfUrl, rep.checkedScriptUrl || att.checkedScriptUrl, ...(rep.pageUrls || att.pageUrls || [])]
        .map(u => require('../../assets/js/uploadcare-config').uuid(u)).filter(Boolean))];
      const results = await Promise.all(ids.map(deleteStoredFile));
      if (rep.status === 'approved') await refreshBoard(projectId, sa, rep);
      return ok({ ok: true, filesDeleted: results.filter(Boolean).length, filesFailed: results.filter(r => !r).length });
    }

    // ── Staff: re-run the AI check ──
    if (action === 'regrade') {
      const attemptId = String(body.attemptId || '');
      if (!/^[A-Za-z0-9_-]+__[A-Za-z0-9]+$/.test(attemptId)) return bad(400, 'Invalid attempt');
      if (!(await isStaff(projectId, sa, uid))) return bad(403, 'Only teachers can re-check scripts');
      const att = await fsGet(projectId, sa, `offlineAttempts/${attemptId}`);
      if (!att) return bad(404, 'Attempt not found');
      const rep = await fsGet(projectId, sa, `offlineReports/${attemptId}`);
      if (rep && decFields(rep).reviewMode === 'teacher') return bad(409, 'This script is assigned for teacher review.');
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
    const test = decFields(testDoc);
    const isOnline = test.series === 'online';
    // Online series: students who signed up with Google take tests from their
    // online profile; enrolled students keep their institute record.
    const onlineDoc = isOnline && !studentDoc ? await fsGet(projectId, sa, `onlineStudents/${uid}`) : null;
    const onlineProfile = onlineDoc ? decFields(onlineDoc) : null;
    if (!studentDoc && !(onlineProfile && onlineProfile.profileComplete)) {
      return bad(403, isOnline ? 'Complete your profile to take online tests.' : 'Only enrolled students can take tests.');
    }
    const student = studentDoc ? decFields(studentDoc) : { ...onlineProfile, studentId: onlineProfile.onlineId || '' };
    if (String(test.class) !== String(student.class || '')) return bad(403, 'This test is for a different class.');
    if (test.board && test.board !== student.board) return bad(403, 'This test is for a different board.');
    const attemptId = `${testId}__${uid}`;
    const attDoc = await fsGet(projectId, sa, `offlineAttempts/${attemptId}`);
    const att = attDoc ? decFields(attDoc) : null;

    if (action === 'start') {
      if (att) return ok({ attemptId, ...att, serverNow: new Date().toISOString() });
      if (test.isActive === false) return bad(403, 'This test is closed.');
      if (isOnline && test.kind === 'custom' && test.forUid !== uid) return bad(403, 'This custom test was made for another student.');
      // Mock pack: only for students in the pack, and not before its opening time.
      if (isOnline && test.kind === 'package') {
        // Everyone joins a pack (TNC students pay for packs too).
        if (!(await fsGet(projectId, sa, `onlinePurchases/pkg_${test.packageId}__${uid}`))) return bad(402, 'Join this mock pack to take the test.');
        if (test.releaseAt && Date.parse(test.releaseAt) > Date.now()) {
          const when = new Date(test.releaseAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
          return bad(403, `This mock opens on ${when}.`);
        }
      }
      // Online series: TNC students get chapter-wise tests free; everything
      // else needs a free-mock claim or a payment (both create a purchase).
      if (isOnline && onlineSeries.priceFor(test, !!studentDoc) > 0 && !(await fsGet(projectId, sa, `onlinePurchases/${testId}__${uid}`))) {
        return bad(402, `Unlock this test for ₹${onlineSeries.priceFor(test, !!studentDoc)} to start.`);
      }
      const keyDoc = await fsGet(projectId, sa, `offlineTestKeys/${testId}`);
      const key = keyDoc ? decFields(keyDoc) : {};
      if (!key.questionPdfUrl) return bad(409, 'The question paper has not been uploaded yet.');
      const duration = Math.max(5, Math.min(600, parseInt(test.durationMin, 10) || 60));
      const now = new Date();
      const rec = {
        attemptId, testId, uid,
        studentName: student.name || '', studentId: student.studentId || '',
        studentSection: student.section || '',
        durationMin: duration,
        startedAt: now.toISOString(),
        deadline: new Date(now.getTime() + duration * 60000).toISOString(),
        uploadGraceMin: graceFor(test),
        questionPdfUrl: key.questionPdfUrl,
        status: 'started'
      };
      try {
        await fsCommit(projectId, sa, [{ path: `offlineAttempts/${attemptId}`, data: rec, currentDocument: { exists: false } }]);
      } catch (e) {
        if (!e.conflict) throw e;
        const existing = await fsGet(projectId, sa, `offlineAttempts/${attemptId}`);
        if (!existing) throw e;
        return ok({ ...decFields(existing), serverNow: new Date().toISOString() });
      }
      return ok({ ...rec, serverNow: now.toISOString() });
    }

    // The answer key, once this student has submitted (never while the timer
    // runs), and only for papers the admin shared a key for.
    if (action === 'answer-key') {
      if (!att || att.status === 'started') return bad(409, 'Submit your answers first — the answer key opens after that.');
      if (test.hasAnswerKey !== true) return bad(404, 'The answer key for this test is not available yet.');
      const keyDoc = await fsGet(projectId, sa, `offlineTestKeys/${testId}`);
      const answerPdfUrl = keyDoc ? decFields(keyDoc).answerPdfUrl : '';
      if (!answerPdfUrl || !UC.test(answerPdfUrl)) return bad(404, 'The answer key for this test is not available yet.');
      return ok({ answerPdfUrl });
    }

    if (action === 'submit') {
      if (!att) return bad(409, 'Start the test before submitting.');
      if (att.status !== 'started') {
        if (att.scriptPdfUrl && att.scriptPdfUrl === body.scriptPdfUrl) return ok({ ok: true, status: att.status, lateByMin: att.lateByMin || 0 });
        return bad(409, 'You have already submitted this test.');
      }
      const scriptPdfUrl = String(body.scriptPdfUrl || '');
      const pageUrls = Array.isArray(body.pageUrls) ? body.pageUrls.map(String) : [];
      if (!UC.test(scriptPdfUrl)) return bad(400, 'Upload your answer script as a PDF.');
      const manual = test.gradingMode === 'teacher';
      if ((!manual && !pageUrls.length) || pageUrls.length > MAX_PAGES || !pageUrls.every(u => UC.test(u))) {
        return bad(400, `Your PDF must have between 1 and ${MAX_PAGES} pages.`);
      }
      const now = new Date();
      const lateByMin = Math.max(0, Math.round((now - new Date(att.deadline)) / 60000));
      const usedMin = Math.max(0, Math.round((now - new Date(att.startedAt)) / 60000));
      const status = manual ? 'submitted' : 'checking';
      const review = { reviewDueAt: new Date(now.getTime() + policy.DAY).toISOString() };
      const submitted = { ...att, ...review, status, submittedAt: now.toISOString(), lateByMin, usedMin, scriptPdfUrl, pageUrls };
      const report = {
        attemptId, testId, uid, ...review,
        studentName: student.name || '', studentId: student.studentId || '',
        studentClass: String(student.class || ''), studentBoard: student.board || '', studentSection: student.section || '', school: student.school || '',
        testName: test.testName || '', subject: test.subject || '', chapter: test.chapter || '', module: test.module || 'Full chapter',
        board: test.board || '', totalMarks: Number(test.totalMarks) || 0, durationMin: att.durationMin,
        teacherUid: test.teacherUid || '', teacherName: test.teacherName || '',
        startedAt: att.startedAt, deadline: att.deadline, submittedAt: now.toISOString(),
        lateByMin, usedMin, scriptPdfUrl, pageUrls,
        series: isOnline ? 'online' : 'offline', enrolled: !!studentDoc,
        studentCity: student.city || '', studentState: student.state || '',
        status, reviewMode: manual ? 'teacher' : 'ai', aiReport: '', finalReport: '', integrity: '', error: '',
        approvedByUid: '', approvedByName: '', approvedAt: ''
      };
      await fsCommit(projectId, sa, [
        { path: `offlineAttempts/${attemptId}`, data: submitted, currentDocument: { updateTime: attDoc.updateTime } },
        { path: `offlineReports/${attemptId}`, data: report, currentDocument: { exists: false } },
        { path: resultPaths(report, attemptId).history, data: policy.history(report) }
      ]);
      try { if (!manual) await triggerGrader(attemptId); }
      catch (e) { console.error('[offline-test] trigger failed', e); }   // teacher can re-run from the approval list
      return ok({ ok: true, status, lateByMin });
    }

    return bad(400, 'Unknown action');
  } catch (e) {
    const msg = (e && e.message) || String(e);
    if (e.conflict) return bad(409, 'This test was updated in another window. Refresh to see its current status.');
    if (/Invalid Firebase ID token|Missing idToken|expired/i.test(msg)) return bad(401, 'Please sign in again.');
    if (e && e.status === 503) return bad(503, msg);   // an outside service timed out: friendly message
    console.error('[offline-test]', e);                 // details stay in the server log
    return bad(500, 'Something went wrong. Please try again.');
  }
};

