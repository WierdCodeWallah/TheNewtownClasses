/**
 * Netlify Function: create-room
 * Creates a private Daily.co room — API key never leaves the server.
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
    const { idToken, scheduledTs, durationMins } = JSON.parse(event.body || '{}');

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

    // 2. Create a private Daily.co room
    const expUnix  = Math.floor((scheduledTs + (durationMins + 30) * 60000) / 1000);
    const roomName = `ntc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const dailyRes = await request(
      'api.daily.co', '/v1/rooms', 'POST',
      { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.DAILY_API_KEY}` },
      {
        name    : roomName,
        privacy : 'private',
        properties: {
          exp               : expUnix,
          max_participants  : 200,
          enable_chat       : true,
          enable_screenshare: true,
          enable_knocking   : false,
          start_video_off   : false,
          start_audio_off   : false
        }
      }
    );

    if (dailyRes.status !== 200) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Failed to create room', detail: dailyRes.body }) };
    }

    return {
      statusCode: 200, headers: CORS,
      body: JSON.stringify({ roomName: dailyRes.body.name, expiry: expUnix })
    };

  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
