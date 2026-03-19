/* ══════════════════════════════════════════════════════════════
   PROXY: /api/analyze
   Nyckel beverage classifier — keeps client_secret server-side.

   Frontend sends:  POST { image: "<base64 jpeg>" }
   This sends it to Nyckel with the secret, returns { labelName, confidence }

   VERCEL ENV VARS REQUIRED:
     NYCKEL_CLIENT_ID
     NYCKEL_CLIENT_SECRET
     NYCKEL_FUNCTION_ID    (default: beverage-types)
   ══════════════════════════════════════════════════════════════ */

const https = require('https');

/* ── CORS ── */
const cors = (res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

/* ── Minimal HTTPS POST — no extra npm packages needed ── */
const post = (url, headers, body) => new Promise((resolve, reject) => {
  const u   = new URL(url);
  const req = https.request(
    { hostname: u.hostname, path: u.pathname, method: 'POST', headers },
    (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => resolve({ status: r.statusCode, body: d })); }
  );
  req.on('error', reject);
  req.write(body);
  req.end();
});

/* ── Token cache — survives across warm lambda invocations ── */
let _token = null, _tokenExp = 0;

const getToken = async () => {
  if (_token && Date.now() < _tokenExp - 10_000) return _token;

  const id     = process.env.NYCKEL_CLIENT_ID;
  const secret = process.env.NYCKEL_CLIENT_SECRET;
  if (!id || !secret) throw new Error('NYCKEL_CLIENT_ID / NYCKEL_CLIENT_SECRET env vars not set');

  const body = `grant_type=client_credentials&client_id=${id}&client_secret=${secret}`;
  const res  = await post(
    'https://www.nyckel.com/connect/token',
    { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    body
  );
  if (res.status !== 200) throw new Error(`Nyckel token failed (${res.status}): ${res.body.slice(0, 100)}`);

  const d    = JSON.parse(res.body);
  _token     = d.access_token;
  _tokenExp  = Date.now() + (d.expires_in ?? 3600) * 1000;
  return _token;
};

/* ── Handler ── */
module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' });

  const { image } = req.body || {};
  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: 'Body must contain { image: "<base64>" }' });
  }

  /* ~2 MB guard */
  if (image.length > 2_800_000) {
    return res.status(413).json({ error: 'Image too large — max ~2 MB' });
  }

  try {
    const token      = await getToken();
    const fnId       = process.env.NYCKEL_FUNCTION_ID || 'beverage-types';
    const payload    = JSON.stringify({ data: image });
    const nyckelRes  = await post(
      `https://www.nyckel.com/v1/functions/${fnId}/invoke`,
      {
        'Authorization' : `Bearer ${token}`,
        'Content-Type'  : 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      payload
    );

    if (nyckelRes.status !== 200) {
      return res.status(502).json({ error: `Nyckel returned ${nyckelRes.status}: ${nyckelRes.body.slice(0, 120)}` });
    }

    /* Forward Nyckel's response: { labelName, confidence } */
    return res.status(200).json(JSON.parse(nyckelRes.body));

  } catch (err) {
    console.error('[/api/analyze]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
