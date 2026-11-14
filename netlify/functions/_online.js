/**
 * Shared server helpers for the Online Test Series (all-India):
 *  - fsQuery()            Firestore runQuery with equality filters
 *  - Razorpay orders, signature checks and purchase grants
 *  - refreshLeaderboard() recomputes one class + subject leaderboard
 * Used by online-series.js, razorpay-webhook.js and offline-test.js.
 */
const crypto = require('crypto');
const policy = require('../../assets/js/online-policy');
const syllabus = require('../../assets/js/syllabus');
const { request, fsGet, fsCommit, enc, decFields } = require('./_google');

// Prices in rupees per kind; ONLINE_CHAPTER_PRICE_INR / ONLINE_MOCK_PRICE_INR override.
const envPrice = (name, fallback) => { const n = parseInt(process.env[name], 10); return Number.isFinite(n) && n >= 1 && n <= 100000 ? n : fallback; };
const prices = () => ({ chapter: envPrice('ONLINE_CHAPTER_PRICE_INR', policy.PRICES.chapter), mock: envPrice('ONLINE_MOCK_PRICE_INR', policy.PRICES.mock) });
const priceFor = (test, enrolled) => policy.priceFor(test, prices(), enrolled);
// Free-mock claims: { uid, claims: [{ testId, subject, testName, claimedAt }] }.
function freeMockState(claimDoc, enrolled, decFields) {
  const d = claimDoc ? decFields(claimDoc) : null;
  const claims = d ? (Array.isArray(d.claims) ? d.claims : d.testId ? [{ testId: d.testId, subject: d.subject, testName: d.testName, claimedAt: d.claimedAt }] : []) : [];
  const allowance = enrolled ? policy.FREE_MOCKS.enrolled : policy.FREE_MOCKS.online;
  return { allowance, usedCount: claims.length, left: Math.max(0, allowance - claims.length), claims: claims.map(c => ({ testId: c.testId, subject: c.subject || '' })), raw: claims };
}
const paymentsReady = () => !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

// Equality-only query (no composite index needed). Returns [{ id, data }].
async function fsQuery(projectId, token, collectionId, equals, fields, limit) {
  const filters = Object.entries(equals).map(([fieldPath, value]) => ({ fieldFilter: { field: { fieldPath }, op: 'EQUAL', value: enc(value) } }));
  const structuredQuery = {
    from: [{ collectionId }],
    ...(filters.length ? { where: filters.length === 1 ? filters[0] : { compositeFilter: { op: 'AND', filters } } } : {}),
    ...(fields ? { select: { fields: fields.map(fieldPath => ({ fieldPath })) } } : {}),
    ...(limit ? { limit } : {})
  };
  const r = await request('firestore.googleapis.com', `/v1/projects/${projectId}/databases/(default)/documents:runQuery`, 'POST',
    { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, { structuredQuery });
  if (r.status !== 200 || !Array.isArray(r.body)) throw new Error(`Firestore query ${collectionId} -> ${r.status}`);
  return r.body.filter(x => x.document).map(x => ({ id: x.document.name.split('/').pop(), data: decFields(x.document) }));
}

// ── Razorpay ──
function razorpayAuth() {
  return 'Basic ' + Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
}
async function createRazorpayOrder(amountPaise, receipt, notes) {
  const r = await request('api.razorpay.com', '/v1/orders', 'POST',
    { Authorization: razorpayAuth(), 'Content-Type': 'application/json' },
    { amount: amountPaise, currency: 'INR', receipt: String(receipt).slice(0, 40), notes });
  if (r.status !== 200 || !r.body || !r.body.id) {
    console.error('[online] Razorpay order failed', r.status, r.body && r.body.error && r.body.error.description);   // details stay in the logs
    throw Object.assign(new Error('Could not start the payment. Please try again.'), { status: 502 });
  }
  return r.body;
}
function safeEqualHex(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8'), y = Buffer.from(String(b || ''), 'utf8');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}
const checkoutSignatureOk = (orderId, paymentId, signature) => safeEqualHex(
  crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '').update(`${orderId}|${paymentId}`).digest('hex'), signature);
const webhookSignatureOk = (rawBody, signature) => !!process.env.RAZORPAY_WEBHOOK_SECRET && safeEqualHex(
  crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex'), signature);

// Marks an order paid and unlocks its test. Safe to call twice (checkout
// handler and webhook can both arrive): a second call changes nothing.
// Check a cart of chapters against the syllabus. items: [{ subject, chapters[] }].
// Returns { ok, error, items (clean, syllabus order), count }.
function checkModuleCart(board, cls, items) {
  if (!policy.MODULE.classes.includes(String(cls))) return { ok: false, error: 'Custom module tests are for Classes 9 to 12.' };
  if (!['CBSE', 'CISCE'].includes(board)) return { ok: false, error: 'Choose CBSE or ICSE / ISC.' };
  if (!Array.isArray(items) || !items.length) return { ok: false, error: 'Add at least one chapter.' };
  const clean = [], seen = new Set();
  for (const it of items) {
    const subject = String((it && it.subject) || '');
    const book = syllabus.chapters(board, cls, subject);
    if (!book.length || seen.has(subject)) return { ok: false, error: 'Choose chapters from the subject list.' };
    seen.add(subject);
    const picked = new Set((Array.isArray(it.chapters) ? it.chapters : []).map(String));
    if (![...picked].every(c => book.includes(c))) return { ok: false, error: `Some ${subject} chapters are not in the ${syllabus.boardLabel(board, cls)} syllabus. Refresh and try again.` };
    const chapters = book.filter(c => picked.has(c));
    if (chapters.length && chapters.length < policy.MODULE.minPerPaper) return { ok: false, error: `Pick at least ${policy.MODULE.minPerPaper} chapters for ${subject}.` };
    if (chapters.length) clean.push({ subject, chapters });
  }
  const count = clean.reduce((n, it) => n + it.chapters.length, 0);
  if (!count) return { ok: false, error: 'Add at least one chapter.' };
  if (count > policy.MODULE.maxChapters) return { ok: false, error: `You can add up to ${policy.MODULE.maxChapters} chapters at a time.` };
  return { ok: true, items: clean, count };
}

// One request per subject in the order: the team makes that paper.
// Deterministic IDs make a second confirmation harmless.
async function createModuleRequests(projectId, sa, order, orderId, now) {
  const writes = [];
  const due = new Date(Date.parse(now) + policy.MODULE.readyHours * 3600000).toISOString();
  for (const it of order.items || []) {
    const id = `${orderId}_${policy.subjectKey(it.subject)}`;
    if (await fsGet(projectId, sa, `moduleRequests/${id}`)) continue;
    const share = order.chapterCount ? Math.round((order.amountPaise || 0) * it.chapters.length / order.chapterCount) : 0;
    writes.push({ path: `moduleRequests/${id}`, currentDocument: { exists: false }, data: {
      id, orderId, uid: order.uid, studentName: order.studentName || '', onlineId: order.onlineId || '', enrolled: !!order.enrolled, phone: order.phone || '',
      class: String(order.class || ''), board: order.board, boardLabel: syllabus.boardLabel(order.board, order.class),
      subject: it.subject, chapters: it.chapters, chapterCount: it.chapters.length, amountPaise: share,
      status: 'requested', testId: '', createdAt: now, dueAt: due, readyAt: '' } });
  }
  return writes;
}

// An unpaid Razorpay order for the same student + item + amount from the last
// 20 minutes is reused, so double taps or a second tab cannot create a second
// order — and Razorpay accepts only one payment per order (no double charge).
async function reusableOrder(projectId, sa, uid, testId, amountPaise) {
  try {
    const rows = await fsQuery(projectId, sa, 'onlineOrders', { uid, testId, status: 'created' }, ['orderId', 'amountPaise', 'createdAt'], 5);
    const fresh = rows.map(r => r.data).filter(o => Number(o.amountPaise) === Number(amountPaise) && Date.now() - Date.parse(o.createdAt || 0) < 20 * 60000)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
    return fresh ? fresh.orderId : '';
  } catch (_) { return ''; }   // never block a payment because the lookup failed
}
async function grantPurchase(projectId, sa, orderId, paymentId, via) {
  const orderDoc = await fsGet(projectId, sa, `onlineOrders/${orderId}`);
  if (!orderDoc) throw Object.assign(new Error('Payment order not found.'), { status: 404 });
  const order = decFields(orderDoc);
  if (order.type === 'module') {
    const now = new Date().toISOString();
    const writes = await createModuleRequests(projectId, sa, order, orderId, order.paidAt || now);
    if (order.status !== 'paid') writes.unshift({ path: `onlineOrders/${orderId}`, data: { ...order, status: 'paid', paymentId, paidAt: now, confirmedVia: via } });
    if (writes.length) {
      try { await fsCommit(projectId, sa, writes); }
      catch (e) { if (!e.conflict) throw e; }   // the other confirmation got there first
    }
    return { uid: order.uid, type: 'module', orderId };
  }
  const purchasePath = `onlinePurchases/${order.testId}__${order.uid}`;
  const existing = await fsGet(projectId, sa, purchasePath);
  const now = new Date().toISOString();
  const writes = [];
  // Already unlocked by another order (or a promo): this payment is a duplicate — flag it so admin refunds it.
  const duplicate = !!existing && decFields(existing).orderId !== orderId;
  if (order.status !== 'paid') writes.push({ path: `onlineOrders/${orderId}`, data: { ...order, status: 'paid', paymentId, paidAt: now, confirmedVia: via, ...(duplicate ? { duplicate: true } : {}) } });
  if (duplicate) console.error('[online] duplicate payment for an unlocked item — refund needed', orderId, paymentId);
  if (!existing) writes.push({ path: purchasePath, currentDocument: { exists: false }, data: {
    uid: order.uid, testId: order.testId, orderId, paymentId, amountPaise: order.amountPaise, currency: 'INR',
    testName: order.testName || '', subject: order.subject || '', class: order.class || '',
    studentName: order.studentName || '', email: order.email || '', paidAt: now,
    ...(order.type === 'package' ? { kind: 'package', packageId: order.packageId || '' } : {})
  } });
  if (writes.length) {
    try { await fsCommit(projectId, sa, writes); }
    catch (e) { if (!e.conflict) throw e; }   // the other confirmation got there first
  }
  return { uid: order.uid, testId: order.testId };
}

// Recompute one class + subject leaderboard from every checked online script.
// Stores the count, the top three names and an anonymous descending score
// list, from which each student's own rank is worked out in the portal.
async function refreshLeaderboard(projectId, sa, cls, subject) {
  if (!cls || !subject) return null;
  const rows = await fsQuery(projectId, sa, 'offlineReports',
    { series: 'online', studentClass: String(cls), subject: String(subject), status: 'approved' },
    ['uid', 'studentName', 'score', 'totalMarks', 'approvedAt']);
  const list = policy.rank(rows.map(r => ({ uid: r.data.uid, name: r.data.studentName, score: r.data.score, totalMarks: r.data.totalMarks, approvedAt: r.data.approvedAt })));
  const top = await Promise.all(list.slice(0, 3).map(async s => {
    const p = await fsGet(projectId, sa, `onlineStudents/${s.uid}`).catch(() => null);
    const prof = p ? decFields(p) : {};
    return { rank: s.rank, name: policy.shortName(prof.name || s.name), city: prof.city || '', state: prof.state || '' };
  }));
  const board = { class: String(cls), subject: String(subject), count: list.length, scores: list.map(s => s.avgPct), top, updatedAt: new Date().toISOString() };
  await fsCommit(projectId, sa, [{ path: `onlineLeaderboard/${policy.boardKey(cls, subject)}`, data: board }]);
  return board;
}

// ── Promo codes: 100% off one purchase (a test unlock or a custom-module order) ──
// promoCodes/{CODE}: { code, scope: all|chapter|mock|custom|package, maxUses (0 = no limit), uses,
//   oncePerStudent, expiresAt, active, note, forUid?, forName?, forOnlineId? }. forUid = only that student. Created by admins; uses are counted here.
const PROMO_RE = /^[A-Z0-9]{4,20}$/;
const scopeLabel = { chapter: 'chapter-wise tests', mock: 'full mock tests', custom: 'custom module tests', package: 'mock packs' };
async function checkPromo(projectId, sa, raw, kind, uid) {
  const code = String(raw || '').trim().toUpperCase();
  if (!PROMO_RE.test(code)) return { error: 'Enter a valid promo code.' };
  const doc = await fsGet(projectId, sa, `promoCodes/${code}`);
  if (!doc) return { error: 'This promo code is not valid.' };
  const promo = decFields(doc);
  // A code made for one student (forUid) works only for that student, so a shared code is useless to others.
  if (promo.forUid && promo.forUid !== uid) return { error: 'This promo code was made for another student.' };
  if (promo.active === false) return { error: 'This promo code is no longer active.' };
  if (promo.expiresAt && Date.parse(promo.expiresAt) < Date.now()) return { error: 'This promo code has expired.' };
  if (promo.scope && promo.scope !== 'all' && promo.scope !== kind) return { error: `This code works on ${scopeLabel[promo.scope] || 'other purchases'} only.` };
  if (Number(promo.maxUses) > 0 && Number(promo.uses || 0) >= Number(promo.maxUses)) return { error: 'This promo code has been used up.' };
  if (promo.oncePerStudent !== false) {
    const mine = await fsQuery(projectId, sa, 'promoRedemptions', { code, uid }, ['code'], 1);
    if (mine.length) return { error: "You've already used this promo code." };
  }
  return { code, promo, doc };
}
// Writes that record one use; the caller adds the unlock and commits them together.
// The promo's updateTime guards against two people using the last seat at once.
function promoWrites(check, uid, target, kind, extra, now) {
  return [
    { path: `promoCodes/${check.code}`, currentDocument: { updateTime: check.doc.updateTime }, data: { ...check.promo, uses: Number(check.promo.uses || 0) + 1, lastUsedAt: now } },
    { path: `promoRedemptions/${check.code}__${uid}__${target}`, currentDocument: { exists: false }, data: { code: check.code, uid, target, kind, at: now, ...extra } }
  ];
}

module.exports = { reusableOrder, prices, priceFor, freeMockState, checkModuleCart, createModuleRequests, checkPromo, promoWrites, paymentsReady, fsQuery, createRazorpayOrder, checkoutSignatureOk, webhookSignatureOk, grantPurchase, refreshLeaderboard };
