const crypto = require('crypto');

const OTP_SECRET = "kmolichaat_whatsapp_2024";
const FIREBASE_API_KEY = "AIzaSyDlNKPFyaDiwuWcoYoc9QghiTuvxuWwnUc";
const FIREBASE_PROJECT_ID = "whatsapp-kmoli";

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { phone, otp, otpToken, expiry } = req.body;
  if (!phone || !otp || !otpToken || !expiry) {
    return res.status(400).json({ error: 'Data tidak lengkap' });
  }

  if (Date.now() > expiry) {
    return res.status(400).json({ error: 'OTP sudah expired, minta ulang' });
  }

  const expected = crypto
    .createHmac('sha256', OTP_SECRET)
    .update(`${otp}:${phone}:${expiry}`)
    .digest('hex');

  if (expected !== otpToken) {
    return res.status(400).json({ error: 'OTP salah' });
  }

  try {
    // Sign in anonymous Firebase untuk dapat uid
    const signInRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnSecureToken: true })
      }
    );
    const signInData = await signInRes.json();

    if (!signInData.idToken) {
      return res.status(500).json({ error: 'Gagal buat session Firebase' });
    }

    const uid = signInData.localId;
    const idToken = signInData.idToken;
    const refreshToken = signInData.refreshToken;

    // Cek apakah sudah ada user dengan nomor ini di Firestore
    const queryUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`;
    const queryRes = await fetch(queryUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'users' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'phone' },
              op: 'EQUAL',
              value: { stringValue: phone }
            }
          },
          limit: 1
        }
      })
    });

    const queryData = await queryRes.json();
    const existingDoc = queryData[0]?.document;

    let finalUid = uid;
    let isNewUser = true;

    if (existingDoc) {
      finalUid = existingDoc.name.split('/').pop();
      isNewUser = false;
    } else {
      // Simpan user baru
      const userUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${uid}`;
      await fetch(userUrl, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          fields: {
            uid: { stringValue: uid },
            phone: { stringValue: phone },
            name: { stringValue: phone },
            avatar: { stringValue: '' },
            createdAt: { timestampValue: new Date().toISOString() }
          }
        })
      });
    }

    return res.status(200).json({
      success: true,
      uid: finalUid,
      phone,
      idToken,
      refreshToken,
      isNewUser
    });

  } catch (err) {
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
