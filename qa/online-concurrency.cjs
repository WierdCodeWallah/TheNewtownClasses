/* Online Test Series — race-condition checks for the server functions.
   Fires hundreds of simultaneous requests at the real online-series.js /
   offline-test.js / razorpay-webhook.js code against the in-memory Firestore of
   online-functions.cjs, with random 0–25 ms delays around every read and write
   so requests interleave like they do in production. Checks that nothing is
   granted twice and nothing breaks:
     · 500 students open the app at once
     · 300 students start a payment at once
     · 100 students race for a promo code with 10 uses → exactly 10 win
     · one student taps a once-per-student code on 20 tests at once → 1 win
     · one payment confirmed 10× by the phone and 10× by the webhook → 1 unlock
     · one student claims 5 free mocks at once → 1 claim
     · one student double-joins a pack with a promo → 1 join, 1 use
     · 300 students start and submit their answer scripts at once
   This checks correctness under concurrency, not hosting capacity.
   Run: node qa/online-concurrency.cjs */
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const file = path.resolve(__dirname, 'online-functions.cjs');
let src = fs.readFileSync(file, 'utf8');
src = src.slice(0, src.indexOf('(async () => {'));
// Random latency around every Firestore / HTTP call (the commit itself stays atomic, like Firestore's).
src = src.replace('const googlePath = require.resolve', `const lag = () => new Promise(r => setTimeout(r, Math.random() * 25));
for (const k of ['fsGet', 'fsPatch', 'fsCommit', 'request']) { const f = stub[k]; stub[k] = async (...a) => { await lag(); const out = await f(...a); await lag(); return out; }; }
const googlePath = require.resolve`);
const main = String.raw`
const range = n => Array.from({ length: n }, (_, i) => i);
const timed = async (label, fn) => { const t = Date.now(); const r = await fn(); return { r, ms: Date.now() - t, label }; };
const ok = r => r.status === 200;
(async () => {
  process.env.RAZORPAY_KEY_ID = 'rzp_test_fixture'; process.env.RAZORPAY_KEY_SECRET = 'fixture_secret'; process.env.RAZORPAY_WEBHOOK_SECRET = 'hook_secret';
  db.set('teachers/t1', { name: 'Aarav Sen' });
  // 500 Google students with complete profiles.
  assert.equal((await api({ idToken: 'g:s0', action: 'save-profile', profile: form({ name: 'Student Zero' }) })).status, 200);
  const base = db.get('onlineStudents/s0');
  range(500).forEach(i => db.set('onlineStudents/s' + i, { ...base, uid: 's' + i, name: 'Student ' + i, onlineId: 'TNC-ON-S' + i, email: 's' + i + '@gmail.example' }));
  const paper = id => { db.set('offlineTestKeys/' + id, { questionPdfUrl: 'https://ucarecdn.com/11111111-1111-1111-1111-111111111111/' }); };
  const mk = (id, extra) => { db.set('offlineTests/' + id, { testName: 'Test ' + id, class: '10', subject: 'Physics', chapter: 'Light', totalMarks: 40, durationMin: 60, isActive: true, teacherUid: 't1', teacherName: 'Aarav Sen', gradingMode: 'teacher', series: 'online', ...extra }); paper(id); };
  mk('cchap01', { kind: 'chapter' });
  range(20).forEach(i => mk('cchapx' + String(i).padStart(2, '0'), { kind: 'chapter' }));
  range(5).forEach(i => mk('cmock0' + i, { kind: 'mock', subject: ['Physics', 'Chemistry', 'Biology', 'Mathematics', 'Science'][i] }));
  const lines = [];

  // 1. 500 students open the app at once.
  let t = await timed('session', () => Promise.all(range(500).map(i => api({ idToken: 'g:s' + i, action: 'session' }))));
  assert.ok(t.r.every(ok), 'all 500 sessions answered'); lines.push('500 students open the app at once → 500 × OK');

  // 2. 300 students start a payment at once.
  t = await timed('orders', () => Promise.all(range(300).map(i => api({ idToken: 'g:s' + i, action: 'create-order', testId: 'cchap01' }))));
  assert.ok(t.r.every(ok), 'all 300 orders created');
  assert.equal(new Set(t.r.map(x => x.body.orderId)).size, 300, 'each student gets their own order');
  assert.ok(t.r.every(x => x.body.amountPaise === 19900), 'price always set by the server');
  lines.push('300 students start a ₹199 payment at once → 300 separate orders, all ₹199');

  // 3. 100 students race for a promo code with 10 uses.
  db.set('promoCodes/RACE10', { code: 'RACE10', scope: 'all', maxUses: 10, uses: 0, oncePerStudent: true, active: true });
  t = await timed('promo', () => Promise.all(range(100).map(i => api({ idToken: 'g:s' + (100 + i), action: 'redeem-promo', code: 'RACE10', testId: 'cchap01' }))));
  const winners = t.r.filter(ok).length;
  const promoUnlocks = [...db.keys()].filter(k => /^onlinePurchases\/cchap01__s\d+$/.test(k) && db.get(k).via === 'promo').length;
  assert.ok(t.r.every(x => [200, 400, 409].includes(x.status)), 'losers get a clear message, never a crash');
  assert.ok(winners <= 10, 'never more than 10 uses (' + winners + ')');
  assert.equal(db.get('promoCodes/RACE10').uses, winners, 'use count matches the unlocks');
  assert.equal(promoUnlocks, winners, 'one unlock per counted use');
  // The server retries collisions itself, so all 10 uses go in the first round.
  assert.equal(winners, 10, 'all 10 uses granted without students retrying (' + winners + ')');
  assert.equal(db.get('promoCodes/RACE10').uses, 10, 'exactly 10 uses');
  assert.ok(t.r.filter(x => !ok(x)).every(x => /used up|try again/i.test(x.body.error || '')), 'everyone else is told why');
  assert.equal([...db.keys()].filter(k => k.startsWith('promoRedemptions/RACE10__')).length, 10, 'exactly 10 redemption records');
  lines.push('100 students race for a 10-use promo code → exactly 10 unlocks on the first try, 10 uses counted, everyone else told it is used up (' + t.ms + 'ms)');

  // 4. One student, once-per-student code, 20 tests at once.
  db.set('promoCodes/ONCE1', { code: 'ONCE1', scope: 'all', maxUses: 0, uses: 0, oncePerStudent: true, active: true });
  t = await timed('once', () => Promise.all(range(20).map(i => api({ idToken: 'g:s499', action: 'redeem-promo', code: 'ONCE1', testId: 'cchapx' + String(i).padStart(2, '0') }))));
  assert.equal(t.r.filter(ok).length, 1, 'only one test unlocked'); assert.equal(db.get('promoCodes/ONCE1').uses, 1);
  lines.push('One student taps a once-per-student code on 20 tests at once → 1 unlock');

  // 5. One payment confirmed 10× by the phone and 10× by the webhook at the same time.
  const order = t.r && (await api({ idToken: 'g:s300', action: 'create-order', testId: 'cchapx00' })).body;
  const payId = 'pay_Race000001', sig = sign(order.orderId, payId);
  const payload = { event: 'payment.captured', payload: { payment: { entity: { id: payId, order_id: order.orderId, amount: 19900, currency: 'INR', status: 'captured' } } } };
  t = await timed('confirm', () => Promise.all([...range(10).map(() => api({ idToken: 'g:s300', action: 'verify-payment', orderId: order.orderId, paymentId: payId, signature: sig })), ...range(10).map(() => hook(payload))]));
  assert.ok(t.r.every(ok), 'every confirmation answers OK (no 500s)');
  assert.ok(db.has('onlinePurchases/cchapx00__s300'), 'unlocked'); assert.equal(db.get('onlineOrders/' + order.orderId).status, 'paid');
  assert.ok(!db.get('onlineOrders/' + order.orderId).duplicate, 'not flagged as a duplicate');
  lines.push('One payment confirmed 10× by the phone + 10× by the webhook at once → 1 unlock, order paid once');

  // 6. One student claims 5 free mocks at once.
  t = await timed('free', () => Promise.all(range(5).map(i => api({ idToken: 'g:s301', action: 'claim-free', testId: 'cmock0' + i }))));
  assert.equal(t.r.filter(ok).length, 1, 'only one free mock');
  assert.equal([...db.keys()].filter(k => /^onlinePurchases\/cmock0\d__s301$/.test(k)).length, 1);
  lines.push('One student claims 5 free mocks at once → exactly 1 free mock');

  // 7. Double-joining a pack with a promo code.
  db.set('mockPackages/pkrace', { title: 'Physics · 8 weekly mocks', class: '10', board: '', subject: 'Physics', mocks: 8, priceInr: 3199, schedule: [new Date(Date.now() + 86400000).toISOString()], active: true });
  db.set('promoCodes/PACKRACE', { code: 'PACKRACE', scope: 'package', maxUses: 0, uses: 0, oncePerStudent: true, active: true });
  t = await timed('pack', () => Promise.all(range(5).map(() => api({ idToken: 'g:s302', action: 'package-order', packageId: 'pkrace', promoCode: 'PACKRACE' }))));
  assert.equal(t.r.filter(ok).length, 1, 'joined once'); assert.equal(db.get('promoCodes/PACKRACE').uses, 1, 'code used once');
  lines.push('One student double-taps "Join for ₹0" on a pack 5× → joined once, code used once');

  // 8. 300 students start and submit at once (TNC-free chapter tests via a direct unlock).
  range(300).forEach(i => db.set('onlinePurchases/cchapx01__s' + i, { uid: 's' + i, testId: 'cchapx01', amountPaise: 19900 }));
  t = await timed('start', () => Promise.all(range(300).map(i => ot({ idToken: 'g:s' + i, action: 'start', testId: 'cchapx01' }))));
  assert.ok(t.r.every(ok), 'all 300 started');
  const script = 'https://ucarecdn.com/22222222-2222-2222-2222-222222222222/';
  t = await timed('submit', () => Promise.all([...range(300).map(i => ot({ idToken: 'g:s' + i, action: 'submit', testId: 'cchapx01', scriptPdfUrl: script, pageUrls: [] })),
    ...range(5).map(() => ot({ idToken: 'g:s0', action: 'submit', testId: 'cchapx01', scriptPdfUrl: script, pageUrls: [] }))]));
  assert.ok(t.r.every(x => x.status < 500), 'no server errors');
  assert.equal([...db.keys()].filter(k => /^offlineReports\/cchapx01__s\d+$/.test(k)).length, 300, 'exactly one script per student');
  lines.push('300 students start and submit at once (+ one student submits 5× together) → 300 scripts, no duplicates, no errors');

  lines.forEach(l => console.log('✓ ' + l));
  console.log('All concurrency checks passed.');
})().catch(e => { console.error(e); process.exit(1); });
`;
const run = new Module(file, module); run.filename = file; run.paths = module.paths;
run._compile(src + main, file);
