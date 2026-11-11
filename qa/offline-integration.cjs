/* Run after qa/offline-rules.cjs against the same LOCAL emulator on 8188.
   Uses the real endpoint and Firestore REST encoding/atomic commits. Only
   token verification is replaced; all HTTPS requests are forced to localhost. */
const assert = require('node:assert/strict');
const http = require('node:http'), https = require('node:https');
https.request = (options, callback) => {
  assert.equal(options.hostname, 'firestore.googleapis.com', 'no external network calls');
  assert(options.path.includes('/projects/demo-offline/'), 'isolated demo project only');
  return http.request({ ...options, hostname: '127.0.0.1', port: 8188 }, callback);
};
process.env.FIREBASE_PROJECT_ID = 'demo-offline';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"localFixture":true}';
const google = require('../netlify/functions/_google');
const modulePath = require.resolve('../netlify/functions/_google');
require.cache[modulePath].exports = { ...google, verifyFirebaseIdToken: async uid => ({ uid }), getServiceAccountAccessToken: async () => 'owner' };
const { handler } = require('../netlify/functions/offline-test');
const project = 'demo-offline', auth = 'owner';
const read = async path => google.decFields(await google.fsGet(project, auth, path));
const call = async data => {
  const r = await handler({ httpMethod: 'POST', body: JSON.stringify(data) });
  return { status: r.statusCode, body: JSON.parse(r.body) };
};
(async () => {
  await google.fsPatch(project, auth, 'students/integration', { name: 'Integration Student', studentId: 'NTC-QA', class: '11', board: 'CBSE', section: 'A' });
  await google.fsPatch(project, auth, 'teachers/integrationTeacher', { name: 'Integration Teacher' });
  const testId = 'manual_' + Date.now(), attemptId = testId + '__integration';
  const pdf = 'https://ucarecdn.com/11111111-1111-1111-1111-111111111111/';
  await google.fsPatch(project, auth, `offlineTests/${testId}`, { testName: 'Integration Exam', subject: 'Physics', chapter: 'Motion', class: '11', board: 'CBSE', gradingMode: 'teacher', teacherUid: 'integrationTeacher', durationMin: 30, totalMarks: 20, isActive: true });
  await google.fsPatch(project, auth, `offlineTestKeys/${testId}`, { questionPdfUrl: pdf });
  const start = { idToken: 'integration', action: 'start', testId };
  const starts = await Promise.all([call(start), call(start)]);
  assert(starts.every(r => r.status === 200), JSON.stringify(starts));
  assert.equal(starts[0].body.deadline, starts[1].body.deadline, 'real concurrent create keeps one timer');
  const path = `offlineAttempts/${attemptId}`, old = await google.fsGet(project, auth, path);
  const record = google.decFields(old);
  const late = { ...record, deadline: new Date(Date.now() - 20 * 60000).toISOString(), startedAt: new Date(Date.now() - 50 * 60000).toISOString() };
  await google.fsPatch(project, auth, path, late);
  // A stale real Firestore precondition must roll back every write in the batch.
  await assert.rejects(google.fsCommit(project, auth, [
    { path: `students/integration/offlineResults/rollback_${testId}`, data: { score: 99 } },
    { path, data: record, currentDocument: { updateTime: old.updateTime } }
  ]), e => e.conflict === true);
  assert.equal(await google.fsGet(project, auth, `students/integration/offlineResults/rollback_${testId}`), null);
  const submit = { ...start, action: 'submit', scriptPdfUrl: pdf, pageUrls: [] };
  const submitted = await call(submit);
  assert.equal(submitted.status, 200, JSON.stringify(submitted));
  assert.equal(submitted.body.lateByMin, 20);
  assert.equal((await call(submit)).status, 200, 'real retry preserves submission');
  const report = await read(`offlineReports/${attemptId}`);
  assert.equal(report.studentSection, 'A'); assert.equal(report.reviewMode, 'teacher');
  const returned = { idToken: 'integrationTeacher', action: 'return-script', attemptId, checkedScriptUrl: pdf, score: 16.5, remark: 'Show the units.' };
  assert.equal((await call(returned)).status, 200);
  const saved = await read(`students/integration/offlineResults/ots_${attemptId}`);
  assert.equal(saved.score, 16.5); assert.equal(saved.pct, 83); assert.equal(saved.answerSheetUrl, pdf);
  assert.equal(saved.recordExpiresAt, undefined, 'results are permanent: no record expiry');
  assert.equal(saved.pdfExpiresAt, undefined, 'checked PDFs are permanent: no PDF expiry');
  assert.equal((await read(`students/integration/offlineHistory/${attemptId}`)).status, 'approved');
  assert.equal((await read(path)).status, 'approved');
  assert.equal((await read(`offlineReports/${attemptId}`)).status, 'approved');
  assert.equal((await call(returned)).status, 200);
  await google.fsPatch(project, auth, `students/integration/offlineHistory/delete_${testId}`, { temporary: true });
  const toDelete = await google.fsGet(project, auth, `students/integration/offlineHistory/delete_${testId}`);
  await google.fsCommit(project, auth, [{ path: `students/integration/offlineHistory/delete_${testId}`, remove: true, currentDocument: { updateTime: toDelete.updateTime } }]);
  assert.equal(await google.fsGet(project, auth, `students/integration/offlineHistory/delete_${testId}`), null);

  // Admin permanent delete through the real endpoint and real atomic commit.
  await google.fsPatch(project, auth, 'admins/integrationAdmin', { isAdmin: true });
  assert.equal((await call({ idToken: 'integrationTeacher', action: 'delete-record', attemptId })).status, 403, 'teacher cannot delete');
  const removed = await call({ idToken: 'integrationAdmin', action: 'delete-record', attemptId });
  assert.equal(removed.status, 200, JSON.stringify(removed));
  for (const p of [`offlineReports/${attemptId}`, `offlineAttempts/${attemptId}`, `students/integration/offlineResults/ots_${attemptId}`, `students/integration/offlineHistory/${attemptId}`]) {
    assert.equal(await google.fsGet(project, auth, p), null, p + ' deleted');
  }
  assert.equal((await read(`offlineAudit/delete_${attemptId}`)).byAdminUid, 'integrationAdmin');
  assert(await google.fsGet(project, auth, `offlineTests/${testId}`), 'the test itself is kept');
  assert.equal((await call({ idToken: 'integrationAdmin', action: 'delete-record', attemptId })).status, 404);
  console.log('Real Firestore integration passed: concurrent start, stale-write rollback, late submission, retry, named report, atomic checked-PDF archive and atomic admin delete. Authentication and file hosting remain fixtures.');
})().catch(error => { console.error(error); process.exitCode = 1; });
