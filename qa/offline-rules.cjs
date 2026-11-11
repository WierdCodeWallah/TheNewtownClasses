/* Real Firestore rules checks against an isolated LOCAL emulator only.
   java -jar <firestore-emulator.jar> --host 127.0.0.1 --port 8188 \
     --project_id demo-offline --rules firestore.rules
   node qa/offline-rules.cjs
   No production credentials or production writes. */
const assert = require('node:assert/strict');
const project = 'demo-offline', host = 'http://127.0.0.1:8188';
const base = `/v1/projects/${project}/databases/(default)/documents`;
const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function token(uid) {
  const now = Math.floor(Date.now() / 1000);
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ sub: uid, user_id: uid, iss: 'https://securetoken.google.com/' + project, aud: project, iat: now, exp: now + 3600, firebase: { sign_in_provider: 'password', identities: {} } })}.`;
}
const field = v => typeof v === 'boolean' ? { booleanValue: v } : { stringValue: String(v) };
let checks = 0;
async function request(path, method, data, auth, expected) {
  const response = await fetch(host + base + '/' + path, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth } : {}) }, body: data ? JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, field(v)])) }) : undefined });
  const text = await response.text();
  assert.equal(response.status, expected, `${method} ${path}: ${text}`); checks++;
  return text ? JSON.parse(text) : null;
}
const get = (path, auth, status) => request(path, 'GET', null, auth, status);
const patch = (path, data, auth, status) => request(path, 'PATCH', data, auth, status);
const remove = (path, auth, status) => request(path, 'DELETE', null, auth, status);
(async () => {
  const reset = await fetch(`${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(reset.status, 200);
  const student = token('student'), other = token('other'), teacher = token('teacher');
  await patch('students/student', { name: 'Riya', class: '11' }, 'owner', 200);
  await patch('teachers/teacher', { name: 'Teacher' }, 'owner', 200);
  await patch('offlineTests/test01', { class: '11', isActive: true, gradingMode: 'teacher' }, teacher, 200);
  await patch('offlineTestKeys/test01', { questionPdfUrl: 'fixture', answerPdfUrl: 'secret' }, teacher, 200);
  await get('offlineTests', student, 200);
  await get('offlineTests', null, 403);
  await patch('offlineTests/forged', { class: '11' }, student, 403);
  await get('offlineTestKeys/test01', student, 403);
  await get('offlineTestKeys', student, 403);
  await get('offlineTestKeys/test01', teacher, 200);
  const attempt = { uid: 'student', status: 'started', deadline: '2099-01-01' };
  await patch('offlineAttempts/test01__student', attempt, student, 403);
  await patch('offlineAttempts/test01__student', attempt, 'owner', 200);
  await get('offlineAttempts/test01__student', student, 200);
  await get('offlineAttempts/test01__student', other, 403);
  await get('offlineAttempts', student, 403);
  await patch('offlineAttempts/test01__student?updateMask.fieldPaths=deadline', { deadline: '2100-01-01' }, student, 403);
  const report = { uid: 'student', teacherUid: 'teacher', reviewMode: 'teacher', status: 'submitted', score: '8' };
  await patch('offlineReports/test01__student', report, student, 403);
  await patch('offlineReports/test01__student', report, 'owner', 200);
  await get('offlineReports/test01__student', student, 403);
  await get('offlineReports', student, 403);
  await get('offlineReports/test01__student', teacher, 200);
  await patch('offlineReports/test01__student?updateMask.fieldPaths=status', { status: 'approved' }, teacher, 403);
  await patch('offlineAttempts/test01__student?updateMask.fieldPaths=status', { status: 'approved' }, teacher, 403);
  await patch('offlineReports/test01__student', { ...report, status: 'approved' }, 'owner', 200);
  await get('offlineReports/test01__student', student, 200);
  await get('offlineReports/test01__student', other, 403);
  const resultPath = 'students/student/offlineResults/ots_test01__student';
  const result = { reportId: 'test01__student', reviewMode: 'teacher', score: '8', class: '11', answerSheetUrl: 'fixture' };
  await patch(resultPath, result, teacher, 403);
  await patch(resultPath, result, 'owner', 200);
  await get('students/student/offlineResults', student, 200);
  await get(resultPath, other, 403);
  await get(resultPath, null, 403);
  await patch(resultPath + '?updateMask.fieldPaths=score', { score: '10' }, student, 403);
  await patch(resultPath + '?updateMask.fieldPaths=score', { score: '10' }, teacher, 403);
  await remove(resultPath, student, 403);
  await remove(resultPath, teacher, 403);
  await remove('offlineReports/test01__student', teacher, 403);
  await remove('offlineAttempts/test01__student', teacher, 403);
  await remove('offlineTests/test01', teacher, 403);
  await remove('offlineTestKeys/test01', teacher, 403);
  await patch('offlineTests/test01?updateMask.fieldPaths=isActive', { isActive: false }, teacher, 200);
  await patch('students/student?updateMask.fieldPaths=class', { class: '12' }, 'owner', 200);
  await get(resultPath, student, 200);
  const historyPath = 'students/student/offlineHistory/test01__student';
  await patch(historyPath, { status: 'submitted' }, student, 403);
  await patch(historyPath, { status: 'submitted' }, teacher, 403);
  await patch(historyPath, { status: 'submitted' }, 'owner', 200);
  await get('students/student/offlineHistory', student, 200);
  await get(historyPath, other, 403);
  await remove(historyPath, student, 403);
  await get('offlineFileDeletes', student, 403);
  await get('offlineFileDeletes', teacher, 403);
  // Existing AI approvals and ordinary classroom mark entry remain supported.
  await patch('offlineReports/legacy__student', { uid: 'student', status: 'ai_checked' }, 'owner', 200);
  await patch('offlineAttempts/legacy__student', { uid: 'student', status: 'ai_checked' }, 'owner', 200);
  await patch('offlineReports/legacy__student?updateMask.fieldPaths=status', { status: 'approved' }, teacher, 200);
  await patch('offlineAttempts/legacy__student?updateMask.fieldPaths=status', { status: 'approved' }, teacher, 200);
  await patch('students/student/offlineResults/classroom', { score: '6' }, teacher, 200);
  await remove('students/student/offlineResults/classroom', teacher, 200);
  console.log(`${checks} real local Firestore checks passed: private papers, own attempts/results, server-only manual returns, protected history, class promotion and legacy compatibility.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
