/**
 * Netlify Function: join-room
 * Issues a time-gated Daily.co meeting token — API key never leaves the server.
 * Teacher always appears as "The NewTown Classes".
 */
const https = require('https');

function request(hostname, path, method, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method, headers }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const CORS = {
  'Access-Control-Allow-Origin' : '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { idToken, roomName, scheduledTs, durationMins, role } = JSON.parse(event.body || '{}');

    // 1. Verify Firebase ID token
    const verifyRes = await request(
      'identitytoolkit.googleapis.com',
      `/v1/accounts:lookup?key=${process.env.FIREBASE_API_KEY}`,
      'POST',
      { 'Content-Type': 'application/json' },
      { idToken }
    );
    if (verifyRes.status !== 200 || !verifyRes.body.users?.[0]) {
      return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorised' }) };
    }

    // 2. Time-gate check
    const now   = Date.now();
    const open  = scheduledTs - 5  * 60000;
    const close = scheduledTs + (durationMins + 30) * 60000;

    if (now < open) {
      const minsLeft = Math.ceil((open - now) / 60000);
      return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: `Class hasn't started yet. Opens in ${minsLeft} min.` }) };
    }
    if (now > close) {
      return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'This class has ended.' }) };
    }

    // 3. Issue Daily.co meeting token
    const isTeacher  = role === 'teacher';
    const expSeconds = Math.floor(close / 1000);

    const tokenRes = await request(
      'api.daily.co', '/v1/meeting-tokens', 'POST',
      { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.DAILY_API_KEY}` },
      {
        properties: {
          room_name       : roomName,
          exp             : expSeconds,
          is_owner        : isTeacher,
          user_name       : isTeacher ? 'The NewTown Classes' : 'Student',
          enable_recording: false
        }
      }
    );

    if (tokenRes.status !== 200) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Could not issue meeting token', detail: tokenRes.body }) };
    }

    return {
      statusCode: 200, headers: CORS,
      body: JSON.stringify({ token: tokenRes.body.token, domain: process.env.DAILY_DOMAIN, roomName, isTeacher })
    };

  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
