const crypto = require('crypto');

const FONNTE_TOKEN = "AL8bgF5kz57xq4Fge3jX";
const OTP_SECRET = "kmolichaat_whatsapp_2024";

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Nomor HP wajib diisi' });

  const cleaned = phone.replace(/[\s\-\+]/g, '');
  const normalized = cleaned.startsWith('0')
    ? '62' + cleaned.slice(1)
    : cleaned.startsWith('62') ? cleaned : '62' + cleaned;

  if (!/^62\d{8,13}$/.test(normalized)) {
    return res.status(400).json({ error: 'Format nomor tidak valid. Contoh: 08123456789' });
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiry = Date.now() + 5 * 60 * 1000;

  const message = `*KmoliChat* 💬\n\nKode OTP kamu: *${otp}*\n\nBerlaku 5 menit.\nJangan kasih tau siapapun!`;

  try {
    const response = await fetch('https://api.fonnte.com/send', {
      method: 'POST',
      headers: {
        'Authorization': FONNTE_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ target: normalized, message, countryCode: '62' })
    });

    const data = await response.json();
    if (!data.status) {
      return res.status(500).json({ error: 'Gagal kirim OTP: ' + (data.reason || 'Cek token Fonnte') });
    }

    const otpToken = crypto
      .createHmac('sha256', OTP_SECRET)
      .update(`${otp}:${normalized}:${expiry}`)
      .digest('hex');

    return res.status(200).json({ success: true, phone: normalized, otpToken, expiry });

  } catch (err) {
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
