/**
 * ════════════════════════════════════════════════════
 *  Netlify Function: fetch-zoom-recording
 *  ────────────────────────────────────────────────
 *  Called by teacher-dashboard.html / admin-panel.html after a
 *  live class ends. Given a Zoom meetingId (the same one we
 *  saved to the liveClasses doc when the meeting was created),
 *  this function asks Zoom for the cloud recording's play_url
 *  and returns it to the browser, which then stores it on the
 *  same liveClasses doc as `recordingUrl`.
 *
 *  REQUIRED ENV VARS (already present from create-zoom-meeting):
 *    ZOOM_ACCOUNT_ID
 *    ZOOM_CLIENT_ID
 *    ZOOM_CLIENT_SECRET
 *    FIREBASE_API_KEY
 *    FIREBASE_PROJECT_ID
 *
 *  REQUIRED ZOOM APP SCOPES:
 *    recording:read:admin        (read cloud recording metadata)
 *    user:read:admin             (verify caller's account)
 *
 *  How Zoom cloud recording timing works:
 *    • A class ends → Zoom processes the recording in the background.
 *    • Processing takes anywhere from ~2 minutes (short class) to
 *      ~30 minutes (long class). During processing this endpoint
 *      returns 404 / "no recording yet". The dashboard surfaces
 *      that as "still processing — try again in a few minutes".
 * ════════════════════════════════════════════════════
 */
const https  = require('https');
const crypto = require('crypto');

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

function b64urlToBuf(s) {
  const pad = s.length % 4;
  if (pad) s += '='.repeat(4 - pad);
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
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
    throw new Error('Firebase ID token expired - please refresh the page and try again');
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

// ── 1. Verify caller is teacher or admin (same logic as create-zoom-meeting) ──
async function verifyTeacher(idToken) {
  const { uid } = await verifyFirebaseIdToken(idToken);
  const project = process.env.FIREBASE_PROJECT_ID;
  const docPath = (col) => `/v1/projects/${project}/databases/(default)/documents/${col}/${uid}`;
  const [tRes, aRes] = await Promise.all([
    request('firestore.googleapis.com', docPath('teachers'),
      'GET', { Authorization: `Bearer ${idToken}` }),
    request('firestore.googleapis.com', docPath('admins'),
      'GET', { Authorization: `Bearer ${idToken}` })
  ]);
  const isTeacher = tRes.status === 200 && tRes.body?.name;
  const isAdmin   = aRes.status === 200 && aRes.body?.name;
  if (!isTeacher && !isAdmin) {
    throw new Error('Only teachers or admins can fetch recordings');
  }
  return { uid, isTeacher, isAdmin };
}

// ── 2. Zoom OAuth (Server-to-Server) ──
async function getZoomAccessToken() {
  const creds = Buffer
    .from(`${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`)
    .toString('base64');
  const body = `grant_type=account_credentials&account_id=${encodeURIComponent(process.env.ZOOM_ACCOUNT_ID)}`;
  const r = await request(
    'zoom.us', '/oauth/token', 'POST',
    {
      'Authorization': `Basic ${creds}`,
      'Content-Type' : 'application/x-www-form-urlencoded'
    },
    body
  );
  if (r.status !== 200 || !r.body?.access_token) {
    throw new Error(`Zoom OAuth failed (${r.status}): ${JSON.stringify(r.body)}`);
  }
  return r.body.access_token;
}

// ── 3. Fetch recording metadata for the meeting ──
//
// Zoom returns a "recording_files" array, one entry per recording type
// (video MP4, audio M4A, chat, transcript). We pick the best playable
// video link — preferring `share_url` (the polished player Zoom hosts)
// over `play_url`, falling back to the raw MP4 download_url.
async function fetchMeetingRecording(accessToken, meetingId) {
  const r = await request(
    'api.zoom.us',
    `/v2/meetings/${encodeURIComponent(meetingId)}/recordings`,
    'GET',
    { 'Authorization': `Bearer ${accessToken}` }
  );
  if (r.status === 404) return null;          // not ready or no recording made
  if (r.status !== 200) {
    throw new Error(`Zoom recordings fetch failed (${r.status}): ${JSON.stringify(r.body)}`);
  }
  return r.body;
}

function pickBestPlayableUrl(recording) {
  if (!recording) return null;

  // 1. Prefer the meeting-level share_url — it's the polished Zoom player
  //    page that bundles video + audio + chat in one nice UI.
  const shareUrl = recording.share_url;
  const sharePwd = recording.password || '';

  // 2. Otherwise pick the largest video MP4 from recording_files. Zoom marks
  //    audio-only as M4A, transcripts as VTT, chat as CHAT etc., so filtering
  //    to MP4 is sufficient — we don't need to also gate on recording_type.
  let bestFile = null;
  for (const f of (recording.recording_files || [])) {
    if (f.status && f.status !== 'completed') continue;
    if (f.file_type !== 'MP4') continue;
    if (!bestFile || (f.file_size || 0) > (bestFile.file_size || 0)) bestFile = f;
  }

  if (shareUrl) {
    return { url: shareUrl, password: sharePwd, source: 'zoom_cloud' };
  }
  if (bestFile && (bestFile.play_url || bestFile.download_url)) {
    return {
      url     : bestFile.play_url || bestFile.download_url,
      password: sharePwd,
      source  : 'zoom_cloud'
    };
  }
  return null;
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

  const missing = ['ZOOM_ACCOUNT_ID','ZOOM_CLIENT_ID','ZOOM_CLIENT_SECRET','FIREBASE_PROJECT_ID']
    .filter(k => !process.env[k]);
  if (missing.length) {
    return bad(500, `Server is missing env vars: ${missing.join(', ')}`);
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return bad(400, 'Invalid JSON'); }

  const { idToken, meetingId } = body;
  if (!meetingId) return bad(400, 'Missing meetingId');

  try {
    await verifyTeacher(idToken);
    const zoomToken = await getZoomAccessToken();
    const rec       = await fetchMeetingRecording(zoomToken, meetingId);

    if (!rec) {
      return {
        statusCode: 202,
        headers   : CORS,
        body      : JSON.stringify({
          status : 'not_ready',
          message: 'Recording is still processing on Zoom. Try again in a few minutes.'
        })
      };
    }

    const picked = pickBestPlayableUrl(rec);
    if (!picked) {
      return {
        statusCode: 202,
        headers   : CORS,
        body      : JSON.stringify({
          status : 'no_video',
          message: 'Zoom returned recording metadata but no playable video file. The class may have been audio-only or the recording is still processing.'
        })
      };
    }

    return {
      statusCode: 200,
      headers   : CORS,
      body      : JSON.stringify({
        status        : 'ready',
        recordingUrl  : picked.url,
        recordingPassword: picked.password,
        recordingSource: picked.source,
        durationMin   : rec.duration || 0,
        startTime     : rec.start_time || ''
      })
    };
  } catch (e) {
    const msg = e && e.message || String(e);
    if (/Invalid Firebase ID token|Only teachers/i.test(msg)) return bad(401, msg);
    if (/Zoom OAuth failed/i.test(msg))                       return bad(502, msg);
    console.error('[fetch-zoom-recording]', e);
    return bad(500, msg);
  }
};
