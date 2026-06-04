/**
 * ════════════════════════════════════════════════════
 *  Netlify Function: ask-gemini
 *  ────────────────────────────────────────────────
 *  Called by student-dashboard.html "Ask a Doubt" panel.
 *  Forwards a chat turn to Google Gemini and returns the
 *  model's reply. Keeps the API key server-side.
 *
 *  REQUIRED ENV VARS (set in Netlify → Site settings → Environment):
 *    GEMINI_API_KEY      — get one at https://aistudio.google.com/apikey
 *    FIREBASE_PROJECT_ID — your Firebase projectId
 *
 *  Auth model:
 *    Caller must send a valid Firebase ID token. We verify the
 *    token's RS256 signature locally against Firebase's public
 *    keys (no FIREBASE_API_KEY required, so HTTP-referrer-restricted
 *    keys don't break us).
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

// ────────────────────────────────────────────────
//  Firebase ID token verification (self-contained)
// ────────────────────────────────────────────────
//  We fetch Firebase's public x509 certs and verify the RS256
//  signature ourselves. No FIREBASE_API_KEY required, so HTTP-
//  referrer restrictions on your web API key don't cause this
//  endpoint to reject every request.
//
//  Cache the certs in memory for `max-age` seconds (the response
//  Cache-Control tells us how long they're valid). Cold starts
//  re-fetch — that's fine, the call is fast.
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

  // Honor the Cache-Control max-age if present, otherwise default to 1 hour.
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

  // Header checks
  if (header.alg !== 'RS256') throw new Error('Invalid Firebase ID token (alg)');
  if (!header.kid)            throw new Error('Invalid Firebase ID token (kid)');

  // Claim checks (Firebase ID token spec)
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

  // Signature check
  const keys = await fetchFirebasePublicKeys();
  const cert = keys[header.kid];
  if (!cert) throw new Error('Invalid Firebase ID token (unknown signing key)');

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(parts[0] + '.' + parts[1]);
  const ok = verifier.verify(cert, b64urlToBuf(parts[2]));
  if (!ok) throw new Error('Invalid Firebase ID token (bad signature)');

  return { uid: payload.sub, email: payload.email || '' };
}

// ────────────────────────────────────────────────
//  Build the chat history payload for Gemini
// ────────────────────────────────────────────────
// The frontend sends [{ role: 'user'|'model', text: '...' }, ...]
// Gemini expects [{ role: 'user'|'model', parts: [{ text }] }, ...]
// First turn must be from user. We trim to the last 12 turns to keep
// requests small and cheap.
function buildContents(history, currentQuestion) {
  const cleaned = [];
  if (Array.isArray(history)) {
    for (const turn of history) {
      if (!turn || typeof turn.text !== 'string') continue;
      const role = turn.role === 'model' ? 'model' : 'user';
      const text = turn.text.trim();
      if (!text) continue;
      cleaned.push({ role, parts: [{ text: text.slice(0, 4000) }] });
    }
  }
  // Drop a leading model turn if any (Gemini requires first = user).
  while (cleaned.length && cleaned[0].role !== 'user') cleaned.shift();
  // Cap history length.
  const MAX_TURNS = 12;
  const trimmed = cleaned.slice(-MAX_TURNS);
  // Append the current question as the final user turn.
  if (typeof currentQuestion === 'string' && currentQuestion.trim()) {
    trimmed.push({ role: 'user', parts: [{ text: currentQuestion.trim().slice(0, 4000) }] });
  }
  return trimmed;
}

// ────────────────────────────────────────────────
//  Call Gemini
// ────────────────────────────────────────────────
// Model names move around as Google deprecates and renames them. Try
// today's stable models in order of preference; cache whichever works
// first so subsequent calls skip straight to it.
const MODEL_FALLBACKS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-001',
  'gemini-1.5-flash-latest',
  'gemini-flash-latest'
];
let _workingModel = null;

async function callGemini(contents) {

  const systemInstruction = {
    parts: [{
      text:
        "You are the NewTown Classes academic doubt assistant — a friendly tutor for " +
        "students at The NewTown Classes (a coaching institute in India that prepares " +
        "students for ICSE/CBSE boards, JEE, and NEET). Students may ask about Physics, " +
        "Chemistry, Maths, Biology, or Computer Science. Reply in clear, step-by-step " +
        "form aimed at a school or class 11/12 student. Use simple language, show " +
        "derivations and worked steps where relevant, and use plain text for equations " +
        "(e.g. v = u + a*t). If the question is outside academics, politely decline and " +
        "suggest they ask a teacher. Do NOT mention the underlying model or who built " +
        "you — you are simply 'the NewTown Classes AI assistant'."
    }]
  };

  const requestBody = {
    contents,
    systemInstruction,
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 1024,
      topP: 0.95
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT',         threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH',        threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',  threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT',  threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
    ]
  };

  // Try the cached working model first, then walk through fallbacks.
  const order = _workingModel
    ? [_workingModel, ...MODEL_FALLBACKS.filter(m => m !== _workingModel)]
    : MODEL_FALLBACKS.slice();

  let lastError = null;
  for (const model of order) {
    const path = `/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const r = await request(
      'generativelanguage.googleapis.com', path, 'POST',
      { 'Content-Type': 'application/json' },
      requestBody
    );

    if (r.status === 200) {
      _workingModel = model; // remember for next call
      const cand = r.body?.candidates?.[0];
      const text = cand?.content?.parts?.map(p => p.text).filter(Boolean).join('\n').trim();
      if (!text) {
        if (cand?.finishReason === 'SAFETY') {
          return "I can't answer that one — please rephrase, or click \"Ask a Teacher\" below to get help from a real teacher.";
        }
        throw new Error('AI service returned an empty response');
      }
      return text;
    }

    // 404 = model not found / not supported on this endpoint. Try next.
    const errMsg = r.body?.error?.message || '';
    if (r.status === 404 || /not found|is not supported/i.test(errMsg)) {
      lastError = `Model ${model}: ${errMsg || 'not found'}`;
      continue;
    }

    // 429 = rate limit / quota — friendly message, don't retry.
    if (r.status === 429) {
      const retry = r.body?.error?.details?.find?.(d => d['@type']?.includes('RetryInfo'));
      const wait  = retry?.retryDelay ? ` Please try again in ${retry.retryDelay}.` : ' Please try again in a minute.';
      throw new Error(`The AI assistant is taking a quick break (high demand right now).${wait} If this keeps happening, click "Ask a teacher" below.`);
    }

    // Any other error — bail out, don't try more models.
    throw new Error(`AI service error (${r.status}): ${errMsg || JSON.stringify(r.body)}`);
  }

  throw new Error(`AI service error (404): no available model. Last: ${lastError}`);
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

  const missing = ['GEMINI_API_KEY', 'FIREBASE_PROJECT_ID']
    .filter(k => !process.env[k]);
  if (missing.length) {
    return bad(500, `Server is missing env vars: ${missing.join(', ')}`);
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return bad(400, 'Invalid JSON'); }

  const { idToken, question, history } = body;
  if (!question || typeof question !== 'string' || !question.trim()) {
    return bad(400, 'Missing question');
  }
  if (question.length > 4000) {
    return bad(400, 'Question is too long (max 4000 characters)');
  }

  try {
    await verifyFirebaseIdToken(idToken);
    const contents = buildContents(history, question);
    if (!contents.length) return bad(400, 'No conversation content to send');
    const answer = await callGemini(contents);
    return {
      statusCode: 200,
      headers   : CORS,
      body      : JSON.stringify({ answer })
    };
  } catch (e) {
    const msg = e && e.message || String(e);
    if (/Invalid Firebase ID token|Missing idToken|Firebase ID token expired/i.test(msg)) return bad(401, msg);
    if (/taking a quick break/i.test(msg))                                                 return bad(429, msg);
    if (/AI service error/i.test(msg))                                                    return bad(502, msg);
    console.error('[ask-gemini]', e);
    return bad(500, msg);
  }
};
