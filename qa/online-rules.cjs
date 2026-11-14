/* Online Test Series — real Firestore rules checks against an isolated LOCAL
   emulator only. Replays exactly the reads the /test-series portal makes for a
   Google-signed-in student (no institute record) and an enrolled TNC student,
   plus what must stay private.
     firebase emulators:start --only firestore --project demo-online
     (or java -jar <firestore-emulator.jar> --host 127.0.0.1 --port 8189 --project_id demo-online --rules firestore.rules)
     node qa/online-rules.cjs
   No production credentials or production writes. */
const assert = require('node:assert/strict');
const project = 'demo-online', host = 'http://127.0.0.1:' + (process.env.RULES_PORT || '8189');
const base = `/v1/projects/${project}/databases/(default)/documents`;
const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function token(uid, provider) {
  const now = Math.floor(Date.now() / 1000);
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ sub: uid, user_id: uid, iss: 'https://securetoken.google.com/' + project, aud: project, iat: now, exp: now + 3600, email: uid + '@example.test', email_verified: true, firebase: { sign_in_provider: provider || 'google.com' } })}.`;
}
const field = v => Array.isArray(v) ? { arrayValue: { values: v.map(field) } } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? { integerValue: String(v) } : { stringValue: String(v) };
let checks = 0;
async function call(url, method, body, auth, expected, label) {
  const res = await fetch(host + url, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  assert.equal(res.status, expected, `${label || method + ' ' + url}: ${text.slice(0, 300)}`); checks++;
  return text ? JSON.parse(text) : null;
}
const put = (path, data) => call(`${base}/${path}`, 'PATCH', { fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, field(v)])) }, 'owner', 200, 'seed ' + path);
const get = (path, auth, status) => call(`${base}/${path}`, 'GET', null, auth, status, 'GET ' + path);
const query = (collectionId, equals, auth, status) => {
  const filters = Object.entries(equals).map(([fieldPath, v]) => ({ fieldFilter: { field: { fieldPath }, op: 'EQUAL', value: field(v) } }));
  return call(`${base}:runQuery`, 'POST', { structuredQuery: { from: [{ collectionId }], ...(filters.length ? { where: filters.length === 1 ? filters[0] : { compositeFilter: { op: 'AND', filters } } } : {}) } }, auth, status, `query ${collectionId} ${JSON.stringify(equals)}`);
};
const count = (collectionId, status, auth, expected) => call(`${base}:runAggregationQuery`, 'POST', { structuredAggregationQuery: { structuredQuery: { from: [{ collectionId }], where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: field(status) } } }, aggregations: [{ alias: 'n', count: {} }] } }, auth, expected, 'count ' + collectionId);

(async () => {
  const reset = await fetch(`${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(reset.status, 200, 'emulator reachable');
  await put('admins/adm', { isAdmin: true });
  await put('teachers/t1', { name: 'Aarav' });
  await put('students/tnc1', { name: 'Aman', class: '10', board: 'CBSE', studentId: 'NTC-1' });
  await put('onlineStudents/riya', { uid: 'riya', name: 'Riya', class: '10', board: 'CBSE', phone: '9874461218', profileComplete: true });
  await put('onlineStudents/tnc1', { uid: 'tnc1', name: 'Aman', class: '10', enrolled: true, profileComplete: true });
  await put('onlineStudents/riya/results/a__riya', { testId: 'a', score: 30, totalMarks: 40, class: '10', subject: 'Physics' });
  await put('offlineTests/a', { series: 'online', class: '10', subject: 'Physics', isActive: true });
  await put('offlineAttempts/a__riya', { uid: 'riya', testId: 'a', status: 'started' });
  await put('offlineAttempts/a__other', { uid: 'other', testId: 'a', status: 'started' });
  await put('onlineLeaderboard/c10_physics', { class: '10', subject: 'Physics', count: 1 });
  await put('moduleRequests/o1_physics', { uid: 'riya', status: 'requested', class: '10', subject: 'Physics' });
  await put('moduleRequests/o2_maths', { uid: 'other', status: 'requested', class: '10', subject: 'Mathematics' });
  await put('onlinePurchases/a__riya', { uid: 'riya', testId: 'a' });
  await put('onlineOrders/order_1', { uid: 'riya', amountPaise: 19900 });
  await put('onlineFreeClaims/riya', { uid: 'riya' });

  const riya = token('riya'), tnc = token('tnc1', 'password'), other = token('other'), admin = token('adm', 'password'), teacher = token('t1', 'password');
  // Exactly what the portal loads after sign-in (the reads that returned 403 in the browser).
  for (const [who, auth, uid] of [['Google student', riya, 'riya'], ['TNC student', tnc, 'tnc1']]) {
    await query('offlineTests', { series: 'online', class: '10' }, auth, 200);
    await query('offlineAttempts', { uid }, auth, 200);
    await get(`onlineStudents/${uid}/results`, auth, 200);
    await query('onlineLeaderboard', { class: '10' }, auth, 200);
    await query('moduleRequests', { uid }, auth, 200);
    await get(`onlineStudents/${uid}`, auth, 200);
    console.log(`✓ ${who}: tests, own attempts, own results, leaderboard, own custom requests and profile are readable`);
  }
  const mine = await query('moduleRequests', { uid: 'riya' }, riya, 200);
  assert.equal(mine.filter(x => x.document).length, 1, 'only own requests come back');
  // Privacy: other students' records and money stay closed.
  await query('offlineAttempts', {}, riya, 403);
  await query('offlineAttempts', { uid: 'other' }, riya, 403);
  await query('moduleRequests', { uid: 'other' }, riya, 403);
  await query('moduleRequests', {}, riya, 403);
  await get('onlineStudents/riya', other, 403);
  await get('onlineStudents/riya/results', other, 403);
  await get('onlineOrders/order_1', riya, 403);
  await get('onlineFreeClaims/riya', riya, 200);
  await get('onlineFreeClaims/riya', other, 403);
  await query('onlinePurchases', { uid: 'riya' }, riya, 200);
  await query('onlinePurchases', { uid: 'riya' }, other, 403);
  // Students can never write their own unlocks, results or requests.
  await call(`${base}/onlinePurchases/b__riya`, 'PATCH', { fields: { uid: field('riya') } }, riya, 403, 'student forging a purchase');
  await call(`${base}/moduleRequests/o1_physics?updateMask.fieldPaths=status`, 'PATCH', { fields: { status: field('ready') } }, riya, 403, 'student marking own request ready');
  await call(`${base}/onlineStudents/riya/results/x`, 'PATCH', { fields: { score: field(40) } }, riya, 403, 'student writing a result');
  console.log('✓ privacy: no other student’s attempts, requests, profile or results; no orders; no self-written unlocks, results or requests');
  // Admin Test Desk: lists, counts, marking a custom request ready.
  await query('moduleRequests', {}, admin, 200);
  await count('moduleRequests', 'requested', admin, 200);
  await call(`${base}/moduleRequests/o1_physics?updateMask.fieldPaths=status&updateMask.fieldPaths=testId&updateMask.fieldPaths=readyAt&updateMask.fieldPaths=teacherName`, 'PATCH',
    { fields: { status: field('ready'), testId: field('otc1'), readyAt: field('2026-11-13'), teacherName: field('Aarav') } }, admin, 200, 'admin marks request ready');
  await call(`${base}/moduleRequests/o2_maths?updateMask.fieldPaths=uid`, 'PATCH', { fields: { uid: field('riya') } }, admin, 403, 'admin cannot re-assign a request');
  await call(`${base}/moduleRequests/o2_maths?updateMask.fieldPaths=status`, 'PATCH', { fields: { status: field('ready') } }, teacher, 403, 'teacher cannot mark ready');
  await get('onlineStudents', admin, 200);
  await get('onlineOrders', admin, 200);
  console.log('✓ admin: lists and counts custom requests, marks one ready (only those fields); teachers cannot');
  // Promo codes: admins create and switch them; students never see them.
  const promo = { code: field('TNCTEST1'), scope: field('chapter'), maxUses: { integerValue: '1' }, uses: { integerValue: '0' }, oncePerStudent: field(true), active: field(true), note: field('') };
  await call(`${base}/promoCodes/TNCTEST1?currentDocument.exists=false`, 'PATCH', { fields: promo }, admin, 200, 'admin creates a code');
  await call(`${base}/promoCodes/TNCTEST1?currentDocument.exists=false`, 'PATCH', { fields: promo }, admin, 409, 'existing code is not overwritten');
  await call(`${base}/promoCodes/TNCTEST2`, 'PATCH', { fields: { ...promo, code: field('TNCTEST2'), uses: { integerValue: '5' } } }, admin, 403, 'cannot create with uses already counted');
  await call(`${base}/promoCodes/bad code`, 'PATCH', { fields: { ...promo, code: field('bad code') } }, admin, 403, 'code format enforced');
  await call(`${base}/promoCodes/TNCTEST3`, 'PATCH', { fields: { ...promo, code: field('TNCTEST3') } }, riya, 403, 'students cannot create codes');
  await call(`${base}/promoCodes/TNCTEST1?updateMask.fieldPaths=active`, 'PATCH', { fields: { active: field(false) } }, admin, 200, 'admin switches a code off');
  await call(`${base}/promoCodes/TNCTEST1?updateMask.fieldPaths=uses`, 'PATCH', { fields: { uses: { integerValue: '7' } } }, admin, 403, 'uses cannot be changed by hand');
  await call(`${base}/promoCodes/TNCFOR1?currentDocument.exists=false`, 'PATCH', { fields: { ...promo, code: field('TNCFOR1'), forUid: field('riya'), forName: field('Riya'), forOnlineId: field('TNC-ON-RIYA') } }, admin, 200, 'admin creates a code only for one student');
  await call(`${base}/promoCodes/TNCFOR1?updateMask.fieldPaths=forUid`, 'PATCH', { fields: { forUid: field('other') } }, admin, 403, 'the student a code is for cannot be changed later');
  await get('promoCodes/TNCTEST1', riya, 403); await get('promoCodes', riya, 403); await get('promoCodes', admin, 200);
  await get('promoRedemptions', riya, 403); await get('promoRedemptions', admin, 200);
  console.log('✓ promo codes: admins create (no overwrite, valid format, uses start at 0) and switch off; students cannot read or create codes');
  // Mock packs: students read them; only admins create, edit, pause; never deleted.
  const pack = { title: field('Physics · 8 weekly mocks'), class: field('10'), board: field(''), subject: field('Physics'), mocks: field(8), priceInr: field(3199),
    schedule: field(['2026-12-06T04:30:00.000Z', '2026-12-13T04:30:00.000Z']), active: field(true) };
  await call(`${base}/mockPackages/pk1`, 'PATCH', { fields: pack }, admin, 200, 'admin creates a pack');
  await call(`${base}/mockPackages/pk2`, 'PATCH', { fields: pack }, riya, 403, 'students cannot create packs');
  await call(`${base}/mockPackages/pk2`, 'PATCH', { fields: pack }, teacher, 403, 'teachers cannot create packs');
  await call(`${base}/mockPackages/pk1?updateMask.fieldPaths=active`, 'PATCH', { fields: { active: field(false) } }, admin, 200, 'admin pauses a pack');
  await call(`${base}/mockPackages/pk1?updateMask.fieldPaths=priceInr`, 'PATCH', { fields: { priceInr: field(1) } }, riya, 403, 'students cannot change the price');
  await call(`${base}/mockPackages/pk1`, 'DELETE', null, admin, 403, 'packs are never deleted');
  await query('mockPackages', { class: '10' }, riya, 200); await get('mockPackages/pk1', tnc, 200);
  await call(`${base}/onlinePurchases/pkg_pk1__riya`, 'PATCH', { fields: { uid: field('riya'), testId: field('pkg_pk1') } }, riya, 403, 'student forging a pack join');
  await call(`${base}/promoCodes/TNCPACK1?currentDocument.exists=false`, 'PATCH', { fields: { ...promo, code: field('TNCPACK1'), scope: field('package') } }, admin, 200, 'admin creates a mock-pack code');
  await call(`${base}/promoCodes/TNCPACK2?currentDocument.exists=false`, 'PATCH', { fields: { ...promo, code: field('TNCPACK2'), scope: field('bundle') } }, admin, 403, 'unknown scope refused');
  console.log('✓ mock packs: everyone signed in reads; only admins create / pause; no delete; no self-written joins; mock-pack promo scope');
  console.log(`All ${checks} online rules checks passed.`);
})().catch(e => { console.error(e); process.exit(1); });
