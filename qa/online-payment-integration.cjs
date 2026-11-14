/* Local Firestore integration for payment reservations and reconciliation.
   Start demo-online on 127.0.0.1:8189 with firestore.rules first.
   No external network, real payments, credentials, or production data. */
const assert = require('node:assert/strict');
const http = require('node:http'), https = require('node:https'), crypto = require('node:crypto');
https.request = (options, callback) => {
  assert.equal(options.hostname, 'firestore.googleapis.com');
  assert.ok(options.path.includes('/projects/demo-online/'));
  return http.request({ ...options, agent: undefined, hostname: '127.0.0.1', port: 8189 }, callback);
};
const google = require('../netlify/functions/_google');
let loseCommitResponse = false;
require.cache[require.resolve('../netlify/functions/_google')].exports = {
  ...google,
  async fsCommit(project, token, writes) {
    const result = await google.fsCommit(project, token, writes);
    if (loseCommitResponse && writes.some(w => w.path.startsWith('onlineOrders/'))) {
      loseCommitResponse = false; throw new Error('Simulated lost commit response');
    }
    return result;
  }
};
const online = require('../netlify/functions/_online');
const project = 'demo-online', auth = 'owner', uid = 'integration_' + Date.now();
let created = 0;
const create = target => async () => ({
  orderId: 'order_Integration' + Date.now() + (++created), uid, testId: target,
  amountPaise: 19900, currency: 'INR', status: 'created', createdAt: new Date().toISOString()
});
const read = async p => google.decFields(await google.fsGet(project, auth, p));
const reserve = target => online.paymentOrder(project, auth, uid, target, 19900, create(target));
(async () => {
  const ids = await Promise.all(Array.from({ length: 20 }, () => reserve('simultaneous')));
  assert.equal(new Set(ids).size, 1); assert.equal(created, 1);
  console.log('✓ real Firestore: 20 simultaneous order requests produce one order');

  const firstId = ids[0], secondId = 'order_Legacy' + Date.now();
  await google.fsPatch(project, auth, 'onlineOrders/' + secondId, { ...await read('onlineOrders/' + firstId), orderId: secondId });
  await Promise.all([online.grantPurchase(project, auth, firstId, 'pay_First', 'checkout'), online.grantPurchase(project, auth, secondId, 'pay_Second', 'webhook')]);
  const orders = await Promise.all([firstId, secondId].map(id => read('onlineOrders/' + id)));
  assert.ok(orders.every(o => o.status === 'paid' && o.paymentId));
  assert.equal(orders.filter(o => o.duplicate).length, 1);
  assert.ok(await google.fsGet(project, auth, `onlinePurchases/simultaneous__${uid}`));
  await assert.rejects(reserve('simultaneous'), e => e.status === 409);
  assert.equal(created, 1, 'a paid reservation cannot issue another checkout');
  console.log('✓ real Firestore: both racing payments recorded; exactly one duplicate flagged');

  loseCommitResponse = true;
  await assert.rejects(reserve('lostresponse'), /lost commit response/);
  const before = created;
  const recovered = await reserve('lostresponse');
  assert.equal(created, before); assert.equal((await read('onlineOrders/' + recovered)).status, 'created');
  console.log('✓ lost commit response: retry returns the saved order without creating another');

  const target = 'expiredlease';
  const key = crypto.createHash('sha256').update(JSON.stringify([uid, target, 19900])).digest('hex');
  const path = 'onlineOrderReservations/' + key;
  await google.fsPatch(project, auth, path, { uid, owner: 'crashed', leaseUntil: Date.now() - 1 });
  const replacement = await reserve(target);
  assert.equal((await read(path)).orderId, replacement);

  // An owner delayed past lease recovery must never return its old order.
  const staleTarget = 'staleowner';
  const staleKey = crypto.createHash('sha256').update(JSON.stringify([uid, staleTarget, 19900])).digest('hex');
  const stalePath = 'onlineOrderReservations/' + staleKey;
  let release, entered;
  const gate = new Promise(r => { release = r; }), started = new Promise(r => { entered = r; });
  const stale = online.paymentOrder(project, auth, uid, staleTarget, 19900, async () => { entered(); await gate; return create(staleTarget)(); });
  const rejection = assert.rejects(stale, e => e.conflict === true);
  await started;
  await google.fsPatch(project, auth, stalePath, { ...await read(stalePath), leaseUntil: Date.now() - 1 });
  const winner = await reserve(staleTarget);
  release(); await rejection;
  assert.equal((await read(stalePath)).orderId, winner);
  console.log('✓ lease recovery: expired owner replaced; late owner cannot overwrite or return another order');
})().catch(e => { console.error(e); process.exitCode = 1; });
