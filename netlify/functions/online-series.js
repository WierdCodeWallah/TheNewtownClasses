/**
 * ════════════════════════════════════════════════════
 *  Netlify Function: online-series
 *  ────────────────────────────────────────────────
 *  Server side of the Online Test Series portal (/test-series).
 *
 *  POST { idToken, action, ... }
 *    'session'         Who is signed in: profile, enrolled (TNC ID) or not,
 *                      unlocked tests, price and whether payments are live.
 *                      Enrolled students get a profile copied from their
 *                      institute record and every test unlocked.
 *    'save-profile'    { profile } — the sign-up form (validated here). Only name, class, board,
 *                      subjects, phone and guardian phone are required; the rest can
 *                      be added later from Profile (detailsComplete says if all is filled).
 *    'create-order'    { testId } — a Razorpay order for one paid test
 *                      (chapter-wise ₹299, full mock ₹499).
 *    'verify-payment'  { orderId, paymentId, signature } — checks Razorpay's
 *                      signature and unlocks the test.
 *    'claim-free'      { testId } — online students get one free full mock on
 *                      the subject they choose. Saved in onlineFreeClaims/{uid};
 *                      never moved.
 *    'module-order'    { board, items:[{subject, chapters[]}] } — Custom module
 *                      test (Classes 7–12): ₹199 a chapter for the first 4,
 *                      ₹150 after, or ₹699 for a subject with every chapter picked (a
 *                      Custom full mock); free for TNC students. Each subject
 *                      becomes a moduleRequests/{id} the team makes a paper for.
 *    'check-promo'     { code, testId } or { code, kind:'custom', board?, items? } — is the code
 *                      valid for this purchase? (100% off; nothing is used yet)
 *    'redeem-promo'    { code, testId } — use the code: the test unlocks at ₹0.
 *                      Custom modules pass promoCode to 'module-order' instead.
 *    'package-order'   { packageId, promoCode? } — join a mock pack (weekly
 *                      full-syllabus mocks): ₹0 with a promo code, otherwise a
 *                      Razorpay order for the pack price (TNC students pay too).
 *  TNC (enrolled) students: chapter-wise tests, full mocks and custom module
 *  tests are free; mock packs are paid (promo codes work for them there).
 *  Prices: chapter-wise ₹299 (regular ₹399) and full mock ₹499 (regular ₹699). Enrolled (TNC ID) students
 *  get every test free, so they can take them all and appear on the leaderboard.
 *
 *  Students cannot write any of these records themselves: everything goes
 *  through the service account. Taking the test (start / submit) stays in
 *  offline-test.js, which checks the unlock before handing out the paper.
 *
 *  ENV: FIREBASE_PROJECT_ID, FIREBASE_SERVICE_ACCOUNT,
 *       RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET (payments),
 *       ONLINE_CHAPTER_PRICE_INR / ONLINE_MOCK_PRICE_INR (optional; 299 / 499)
 * ════════════════════════════════════════════════════
 */
const crypto = require('crypto');
const policy = require('../../assets/js/online-policy');
const { verifyFirebaseIdToken, getServiceAccountAccessToken, fsGet, fsCommit, decFields } = require('./_google');
const online = require('./_online');

const CORS = {
  'Access-Control-Allow-Origin' : '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type'                : 'application/json',
  'Cache-Control'               : 'no-store'
};
const ok  = obj => ({ statusCode: 200, headers: CORS, body: JSON.stringify(obj) });
const bad = (status, msg, extra) => ({ statusCode: status, headers: CORS, body: JSON.stringify({ error: msg, ...(extra || {}) }) });

// Only the fields the portal shows; never another student's data.
// Many students can use one promo code at the same moment. When two writes collide,
// re-read and try again (up to 6 times, with a short random pause) instead of
// telling the student "try again".
async function retryOnConflict(fn) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) { if (!e.conflict || i >= 5) throw e; await new Promise(r => setTimeout(r, 30 + Math.random() * 90 * (i + 1))); }
  }
}

function publicProfile(p) {
  const keys = ['uid', 'onlineId', 'enrolled', 'provider', 'email', 'studentId', 'name', 'dob', 'gender', 'phone', 'class', 'board',
    'school', 'subjects', 'target', 'address', 'city', 'state', 'pincode', 'guardianName', 'guardianRelation', 'guardianEmail', 'guardianPhone',
    'profileComplete', 'detailsComplete', 'createdAt', 'photoUrl'];
  return Object.fromEntries(keys.filter(k => p[k] !== undefined).map(k => [k, p[k]]));
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

  try {
    const { uid, email, provider } = await verifyFirebaseIdToken(body.idToken, projectId);
    const sa = await getServiceAccountAccessToken();
    const [studentDoc, profileDoc] = await Promise.all([fsGet(projectId, sa, `students/${uid}`), fsGet(projectId, sa, `onlineStudents/${uid}`)]);
    const enrolled = !!studentDoc;
    const student = studentDoc ? decFields(studentDoc) : null;
    let profile = profileDoc ? decFields(profileDoc) : null;
    // Anyone may create a password account with Firebase, so only enrolled
    // students (TNC ID) or a verified Google account can use the portal.
    if (!enrolled && provider !== 'google.com') return bad(403, 'Please continue with Google, or sign in with your TNC ID.');
    const now = new Date().toISOString();

    // Enrolled students: the institute record is the source of truth for
    // name, class and board. Their profile is created/refreshed from it.
    if (enrolled) {
      const fromInstitute = {
        name: student.name || (profile && profile.name) || 'Student', class: String(student.class || ''), board: student.board || '',
        studentId: student.studentId || '', school: (profile && profile.school) || student.school || '',
        phone: (profile && profile.phone) || policy.phone(student.phone || student.parentPhone || ''),
        photoUrl: student.photoUrl || ''
      };
      const stale = !profile || ['name', 'class', 'board', 'studentId'].some(k => profile[k] !== fromInstitute[k])
        || !profile.lastSeenAt || Date.parse(profile.lastSeenAt) < Date.now() - 12 * 3600000;
      if (stale) {
        profile = { subjects: [], ...(profile || {}), ...fromInstitute, uid, enrolled: true, provider: 'tnc', onlineId: (profile && profile.onlineId) || fromInstitute.studentId || policy.onlineId(uid),
          profileComplete: true, createdAt: (profile && profile.createdAt) || now, updatedAt: now, lastSeenAt: now };
        await fsCommit(projectId, sa, [{ path: `onlineStudents/${uid}`, data: profile }]);
      }
    }

    if (body.action === 'session') {
      if (!enrolled && profile && (!profile.lastSeenAt || Date.parse(profile.lastSeenAt) < Date.now() - 12 * 3600000)) {
        profile = { ...profile, lastSeenAt: now };
        await fsCommit(projectId, sa, [{ path: `onlineStudents/${uid}`, data: profile }]);
      }
      const [purchases, claimDoc] = await Promise.all([online.fsQuery(projectId, sa, 'onlinePurchases', { uid }, ['testId']), fsGet(projectId, sa, `onlineFreeClaims/${uid}`)]);
      const free = online.freeMockState(claimDoc, enrolled, decFields);
      return ok({
        uid, enrolled, email,
        profile: profile ? publicProfile(profile) : { uid, email, name: '', profileComplete: false },
        unlocked: purchases.map(p => p.data.testId).filter(Boolean),
        prices: online.prices(), listPrices: policy.LIST_PRICES, paymentsReady: online.paymentsReady(),
        freeMock: { allowance: free.allowance, usedCount: free.usedCount, left: free.left, claims: free.claims },
        razorpayKeyId: process.env.RAZORPAY_KEY_ID || '', serverNow: now
      });
    }

    if (body.action === 'save-profile') {
      // Quick start: name, class, board, subjects and the two phone numbers are
      // enough to begin; the rest can be added later (detailsComplete tracks it).
      const check = policy.validateProfile(body.profile, { enrolled, quick: true });
      if (!check.ok) return bad(400, Object.values(check.errors)[0], { fields: check.errors });
      const v = check.value;
      const base = profile || { uid, onlineId: policy.onlineId(uid), createdAt: now };
      const next = enrolled
        ? { ...base, ...v, name: base.name, class: base.class, board: base.board }   // institute keeps these
        : { ...base, ...v, enrolled: false, provider: 'google', email };
      Object.assign(next, { uid, profileComplete: true, detailsComplete: check.complete, updatedAt: now, lastSeenAt: now });
      await fsCommit(projectId, sa, [{ path: `onlineStudents/${uid}`, data: next }]);
      return ok({ ok: true, profile: publicProfile(next) });
    }

    // One free full mock for online students, on the subject they choose.
    if (body.action === 'claim-free') {
      const testId = String(body.testId || '');
      if (!/^[A-Za-z0-9_-]{6,80}$/.test(testId)) return bad(400, 'Invalid test');
      if (enrolled) return bad(409, 'Every test is already free for you.');
      if (!profile || !profile.profileComplete) return bad(403, 'Complete your profile first.');
      const testDoc = await fsGet(projectId, sa, `offlineTests/${testId}`);
      if (!testDoc) return bad(404, 'This test is no longer available.');
      const test = decFields(testDoc);
      if (test.series !== 'online') return bad(404, 'This test is not part of the online series.');
      if (policy.kindOf(test) !== 'mock') return bad(409, 'Your free test can be used on a full mock test only.');
      if (test.isActive === false) return bad(409, 'This test is closed.');
      if (String(test.class) !== String(profile.class)) return bad(403, 'This test is for a different class.');
      if (test.board && test.board !== profile.board) return bad(403, 'This test is for a different board.');
      if (await fsGet(projectId, sa, `onlinePurchases/${testId}__${uid}`)) return bad(409, 'You have already unlocked this test.', { unlocked: true });
      const claimDoc = await fsGet(projectId, sa, `onlineFreeClaims/${uid}`);
      const free = online.freeMockState(claimDoc, enrolled, decFields);
      if (!free.left) return bad(409, `You've already used your free mock test${free.allowance > 1 ? 's' : ''} (${free.claims.map(c => c.subject).join(', ') || 'another subject'}).`, { freeUsed: true });
      const claims = [...free.raw, { testId, subject: test.subject || '', testName: test.testName || '', class: String(test.class || ''), claimedAt: now }];
      try {
        await fsCommit(projectId, sa, [
          // The precondition makes two simultaneous claims impossible.
          { path: `onlineFreeClaims/${uid}`, currentDocument: claimDoc ? { updateTime: claimDoc.updateTime } : { exists: false }, data: { uid, enrolled, claims, updatedAt: now } },
          { path: `onlinePurchases/${testId}__${uid}`, currentDocument: { exists: false }, data: {
            uid, testId, orderId: '', paymentId: '', amountPaise: 0, currency: 'INR', via: 'free-mock', kind: 'mock',
            testName: test.testName || '', subject: test.subject || '', class: String(test.class || ''),
            studentName: profile.name || '', email: profile.email || email || '', paidAt: now } }
        ]);
      } catch (e) {
        if (e.conflict) return bad(409, "You've already used your free mock test.", { freeUsed: true });
        throw e;
      }
      return ok({ ok: true, testId, freeMock: { allowance: free.allowance, usedCount: claims.length, left: free.allowance - claims.length, claims: claims.map(c => ({ testId: c.testId, subject: c.subject })) } });
    }

    // Mock packs: the purchase is onlinePurchases/pkg_{packageId}__{uid}.
    if (body.action === 'package-order' || ((body.action === 'check-promo') && body.packageId)) {
      if (!profile || !profile.profileComplete) return bad(403, 'Complete your profile first.');
      const packageId = String(body.packageId || '');
      if (!/^[A-Za-z0-9_-]{4,80}$/.test(packageId)) return bad(400, 'Invalid pack');
      const pkgDoc = await fsGet(projectId, sa, `mockPackages/${packageId}`);
      if (!pkgDoc) return bad(404, 'This pack is no longer available.');
      const pkg = decFields(pkgDoc), key = 'pkg_' + packageId;
      if (pkg.active === false) return bad(409, 'This pack is not on sale right now.');
      if (String(pkg.class) !== String(profile.class)) return bad(403, 'This pack is for a different class.');
      if (pkg.board && pkg.board !== profile.board) return bad(403, 'This pack is for a different board.');
      if (!policy.PACK_CLASSES.includes(String(profile.class))) return bad(403, 'Mock packs are for Classes 9 to 12.');
      if (await fsGet(projectId, sa, `onlinePurchases/${key}__${uid}`)) return bad(409, 'You have already joined this pack.', { unlocked: true });
      const purchase = (extra) => ({ path: `onlinePurchases/${key}__${uid}`, currentDocument: { exists: false }, data: {
        uid, testId: key, packageId, kind: 'package', orderId: '', paymentId: '', amountPaise: 0, currency: 'INR',
        testName: pkg.title || 'Mock pack', subject: pkg.subject || '', class: String(pkg.class || ''), studentName: profile.name || '', email: profile.email || email || '', paidAt: now, ...extra } });
      if (body.action === 'check-promo') {
        const check = await online.checkPromo(projectId, sa, body.code, 'package', uid, { valueInr: Number(pkg.priceInr || 0) });
        if (check.error) return bad(400, check.error);
        return ok({ ok: true, code: check.code, kind: 'package', limits: check.limits });
      }
      try {
        if (body.promoCode) return await retryOnConflict(async () => {
          if (await fsGet(projectId, sa, `onlinePurchases/${key}__${uid}`)) return bad(409, 'You have already joined this pack.', { unlocked: true });
          const check = await online.checkPromo(projectId, sa, body.promoCode, 'package', uid, { valueInr: Number(pkg.priceInr || 0) });
          if (check.error) return bad(400, check.error);
          await fsCommit(projectId, sa, [...online.promoWrites(check, uid, key, 'package', { testName: pkg.title || '', subject: pkg.subject || '', class: String(pkg.class || ''), studentName: profile.name || '', onlineId: profile.onlineId || '', valuePaise: Number(pkg.priceInr || 0) * 100 }, now),
            purchase({ via: 'promo', promoCode: check.code })]);
          return ok({ ok: true, free: true, promo: check.code, packageId });
        });
      } catch (e) {
        if (e.conflict) return bad(409, 'Lots of students are joining right now. Please try again in a moment.');
        throw e;
      }
      if (!online.paymentsReady()) return bad(503, 'Payments are being set up. Please call or WhatsApp us to join now.');
      const amountPaise = Math.round(Number(pkg.priceInr || 0) * 100);
      if (!(amountPaise > 0)) return bad(409, 'This pack has no price set yet.');
      const orderId = await online.paymentOrder(projectId, sa, uid, key, amountPaise, async () => {
        const rz = await online.createRazorpayOrder(amountPaise, `pkg_${Date.now().toString(36)}_${uid.slice(0, 8)}`, { uid, type: 'package', packageId });
        return {
        orderId: rz.id, type: 'package', uid, testId: key, packageId, amountPaise, currency: 'INR', status: 'created', createdAt: now,
        testName: pkg.title || 'Mock pack', subject: pkg.subject || '', class: String(pkg.class || ''), kind: 'package',
        studentName: profile.name || '', onlineId: profile.onlineId || '', email: profile.email || email || '', phone: profile.phone || '' };
      });
      return ok({ orderId, amountPaise, currency: 'INR', keyId: process.env.RAZORPAY_KEY_ID, testName: pkg.title || 'Mock pack',
        prefill: { name: profile.name || '', email: profile.email || email || '', contact: profile.phone || '' } });
    }

    // Promo codes (Google students): check, then use one on a test unlock.
    if (body.action === 'check-promo' || body.action === 'redeem-promo') {
      // TNC students need no code for tests (all free); they can use one on a custom module.
      if (enrolled) return bad(409, 'Chapter tests, full mocks and custom tests are already free for you.');
      if (!profile || !profile.profileComplete) return bad(403, 'Complete your profile first.');
      let kind = 'custom', test = null, testId = '';
      if (body.kind !== 'custom' || body.action === 'redeem-promo') {
        testId = String(body.testId || '');
        if (!/^[A-Za-z0-9_-]{6,80}$/.test(testId)) return bad(400, 'Invalid test');
        const testDoc = await fsGet(projectId, sa, `offlineTests/${testId}`);
        if (!testDoc) return bad(404, 'This test is no longer available.');
        test = decFields(testDoc);
        if (test.series !== 'online' || test.isActive === false) return bad(409, 'This test is not available.');
        if (String(test.class) !== String(profile.class)) return bad(403, 'This test is for a different class.');
        if (online.priceFor(test, false) === 0) return bad(409, 'This test is free — just start it.');
        if (await fsGet(projectId, sa, `onlinePurchases/${testId}__${uid}`)) return bad(409, 'You have already unlocked this test.', { unlocked: true });
        kind = policy.kindOf(test);
      }
      // What the code would pay for: the test's price, or the custom cart (when the app sends it).
      let use;
      if (test) use = { valueInr: online.priceFor(test, false) };
      else if (Array.isArray(body.items) && body.items.length) {
        const cart = online.checkModuleCart(String(body.board || ''), profile.class, body.items);
        if (!cart.ok) return bad(400, cart.error);
        use = { chapters: cart.count, valueInr: cart.amountInr };
      }
      if (body.action === 'check-promo') {
        const check = await online.checkPromo(projectId, sa, body.code, kind, uid, use);
        if (check.error) return bad(400, check.error, check.limits ? { limits: check.limits } : {});
        return ok({ ok: true, code: check.code, kind, limits: check.limits });
      }
      try {
        return await retryOnConflict(async () => {
        if (await fsGet(projectId, sa, `onlinePurchases/${testId}__${uid}`)) return bad(409, 'You have already unlocked this test.', { unlocked: true });
        const check = await online.checkPromo(projectId, sa, body.code, kind, uid, use);
        if (check.error) return bad(400, check.error);
        await fsCommit(projectId, sa, [
          ...online.promoWrites(check, uid, testId, kind, { testName: test.testName || '', subject: test.subject || '', class: String(test.class || ''), studentName: profile.name || '', onlineId: profile.onlineId || '', valuePaise: online.priceFor(test, false) * 100 }, now),
          { path: `onlinePurchases/${testId}__${uid}`, currentDocument: { exists: false }, data: {
            uid, testId, orderId: '', paymentId: '', amountPaise: 0, currency: 'INR', via: 'promo', promoCode: check.code, kind,
            testName: test.testName || '', subject: test.subject || '', class: String(test.class || ''), studentName: profile.name || '', email: profile.email || email || '', paidAt: now } }
        ]);
        return ok({ ok: true, testId, code: check.code });
        });
      } catch (e) {
        if (e.conflict) return bad(409, 'Lots of students are using this code right now. Please try again in a moment.');
        throw e;
      }
    }

    // Custom module test: a cart of chapters → one paper request per subject.
    if (body.action === 'module-order') {
      if (!profile || !profile.profileComplete) return bad(403, 'Complete your profile first.');
      const board = String(body.board || '');
      const cart = online.checkModuleCart(board, profile.class, body.items);
      if (!cart.ok) return bad(400, cart.error);
      const amountPaise = enrolled ? 0 : cart.amountInr * 100;
      const order = { type: 'module', uid, class: String(profile.class), board, items: cart.items, chapterCount: cart.count, amountPaise, currency: 'INR',
        enrolled, studentName: profile.name || '', onlineId: profile.onlineId || '', email: profile.email || email || '', phone: profile.phone || '',
        testName: `Custom module · ${cart.count} chapter${cart.count === 1 ? '' : 's'}`, subject: cart.items.map(i => i.subject).join(', '), createdAt: now };
      if (enrolled) {   // TNC students: no payment, the papers are requested straight away
        const orderId = 'free_' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex') + uid.slice(0, 6);
        const writes = await online.createModuleRequests(projectId, sa, { ...order, orderId }, orderId, now);
        await fsCommit(projectId, sa, [{ path: `onlineOrders/${orderId}`, data: { ...order, orderId, fullAmountPaise: cart.amountInr * 100, status: 'paid', paidAt: now, confirmedVia: 'free' } }, ...writes]);
        return ok({ ok: true, free: true, orderId, requests: writes.map(w => w.data) });
      }
      if (!(amountPaise > 0)) return bad(400, 'Your cart is empty.');
      if (body.promoCode) {   // a 100% promo code: the order is placed at ₹0
        try {
          return await retryOnConflict(async () => {
            const check = await online.checkPromo(projectId, sa, body.promoCode, 'custom', uid, { chapters: cart.count, valueInr: amountPaise / 100 });
            if (check.error) return bad(400, check.error);
            const orderId = 'promo_' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex') + uid.slice(0, 6);
            const promoOrder = { ...order, orderId, amountPaise: 0, fullAmountPaise: amountPaise, promoCode: check.code };
            const writes = await online.createModuleRequests(projectId, sa, promoOrder, orderId, now);
            await fsCommit(projectId, sa, [
              ...online.promoWrites(check, uid, orderId, 'custom', { testName: order.testName, subject: order.subject, class: String(profile.class), studentName: profile.name || '', onlineId: profile.onlineId || '', valuePaise: amountPaise }, now),
              { path: `onlineOrders/${orderId}`, data: { ...promoOrder, status: 'paid', paidAt: now, confirmedVia: 'promo' } }, ...writes]);
            return ok({ ok: true, free: true, promo: check.code, orderId, requests: writes.map(w => w.data) });
          });
        } catch (e) {
          if (e.conflict) return bad(409, 'Lots of students are using this code right now. Please try again in a moment.');
          throw e;
        }
      }
      if (!online.paymentsReady()) return bad(503, 'Payments are being set up. Please try again in a little while.');
      const target = 'cart_' + crypto.createHash('sha256').update(JSON.stringify([profile.class, board, cart.items.slice().sort((a, b) => a.subject.localeCompare(b.subject))])).digest('hex');
      const orderId = await online.paymentOrder(projectId, sa, uid, target, amountPaise, async () => {
        const rz = await online.createRazorpayOrder(amountPaise, `mod_${Date.now().toString(36)}_${uid.slice(0, 8)}`, { uid, type: 'module', chapters: String(cart.count) });
        return { ...order, testId: target, orderId: rz.id, status: 'created' };
      });
      return ok({ orderId, amountPaise, currency: 'INR', keyId: process.env.RAZORPAY_KEY_ID, testName: order.testName,
        prefill: { name: profile.name || '', email: profile.email || email || '', contact: profile.phone || '' } });
    }

    if (body.action === 'create-order' || body.action === 'verify-payment') {
      if (!online.paymentsReady()) return bad(503, 'Payments are being set up. Please try again in a little while.');
    }

    if (body.action === 'create-order') {
      const testId = String(body.testId || '');
      if (!/^[A-Za-z0-9_-]{6,80}$/.test(testId)) return bad(400, 'Invalid test');
      if (!profile || !profile.profileComplete) return bad(403, 'Complete your profile first.');
      const testDoc = await fsGet(projectId, sa, `offlineTests/${testId}`);
      if (!testDoc) return bad(404, 'This test is no longer available.');
      const test = decFields(testDoc);
      if (test.series !== 'online') return bad(404, 'This test is not part of the online series.');
      if (test.isActive === false) return bad(409, 'This test is closed.');
      if (online.priceFor(test, enrolled) === 0) return bad(409, 'This test is free for you — just start it.');
      if (String(test.class) !== String(profile.class)) return bad(403, 'This test is for a different class.');
      if (test.board && test.board !== profile.board) return bad(403, 'This test is for a different board.');
      if (await fsGet(projectId, sa, `onlinePurchases/${testId}__${uid}`)) return bad(409, 'You have already unlocked this test.', { unlocked: true });
      const amountPaise = online.priceFor(test, enrolled) * 100;
      if (!(amountPaise > 0)) return bad(409, 'This test is free — just start it.');
      const orderId = await online.paymentOrder(projectId, sa, uid, testId, amountPaise, async () => {
        const order = await online.createRazorpayOrder(amountPaise, `ots_${Date.now().toString(36)}_${uid.slice(0, 8)}`, { uid, testId });
        return {
        orderId: order.id, uid, testId, amountPaise, currency: 'INR', status: 'created', createdAt: now,
        testName: test.testName || '', subject: test.subject || '', class: String(test.class || ''), kind: policy.kindOf(test),
        studentName: profile.name || '', onlineId: profile.onlineId || '', email: profile.email || email || '', phone: profile.phone || ''
        };
      });
      return ok({
        orderId, amountPaise, currency: 'INR', keyId: process.env.RAZORPAY_KEY_ID,
        testName: test.testName || '', prefill: { name: profile.name || '', email: profile.email || email || '', contact: profile.phone || '' }
      });
    }

    if (body.action === 'verify-payment') {
      const orderId = String(body.orderId || ''), paymentId = String(body.paymentId || ''), signature = String(body.signature || '');
      if (!/^order_[A-Za-z0-9]{6,40}$/.test(orderId) || !/^pay_[A-Za-z0-9]{6,40}$/.test(paymentId) || !/^[0-9a-f]{64}$/.test(signature)) return bad(400, 'Invalid payment details.');
      const orderDoc = await fsGet(projectId, sa, `onlineOrders/${orderId}`);
      if (!orderDoc || decFields(orderDoc).uid !== uid) return bad(404, 'Payment order not found.');
      if (!online.checkoutSignatureOk(orderId, paymentId, signature)) return bad(400, 'We could not confirm this payment. If money was deducted, it will be confirmed automatically or refunded.');
      const granted = await online.grantPurchase(projectId, sa, orderId, paymentId, 'checkout');
      return ok({ ok: true, testId: granted.testId || '', type: granted.type || 'test' });
    }

    return bad(400, 'Unknown action');
  } catch (e) {
    const msg = (e && e.message) || String(e);
    if (/Invalid Firebase ID token|Missing idToken|expired/i.test(msg)) return bad(401, 'Please sign in again.');
    if (e && e.status) return bad(e.status, msg);
    console.error('[online-series]', e);
    return bad(500, 'Something went wrong. Please try again.');
  }
};
