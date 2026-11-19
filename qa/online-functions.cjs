/* Online Test Series — server function checks (no network).
   Runs online-series.js, razorpay-webhook.js and the online paths of
   offline-test.js against an in-memory Firestore, fake ID tokens and a fake
   Razorpay. Run: node qa/online-functions.cjs */
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

process.env.FIREBASE_PROJECT_ID = 'fixture';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"fixture":true}';
process.env.URL = 'https://example.test';

const db = new Map(), versions = new Map();
let version = 0, orderSeq = 0;
const calls = { razorpay: [], brevo: [] };
const clone = v => JSON.parse(JSON.stringify(v));
const stub = {
  // Tokens: "g:<uid>" = Google sign-in, "p:<uid>" = password (TNC ID) sign-in.
  async verifyFirebaseIdToken(t) {
    const m = /^(g|p):(.+)$/.exec(t || '');
    if (!m) throw new Error('Invalid Firebase ID token');
    return { uid: m[2], email: m[1] === 'g' ? m[2] + '@gmail.example' : m[2] + '@ntcportal.local', provider: m[1] === 'g' ? 'google.com' : 'password' };
  },
  async getServiceAccountAccessToken() { return 'sa'; },
  async fsGet(_p, _t, p) { return db.has(p) ? { fields: clone(db.get(p)), updateTime: String(versions.get(p) || 0) } : null; },
  async fsPatch(_p, _t, p, obj) { db.set(p, clone(obj)); return {}; },
  async fsCommit(_p, _t, records) {
    for (const { path: p, currentDocument: pre } of records) {
      if (pre && ((pre.exists === false && db.has(p)) || (pre.updateTime !== undefined && pre.updateTime !== String(versions.get(p) || 0)))) { const e = new Error('Conflict'); e.conflict = true; throw e; }
    }
    for (const { path: p, data, remove } of records) { if (remove) { db.delete(p); versions.delete(p); continue; } db.set(p, clone(data)); versions.set(p, ++version); }
  },
  decFields(doc) { return clone(doc.fields || {}); },
  enc(v) { return typeof v === 'boolean' ? { booleanValue: v } : { stringValue: String(v) }; },
  async request(host, p, method, headers, body) {
    if (host === 'api.razorpay.com' && p === '/v1/orders') {
      calls.razorpay.push({ headers, body });
      return { status: 200, body: { id: 'order_Fx' + String(++orderSeq).padStart(6, '0'), amount: body.amount, currency: 'INR', notes: body.notes } };
    }
    if (host === 'firestore.googleapis.com' && p.endsWith(':runQuery')) {
      const q = body.structuredQuery, coll = q.from[0].collectionId;
      const where = q.where ? (q.where.compositeFilter ? q.where.compositeFilter.filters : [q.where]) : [];
      const docs = [...db.entries()].filter(([k, v]) => k.split('/').length === 2 && k.startsWith(coll + '/')
        && where.every(f => { const x = f.fieldFilter, val = x.value.stringValue ?? x.value.booleanValue; return v[x.field.fieldPath] === val; }));
      return { status: 200, body: docs.map(([k, v]) => ({ document: { name: 'projects/fixture/databases/(default)/documents/' + k, fields: clone(v) } })) };
    }
    if (host === 'api.uploadcare.com') return { status: 204, body: '' };
    if (host === 'api.brevo.com' && p === '/v3/smtp/email') { calls.brevo.push({ headers, body }); return { status: 201, body: { messageId: 'm1' } }; }
    throw new Error('unexpected request ' + host + p);
  }
};
const googlePath = require.resolve(path.join(__dirname, '../netlify/functions/_google.js'));
require.cache[googlePath] = { id: googlePath, filename: googlePath, loaded: true, exports: stub };
const policy = require('../assets/js/online-policy.js');
const online = require('../netlify/functions/online-series.js');
const webhook = require('../netlify/functions/razorpay-webhook.js');
const offline = require('../netlify/functions/offline-test.js');

const run = fn => async body => { const r = await fn.handler({ httpMethod: 'POST', body: JSON.stringify(body) }); return { status: r.statusCode, body: JSON.parse(r.body) }; };
const api = run(online), ot = run(offline);
const hook = async (payload, secret) => {
  const raw = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', secret || process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex');
  const r = await webhook.handler({ httpMethod: 'POST', body: raw, headers: { 'X-Razorpay-Signature': sig } });
  return { status: r.statusCode, body: JSON.parse(r.body) };
};
const form = over => ({ name: 'Riya Sharma', dob: '2011-05-04', gender: 'Female', phone: '+91 98000 12345', class: '10', board: 'CBSE', school: 'DPS Newtown',
  subjects: ['Science', 'Mathematics', 'Physics', 'Nonsense'], target: 'NEET', address: '12 Lake Road, Sector 5', city: 'Kolkata', state: 'West Bengal', pincode: '700156',
  guardianName: 'Anil Sharma', guardianRelation: 'Father', guardianPhone: '9830012345', ...over });
const sign = (orderId, paymentId) => crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');

(async () => {
  // ── Policy maths ──
  const ranked = policy.rank([
    { uid: 'a', name: 'A', score: 40, totalMarks: 40, approvedAt: '2026-11-02' },
    { uid: 'b', name: 'B', score: 20, totalMarks: 20, approvedAt: '2026-11-01' },
    { uid: 'b', name: 'B', score: 10, totalMarks: 20, approvedAt: '2026-11-03' },
    { uid: 'c', name: 'C', score: 15, totalMarks: 20, approvedAt: '2026-11-01' },
    { uid: 'd', name: 'D', score: 99, totalMarks: 0 }
  ]);
  assert.deepEqual(ranked.map(r => [r.uid, r.avgPct, r.rank]), [['a', 100, 1], ['b', 75, 2], ['c', 75, 2]], 'ties share a rank; more tests first within a tie; zero-mark rows ignored');
  assert.equal(policy.rankFrom(ranked.map(r => r.avgPct), policy.averageOf([{ score: 15, totalMarks: 20 }])), 2, 'own rank from the anonymous score list matches');
  assert.equal(policy.shortName('  riya  kumari sharma '), 'riya S.');
  assert.equal(policy.boardKey('10', 'Computer Science'), 'c10_computer-science');
  assert.ok(!policy.validateProfile(form({ phone: '12345', pincode: '0123' })).ok);
  console.log('✓ policy: ranking with ties, own rank from anonymous scores, short names, validation');

  // ── session + onboarding ──
  db.set('students/tnc1', { name: 'Aman Gupta', studentId: 'NTC-2026-001', class: '10', board: 'CBSE', phone: '9800000001' });
  assert.equal((await api({ idToken: 'bad', action: 'session' })).status, 401);
  assert.equal((await api({ idToken: 'p:stranger', action: 'session' })).status, 403, 'a password account that is not enrolled is refused');
  let s = await api({ idToken: 'g:riya', action: 'session' });
  assert.equal(s.status, 200);
  assert.equal(s.body.enrolled, false); assert.equal(s.body.profile.profileComplete, false);
  assert.equal(s.body.paymentsReady, false, 'payments report not ready without keys');
  assert.deepEqual(s.body.prices, { chapter: 299, mock: 499 }, 'chapter-wise ₹299, full mock ₹499');
  assert.deepEqual(s.body.listPrices, { chapter: 399, mock: 699 }, 'regular prices ₹399 / ₹699, shown struck through');
  assert.equal(policy.listPriceFor({ kind: 'mock' }), 699); assert.equal(policy.listPriceFor({ kind: 'chapter' }), 399); assert.equal(policy.listPriceFor({ kind: 'mock' }, null, null, true), 0, 'nothing struck through for TNC students');
  assert.deepEqual(policy.paperFor('mock'), { marks: 80, durationMin: 180, graceMin: 20 }); assert.deepEqual(policy.paperFor('chapter'), { marks: 40, durationMin: 90, graceMin: 10 });
  assert.equal(policy.facultyName('Physics'), 'TNC Physics Faculty'); assert.equal(policy.facultyName('Computer'), 'TNC Computer Science Faculty');
  assert.deepEqual(s.body.freeMock, { allowance: 1, usedCount: 0, left: 1, claims: [] }, 'online students: 1 free mock');
  let bad = await api({ idToken: 'g:riya', action: 'save-profile', profile: form({ phone: '123', state: 'Atlantis' }) });
  assert.equal(bad.status, 400); assert.ok(bad.body.fields.phone && bad.body.fields.state, 'field errors returned');
  // Quick start: name, class, board, subjects and both phone numbers are enough; the rest comes later.
  const quickForm = { name: 'Quick Student', class: '10', board: 'CBSE', subjects: ['Physics', 'Science', 'Mathematics'], phone: '9800011111', guardianPhone: '9830011111' };
  assert.equal((await api({ idToken: 'g:quick', action: 'save-profile', profile: { ...quickForm, guardianPhone: '' } })).status, 400, 'guardian phone is required to start');
  const quick = await api({ idToken: 'g:quick', action: 'save-profile', profile: quickForm });
  assert.equal(quick.status, 200); assert.equal(quick.body.profile.profileComplete, true); assert.equal(quick.body.profile.detailsComplete, false, 'details can be added later');
  assert.deepEqual(db.get('onlineStudents/quick').subjects, ['Science', 'Mathematics'], 'CBSE Class 10: Physics dropped, Science kept');
  assert.equal((await api({ idToken: 'g:quick', action: 'save-profile', profile: { ...quickForm, pincode: '12' } })).status, 400, 'optional fields must still be valid when filled');
  assert.deepEqual(policy.subjectsFor('ICSE', '10').filter(x => ['Physics', 'Chemistry', 'Biology', 'Science'].includes(x)), ['Physics', 'Chemistry', 'Biology'], 'ICSE: three sciences, no Science');
  assert.deepEqual(policy.subjectsFor('CBSE', '12').filter(x => ['Physics', 'Science'].includes(x)), ['Physics'], 'CBSE Class 11-12: Physics, no Science');
  const saved = await api({ idToken: 'g:riya', action: 'save-profile', profile: form() });
  assert.equal(saved.status, 200); assert.equal(saved.body.profile.detailsComplete, true, 'full form → details complete');
  const prof = db.get('onlineStudents/riya');
  assert.equal(prof.phone, '9800012345', '+91 and spaces stripped');
  assert.deepEqual(prof.subjects, ['Science', 'Mathematics'], 'unknown subjects and other-board subjects (Physics for CBSE Class 10) dropped');
  assert.equal(prof.onlineId, 'TNC-ON-RIYA'); assert.equal(prof.provider, 'google'); assert.equal(prof.email, 'riya@gmail.example');
  assert.equal(prof.profileComplete, true);
  const tnc = await api({ idToken: 'p:tnc1', action: 'session' });
  assert.equal(tnc.body.enrolled, true); assert.equal(tnc.body.profile.profileComplete, true, 'TNC students skip the form');
  assert.equal(db.get('onlineStudents/tnc1').class, '10'); assert.equal(db.get('onlineStudents/tnc1').onlineId, 'NTC-2026-001');
  await api({ idToken: 'p:tnc1', action: 'save-profile', profile: form({ name: 'Hacker', class: '12', board: 'ICSE' }) });
  assert.equal(db.get('onlineStudents/tnc1').class, '10', 'enrolled students cannot change class'); assert.equal(db.get('onlineStudents/tnc1').name, 'Aman Gupta');
  console.log('✓ session & form: Google-only sign-up, validation, normalised phone/subjects, TNC students auto-profiled and locked to institute class');

  // ── tests ──
  const test = (id, extra) => db.set('offlineTests/' + id, { testName: 'Test ' + id, class: '10', subject: 'Physics', chapter: 'Light', totalMarks: 40, durationMin: 60, isActive: true, teacherUid: 't1', teacherName: 'Aarav Sen', gradingMode: 'teacher', series: 'online', ...extra });
  test('onfree01', { kind: 'mock', testName: 'Full mock 1' }); test('onpaid01', { kind: 'chapter' }); test('onpaid02', { class: '11', kind: 'mock' }); test('offln001', { series: 'offline' });
  test('onmock02', { kind: 'mock', subject: 'Chemistry', testName: 'Chemistry mock' }); test('onlegacy', { testName: 'Full syllabus test' });
  assert.equal(policy.kindOf(db.get('offlineTests/onlegacy')), 'mock', 'older tests named "full syllabus" count as mocks');
  ['onfree01', 'onpaid01', 'onpaid02', 'offln001', 'onmock02'].forEach(id => db.set('offlineTestKeys/' + id, { questionPdfUrl: 'https://ucarecdn.com/11111111-1111-1111-1111-111111111111/' }));
  db.set('teachers/t1', { name: 'Aarav Sen' });

  // ── start: unlock rules ──
  assert.equal((await ot({ idToken: 'g:nobody', action: 'start', testId: 'onfree01' })).status, 403, 'no profile → complete your profile');
  assert.equal((await ot({ idToken: 'g:riya', action: 'start', testId: 'offln001' })).status, 403, 'online students cannot take offline-series tests');
  const locked = await ot({ idToken: 'g:riya', action: 'start', testId: 'onpaid01' });
  assert.equal(locked.status, 402); assert.match(locked.body.error, /₹299/, 'chapter test asks ₹299');
  const lockedMock = await ot({ idToken: 'g:riya', action: 'start', testId: 'onfree01' });
  assert.equal(lockedMock.status, 402); assert.match(lockedMock.body.error, /₹499/, 'every mock is paid until the free one is chosen');
  assert.equal((await ot({ idToken: 'g:riya', action: 'start', testId: 'onpaid02' })).status, 403, 'other class refused');
  // One free full mock, on the subject the student chooses.
  assert.equal((await api({ idToken: 'g:riya', action: 'claim-free', testId: 'onpaid01' })).status, 409, 'free test is for full mocks only');
  assert.equal((await api({ idToken: 'g:riya', action: 'claim-free', testId: 'onpaid02' })).status, 403, 'other class refused');
  const claimed = await api({ idToken: 'g:riya', action: 'claim-free', testId: 'onfree01' });
  assert.equal(claimed.status, 200); assert.equal(claimed.body.freeMock.claims[0].subject, 'Physics'); assert.equal(claimed.body.freeMock.left, 0);
  assert.equal(db.get('onlinePurchases/onfree01__riya').via, 'free-mock'); assert.equal(db.get('onlinePurchases/onfree01__riya').amountPaise, 0);
  const second = await api({ idToken: 'g:riya', action: 'claim-free', testId: 'onmock02' });
  assert.equal(second.status, 409); assert.equal(second.body.freeUsed, true); assert.match(second.body.error, /Physics/, 'only one free mock in total');
  assert.equal((await api({ idToken: 'g:riya', action: 'session' })).body.freeMock.left, 0);
  const free = await ot({ idToken: 'g:riya', action: 'start', testId: 'onfree01' });
  assert.equal(free.status, 200); assert.ok(free.body.questionPdfUrl);
  assert.equal((await ot({ idToken: 'g:riya', action: 'start', testId: 'onmock02' })).status, 402, 'other subjects\' mocks stay paid');
  // TNC students: every test free (chapter-wise and full mocks), no claim needed.
  test('onmock03', { kind: 'mock', testName: 'Mock 3' }); db.set('offlineTestKeys/onmock03', { questionPdfUrl: 'https://ucarecdn.com/11111111-1111-1111-1111-111111111111/' });
  for (const id of ['onpaid01', 'onfree01', 'onmock02', 'onmock03']) assert.equal((await ot({ idToken: 'p:tnc1', action: 'start', testId: id })).status, 200, 'TNC students start ' + id + ' free');
  assert.deepEqual((await api({ idToken: 'p:tnc1', action: 'session' })).body.freeMock, { allowance: 0, usedCount: 0, left: 0, claims: [] }, 'no free-mock offer for TNC students');
  assert.equal((await api({ idToken: 'p:tnc1', action: 'claim-free', testId: 'onmock03' })).status, 409, 'TNC students need no claim');
  console.log('✓ start: online — chapter ₹299 / mock ₹499, 1 free mock; TNC — every test free');

  // ── payments ──
  assert.equal((await api({ idToken: 'g:riya', action: 'create-order', testId: 'onpaid01' })).status, 503, 'no keys → payments not ready');
  process.env.RAZORPAY_KEY_ID = 'rzp_test_fixture'; process.env.RAZORPAY_KEY_SECRET = 'fixture_secret'; process.env.RAZORPAY_WEBHOOK_SECRET = 'hook_secret';
  assert.equal((await api({ idToken: 'g:riya', action: 'create-order', testId: 'onfree01' })).body.unlocked, true, 'the free mock needs no payment');
  assert.equal((await api({ idToken: 'g:riya', action: 'create-order', testId: 'offln001' })).status, 404);
  assert.equal((await api({ idToken: 'g:riya', action: 'create-order', testId: 'onpaid02' })).status, 403);
  assert.equal((await api({ idToken: 'p:tnc1', action: 'create-order', testId: 'onpaid01' })).status, 409, 'TNC students never pay for chapter tests');
  assert.equal((await api({ idToken: 'p:tnc1', action: 'create-order', testId: 'onmock03' })).status, 409, 'TNC students never pay for mocks');
  const order = await api({ idToken: 'g:riya', action: 'create-order', testId: 'onpaid01' });
  assert.equal(order.status, 200); assert.equal(order.body.amountPaise, 29900, 'chapter test ₹299'); assert.equal(order.body.keyId, 'rzp_test_fixture');
  assert.equal(calls.razorpay[0].body.amount, 29900);
  assert.equal((await api({ idToken: 'g:riya', action: 'create-order', testId: 'onmock02' })).body.amountPaise, 49900, 'full mock ₹499'); assert.deepEqual(calls.razorpay[0].body.notes, { uid: 'riya', testId: 'onpaid01' });
  assert.match(calls.razorpay[0].headers.Authorization, /^Basic /);
  assert.equal(db.get('onlineOrders/' + order.body.orderId).status, 'created');
  const pay = 'pay_Fx000001';
  assert.equal((await api({ idToken: 'g:riya', action: 'verify-payment', orderId: order.body.orderId, paymentId: pay, signature: 'f'.repeat(64) })).status, 400, 'forged signature refused');
  assert.equal((await api({ idToken: 'g:other', action: 'verify-payment', orderId: order.body.orderId, paymentId: pay, signature: sign(order.body.orderId, pay) })).status, 404, "someone else's order is refused");
  db.set('onlineStudents/other', { ...prof, uid: 'other' });
  assert.equal((await api({ idToken: 'g:other', action: 'verify-payment', orderId: order.body.orderId, paymentId: pay, signature: sign(order.body.orderId, pay) })).status, 404, "another student's order is not found for them");
  const ok1 = await api({ idToken: 'g:riya', action: 'verify-payment', orderId: order.body.orderId, paymentId: pay, signature: sign(order.body.orderId, pay) });
  assert.equal(ok1.status, 200); assert.equal(ok1.body.testId, 'onpaid01');
  assert.equal(db.get('onlinePurchases/onpaid01__riya').paymentId, pay);
  assert.equal(db.get('onlineOrders/' + order.body.orderId).status, 'paid');
  assert.equal((await api({ idToken: 'g:riya', action: 'verify-payment', orderId: order.body.orderId, paymentId: pay, signature: sign(order.body.orderId, pay) })).status, 200, 'retry is harmless');
  assert.equal((await api({ idToken: 'g:riya', action: 'create-order', testId: 'onpaid01' })).body.unlocked, true, 'cannot pay twice');
  s = await api({ idToken: 'g:riya', action: 'session' });
  assert.deepEqual(s.body.unlocked.sort(), ['onfree01', 'onpaid01']); assert.equal(s.body.paymentsReady, true);
  assert.equal((await ot({ idToken: 'g:riya', action: 'start', testId: 'onpaid01' })).status, 200, 'paid test starts');
  // Double tap / second tab: the same unpaid order comes back (Razorpay takes one payment per order).
  test('onpaid04', { kind: 'chapter' }); db.set('offlineTestKeys/onpaid04', { questionPdfUrl: 'https://ucarecdn.com/11111111-1111-1111-1111-111111111111/' });
  const before = calls.razorpay.length;
  const t1 = await api({ idToken: 'g:riya', action: 'create-order', testId: 'onpaid04' }), t2 = await api({ idToken: 'g:riya', action: 'create-order', testId: 'onpaid04' });
  assert.equal(t1.body.orderId, t2.body.orderId, 'second tap reuses the unpaid order'); assert.equal(calls.razorpay.length, before + 1, 'only one Razorpay order');
  // A payment for something already unlocked is flagged for refund, not lost.
  const dupOrder = 'order_Dup0000001';
  db.set('onlineOrders/' + dupOrder, { orderId: dupOrder, uid: 'riya', testId: 'onpaid01', amountPaise: 29900, currency: 'INR', status: 'created', createdAt: new Date().toISOString() });
  assert.equal((await api({ idToken: 'g:riya', action: 'verify-payment', orderId: dupOrder, paymentId: 'pay_Dup0000001', signature: sign(dupOrder, 'pay_Dup0000001') })).status, 200);
  assert.equal(db.get('onlineOrders/' + dupOrder).duplicate, true, 'duplicate payment flagged for a refund');
  assert.equal(db.get('onlinePurchases/onpaid01__riya').orderId, order.body.orderId, 'original unlock untouched');
  console.log('✓ payments: ₹299 chapter / ₹499 mock Razorpay orders, signature verified, purchase saved once, cannot pay twice, unlocked test starts');

  // ── webhook ──
  test('onpaid03', { kind: 'mock' }); db.set('offlineTestKeys/onpaid03', { questionPdfUrl: 'https://ucarecdn.com/11111111-1111-1111-1111-111111111111/' });
  const o2 = await api({ idToken: 'g:riya', action: 'create-order', testId: 'onpaid03' });
  const payload = amount => ({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_Hook0001', order_id: o2.body.orderId, amount, currency: 'INR', status: 'captured' } } } });
  assert.equal((await hook(payload(49900), 'wrong')).status, 401, 'bad webhook signature refused');
  assert.equal((await hook(payload(100))).body.ignored, 'amount mismatch');
  assert.ok(!db.has('onlinePurchases/onpaid03__riya'));
  assert.equal((await hook(payload(49900))).status, 200);
  assert.equal(db.get('onlinePurchases/onpaid03__riya').paymentId, 'pay_Hook0001', 'webhook unlocks even if the phone closed');
  assert.equal(db.get('onlineOrders/' + o2.body.orderId).confirmedVia, 'webhook');
  assert.equal((await hook(payload(49900))).status, 200, 'duplicate delivery is harmless');
  assert.equal((await hook({ event: 'order.paid', payload: { payment: { entity: { id: 'pay_X', order_id: 'order_unknown1', amount: 49900, status: 'captured' } } } })).body.ignored, 'unknown order');
  console.log('✓ webhook: signed, amount-checked, idempotent unlock, foreign orders ignored');

  // ── Custom module test: cart of chapters → paid → one paper request per subject ──
  assert.equal(policy.modulePrice(1), 199); assert.equal(policy.modulePrice(4), 796); assert.equal(policy.modulePrice(6), 1096); assert.equal(policy.modulePrice(6, true), 0, 'TNC students: custom modules free');
  const sy = require('../assets/js/syllabus.js');
  const sci = sy.chapters('CBSE', '10', 'Science'), mat = sy.chapters('CBSE', '10', 'Mathematics');
  assert.equal((await api({ idToken: 'g:riya', action: 'module-order', board: 'CBSE', items: [] })).status, 400, 'empty cart refused');
  assert.equal((await api({ idToken: 'g:riya', action: 'module-order', board: 'CBSE', items: [{ subject: 'Science', chapters: ['Made-up chapter'] }] })).status, 400, 'chapters must be in the syllabus');
  const crossBoard = await api({ idToken: 'g:riya', action: 'module-order', board: 'CISCE', items: [{ subject: 'Physics', chapters: sy.chapters('CISCE', '10', 'Physics').slice(0, 2) }] });
  assert.equal(crossBoard.status, 400); assert.match(crossBoard.body.error, /follow your CBSE syllabus/, 'a CBSE student cannot order ICSE chapters');
  assert.equal(policy.customBoard('CBSE'), 'CBSE'); assert.equal(policy.customBoard('ICSE'), 'CISCE'); assert.equal(policy.customBoard('State Board'), '', 'other boards may pick either');
  db.set('onlineStudents/junior', { ...prof, uid: 'junior', class: '8' });
  // Class 8 (new NCERT "Curiosity" / "Ganita Prakash" chapters) can order custom tests too.
  const sci8 = sy.chapters('CBSE', '8', 'Science'), mat8 = sy.chapters('CBSE', '8', 'Mathematics');
  assert.equal(sci8[0], 'Exploring the Investigative World of Science'); assert.equal(mat8.length, 14);
  assert.equal(sy.chapters('CISCE', '7', 'Physics')[0], 'Physical Quantities and Measurement'); assert.equal(sy.boardLabel('CISCE', '8'), 'ICSE');
  const jr = await api({ idToken: 'g:junior', action: 'module-order', board: 'CBSE', items: [{ subject: 'Science', chapters: [sci8[1], sci8[4]] }] });
  assert.equal(jr.status, 200, 'Class 8 custom test order'); assert.equal(jr.body.amountPaise, 39800);
  assert.match((await api({ idToken: 'g:junior', action: 'module-order', board: 'CBSE', items: [{ subject: 'Science', chapters: [sci[0], sci[1]] }] })).body.error, /not in the CBSE syllabus/, 'Class 10 chapters refused for Class 8');
  const one = await api({ idToken: 'g:riya', action: 'module-order', board: 'CBSE', items: [{ subject: 'Science', chapters: [sci[0]] }, { subject: 'Mathematics', chapters: [mat[0], mat[1]] }] });
  assert.equal(one.status, 400); assert.match(one.body.error, /at least 2 chapters for Science/, 'each paper needs 2+ chapters');
  const mo = await api({ idToken: 'g:riya', action: 'module-order', board: 'CBSE', items: [{ subject: 'Science', chapters: [sci[3], sci[0], sci[1], sci[0]] }, { subject: 'Mathematics', chapters: [mat[0], mat[1], mat[2]] }] });
  assert.equal(mo.status, 200); assert.equal(mo.body.amountPaise, (4 * 199 + 2 * 150) * 100, '6 chapters: 4 × ₹199 + 2 × ₹150');
  const morder = db.get('onlineOrders/' + mo.body.orderId);
  assert.equal(morder.type, 'module'); assert.equal(morder.chapterCount, 6); assert.deepEqual(morder.items[0].chapters, [sci[0], sci[1], sci[3]], 'syllabus order, duplicates dropped');
  const mpay = 'pay_Mod00001';
  const mver = await api({ idToken: 'g:riya', action: 'verify-payment', orderId: mo.body.orderId, paymentId: mpay, signature: sign(mo.body.orderId, mpay) });
  assert.equal(mver.status, 200); assert.equal(mver.body.type, 'module');
  const reqKeys = () => [...db.keys()].filter(k => k.startsWith('moduleRequests/' + mo.body.orderId));
  assert.equal(reqKeys().length, 2, 'one paper request per subject');
  const rq = db.get(reqKeys().find(k => k.endsWith('_science')));
  assert.equal(rq.level, 'medium', 'Medium when no level is chosen'); assert.equal(rq.note, '');
  assert.equal(rq.chapterCount, 3); assert.equal(rq.status, 'requested'); assert.equal(rq.boardLabel, 'CBSE'); assert.equal(rq.uid, 'riya');
  assert.equal(Date.parse(rq.dueAt) - Date.parse(rq.createdAt), 24 * 3600000, 'ready within 24 hours');
  assert.equal(rq.amountPaise + db.get(reqKeys().find(k => k.endsWith('_mathematics'))).amountPaise, 109600, 'amount shared across the papers');
  assert.equal((await hook({ event: 'payment.captured', payload: { payment: { entity: { id: mpay, order_id: mo.body.orderId, amount: 109600, currency: 'INR', status: 'captured' } } } })).status, 200);
  assert.equal(reqKeys().length, 2, 'webhook after checkout creates nothing twice');
  // Every chapter of a subject → a Custom full mock at ₹699; other chapters keep the per-chapter rate.
  assert.equal(policy.isFullMock(mat.length, mat.length), true); assert.equal(policy.isFullMock(3, 3), false, 'three chapters cost less than ₹699 on their own');
  const fm = await api({ idToken: 'g:riya', action: 'module-order', board: 'CBSE', level: 'high', note: 'More numericals <b>please</b>', items: [{ subject: 'Mathematics', chapters: mat.slice() }, { subject: 'Science', chapters: [sci[2], sci[4]] }] });
  assert.equal(fm.status, 200); assert.equal(fm.body.amountPaise, (699 + 2 * 199) * 100, 'all Maths chapters ₹699 + 2 Science chapters × ₹199');
  const fmo = db.get('onlineOrders/' + fm.body.orderId); assert.equal(fmo.items.find(i => i.subject === 'Mathematics').full, true); assert.ok(!fmo.items.find(i => i.subject === 'Science').full);
  await api({ idToken: 'g:riya', action: 'verify-payment', orderId: fm.body.orderId, paymentId: 'pay_Mod00002', signature: sign(fm.body.orderId, 'pay_Mod00002') });
  const fmReq = k => db.get([...db.keys()].find(x => x.startsWith('moduleRequests/' + fm.body.orderId) && x.endsWith(k)));
  assert.equal(fmReq('_mathematics').level, 'high'); assert.equal(fmReq('_science').level, 'high', 'level on every paper of the order'); assert.match(fmReq('_mathematics').note, /^More numericals\s+b\s+please/, 'note kept, markup stripped');
  assert.equal(policy.levelOf('impossible'), 'medium', 'unknown level → Medium');
  assert.equal(fmReq('_mathematics').full, true); assert.equal(fmReq('_mathematics').amountPaise, 69900, 'full mock paper worth ₹699'); assert.equal(fmReq('_science').amountPaise, 39800);
  const tm = await api({ idToken: 'p:tnc1', action: 'module-order', board: 'CBSE', items: [{ subject: 'Mathematics', chapters: [mat[5], mat[7]] }] });
  assert.equal(tm.status, 200); assert.equal(tm.body.free, true, 'TNC students order custom tests free'); assert.equal(tm.body.requests.length, 1, 'paper requested straight away');
  const tmo = db.get('onlineOrders/' + tm.body.orderId); assert.equal(tmo.enrolled, true); assert.equal(tmo.amountPaise, 0); assert.equal(tmo.confirmedVia, 'free');
  assert.equal(calls.razorpay.filter(c => c.body.notes && c.body.notes.uid === 'tnc1').length, 0, 'no Razorpay order for a TNC custom test');
  test('oncust01', { kind: 'custom', forUid: 'riya', requestId: rq.id, testName: 'Custom module · Science' }); db.set('offlineTestKeys/oncust01', { questionPdfUrl: 'https://ucarecdn.com/11111111-1111-1111-1111-111111111111/' });
  assert.equal((await ot({ idToken: 'p:tnc1', action: 'start', testId: 'oncust01' })).status, 403, "another student's custom paper is refused");
  assert.equal((await ot({ idToken: 'g:riya', action: 'start', testId: 'oncust01' })).status, 200, 'the student starts their custom paper without paying again');
  console.log('✓ custom module: ₹199 × 4 then ₹150, all chapters of a subject = ₹699 Custom full mock, syllabus-checked cart, Classes 9–12 only, paid → one request per subject (once), TNC students free, paper only for its student');

  // ── Promo codes: 100% off one purchase for Google students ──
  test('onpromo1', { kind: 'chapter', testName: 'Chapter promo' }); test('onpromo2', { kind: 'mock', testName: 'Mock promo' }); test('onpromo3', { kind: 'chapter', testName: 'Chapter promo 2' });
  ['onpromo1', 'onpromo2', 'onpromo3'].forEach(id => db.set('offlineTestKeys/' + id, { questionPdfUrl: 'https://ucarecdn.com/11111111-1111-1111-1111-111111111111/' }));
  db.set('promoCodes/TNCCHAP', { code: 'TNCCHAP', scope: 'chapter', maxUses: 2, uses: 0, oncePerStudent: true, active: true, expiresAt: '' });
  db.set('promoCodes/TNCOFF', { code: 'TNCOFF', scope: 'all', maxUses: 0, uses: 0, active: false });
  db.set('promoCodes/TNCOLD', { code: 'TNCOLD', scope: 'all', maxUses: 0, uses: 0, active: true, expiresAt: '2020-01-01T00:00:00Z' });
  db.set('promoCodes/TNCMOD', { code: 'TNCMOD', scope: 'custom', maxUses: 1, uses: 0, oncePerStudent: true, active: true });
  const promo = (who, body) => api({ idToken: who, ...body });
  assert.match((await promo('g:riya', { action: 'check-promo', code: 'no!', testId: 'onpromo1' })).body.error, /valid promo code/);
  assert.match((await promo('g:riya', { action: 'check-promo', code: 'TNCXXXX', testId: 'onpromo1' })).body.error, /not valid/);
  assert.match((await promo('g:riya', { action: 'check-promo', code: 'TNCOFF', testId: 'onpromo1' })).body.error, /no longer active/);
  assert.match((await promo('g:riya', { action: 'check-promo', code: 'TNCOLD', testId: 'onpromo1' })).body.error, /expired/);
  assert.match((await promo('g:riya', { action: 'check-promo', code: 'TNCCHAP', testId: 'onpromo2' })).body.error, /chapter-wise tests only/, 'scope enforced');
  assert.equal((await promo('p:tnc1', { action: 'check-promo', code: 'TNCCHAP', testId: 'onpromo1' })).status, 409, 'TNC students need no code');
  const chk = await promo('g:riya', { action: 'check-promo', code: ' tncchap ', testId: 'onpromo1' });
  assert.equal(chk.status, 200); assert.equal(chk.body.code, 'TNCCHAP'); assert.equal(db.get('promoCodes/TNCCHAP').uses, 0, 'checking uses nothing');
  const red = await promo('g:riya', { action: 'redeem-promo', code: 'TNCCHAP', testId: 'onpromo1' });
  assert.equal(red.status, 200);
  assert.equal(db.get('onlinePurchases/onpromo1__riya').via, 'promo'); assert.equal(db.get('onlinePurchases/onpromo1__riya').amountPaise, 0);
  assert.equal(db.get('promoCodes/TNCCHAP').uses, 1); assert.ok(db.has('promoRedemptions/TNCCHAP__riya__onpromo1'));
  assert.equal((await ot({ idToken: 'g:riya', action: 'start', testId: 'onpromo1' })).status, 200, 'promo-unlocked test starts');
  assert.match((await promo('g:riya', { action: 'redeem-promo', code: 'TNCCHAP', testId: 'onpromo3' })).body.error, /already used this promo code/, 'once per student');
  db.set('onlineStudents/sam', { ...prof, uid: 'sam', name: 'Sam' });
  assert.equal((await promo('g:sam', { action: 'redeem-promo', code: 'TNCCHAP', testId: 'onpromo1' })).status, 200);
  db.set('onlineStudents/zoe', { ...prof, uid: 'zoe', name: 'Zoe' });
  assert.match((await promo('g:zoe', { action: 'check-promo', code: 'TNCCHAP', testId: 'onpromo1' })).body.error, /used up/, 'total uses enforced');
  assert.equal((await promo('g:riya', { action: 'redeem-promo', code: 'TNCCHAP', testId: 'onpromo1' })).status, 409, 'cannot apply to an unlocked test');
  // Custom module with a promo: ₹0 order, requests created, code counted.
  assert.match((await promo('g:riya', { action: 'check-promo', code: 'TNCCHAP', kind: 'custom' })).body.error, /chapter-wise tests only|used up/);
  assert.equal((await promo('g:riya', { action: 'check-promo', code: 'TNCMOD', kind: 'custom' })).status, 200);
  const pm = await promo('g:riya', { action: 'module-order', board: 'CBSE', promoCode: 'TNCMOD', items: [{ subject: 'Science', chapters: [sci[5], sci[6]] }] });
  assert.equal(pm.status, 200); assert.equal(pm.body.free, true); assert.equal(pm.body.promo, 'TNCMOD'); assert.equal(pm.body.requests.length, 1);
  const pmo = db.get('onlineOrders/' + pm.body.orderId);
  assert.equal(pmo.amountPaise, 0); assert.equal(pmo.fullAmountPaise, 39800); assert.equal(pmo.confirmedVia, 'promo');
  assert.equal(db.get('promoCodes/TNCMOD').uses, 1);
  assert.match((await promo('g:sam', { action: 'module-order', board: 'CBSE', promoCode: 'TNCMOD', items: [{ subject: 'Science', chapters: [sci[0], sci[1]] }] })).body.error, /used up/);
  // A code locked to one student: useless to anyone it is shared with.
  db.set('promoCodes/TNCFORZOE', { code: 'TNCFORZOE', scope: 'all', maxUses: 1, uses: 0, oncePerStudent: true, active: true, forUid: 'zoe', forName: 'Zoe', forOnlineId: 'TNC-ON-ZOE' });
  assert.match((await promo('g:sam', { action: 'check-promo', code: 'TNCFORZOE', testId: 'onpromo3' })).body.error, /made for another student/);
  assert.match((await promo('g:sam', { action: 'redeem-promo', code: 'TNCFORZOE', testId: 'onpromo3' })).body.error, /made for another student/, 'redeem refused too');
  assert.match((await promo('g:sam', { action: 'module-order', board: 'CBSE', promoCode: 'TNCFORZOE', items: [{ subject: 'Science', chapters: [sci[0], sci[1]] }] })).body.error, /made for another student/);
  assert.equal(db.get('promoCodes/TNCFORZOE').uses, 0, 'nothing used up by the wrong student');
  assert.equal((await promo('g:zoe', { action: 'redeem-promo', code: 'TNCFORZOE', testId: 'onpromo3' })).status, 200, 'the student it was made for can use it');
  // Limits: a code for 2 chapters (₹399) cannot pay for a bigger cart, a mock or a pack.
  db.set('promoCodes/TWOCH', { code: 'TWOCH', scope: 'custom', maxUses: 0, uses: 0, oncePerStudent: true, active: true, maxChapters: 2, maxValueInr: 399 });
  db.set('onlineStudents/lim', { ...prof, uid: 'lim', name: 'Lim' });
  const bigCart = [{ subject: 'Science', chapters: [sci[0], sci[1]] }, { subject: 'Mathematics', chapters: [mat[0], mat[1]] }];
  assert.match((await promo('g:lim', { action: 'check-promo', code: 'TWOCH', kind: 'custom', board: 'CBSE', items: bigCart })).body.error, /covers up to 2 chapters[\s\S]*has 4[\s\S]*remove 2/, 'checked against the cart');
  const tooBig = await promo('g:lim', { action: 'module-order', board: 'CBSE', promoCode: 'TWOCH', items: bigCart });
  assert.equal(tooBig.status, 400); assert.match(tooBig.body.error, /covers up to 2 chapters/, '4 chapters / 2 subjects refused at order time');
  assert.equal(db.get('promoCodes/TWOCH').uses, 0, 'nothing used up');
  const fits = await promo('g:lim', { action: 'check-promo', code: 'TWOCH', kind: 'custom', board: 'CBSE', items: [bigCart[0]] });
  assert.equal(fits.status, 200); assert.deepEqual(fits.body.limits, { maxValueInr: 399, maxChapters: 2 }, 'limits sent to the app');
  const twoCh = await promo('g:lim', { action: 'module-order', board: 'CBSE', promoCode: 'TWOCH', items: [bigCart[0]] });
  assert.equal(twoCh.body.free, true, 'exactly 2 chapters goes through at ₹0'); assert.equal(db.get('promoCodes/TWOCH').uses, 1);
  db.set('promoCodes/CAP399', { code: 'CAP399', scope: 'all', maxUses: 0, uses: 0, oncePerStudent: false, active: true, maxValueInr: 399 });
  assert.match((await promo('g:lim', { action: 'redeem-promo', code: 'CAP399', testId: 'onpromo2' })).body.error, /covers up to ₹399[\s\S]*₹499/, '₹499 mock refused by a ₹399 code');
  assert.equal((await promo('g:lim', { action: 'redeem-promo', code: 'CAP399', testId: 'onpromo3' })).status, 200, '₹299 chapter test is covered');
  console.log('✓ promo limits: a 2-chapter / ₹399 code refuses a 4-chapter cart and a ₹499 mock (nothing used up), covers 2 chapters and a ₹299 test');
  console.log('✓ promo codes: validated (format, unknown, off, expired, scope), check uses nothing, redeem unlocks at ₹0 once per student, total limit, custom module ₹0 order');

  // ── Mock packs: weekly full-syllabus mocks at a fixed day and time ──
  const sched = policy.packSchedule('2026-12-06', '10:00', 8);
  assert.equal(sched.length, 8); assert.equal(sched[0], '2026-12-06T04:30:00.000Z', '10:00 India time');
  assert.equal(Date.parse(sched[1]) - Date.parse(sched[0]), 7 * 86400000, 'one a week');
  assert.deepEqual(policy.PACK_PRESETS.map(p => [p.mocks, p.priceInr]), [[8, 3199], [4, 1699]]);
  assert.equal(policy.packSchedule('', '10:00', 4).length, 0);
  const past = new Date(Date.now() - 3600000).toISOString(), later = new Date(Date.now() + 5 * 86400000).toISOString();
  db.set('mockPackages/pkphy8', { title: 'Physics · 8 weekly mocks', class: '10', board: '', subject: 'Physics', mocks: 8, priceInr: 3199, schedule: [past, later], active: true });
  db.set('mockPackages/pkold1', { title: 'Paused pack', class: '10', board: '', subject: 'Physics', mocks: 4, priceInr: 1699, schedule: [later], active: false });
  db.set('mockPackages/pkicse', { title: 'ICSE pack', class: '10', board: 'ICSE', subject: 'Physics', mocks: 4, priceInr: 1699, schedule: [later], active: true });
  test('onpack01', { kind: 'package', packageId: 'pkphy8', slot: 1, releaseAt: past, testName: 'Physics full mock 1' });
  test('onpack02', { kind: 'package', packageId: 'pkphy8', slot: 2, releaseAt: later, testName: 'Physics full mock 2' });
  ['onpack01', 'onpack02'].forEach(id => db.set('offlineTestKeys/' + id, { questionPdfUrl: 'https://ucarecdn.com/11111111-1111-1111-1111-111111111111/' }));
  assert.equal(policy.priceFor(db.get('offlineTests/onpack01'), policy.PRICES), 0, 'pack mocks have no single price');
  const notIn = await ot({ idToken: 'g:riya', action: 'start', testId: 'onpack01' });
  assert.equal(notIn.status, 402); assert.match(notIn.body.error, /Join this mock pack/);
  assert.equal((await api({ idToken: 'g:riya', action: 'package-order', packageId: 'bad id!' })).status, 400);
  assert.equal((await api({ idToken: 'g:riya', action: 'package-order', packageId: 'pknone' })).status, 404);
  assert.equal((await api({ idToken: 'g:riya', action: 'package-order', packageId: 'pkold1' })).status, 409, 'paused pack not on sale');
  assert.equal((await api({ idToken: 'g:riya', action: 'package-order', packageId: 'pkicse' })).status, 403, 'other board refused');
  assert.equal((await api({ idToken: 'g:nobody', action: 'package-order', packageId: 'pkphy8' })).status, 403, 'profile needed');
  const po = await api({ idToken: 'g:riya', action: 'package-order', packageId: 'pkphy8' });
  assert.equal(po.status, 200); assert.equal(po.body.amountPaise, 319900, 'pack price ₹3199');
  assert.equal(db.get('onlineOrders/' + po.body.orderId).type, 'package');
  const ppay = 'pay_Pack0001';
  const pv = await api({ idToken: 'g:riya', action: 'verify-payment', orderId: po.body.orderId, paymentId: ppay, signature: sign(po.body.orderId, ppay) });
  assert.equal(pv.status, 200);
  assert.equal(db.get('onlinePurchases/pkg_pkphy8__riya').paymentId, ppay, 'joining saved as pkg_ purchase');
  assert.equal((await api({ idToken: 'g:riya', action: 'package-order', packageId: 'pkphy8' })).status, 409, 'cannot join twice');
  assert.equal((await ot({ idToken: 'g:riya', action: 'start', testId: 'onpack01' })).status, 200, 'opened pack mock starts');
  const early = await ot({ idToken: 'g:riya', action: 'start', testId: 'onpack02' });
  assert.equal(early.status, 403); assert.match(early.body.error, /opens on/, 'not before its opening time');
  // Webhook path for a pack, TNC free join, promo join.
  db.set('onlineStudents/pia', { ...prof, uid: 'pia', name: 'Pia' });
  const po2 = await api({ idToken: 'g:pia', action: 'package-order', packageId: 'pkphy8' });
  assert.equal((await hook({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_Pack0002', order_id: po2.body.orderId, amount: 319900, currency: 'INR', status: 'captured' } } } })).status, 200);
  assert.ok(db.has('onlinePurchases/pkg_pkphy8__pia'), 'webhook joins the pack');
  const tj = await api({ idToken: 'p:tnc1', action: 'package-order', packageId: 'pkphy8' });
  assert.equal(tj.status, 200); assert.ok(!tj.body.free); assert.equal(tj.body.amountPaise, 319900, 'TNC students pay for mock packs');
  assert.ok(!db.has('onlinePurchases/pkg_pkphy8__tnc1'));
  assert.equal((await ot({ idToken: 'p:tnc1', action: 'start', testId: 'onpack01' })).status, 402, 'TNC students must join a pack to take its mocks');
  db.set('promoCodes/TNCPACK', { code: 'TNCPACK', scope: 'package', maxUses: 0, uses: 0, oncePerStudent: true, active: true });
  assert.match((await api({ idToken: 'g:sam', action: 'check-promo', code: 'TNCCHAP', packageId: 'pkphy8' })).body.error, /chapter-wise tests only|used up/);
  assert.match((await api({ idToken: 'g:sam', action: 'check-promo', code: 'TNCPACK', testId: 'onpromo3' })).body.error, /mock packs only/, 'pack code does not work on tests');
  assert.equal((await api({ idToken: 'g:sam', action: 'check-promo', code: 'TNCPACK', packageId: 'pkphy8' })).status, 200);
  db.set('mockPackages/pkcls8', { title: 'Class 8 pack', class: '8', board: '', subject: 'Science', mocks: 4, priceInr: 1699, schedule: [later], active: true });
  assert.match((await api({ idToken: 'g:junior', action: 'package-order', packageId: 'pkcls8' })).body.error, /Classes 9 to 12/, 'no mock packs for Class 8');
  assert.match((await api({ idToken: 'g:sam', action: 'package-order', packageId: 'pkphy8', promoCode: 'CAP399' })).body.error, /covers up to ₹399[\s\S]*₹3199/, 'a ₹399 code cannot pay for a ₹3199 pack');
  const pj = await api({ idToken: 'g:sam', action: 'package-order', packageId: 'pkphy8', promoCode: 'TNCPACK' });
  assert.equal(pj.body.free, true); assert.equal(db.get('onlinePurchases/pkg_pkphy8__sam').via, 'promo'); assert.equal(db.get('promoCodes/TNCPACK').uses, 1);
  // TNC students can use a code on a pack or custom module (not on tests — those are free for them).
  assert.equal((await api({ idToken: 'p:tnc1', action: 'check-promo', code: 'TNCPACK', packageId: 'pkphy8' })).status, 200);
  const tp = await api({ idToken: 'p:tnc1', action: 'package-order', packageId: 'pkphy8', promoCode: 'TNCPACK' });
  assert.equal(tp.body.free, true); assert.equal(db.get('onlinePurchases/pkg_pkphy8__tnc1').via, 'promo');
  assert.equal((await ot({ idToken: 'p:tnc1', action: 'start', testId: 'onpack01' })).status, 200, 'TNC student in the pack starts its mock');
  db.set('promoCodes/TNCMODT', { code: 'TNCMODT', scope: 'custom', maxUses: 0, uses: 0, oncePerStudent: true, active: true });
  assert.equal((await api({ idToken: 'p:tnc1', action: 'check-promo', code: 'TNCMODT', kind: 'custom' })).status, 409, 'TNC students need no code for custom tests (already free)');
  const tcm = await api({ idToken: 'p:tnc1', action: 'module-order', board: 'CBSE', promoCode: 'TNCMODT', items: [{ subject: 'Mathematics', chapters: [mat[6], mat[8]] }] });
  assert.equal(tcm.body.free, true); assert.ok(!tcm.body.promo, 'free without using the code'); assert.equal(db.get('promoCodes/TNCMODT').uses, 0);
  assert.equal((await api({ idToken: 'p:tnc1', action: 'redeem-promo', code: 'TNCMODT', testId: 'onpromo3' })).status, 409, 'no codes on tests for TNC students');
  console.log('✓ mock packs: weekly schedule, ₹3199 order + verify / webhook join, cannot join twice, paused / other board refused, opens only at its time, TNC students pay (or use a code), pack promo code');

  // ── submit → teacher returns → leaderboard ──
  const script = 'https://ucarecdn.com/22222222-2222-2222-2222-222222222222/';
  assert.equal((await ot({ idToken: 'g:riya', action: 'submit', testId: 'onfree01', scriptPdfUrl: script, pageUrls: [] })).status, 200);
  const rep = db.get('offlineReports/onfree01__riya');
  assert.equal(rep.series, 'online'); assert.equal(rep.enrolled, false); assert.equal(rep.studentId, 'TNC-ON-RIYA'); assert.equal(rep.studentCity, 'Kolkata');
  assert.ok(db.has('onlineStudents/riya/history/onfree01__riya'), 'history under the online profile');
  assert.ok(!db.has('students/riya/offlineHistory/onfree01__riya'));
  await ot({ idToken: 'p:tnc1', action: 'submit', testId: 'onpaid01', scriptPdfUrl: script, pageUrls: [] });
  assert.equal(db.get('offlineReports/onpaid01__tnc1').enrolled, true);
  const checked = 'https://ucarecdn.com/33333333-3333-3333-3333-333333333333/';
  // Parent email: optional on the form, validated, and the result is emailed on Send back.
  assert.equal(policy.validateProfile(form({ guardianEmail: 'not-an-email' })).errors.guardianEmail, 'Enter a valid email, or leave it empty.');
  assert.ok(policy.validateProfile(form({ guardianEmail: '' })).ok, 'guardian email is optional');
  assert.equal((await api({ idToken: 'g:riya', action: 'save-profile', profile: form({ guardianEmail: 'Anil.Sharma@Gmail.com' }) })).status, 200);
  assert.equal(db.get('onlineStudents/riya').guardianEmail, 'anil.sharma@gmail.com');
  process.env.BREVO_API_KEY = 'xkeysib-fixture'; process.env.RESULT_EMAIL_FROM = 'results@thenewtownclasses.com';
  const ret = await ot({ idToken: 'p:t1', action: 'return-script', attemptId: 'onfree01__riya', checkedScriptUrl: checked, score: 30, remark: 'Good <b>work</b>' });
  assert.equal(ret.status, 200); assert.deepEqual(ret.body.emailed, ['anil.sharma@gmail.com', 'riya@gmail.example'], 'parent + student emailed');
  const mail = calls.brevo[0].body;
  assert.equal(calls.brevo[0].headers['api-key'], 'xkeysib-fixture'); assert.equal(mail.sender.email, 'results@thenewtownclasses.com');
  assert.match(mail.subject, /Riya Sharma's result: Full mock 1 — 30\/40/);
  assert.match(mail.htmlContent, /30 \/ 40[\s\S]*75%[\s\S]*Dear Anil Sharma[\s\S]*|Dear Anil Sharma[\s\S]*30 \/ 40[\s\S]*75%/); assert.match(mail.htmlContent, /Good &lt;b&gt;work&lt;\/b&gt;/, 'feedback escaped');
  assert.match(mail.htmlContent, /View checked answer sheet/); assert.match(mail.htmlContent, /approved by a TNC teacher/);
  delete process.env.BREVO_API_KEY;
  const result = db.get('onlineStudents/riya/results/onfree01__riya');
  assert.equal(result.teacherName, 'TNC Physics Faculty'); assert.equal(result.teacherUid, '', 'online students never see who checked');
  assert.equal(db.get('offlineReports/onfree01__riya').approvedByUid, 't1', 'admins still see the checker');
  assert.equal(result.score, 30); assert.equal(result.testId, 'onfree01'); assert.equal(result.class, '10'); assert.equal(result.series, 'online'); assert.equal(result.answerSheetUrl, checked);
  assert.ok(!db.has('students/riya/offlineResults/ots_onfree01__riya'), 'online results stay out of the institute record');
  let board = db.get('onlineLeaderboard/c10_physics');
  assert.equal(board.count, 1); assert.deepEqual(board.scores, [75]); assert.deepEqual(board.top, [{ rank: 1, name: 'Riya S.', city: 'Kolkata', state: 'West Bengal' }]);
  await ot({ idToken: 'p:t1', action: 'return-script', attemptId: 'onpaid01__tnc1', checkedScriptUrl: checked, score: 36, remark: '' });
  board = db.get('onlineLeaderboard/c10_physics');
  assert.equal(board.count, 2); assert.deepEqual(board.scores, [90, 75]); assert.deepEqual(board.top.map(t => t.name), ['Aman G.', 'Riya S.']);
  assert.equal(policy.rankFrom(board.scores, policy.averageOf([result])), 2, "Riya's own rank works out to #2");
  console.log('✓ submit/return: online report + history, result under online profile, leaderboard count / top names / anonymous scores');

  // ── admin delete refreshes the board ──
  db.set('admins/adm', { isAdmin: true });
  assert.equal((await ot({ idToken: 'p:adm', action: 'delete-record', attemptId: 'onpaid01__tnc1' })).status, 200);
  assert.ok(!db.has('onlineStudents/tnc1/results/onpaid01__tnc1') && !db.has('onlineStudents/tnc1/history/onpaid01__tnc1'));
  board = db.get('onlineLeaderboard/c10_physics');
  assert.equal(board.count, 1); assert.deepEqual(board.top.map(t => t.name), ['Riya S.']);
  console.log('✓ admin delete: online result and history removed, leaderboard recomputed');
  // Same buyer in multiple tabs: one external order for each purchase type.
  await api({ idToken: 'g:racebuyer', action: 'save-profile', profile: form() });
  db.set('offlineTests/racetest', { series: 'online', kind: 'chapter', class: '10', subject: 'Physics', isActive: true });
  db.set('mockPackages/racepack', { title: 'Race pack', class: '10', subject: 'Physics', active: true, priceInr: 3199 });
  const cartChapters = require('../assets/js/syllabus').chapters('CBSE', '10', 'Science').slice(0, 2);
  for (const purchase of [
    { action: 'create-order', testId: 'racetest' },
    { action: 'package-order', packageId: 'racepack' },
    { action: 'module-order', board: 'CBSE', items: [{ subject: 'Science', chapters: cartChapters }] }
  ]) {
    const before = calls.razorpay.length;
    const orders = await Promise.all(Array.from({ length: 10 }, () => api({ idToken: 'g:racebuyer', ...purchase })));
    assert.ok(orders.every(r => r.status === 200), JSON.stringify(orders));
    assert.equal(new Set(orders.map(r => r.body.orderId)).size, 1, 'tabs receive the same order');
    assert.equal(calls.razorpay.length - before, 1, 'only one external order created');
  }
  // Legacy distinct orders may still be paid concurrently: record BOTH and flag the duplicate.
  const firstId = [...db.values()].find(o => o.uid === 'racebuyer' && o.testId === 'racetest' && o.orderId)?.orderId;
  const secondId = 'order_LegacyRace001';
  db.set('onlineOrders/' + secondId, { ...db.get('onlineOrders/' + firstId), orderId: secondId });
  const confirm = (orderId, i) => api({ idToken: 'g:racebuyer', action: 'verify-payment', orderId, paymentId: 'pay_Race00000' + i, signature: sign(orderId, 'pay_Race00000' + i) });
  const confirmations = await Promise.all([confirm(firstId, 1), confirm(secondId, 2)]);
  assert.ok(confirmations.every(r => r.status === 200));
  const paidOrders = [firstId, secondId].map(id => db.get('onlineOrders/' + id));
  assert.ok(paidOrders.every(o => o.status === 'paid' && o.paymentId));
  assert.equal(paidOrders.filter(o => o.duplicate).length, 1, 'duplicate payment is visible for refund');
  await Promise.all([confirm(firstId, 1), confirm(secondId, 2)]);
  assert.equal([firstId, secondId].filter(id => db.get('onlineOrders/' + id).duplicate).length, 1);
  console.log('✓ multi-tab orders: one test/pack/cart order; racing legacy payments both recorded, one flagged for refund');
  console.log('All online test series function checks passed.');
})().catch(e => { console.error(e); process.exit(1); });
