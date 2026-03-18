# KmoliChat — WhatsApp-like Firebase Chat App

## 📁 Struktur File
```
chatapp/
├── public/
│   ├── index.html          ← Seluruh UI app
│   └── js/
│       ├── firebase-config.js  ← Konfigurasi Firebase (EDIT INI)
│       └── app.js              ← Seluruh logic aplikasi
├── vercel.json             ← Config deploy Vercel
├── firestore.rules         ← Security rules Firestore
├── storage.rules           ← Security rules Storage
└── README.md
```

---

## 🔥 Setup Firebase (WAJIB)

### 1. Buat Project Firebase
1. Buka https://console.firebase.google.com
2. Klik "Add project" → isi nama → Create
3. Matikan Google Analytics kalau tidak perlu

### 2. Aktifkan Authentication
1. Di Firebase Console → **Authentication** → Get Started
2. **Sign-in method** → Enable **Email/Password**

### 3. Buat Firestore Database
1. Di Firebase Console → **Firestore Database** → Create database
2. Pilih **Start in production mode** (rules sudah kita atur)
3. Pilih region terdekat (asia-southeast1 untuk Indonesia)

### 4. Aktifkan Firebase Storage
1. Di Firebase Console → **Storage** → Get started
2. Pilih **Start in production mode**
3. Pilih region yang sama

### 5. Daftarkan Web App
1. Di Firebase Console → Project Settings (⚙️) → **Your apps**
2. Klik icon **</>** (Web)
3. Isi nickname → Register app
4. **Copy firebaseConfig** yang tampil

### 6. Isi Config di Kode
Buka `public/js/firebase-config.js`, ganti semua field:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",           // ← ganti
  authDomain: "project.firebaseapp.com",  // ← ganti
  projectId: "your-project-id",  // ← ganti
  storageBucket: "project.appspot.com",   // ← ganti
  messagingSenderId: "123456789",  // ← ganti
  appId: "1:123:web:abc123"      // ← ganti
};
```

### 7. Pasang Firestore Security Rules
1. Firebase Console → **Firestore** → **Rules**
2. Copy-paste isi file `firestore.rules`
3. Klik **Publish**

### 8. Pasang Storage Security Rules
1. Firebase Console → **Storage** → **Rules**
2. Copy-paste isi file `storage.rules`
3. Klik **Publish**

---

## 🚀 Deploy ke Vercel

### Cara 1: Via GitHub (Recommended)

```bash
# 1. Push ke GitHub
git init
git add .
git commit -m "init kmolicheat"
git remote add origin https://github.com/username/kmolichaat.git
git push -u origin main

# 2. Buka vercel.com → Import Git Repository
# 3. Pilih repo → Deploy
# Selesai! Vercel auto-detect static files
```

### Cara 2: Via Vercel CLI

```bash
# Install CLI
npm i -g vercel

# Deploy dari folder chatapp/
vercel

# Follow prompts, pilih "No" untuk framework detection
```

---

## ✅ Fitur yang Tersedia

| Fitur | Status |
|-------|--------|
| Register & Login (Firebase Auth) | ✅ |
| DM / Chat Pribadi 1-on-1 | ✅ |
| Group Chat | ✅ |
| Buat Grup dengan nama, bio, avatar | ✅ |
| Link Invite untuk join grup | ✅ |
| Auto-join via URL invite | ✅ |
| Realtime chat (onSnapshot) | ✅ |
| Admin bisa edit nama/bio/avatar grup | ✅ |
| Admin bisa kick member | ✅ |
| User bisa keluar dari grup | ✅ |
| Cari user berdasarkan email (untuk DM) | ✅ |
| Upload avatar grup | ✅ |
| Security: DM private hanya 2 user | ✅ |
| Security: Grup hanya untuk member | ✅ |
| Security Rules Firestore | ✅ |

---

## 🔒 Keamanan Data

- **DM**: Hanya user yang ada di `participants` array yang bisa akses
- **Grup**: Hanya user yang ada di `members` array yang bisa akses
- **Pesan**: Validasi di backend (Firestore Rules) bukan hanya di frontend
- **Admin ops**: Validasi server-side bahwa requestor adalah admin

---

## ⚠️ Tips Production

1. **JANGAN** share `firebaseConfig` secara publik jika menggunakan fitur berbayar
2. Aktifkan **App Check** di Firebase untuk mencegah abuse
3. Set **Firestore usage limits** di billing untuk mengontrol biaya
4. Tambahkan **email verification** untuk keamanan lebih

---

## 🗂️ Struktur Database Firestore

```
users/{uid}
  - uid, name, email, avatar, createdAt

chats/{chatId}
  - participants: [uid1, uid2]
  - lastMessage, lastMessageAt, createdAt

messages/{msgId}
  - chat_id, sender_id, sender_name, text, timestamp

groups/{groupId}
  - name, bio, avatar, members[], admin, inviteCode
  - lastMessage, lastMessageAt, createdAt

group_messages/{msgId}
  - group_id, sender_id, sender_name, text, timestamp
```
