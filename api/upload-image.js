/* ══════════════════════════════════════════════════════════════
   PROXY: /api/upload-image
   Cloudinary profile photo upload — keeps API secret server-side.

   Frontend sends:  POST { image: "<base64>", userId: "uid" }
   Returns:         { url: "https://res.cloudinary.com/..." }

   VERCEL ENV VARS REQUIRED:
     CLOUDINARY_CLOUD_NAME
     CLOUDINARY_API_KEY
     CLOUDINARY_API_SECRET
   ══════════════════════════════════════════════════════════════ */

const cloudinary = require('cloudinary').v2;

/* ── CORS ── */
const cors = (res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' });

  /* Configure from env vars — never hardcoded */
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey    = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    return res.status(500).json({ error: 'Cloudinary env vars not set on server' });
  }

  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });

  const { image, userId } = req.body || {};
  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: 'Body must contain { image: "<base64>" }' });
  }

  /* ~2 MB guard */
  if (image.length > 2_800_000) {
    return res.status(413).json({ error: 'Image too large — max ~2 MB' });
  }

  try {
    const result = await cloudinary.uploader.upload(image, {
      folder        : `hydration-app/avatars/${userId || 'anon'}`,
      public_id     : 'avatar',
      overwrite     : true,
      resource_type : 'image',
      format        : 'webp',
      /* Square-crop 400×400, face-aware, compressed */
      transformation: [
        { width: 400, height: 400, crop: 'fill', gravity: 'face' },
        { quality: 'auto:good' },
      ],
    });

    /* Return only the CDN URL — nothing sensitive */
    return res.status(200).json({ url: result.secure_url });

  } catch (err) {
    console.error('[/api/upload-image]', err.message);
    return res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
};
