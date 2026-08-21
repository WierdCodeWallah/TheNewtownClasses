/**
 * ════════════════════════════════════════════════════
 *  Shared Google / Firebase helpers for Netlify functions
 *  ──────────────────────────────────────────────────
 *  - request()                    tiny JSON-aware HTTPS wrapper (no deps)
 *  - verifyFirebaseIdToken()      self-contained RS256 ID-token verification
 *  - getServiceAccountAccessToken()  OAuth token from FIREBASE_SERVICE_ACCOUNT
 *  - Firestore REST helpers (fsGet / fsPatch / fsRunQuery) using the SA token,
 *    which bypasses security rules — used for server-authoritative writes.
 *  - enc / dec                    JS <-> Firestore field-value converters
 *
 *  These mirror the logic already proven in ask-gemini.js and send-push.js.
 * ════════════════════════════════════════════════════
 */
const https  = require('https');
const crypto = require('crypto');

// ── Tiny JSON-aware HTTPS wrapper. No external deps so cold-start stays fast. ──
function request(hostname, path, method, headers, body) {
  return new Promise((resolve, reject) => {
    headers = headers || {};
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

// ── Fetch raw bytes from any https URL (e.g. an Uploadcare image). ──
function fetchBinary(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow one redirect (Uploadcare CDN sometimes 30x).
        return resolve(fetchBinary(res.headers.location));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`fetch ${url} -> ${res.statusCode}`)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: res.headers['content-type'] || 'image/jpeg' }));
    }).on('error', reject);
  });
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBuf(s) {
  const pad = s.length % 4;
  if (pad) s += '='.repeat(4 - pad);
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

// ────────────────────────────────────────────────
//  Firebase ID token verification (RS256, self-contained)
// ────────────────────────────────────────────────
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

async function verifyFirebaseIdToken(idToken, projectId) {
  if (!idToken || typeof idToken !== 'string') throw new Error('Missing idToken');
  if (!projectId) throw new Error('Server missing FIREBASE_PROJECT_ID');
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Invalid Firebase ID token (format)');
  let header, payload;
  try {
    header  = JSON.parse(b64urlToBuf(parts[0]).toString('utf8'));
    payload = JSON.parse(b64urlToBuf(parts[1]).toString('utf8'));
  } catch { throw new Error('Invalid Firebase ID token (decode failed)'); }

  if (header.alg !== 'RS256') throw new Error('Invalid Firebase ID token (alg)');
  if (!header.kid)            throw new Error('Invalid Firebase ID token (kid)');
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) throw new Error('Firebase ID token expired — please refresh and try again');
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

  const provider = (payload.firebase && payload.firebase.sign_in_provider) || '';
  return { uid: payload.sub, email: payload.email || '', provider };
}

// ────────────────────────────────────────────────
//  Service-account access token (scoped for Firestore)
// ────────────────────────────────────────────────
let _accessTokenCache = { token: null, expiry: 0 };
async function getServiceAccountAccessToken(scope) {
  if (_accessTokenCache.token && Date.now() < _accessTokenCache.expiry) return _accessTokenCache.token;
  let sa;
  try { sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT); }
  catch { throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON'); }
  if (!sa.client_email || !sa.private_key) throw new Error('FIREBASE_SERVICE_ACCOUNT is missing client_email / private_key');
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim  = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: scope || 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600
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

// ────────────────────────────────────────────────
//  Firestore REST helpers (service-account authenticated)
// ────────────────────────────────────────────────
function docPath(projectId, path) {
  return `/v1/projects/${projectId}/databases/(default)/documents/${path}`;
}
// GET one document. Returns { fields } | null (404).
async function fsGet(projectId, token, path) {
  const r = await request('firestore.googleapis.com', docPath(projectId, path), 'GET',
    { Authorization: `Bearer ${token}` });
  if (r.status === 404) return null;
  if (r.status !== 200) throw new Error(`Firestore GET ${path} -> ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body;
}
// PATCH (create/overwrite) a document from a plain JS object.
async function fsPatch(projectId, token, path, obj) {
  const r = await request('firestore.googleapis.com', docPath(projectId, path), 'PATCH',
    { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    { fields: enc(obj).mapValue.fields });
  if (r.status !== 200) throw new Error(`Firestore PATCH ${path} -> ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body;
}

// ── JS value -> Firestore Value ──
function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  if (typeof v === 'object') {
    const fields = {};
    for (const k of Object.keys(v)) fields[k] = enc(v[k]);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}
// ── Firestore Value -> JS value ──
function dec(val) {
  if (!val || typeof val !== 'object') return null;
  if ('nullValue' in val) return null;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return parseInt(val.integerValue, 10);
  if ('doubleValue' in val) return val.doubleValue;
  if ('stringValue' in val) return val.stringValue;
  if ('timestampValue' in val) return val.timestampValue;
  if ('arrayValue' in val) return (val.arrayValue.values || []).map(dec);
  if ('mapValue' in val) {
    const o = {}; const f = val.mapValue.fields || {};
    for (const k of Object.keys(f)) o[k] = dec(f[k]);
    return o;
  }
  return null;
}
// Decode a whole document's fields into a plain object.
function decFields(doc) {
  const out = {}; const f = (doc && doc.fields) || {};
  for (const k of Object.keys(f)) out[k] = dec(f[k]);
  return out;
}

module.exports = {
  request, fetchBinary, b64url, b64urlToBuf,
  verifyFirebaseIdToken, getServiceAccountAccessToken,
  fsGet, fsPatch, enc, dec, decFields
};
