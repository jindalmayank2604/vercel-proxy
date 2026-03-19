/* ══════════════════════════════════════════════════════════════
   PROXY: /api/weather
   Open-Meteo weather data — free API, no key needed.
   Proxied here so the frontend never calls any external URL directly.

   Frontend sends:  POST { lat: number, lon: number, mode: "current"|"daily" }
   Returns:         Raw Open-Meteo JSON response

   No env vars required — Open-Meteo is completely free and open.
   ══════════════════════════════════════════════════════════════ */

const https = require('https');

/* ── CORS ── */
const cors = (res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

/* ── Simple HTTPS GET ── */
const get = (url) => new Promise((resolve, reject) => {
  https.get(url, (r) => {
    let d = '';
    r.on('data', c => d += c);
    r.on('end',  () => resolve({ status: r.statusCode, body: d }));
  }).on('error', reject);
});

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' });

  const { lat, lon, mode } = req.body || {};

  if (typeof lat !== 'number' || typeof lon !== 'number') {
    return res.status(400).json({ error: 'Body must contain { lat: number, lon: number }' });
  }

  /* Clamp coordinates */
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json({ error: 'Invalid coordinates' });
  }

  const latStr = lat.toFixed(4);
  const lonStr = lon.toFixed(4);

  try {
    let url;

    if (mode === 'daily') {
      /* Used by weatherGoal.js — fetches yesterday + today temps */
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yStr = yesterday.toISOString().slice(0, 10);
      const tStr = new Date().toISOString().slice(0, 10);

      url = `https://api.open-meteo.com/v1/forecast?` +
        `latitude=${latStr}&longitude=${lonStr}` +
        `&daily=temperature_2m_max,temperature_2m_min` +
        `&start_date=${yStr}&end_date=${tStr}` +
        `&timezone=auto`;
    } else {
      /* Default: current conditions — used by weather strip on home screen */
      url = `https://api.open-meteo.com/v1/forecast?` +
        `latitude=${latStr}&longitude=${lonStr}` +
        `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code` +
        `&temperature_unit=celsius&timezone=auto`;
    }

    const result = await get(url);

    if (result.status !== 200) {
      return res.status(502).json({ error: `Open-Meteo returned ${result.status}` });
    }

    /* Forward response directly */
    res.setHeader('Content-Type', 'application/json');
    /* Cache for 30 min at CDN level */
    res.setHeader('Cache-Control', 'public, max-age=1800');
    return res.status(200).send(result.body);

  } catch (err) {
    console.error('[/api/weather]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
