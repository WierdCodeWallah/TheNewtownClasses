/**
 * Netlify Function: razorpay-webhook
 * ──────────────────────────────────
 * Razorpay calls this when a payment succeeds, so a test is unlocked even if
 * the student's phone closed the page before the checkout handler ran.
 *
 * Razorpay Dashboard → Settings → Webhooks → Add:
 *   URL     https://<your-site>/.netlify/functions/razorpay-webhook
 *   Secret  any long random string (also saved as RAZORPAY_WEBHOOK_SECRET)
 *   Events  payment.captured, order.paid
 */
const { getServiceAccountAccessToken, fsGet, decFields } = require('./_google');
const online = require('./_online');

const reply = (statusCode, obj) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });
  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_SERVICE_ACCOUNT || !process.env.RAZORPAY_WEBHOOK_SECRET) return reply(500, { error: 'Not configured' });
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  if (!online.webhookSignatureOk(raw, headers['x-razorpay-signature'])) return reply(401, { error: 'Bad signature' });

  let payload;
  try { payload = JSON.parse(raw); } catch { return reply(400, { error: 'Invalid JSON' }); }
  if (!['payment.captured', 'order.paid'].includes(payload.event)) return reply(200, { ignored: payload.event || '' });
  const payment = payload.payload && payload.payload.payment && payload.payload.payment.entity;
  if (!payment || !payment.order_id || !payment.id) return reply(200, { ignored: 'no payment' });
  if (payment.status && payment.status !== 'captured') return reply(200, { ignored: 'not captured' });

  try {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const sa = await getServiceAccountAccessToken();
    const orderDoc = await fsGet(projectId, sa, `onlineOrders/${payment.order_id}`);
    if (!orderDoc) return reply(200, { ignored: 'unknown order' });   // not one of ours
    const order = decFields(orderDoc);
    if (Number(payment.amount) !== Number(order.amountPaise) || (payment.currency && payment.currency !== 'INR')) {
      console.error('[razorpay-webhook] amount mismatch', payment.order_id, payment.amount, order.amountPaise);
      return reply(200, { ignored: 'amount mismatch' });
    }
    await online.grantPurchase(projectId, sa, payment.order_id, payment.id, 'webhook');
    return reply(200, { ok: true });
  } catch (e) {
    console.error('[razorpay-webhook]', e);
    return reply(500, { error: 'Retry later' });   // Razorpay retries failed deliveries
  }
};
