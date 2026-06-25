/**
 * ════════════════════════════════════════════════════
 *  Netlify Function: send-push
 *  ────────────────────────────────────────────────
 *  Admin-only. Sends a Web Push notification (Firebase Cloud Messaging) to
 *  enrolled students. The browser cannot do this safely — sending requires
 *  the service account, which lives only in Netlify env vars.
 *
 *  Called by admin-panel.html → "Notifications" tab.
 *
 *  Flow:
 *    1. Verify the caller's Firebase ID token + that they are an admin.
 *    2. Mint a service-account access token (scopes: firebase.messaging,
 *       datastore) from FIREBASE_SERVICE_ACCOUNT.
 *    3. Query the `pushTokens` collection for the target audience
 *       (all / a class / a subject).
 *    4. Send each token a DATA-ONLY FCM message (the service worker builds
 *       the visible notification — see firebase-messaging-sw.js).
 *    5. Delete tokens FCM reports as stale (UNREGISTERED / invalid).
 *
 *  REQUIRED ENV VARS (same ones the password function uses):
 *    FIREBASE_PROJECT_ID
 *    FIREBASE_SERVICE_ACCOUNT   (full service-account JSON)
 * ════════════════════════════════════════════════════
 */
const https  = require('https');
const crypto = require('crypto');

function request(hostname, path, method, headers, body) {
  return new Promise((resolve, reject) => {
    const payload = body
      ? (headers['Content-Type'] === 'application/x-www-form-urlencoded' ? body : JSON.stringify(body))
      : null;
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    const req = https.request({ hostname, path, method, headers }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        let parsed = d;
        try { parsed = JSON.parse(d); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const CORS = {
  'Access-Control-Allow-Origin' : '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type'                : 'application/json'
};
function bad(status, msg, extra) {
  return { statusCode: status, headers: CORS, body: JSON.stringify({ error: msg, ...(extra || {}) }) };
}
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBuf(s) {
  const pad = s.length % 4;
  if (pad) s += '='.repeat(4 - pad);
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

// ── Firebase ID token verification (self-contained, no deps) ──
let _kidCache = { keys: null, expiry: 0 };
async function fetchFirebasePublicKeys() {
  if (_kidCache.keys && Date.now() < _kidCache.expiry) return _kidCache.keys;
  const r = await request('www.googleapis.com',
    '/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com', 'GET', {});
  if (r.status !== 200 || !r.body || typeof r.body !== 'object') {
    throw new Error(`Could not fetch Firebase public keys (HTTP ${r.status})`);
  }
  let ttlMs = 3600 * 1000;
  const cc = r.headers && r.headers['cache-control'];
  if (cc) { const m = /max-age=(\d+)/i.exec(cc); if (m) ttlMs = Math.max(60000, parseInt(m[1], 10) * 1000); }
  _kidCache = { keys: r.body, expiry: Date.now() + ttlMs };
  return _kidCache.keys;
}
async function verifyFirebaseIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') throw new Error('Missing idToken');
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Invalid Firebase ID token (format)');
  let header, payload;
  try {
    header  = JSON.parse(b64urlToBuf(parts[0]).toString('utf8'));
    payload = JSON.parse(b64urlToBuf(parts[1]).toString('utf8'));
  } catch { throw new Error('Invalid Firebase ID token (decode failed)'); }
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('Server missing FIREBASE_PROJECT_ID');
  if (header.alg !== 'RS256') throw new Error('Invalid Firebase ID token (alg)');
  if (!header.kid)            throw new Error('Invalid Firebase ID token (kid)');
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) {
    throw new Error('Firebase ID token expired — please refresh the page and try again');
  }
  if (typeof payload.iat !== 'number' || payload.iat > now + 60) throw new Error('Invalid Firebase ID token (iat)');
  if (payload.aud !== projectId) throw new Error('Invalid Firebase ID token (wrong project)');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('Invalid Firebase ID token (iss)');
  if (!payload.sub || typeof payload.sub !== 'string') throw new Error('Invalid Firebase ID token (no subject)');
  const keys = await fetchFirebasePublicKeys();
  const cert = keys[header.kid];
  if (!cert) throw new Error('Invalid Firebase ID token (unknown signing key)');
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(parts[0] + '.' + parts[1]);
  if (!verifier.verify(cert, b64urlToBuf(parts[2]))) throw new Error('Invalid Firebase ID token (bad signature)');
  return { uid: payload.sub, email: payload.email || '' };
}
async function requireAdmin(idToken, uid) {
  const project = process.env.FIREBASE_PROJECT_ID;
  const r = await request('firestore.googleapis.com',
    `/v1/projects/${project}/databases/(default)/documents/admins/${uid}`,
    'GET', { Authorization: `Bearer ${idToken}` });
  const ok = r.status === 200 && r.body && r.body.fields
    && r.body.fields.isAdmin && r.body.fields.isAdmin.booleanValue === true;
  if (!ok) throw new Error('Only an admin can perform this action');
}

// ── Service-account access token, scoped for FCM send + Firestore read/delete ──
let _accessTokenCache = { token: null, expiry: 0 };
async function getServiceAccountAccessToken() {
  if (_accessTokenCache.token && Date.now() < _accessTokenCache.expiry) return _accessTokenCache.token;
  let sa;
  try { sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT); }
  catch { throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON'); }
  if (!sa.client_email || !sa.private_key) throw new Error('FIREBASE_SERVICE_ACCOUNT is missing client_email / private_key');
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim  = b64url(JSON.stringify({
    iss:   sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/datastore',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now, exp: now + 3600
  }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(header + '.' + claim);
  const assertion = `${header}.${claim}.${b64url(signer.sign(sa.private_key))}`;
  const body = 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') +
               '&assertion=' + encodeURIComponent(assertion);
  const r = await request('oauth2.googleapis.com', '/token', 'POST',
    { 'Content-Type': 'application/x-www-form-urlencoded' }, body);
  if (r.status !== 200 || !r.body || !r.body.access_token) {
    throw new Error(`Could not get service-account token (${r.status}): ${JSON.stringify(r.body)}`);
  }
  const ttl = (r.body.expires_in ? r.body.expires_in : 3600) * 1000;
  _accessTokenCache = { token: r.body.access_token, expiry: Date.now() + ttl - 60000 };
  return r.body.access_token;
}

// ── Fetch target push tokens from Firestore (by audience) ──
//  Returns [{ token, name }] where name is the full Firestore resource path
//  (used for stale-token cleanup).
async function fetchTargetTokens(accessToken, audience) {
  const project = process.env.FIREBASE_PROJECT_ID;
  const structuredQuery = { from: [{ collectionId: 'pushTokens' }] };
  if (audience && audience.type === 'class' && audience.value) {
    structuredQuery.where = { fieldFilter: { field: { fieldPath: 'class' }, op: 'EQUAL', value: { stringValue: String(audience.value) } } };
  } else if (audience && audience.type === 'subject' && audience.value) {
    structuredQuery.where = { fieldFilter: { field: { fieldPath: 'subjects' }, op: 'ARRAY_CONTAINS', value: { stringValue: String(audience.value) } } };
  } // 'all' → no filter
  const r = await request('firestore.googleapis.com',
    `/v1/projects/${project}/databases/(default)/documents:runQuery`, 'POST',
    { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    { structuredQuery });
  if (r.status !== 200) throw new Error(`Token lookup failed (${r.status}): ${JSON.stringify(r.body)}`);
  const out = [];
  (Array.isArray(r.body) ? r.body : []).forEach(row => {
    const doc = row && row.document;
    const tok = doc && doc.fields && doc.fields.token && doc.fields.token.stringValue;
    if (doc && tok) out.push({ token: tok, name: doc.name });
  });
  return out;
}

// ── Send one data-only FCM message. Returns 'ok' | 'stale' | 'error'. ──
async function sendOne(accessToken, projectId, token, data) {
  const r = await request('fcm.googleapis.com',
    `/v1/projects/${projectId}/messages:send`, 'POST',
    { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    { message: { token, data, webpush: { headers: { TTL: '86400' } } } });
  if (r.status === 200) return 'ok';
  // 404 / UNREGISTERED / INVALID_ARGUMENT → the token is dead, drop it.
  const status = (r.body && r.body.error && r.body.error.status) || '';
  if (r.status === 404 || status === 'NOT_FOUND' || status === 'UNREGISTERED' || status === 'INVALID_ARGUMENT') {
    return 'stale';
  }
  return 'error';
}

async function deleteToken(accessToken, resourceName) {
  // resourceName is the full path: projects/.../documents/pushTokens/<id>
  await request('firestore.googleapis.com', `/v1/${resourceName}`, 'DELETE',
    { Authorization: `Bearer ${accessToken}` }).catch(() => {});
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')    return bad(405, 'Method not allowed');

  const missing = ['FIREBASE_PROJECT_ID', 'FIREBASE_SERVICE_ACCOUNT'].filter(k => !process.env[k]);
  if (missing.length) return bad(500, `Server is missing env vars: ${missing.join(', ')}`);

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return bad(400, 'Invalid JSON'); }

  const { idToken, title, body: message, audience, url } = body;
  if (!title || !String(title).trim())   return bad(400, 'Title is required');
  if (!message || !String(message).trim()) return bad(400, 'Message is required');
  const aud = audience && audience.type ? audience : { type: 'all' };
  if (!['all', 'class', 'subject'].includes(aud.type)) return bad(400, 'Invalid audience');
  if ((aud.type === 'class' || aud.type === 'subject') && !aud.value) return bad(400, 'Audience value is required');

  try {
    const { uid } = await verifyFirebaseIdToken(idToken);
    await requireAdmin(idToken, uid);

    const projectId   = process.env.FIREBASE_PROJECT_ID;
    const accessToken = await getServiceAccountAccessToken();

    const targets = await fetchTargetTokens(accessToken, aud);
    if (!targets.length) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, sent: 0, failed: 0, cleaned: 0, recipients: 0 }) };
    }

    const data = {
      title: String(title).slice(0, 200),
      body:  String(message).slice(0, 1000),
      url:   (url && String(url)) || '/learn'
    };

    let sent = 0, failed = 0, cleaned = 0;
    // Modest concurrency keeps cold-start invocations well under the timeout.
    const BATCH = 20;
    for (let i = 0; i < targets.length; i += BATCH) {
      const slice = targets.slice(i, i + BATCH);
      const results = await Promise.all(slice.map(t => sendOne(accessToken, projectId, t.token, data)
        .then(r => ({ r, t })).catch(() => ({ r: 'error', t }))));
      for (const { r, t } of results) {
        if (r === 'ok') sent++;
        else if (r === 'stale') { failed++; cleaned++; await deleteToken(accessToken, t.name); }
        else failed++;
      }
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, sent, failed, cleaned, recipients: targets.length }) };
  } catch (e) {
    const msg = (e && e.message) || String(e);
    if (/Invalid Firebase ID token|Missing idToken|expired/i.test(msg)) return bad(401, msg);
    if (/Only an admin/i.test(msg)) return bad(403, msg);
    console.error('[send-push]', e);
    return bad(500, msg);
  }
};
