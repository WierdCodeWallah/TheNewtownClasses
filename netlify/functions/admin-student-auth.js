/**
 * ════════════════════════════════════════════════════
 *  Netlify Function: admin-student-auth
 *  ────────────────────────────────────────────────
 *  Admin-only Firebase Auth operations that the browser cannot do safely:
 *    • setPassword — reset a student's password WITHOUT ever storing the
 *                    password anywhere (replaces the old flow that kept a
 *                    plaintext copy in students/{uid}.password).
 *    • delete      — delete a student's Auth account (the old client-side
 *                    accounts:delete call silently failed, leaving orphaned
 *                    Auth users that blocked re-creating the same Student ID).
 *
 *  Called by admin-panel.html (resetPassword / deleteStudent).
 *
 *  REQUIRED ENV VARS (set in Netlify → Site settings → Environment):
 *    FIREBASE_PROJECT_ID      — your Firebase projectId
 *    FIREBASE_SERVICE_ACCOUNT — the FULL service-account JSON, pasted as a
 *                               single value. Get it from:
 *                               Firebase Console → Project settings →
 *                               Service accounts → Generate new private key.
 *                               (Keep this secret — it never touches the
 *                                browser; it lives only in Netlify env.)
 *
 *  Auth model:
 *    1. Caller sends their Firebase ID token. We verify the RS256 signature
 *       locally against Firebase's public keys (no API key needed).
 *    2. We confirm the caller is an admin (admins/{uid}.isAdmin == true),
 *       reading admins/{uid} with the caller's own token so the Firestore
 *       rules apply normally.
 *    3. Only then do we mint a short-lived service-account access token and
 *       perform the privileged operation.
 * ════════════════════════════════════════════════════
 */
const https  = require('https');
const crypto = require('crypto');

// ── Tiny JSON-aware HTTPS wrapper. No external deps so cold-start stays fast. ──
function request(hostname, path, method, headers, body) {
  return new Promise((resolve, reject) => {
    const payload = body
      ? (headers['Content-Type'] === 'application/x-www-form-urlencoded'
          ? body
          : JSON.stringify(body))
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
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBuf(s) {
  const pad = s.length % 4;
  if (pad) s += '='.repeat(4 - pad);
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

// ────────────────────────────────────────────────
//  Firebase ID token verification (self-contained)
// ────────────────────────────────────────────────
let _kidCache = { keys: null, expiry: 0 };

async function fetchFirebasePublicKeys() {
  if (_kidCache.keys && Date.now() < _kidCache.expiry) return _kidCache.keys;

  const r = await request(
    'www.googleapis.com',
    '/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com',
    'GET',
    {}
  );
  if (r.status !== 200 || !r.body || typeof r.body !== 'object') {
    throw new Error(`Could not fetch Firebase public keys (HTTP ${r.status})`);
  }

  let ttlMs = 3600 * 1000;
  const cc = r.headers && r.headers['cache-control'];
  if (cc) {
    const m = /max-age=(\d+)/i.exec(cc);
    if (m) ttlMs = Math.max(60 * 1000, parseInt(m[1], 10) * 1000);
  }
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
  } catch {
    throw new Error('Invalid Firebase ID token (decode failed)');
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('Server missing FIREBASE_PROJECT_ID');

  if (header.alg !== 'RS256') throw new Error('Invalid Firebase ID token (alg)');
  if (!header.kid)            throw new Error('Invalid Firebase ID token (kid)');

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) {
    throw new Error('Firebase ID token expired — please refresh the page and try again');
  }
  if (typeof payload.iat !== 'number' || payload.iat > now + 60) {
    throw new Error('Invalid Firebase ID token (iat)');
  }
  if (payload.aud !== projectId) {
    throw new Error('Invalid Firebase ID token (wrong project)');
  }
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error('Invalid Firebase ID token (iss)');
  }
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('Invalid Firebase ID token (no subject)');
  }

  const keys = await fetchFirebasePublicKeys();
  const cert = keys[header.kid];
  if (!cert) throw new Error('Invalid Firebase ID token (unknown signing key)');

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(parts[0] + '.' + parts[1]);
  const ok = verifier.verify(cert, b64urlToBuf(parts[2]));
  if (!ok) throw new Error('Invalid Firebase ID token (bad signature)');

  return { uid: payload.sub, email: payload.email || '' };
}

// ── Confirm the caller is an admin (reads admins/{uid} with their own token) ──
async function requireAdmin(idToken, uid) {
  const project = process.env.FIREBASE_PROJECT_ID;
  const r = await request(
    'firestore.googleapis.com',
    `/v1/projects/${project}/databases/(default)/documents/admins/${uid}`,
    'GET', { Authorization: `Bearer ${idToken}` }
  );
  const ok = r.status === 200
    && r.body && r.body.fields
    && r.body.fields.isAdmin && r.body.fields.isAdmin.booleanValue === true;
  if (!ok) throw new Error('Only an admin can perform this action');
}

// ────────────────────────────────────────────────
//  Service-account OAuth2 access token (for Admin API)
// ────────────────────────────────────────────────
//  We sign a JWT with the service-account private key and exchange it for a
//  short-lived access token scoped to Identity Toolkit. No external deps.
let _accessTokenCache = { token: null, expiry: 0 };

async function getServiceAccountAccessToken() {
  if (_accessTokenCache.token && Date.now() < _accessTokenCache.expiry) {
    return _accessTokenCache.token;
  }

  let sa;
  try {
    sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON');
  }
  if (!sa.client_email || !sa.private_key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is missing client_email / private_key');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim  = b64url(JSON.stringify({
    iss:   sa.client_email,
    scope: 'https://www.googleapis.com/auth/identitytoolkit',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600
  }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(header + '.' + claim);
  const signature = b64url(signer.sign(sa.private_key));
  const assertion = `${header}.${claim}.${signature}`;

  const body =
    'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') +
    '&assertion=' + encodeURIComponent(assertion);

  const r = await request(
    'oauth2.googleapis.com', '/token', 'POST',
    { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  );
  if (r.status !== 200 || !r.body || !r.body.access_token) {
    throw new Error(`Could not get service-account token (${r.status}): ${JSON.stringify(r.body)}`);
  }
  // Cache for slightly less than the real lifetime.
  const ttl = (r.body.expires_in ? r.body.expires_in : 3600) * 1000;
  _accessTokenCache = { token: r.body.access_token, expiry: Date.now() + ttl - 60000 };
  return r.body.access_token;
}

// Same mapping the admin panel uses: Student ID → internal email.
function toEmail(sid) {
  return String(sid || '').trim().toLowerCase().replace(/\s+/g, '') + '@ntcportal.local';
}

// ── Look up a user's localId (uid) by email, via the Admin lookup endpoint ──
async function lookupUidByEmail(accessToken, email) {
  const project = process.env.FIREBASE_PROJECT_ID;
  const r = await request(
    'identitytoolkit.googleapis.com',
    `/v1/projects/${project}/accounts:lookup`, 'POST',
    { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    { email: [email] }
  );
  const uid = r.body && r.body.users && r.body.users[0] && r.body.users[0].localId;
  if (!uid) throw new Error('No account found for that Student ID');
  return uid;
}

async function adminSetPassword(accessToken, localId, password) {
  const project = process.env.FIREBASE_PROJECT_ID;
  const r = await request(
    'identitytoolkit.googleapis.com',
    `/v1/projects/${project}/accounts:update`, 'POST',
    { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    { localId, password }
  );
  if (r.status !== 200) {
    throw new Error(`Password update failed (${r.status}): ${JSON.stringify(r.body)}`);
  }
}

async function adminDeleteUser(accessToken, localId) {
  const project = process.env.FIREBASE_PROJECT_ID;
  const r = await request(
    'identitytoolkit.googleapis.com',
    `/v1/projects/${project}/accounts:delete`, 'POST',
    { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    { localId }
  );
  // A delete of a non-existent user also returns 200; that's fine (idempotent).
  if (r.status !== 200) {
    throw new Error(`Account delete failed (${r.status}): ${JSON.stringify(r.body)}`);
  }
}

// ════════════════════════════════════════════════════
//  Handler
// ════════════════════════════════════════════════════
exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return bad(405, 'Method not allowed');
  }

  const missing = ['FIREBASE_PROJECT_ID', 'FIREBASE_SERVICE_ACCOUNT']
    .filter(k => !process.env[k]);
  if (missing.length) {
    return bad(500, `Server is missing env vars: ${missing.join(', ')}`);
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return bad(400, 'Invalid JSON'); }

  const { idToken, action, studentId, uid: targetUidIn, newPassword } = body;
  if (!action || !['setPassword', 'delete'].includes(action)) {
    return bad(400, 'Missing or invalid action');
  }
  if (action === 'setPassword' && (!newPassword || String(newPassword).length < 6)) {
    return bad(400, 'New password must be at least 6 characters');
  }

  try {
    // 1. AuthN + AuthZ — must be a signed-in admin.
    const { uid } = await verifyFirebaseIdToken(idToken);
    await requireAdmin(idToken, uid);

    // 2. Privileged service-account token.
    const accessToken = await getServiceAccountAccessToken();

    // 3. Resolve the target account (by uid if given, else by Student ID).
    let targetUid = targetUidIn;
    if (!targetUid) {
      if (!studentId) return bad(400, 'Provide a Student ID or uid');
      targetUid = await lookupUidByEmail(accessToken, toEmail(studentId));
    }

    // 4. Do the thing.
    if (action === 'setPassword') {
      await adminSetPassword(accessToken, targetUid, String(newPassword));
    } else {
      await adminDeleteUser(accessToken, targetUid);
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, uid: targetUid }) };
  } catch (e) {
    const msg = (e && e.message) || String(e);
    if (/Invalid Firebase ID token|Missing idToken|expired/i.test(msg)) return bad(401, msg);
    if (/Only an admin/i.test(msg))                                     return bad(403, msg);
    if (/No account found/i.test(msg))                                  return bad(404, msg);
    console.error('[admin-student-auth]', e);
    return bad(500, msg);
  }
};
