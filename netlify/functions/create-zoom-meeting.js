/**
 * ════════════════════════════════════════════════════
 *  Netlify Function: create-zoom-meeting
 *  ────────────────────────────────────────────────
 *  Called by teacher-dashboard.html when a teacher presses
 *  "Schedule Class". Creates a scheduled Zoom meeting on the
 *  configured Zoom account via Server-to-Server OAuth and
 *  returns { joinUrl, meetingId, passcode } to the caller.
 *
 *  REQUIRED ENV VARS (set in Netlify → Site settings → Environment):
 *    ZOOM_ACCOUNT_ID     — from Zoom Marketplace → App Credentials
 *    ZOOM_CLIENT_ID      — from Zoom Marketplace → App Credentials
 *    ZOOM_CLIENT_SECRET  — from Zoom Marketplace → App Credentials
 *    FIREBASE_API_KEY    — same public apiKey as firebase-config.js
 *    FIREBASE_PROJECT_ID — your Firebase projectId
 *
 *  REQUIRED ZOOM APP SCOPES:
 *    meeting:write:admin     (Server-to-Server OAuth)
 *    user:read:admin         (to look up /users/me)
 *    recording:read:admin    (so fetch-zoom-recording can pull the play_url)
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

// ── 1. Verify the caller is a signed-in Firebase user AND a teacher/admin ──
async function verifyTeacher(idToken) {
  const { uid } = await verifyFirebaseIdToken(idToken);

  // 1b. Check /teachers/{uid} OR /admins/{uid} exists in Firestore. We call
  //     Firestore REST with the user's own ID token so the Firestore rules
  //     apply normally — no service-account key on the server.
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
    throw new Error('Only teachers or admins can create a Zoom class');
  }
  return { uid, isTeacher, isAdmin };
}

// ── 2. Get a short-lived Zoom access token (Server-to-Server OAuth) ──
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

// ── 3. Create the meeting ──
// Zoom expects a local ISO time + timezone. We accept an IST (Asia/Kolkata)
// epoch ms from the client (scheduledTs) and send "Asia/Kolkata" as the
// meeting timezone so Zoom presents it correctly to all participants.
function fmtLocalKolkata(epochMs) {
  const d = new Date(epochMs);
  // Get the Asia/Kolkata components using Intl.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).formatToParts(d).reduce((a, p) => (a[p.type] = p.value, a), {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

async function createZoomMeeting(accessToken, { topic, agenda, scheduledTs, durationMins }) {
  const meetingBody = {
    topic       : topic || 'NewTown Classes — Live Class',
    agenda      : agenda || '',
    type        : 2, // Scheduled meeting
    start_time  : fmtLocalKolkata(scheduledTs),
    timezone    : 'Asia/Kolkata',
    duration    : Math.min(Math.max(parseInt(durationMins || 60, 10), 15), 720),
    default_password: true,
    settings    : {
      // ── Single-seat Zoom Pro, multiple teachers teaching at once ──
      // With join_before_host = true, students can start the meeting
      // without the licensed host being present, so several classes can
      // run in parallel under the same Zoom account. jbh_time = 0 means
      // students can join at any time (not limited to 5/10/15 min before).
      waiting_room           : false,   // must be OFF for join-before-host
      join_before_host       : true,    // lets students start the room
      jbh_time               : 5,       // students can only join 5 min before start (0/5/10/15)
      mute_upon_entry        : true,    // safety: everyone muted on entry
      participant_video      : false,   // students' cams off by default
      host_video             : true,
      approval_type          : 2,       // No registration required
      audio                  : 'both',
      // Auto-record every class to Zoom Cloud so we can show it on the
      // student dashboard later. Requires the Zoom account to have Cloud
      // Recording enabled (Zoom Pro+ → Settings → Recording → Cloud recording ON).
      auto_recording         : 'cloud',
      meeting_authentication : false
    }
  };

  const r = await request(
    'api.zoom.us', '/v2/users/me/meetings', 'POST',
    {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type' : 'application/json'
    },
    meetingBody
  );
  if (r.status !== 201 && r.status !== 200) {
    throw new Error(`Zoom create meeting failed (${r.status}): ${JSON.stringify(r.body)}`);
  }
  return r.body;
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

  // Check env wiring up-front so errors are explicit.
  const missing = ['ZOOM_ACCOUNT_ID','ZOOM_CLIENT_ID','ZOOM_CLIENT_SECRET','FIREBASE_PROJECT_ID']
    .filter(k => !process.env[k]);
  if (missing.length) {
    return bad(500, `Server is missing env vars: ${missing.join(', ')}`);
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return bad(400, 'Invalid JSON'); }

  const { idToken, topic, agenda, scheduledTs, durationMins } = body;
  if (!scheduledTs || !durationMins) {
    return bad(400, 'Missing scheduledTs or durationMins');
  }

  try {
    // 1. AuthZ — signed-in teacher/admin only
    await verifyTeacher(idToken);

    // 2. Zoom OAuth
    const zoomToken = await getZoomAccessToken();

    // 3. Create meeting
    const meeting = await createZoomMeeting(zoomToken, { topic, agenda, scheduledTs, durationMins });

    return {
      statusCode: 200,
      headers   : CORS,
      body      : JSON.stringify({
        joinUrl  : meeting.join_url,
        meetingId: String(meeting.id || ''),
        passcode : meeting.password || '',
        startUrl : meeting.start_url || ''   // private — only returned to the teacher
      })
    };
  } catch (e) {
    // Map common user-fixable errors to 4xx so the frontend can show a helpful message.
    const msg = e && e.message || String(e);
    if (/Invalid Firebase ID token|Only teachers/i.test(msg)) return bad(401, msg);
    if (/Zoom OAuth failed/i.test(msg))                      return bad(502, msg);
    console.error('[create-zoom-meeting]', e);
    return bad(500, msg);
  }
};
