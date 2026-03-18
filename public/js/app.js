import { auth, db, provider } from "./firebase-config.js";
import { signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, setDoc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, onSnapshot, serverTimestamp, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ===================== STATE =====================
let currentUser = null;
let currentChat = null;
let unsubMessages = null;
let unsubChats = null;
let chatList = [];
let currentTab = 'all';
let currentGroupId = null;
let longPressTimer = null;

// ===================== MOBILE =====================
function isMobile() { return window.innerWidth <= 768; }

function showChatMobile() {
  document.getElementById('sidebar').classList.add('hidden');
  const ca = document.getElementById('chat-area');
  ca.classList.add('mobile-active');
  ca.style.display = 'flex';
  hideBottomNav();
  setTimeout(() => {
    const mc = document.getElementById('messages-container');
    if (mc) mc.scrollTop = mc.scrollHeight;
  }, 100);
}

window.showSidebarMobile = function() {
  document.getElementById('sidebar').classList.remove('hidden');
  const ca = document.getElementById('chat-area');
  ca.classList.remove('mobile-active');
  ca.style.display = '';
  showBottomNav();
  clearRoute();
};

// ===================== ROUTER =====================
function setRoute(path) { window.location.hash = path; }
function clearRoute() { window.location.hash = ''; }

async function handleRoute() {
  if (!currentUser) return;
  const hash = window.location.hash;
  if (!hash || hash === '#' || hash === '#/') return;
  const parts = hash.replace('#/', '').split('/');
  const [type, id] = parts;
  if (type === 'join' && id) {
    document.getElementById('join-code-input').value = id;
    openModal('modal-join-group');
  } else if (type === 'group-settings' && id) {
    await openGroupSettings(id);
  } else if ((type === 'dm' || type === 'group') && id) {
    await openChat(type, id);
  }
}
window.addEventListener('hashchange', handleRoute);

// ===================== AUTH =====================
window.doLoginGoogle = async () => {
  const btn = document.getElementById('login-google-btn');
  btn.disabled = true; btn.textContent = 'Menghubungkan...';
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    btn.disabled = false; btn.textContent = '🔑 Masuk dengan Google';
    if (e.code !== 'auth/popup-closed-by-user') {
      const el = document.getElementById('auth-error');
      el.textContent = 'Gagal login: ' + e.message;
      el.style.display = 'block';
    }
  }
};

window.doLogout = async () => {
  if (unsubMessages) unsubMessages();
  if (unsubChats) unsubChats();
  clearRoute();
  await signOut(auth);
};

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    // Cek apakah sudah punya userCode
    const existingSnap = await getDoc(doc(db, 'users', user.uid));
    const existingCode = existingSnap.exists() ? existingSnap.data().userCode : null;
    await setDoc(doc(db, 'users', user.uid), {
      uid: user.uid, name: user.displayName || 'User',
      email: user.email, avatar: user.photoURL || '',
      userCode: existingCode || generateCode(8), // kode unik 8 karakter
      updatedAt: serverTimestamp()
    }, { merge: true });
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app-screen').classList.add('active');
    document.getElementById('my-name').textContent = user.displayName || 'User';
    document.getElementById('my-email').textContent = user.email;
    // Ambil avatar dari Firestore
    const myAvSnap = await getDoc(doc(db, 'users', user.uid));
    const myAvatar = myAvSnap.exists() ? myAvSnap.data().avatar : '';
    const myAvEl = document.getElementById('my-avatar');
    if (myAvatar) {
      myAvEl.innerHTML = `<img src="${myAvatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    } else {
      myAvEl.textContent = (user.displayName || 'U')[0].toUpperCase();
    }
    loadChatList();
    setTimeout(handleRoute, 800);
  } else {
    currentUser = null;
    document.getElementById('auth-screen').style.display = 'flex';
    document.getElementById('app-screen').classList.remove('active');
    document.getElementById('chat-list').innerHTML = '<div class="loading-dots">Memuat chat...</div>';
    if (unsubChats) { unsubChats(); unsubChats = null; }
    if (unsubMessages) { unsubMessages(); unsubMessages = null; }
  }
});

// ===================== CHAT LIST =====================
function loadChatList() {
  if (unsubChats) unsubChats();
  const dmQ = query(collection(db, 'chats'), where('participants', 'array-contains', currentUser.uid));
  const grQ = query(collection(db, 'groups'), where('members', 'array-contains', currentUser.uid));
  let dms = [], groups = [];

  const renderAll = () => {
    chatList = [
      ...dms.map(d => ({ ...d, _type: 'dm' })),
      ...groups.map(g => ({ ...g, _type: 'group' }))
    ].sort((a, b) => (b.lastMessageAt?.seconds||0) - (a.lastMessageAt?.seconds||0));
    renderChatList();
  };

  const u1 = onSnapshot(dmQ, async (snap) => {
    dms = await Promise.all(snap.docs.map(async d => {
      const data = d.data();
      const otherId = data.participants.find(p => p !== currentUser.uid);
      let otherUser = null;
      if (otherId) {
        // getDoc selalu ambil fresh dari server
        const s = await getDoc(doc(db, 'users', otherId));
        if (s.exists()) otherUser = s.data();
      }
      return { id: d.id, ...data, _otherUser: otherUser };
    }));
    renderAll();
  });

  const u2 = onSnapshot(grQ, (snap) => {
    groups = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAll();
  });

  // Listen ke perubahan user lain yang ada di DM — refresh avatar otomatis
  const userListeners = {};
  const watchUserAvatars = (userIds) => {
    userIds.forEach(uid => {
      if (userListeners[uid] || uid === currentUser.uid) return;
      userListeners[uid] = onSnapshot(doc(db, 'users', uid), (snap) => {
        if (!snap.exists()) return;
        const userData = snap.data();
        // Update _otherUser di dms array
        dms = dms.map(d => {
          if (d._otherUser?.uid === uid) {
            return { ...d, _otherUser: { ...d._otherUser, ...userData } };
          }
          return d;
        });
        renderAll();
      });
    });
  };

  // Override renderAll untuk juga watch user avatars
  const _origRenderAll = renderAll;

  unsubChats = () => {
    u1(); u2();
    Object.values(userListeners).forEach(unsub => unsub());
  };

  // Watch avatars setelah DMs pertama kali loaded — dengan delay kecil
  const watchInterval = setInterval(() => {
    const otherIds = dms.map(d => d._otherUser?.uid).filter(Boolean);
    if (otherIds.length > 0) {
      watchUserAvatars(otherIds);
      clearInterval(watchInterval);
    }
  }, 1000);
}

function renderChatList() {
  const container = document.getElementById('chat-list');
  const search = document.getElementById('search-input').value.toLowerCase();
  let filtered = chatList.filter(c => {
    if (currentTab === 'dm' && c._type !== 'dm') return false;
    if (currentTab === 'group' && c._type !== 'group') return false;
    if (search) {
      const name = c._type === 'dm' ? (c._otherUser?.name||'') : (c.name||'');
      return name.toLowerCase().includes(search);
    }
    return true;
  });
  if (!filtered.length) { container.innerHTML = '<div class="loading-dots">Belum ada chat</div>'; return; }
  container.innerHTML = filtered.map(c => {
    const isDM = c._type === 'dm';
    const name = isDM ? (c._otherUser?.name||'User') : c.name;
    const initial = (name||'?')[0].toUpperCase();
    const avatarUrl = isDM ? (c._otherUser?.avatar||'') : (c.avatar||'');
    const avatarHtml = avatarUrl
      ? `<img src="${avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
      : initial;
    const lastMsg = c.lastMessage ? escHtml(c.lastMessage.substring(0,40)) : 'Belum ada pesan';
    const time = c.lastMessageAt ? formatTime(c.lastMessageAt.toDate()) : '';
    const isActive = currentChat?.id === c.id ? 'active' : '';
    return `<div class="chat-item ${isActive}" onclick="openChat('${c._type}','${c.id}')">
      <div class="chat-avatar" style="overflow:hidden">${avatarHtml}</div>
      <div class="chat-info">
        <div class="chat-name">${escHtml(name)}</div>
        <div class="chat-last">${lastMsg}</div>
      </div>
      <div class="chat-meta"><div class="chat-time">${time}</div></div>
    </div>`;
  }).join('');
}

window.filterChats = () => renderChatList();
window.switchChatTab = (tab) => {
  currentTab = tab;
  document.querySelectorAll('.chat-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
  renderChatList();
};

// ===================== OPEN CHAT =====================
window.openChat = async (type, id) => {
  let data;
  try {
    if (type === 'dm') {
      const snap = await getDoc(doc(db, 'chats', id));
      if (!snap.exists()) return;
      data = snap.data();
      if (!data.participants.includes(currentUser.uid)) return showToast('Akses ditolak', 'error');
      const otherId = data.participants.find(p => p !== currentUser.uid);
      if (otherId) { const s = await getDoc(doc(db, 'users', otherId)); if (s.exists()) data._otherUser = s.data(); }
    } else {
      const snap = await getDoc(doc(db, 'groups', id));
      if (!snap.exists()) return;
      data = snap.data();
      if (!data.members.includes(currentUser.uid)) return showToast('Kamu bukan member grup ini', 'error');
    }
  } catch(e) { return showToast('Error: ' + e.message, 'error'); }

  currentChat = { type, id, data };
  setRoute(`/${type}/${id}`);

  const name = type === 'dm' ? (data._otherUser?.name||'User') : data.name;
  const initial = (name||'?')[0].toUpperCase();
  const sub = type === 'dm' ? (data._otherUser?.email||'') : `${data.members?.length||0} member`;

  // Update avatar header
  const chAvEl = document.getElementById('ch-avatar');
  const avatarUrl = type === 'dm' ? (data._otherUser?.avatar||'') : (data.avatar||'');
  if (avatarUrl) {
    chAvEl.innerHTML = `<img src="${avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } else {
    chAvEl.textContent = initial;
  }
  document.getElementById('ch-name').textContent = name;
  document.getElementById('ch-sub').textContent = sub;
  document.getElementById('group-info-btn').style.display = type === 'group' ? 'flex' : 'none';
  document.getElementById('group-info-panel').classList.remove('active');
  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('chat-view').classList.add('active');
  showChatMobile();
  hideBottomNav();
  listenMessages(type, id);
};

// ===================== MESSAGES =====================
function listenMessages(type, id) {
  if (unsubMessages) unsubMessages();
  const container = document.getElementById('messages-container');
  container.innerHTML = '<div class="loading-dots">Memuat pesan...</div>';
  const colName = type === 'dm' ? 'messages' : 'group_messages';
  const fieldName = type === 'dm' ? 'chat_id' : 'group_id';
  const q = query(collection(db, colName), where(fieldName, '==', id));
  unsubMessages = onSnapshot(q, (snap) => {
    const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a,b) => (a.timestamp?.seconds||0) - (b.timestamp?.seconds||0));
    renderMessages(msgs);
  });
}

// ===================== SEND MESSAGE =====================
window.sendMessage = async () => {
  const input = document.getElementById('message-input');
  const text = input.value.trim();
  if (!text || !currentChat) return;
  input.value = ''; autoResize(input);
  try {
    if (currentChat.type === 'dm') {
      const snap = await getDoc(doc(db, 'chats', currentChat.id));
      if (!snap.exists() || !snap.data().participants.includes(currentUser.uid)) return showToast('Akses ditolak','error');
      await addDoc(collection(db, 'messages'), {
        chat_id: currentChat.id, sender_id: currentUser.uid,
        sender_name: currentUser.displayName||'User', text, timestamp: serverTimestamp()
      });
      await updateDoc(doc(db, 'chats', currentChat.id), { lastMessage: text, lastMessageAt: serverTimestamp() });
    } else {
      const snap = await getDoc(doc(db, 'groups', currentChat.id));
      if (!snap.exists() || !snap.data().members.includes(currentUser.uid)) return showToast('Kamu bukan member','error');
      await addDoc(collection(db, 'group_messages'), {
        group_id: currentChat.id, sender_id: currentUser.uid,
        sender_name: currentUser.displayName||'User', text, timestamp: serverTimestamp()
      });
      await updateDoc(doc(db, 'groups', currentChat.id), { lastMessage: text, lastMessageAt: serverTimestamp() });
    }
  } catch(e) { showToast('Gagal kirim: ' + e.message, 'error'); }
};

window.handleEnter = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } };
window.autoResize = (el) => { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight,120)+'px'; };

// ===================== HAPUS PESAN =====================
window.startLP = (e, msgId) => { longPressTimer = setTimeout(() => showMsgMenu(e, msgId), 600); };
window.cancelLP = () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } };

window.showMsgMenu = (e, msgId) => {
  e.preventDefault();
  if (!currentChat) return;
  const chatType = currentChat.type;
  const chatId = currentChat.id;
  document.getElementById('msg-ctx-menu')?.remove();
  const menu = document.createElement('div');
  menu.id = 'msg-ctx-menu';
  const x = e.touches ? e.touches[0].clientX : e.clientX;
  const y = e.touches ? e.touches[0].clientY : e.clientY;
  menu.style.cssText = `position:fixed;left:${Math.min(x,window.innerWidth-160)}px;top:${Math.min(y,window.innerHeight-80)}px;
    background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:6px;z-index:9999;
    min-width:150px;box-shadow:0 8px 24px rgba(0,0,0,0.5)`;
  menu.innerHTML = `<div onclick="deleteMsg('${msgId}','${chatType}')"
    style="padding:10px 14px;cursor:pointer;color:var(--danger);font-size:14px;border-radius:7px;display:flex;align-items:center;gap:8px"
    onmouseover="this.style.background='var(--border)'" onmouseout="this.style.background='none'">🗑️ Hapus Pesan</div>`;
  document.body.appendChild(menu);
  setTimeout(() => {
    document.addEventListener('click', () => menu.remove(), { once: true });
    document.addEventListener('touchstart', () => menu.remove(), { once: true });
  }, 100);
};

window.deleteMsg = async (msgId, chatType) => {
  document.getElementById('msg-ctx-menu')?.remove();
  if (!msgId || !chatType) return showToast('Error: data tidak lengkap', 'error');
  if (!confirm('Hapus pesan ini?')) return;
  try {
    const colName = chatType === 'dm' ? 'messages' : 'group_messages';
    const msgRef = doc(db, colName, msgId);
    await deleteDoc(msgRef);
    showToast('Pesan dihapus', 'success');
  } catch(e) {
    showToast('Gagal hapus: ' + e.message, 'error');
    console.error('Delete error:', e);
  }
};

// ===================== GROUP SETTINGS (ROUTE) =====================
window.toggleGroupInfo = () => {
  if (!currentChat || currentChat.type !== 'group') return;
  setRoute(`/group-settings/${currentChat.id}`);
  openGroupSettings(currentChat.id);
};

window.openGroupSettings = async (groupId) => {
  currentGroupId = groupId; // set dulu sebelum apapun
  const screen = document.getElementById('group-settings-screen');
  const body = document.getElementById('group-settings-body');
  screen.style.display = 'flex';
  hideBottomNav();
  body.innerHTML = '<div class="loading-dots">Memuat...</div>';

  try {
    const snap = await getDoc(doc(db, 'groups', groupId));
    if (!snap.exists()) { body.innerHTML = '<div class="loading-dots">Grup tidak ditemukan</div>'; return; }
    const g = snap.data();
    const isAdmin = g.admin === currentUser.uid || (g.admins||[]).includes(currentUser.uid);

    // Auto-generate inviteCode jika belum ada
    if (!g.inviteCode) {
      const code = generateCode();
      await updateDoc(doc(db, 'groups', groupId), { inviteCode: code });
      g.inviteCode = code;
    }

    const inviteUrl = `${location.origin}${location.pathname}#/join/${g.inviteCode}`;

    // Fetch member details
    const memberSnaps = await Promise.all((g.members||[]).map(uid => getDoc(doc(db, 'users', uid))));
    const members = memberSnaps.map(s => s.exists() ? s.data() : null).filter(Boolean);

    document.getElementById('gs-title').textContent = g.name;
    document.getElementById('gs-edit-btn').style.display = isAdmin ? 'flex' : 'none';

    body.innerHTML = `
      <!-- Avatar & Info -->
      <div style="text-align:center;margin-bottom:24px">
        <div style="position:relative;display:inline-block;margin-bottom:12px">
          <div style="width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,var(--accent2),var(--accent));
            display:flex;align-items:center;justify-content:center;font-size:32px;font-family:'Space Mono',monospace;
            font-weight:700;color:#fff;overflow:hidden">
            ${g.avatar ? `<img src="${g.avatar}" style="width:100%;height:100%;object-fit:cover">` : (g.name||'G')[0].toUpperCase()}
          </div>
          ${isAdmin ? `<label for="group-avatar-file-${groupId}" style="position:absolute;bottom:-2px;right:-2px;width:26px;height:26px;
            background:var(--accent);border-radius:50%;display:flex;align-items:center;justify-content:center;
            cursor:pointer;font-size:12px;color:#000;font-weight:700">+</label>
          <input type="file" id="group-avatar-file-${groupId}" accept="image/*" style="display:none"
            onchange="uploadGroupAvatar(this,'${groupId}')" />` : ''}
        </div>
        <div style="font-size:20px;font-weight:700;font-family:'Space Mono',monospace">${escHtml(g.name)}</div>
        <div style="font-size:13px;color:var(--text2);margin-top:6px;line-height:1.5">${escHtml(g.bio||'Belum ada deskripsi')}</div>
        <div style="font-size:12px;color:var(--text2);margin-top:4px">${(g.members||[]).length} member</div>
      </div>

      <!-- Link Invite -->
      <div style="margin-bottom:24px">
        <div class="section-title">🔗 Link Undangan</div>
        <div class="invite-box" style="margin-top:8px">
          <code id="gs-invite-url" style="font-size:11px;word-break:break-all;color:var(--accent)">${escHtml(inviteUrl)}</code>
          <button class="copy-btn" onclick="copyText(document.getElementById('gs-invite-url').textContent)">Salin</button>
        </div>
        ${isAdmin ? `<button class="btn-secondary" onclick="regenInvite('${groupId}')" style="margin-top:8px;font-size:13px">🔄 Buat Link Baru</button>` : ''}
      </div>

      <!-- Members -->
      <div>
        <div class="section-title" style="margin-bottom:10px">👥 ${members.length} Member</div>
        ${members.map(m => {
          const isMemberAdmin = m.uid === g.admin || (g.admins||[]).includes(m.uid);
          const isMe = m.uid === currentUser.uid;
          return `<div class="member-row" style="padding:10px 0">
            <div class="chat-avatar" style="width:40px;height:40px;font-size:16px">${(m.name||'U')[0].toUpperCase()}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:14px;font-weight:500">${escHtml(m.name)} ${isMe?'<span style="color:var(--text2);font-size:11px">(kamu)</span>':''}</div>
              <div style="font-size:11px;color:var(--text2)">${escHtml(m.email||m.phone||'')}</div>
            </div>
            <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
              ${isMemberAdmin ? '<span class="badge-admin">Admin</span>' : ''}
              ${isAdmin && !isMe && !isMemberAdmin ? `<button class="copy-btn" onclick="makeAdmin('${groupId}','${m.uid}')">Jadikan Admin</button>` : ''}
              ${isAdmin && !isMe ? `<button class="btn-danger" onclick="kickFromSettings('${groupId}','${m.uid}')">Kick</button>` : ''}
            </div>
          </div>`;
        }).join('')}

        ${isAdmin ? `
        <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:16px">
          <div class="section-title" style="margin-bottom:8px">Tambah Member</div>
          <div style="display:flex;gap:8px">
            <input type="email" id="gs-add-email" placeholder="email@member.com"
              style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:10px 14px;
              color:var(--text);font-size:13px;outline:none;font-family:'DM Sans',sans-serif"
              oninput="gsSearchMember(this.value)" />
          </div>
          <div id="gs-member-results" style="margin-top:8px"></div>
        </div>` : ''}

        ${!isAdmin ? `<button class="btn-danger" style="width:100%;margin-top:20px;padding:12px" onclick="leaveGroupFromSettings('${groupId}')">🚪 Keluar Grup</button>` : ''}
      </div>
    `;
  } catch(e) {
    body.innerHTML = `<div style="color:var(--danger);padding:20px;text-align:center">Error: ${e.message}</div>`;
  }
};

window.closeGroupSettings = () => {
  document.getElementById('group-settings-screen').style.display = 'none';
  if (currentChat) {
    setRoute(`/group/${currentChat.id}`);
    hideBottomNav(); // masih di dalam chat
  } else {
    showBottomNav();
    clearRoute();
  }
};

// Edit grup dari settings
window.openGSEdit = async () => {
  if (!currentGroupId) return showToast('Error: grup tidak ditemukan', 'error');
  try {
    const snap = await getDoc(doc(db, 'groups', currentGroupId));
    if (!snap.exists()) return showToast('Grup tidak ditemukan', 'error');
    const g = snap.data();
    document.getElementById('gs-edit-name').value = g.name || '';
    document.getElementById('gs-edit-bio').value = g.bio || '';
    openModal('modal-gs-edit');
  } catch(e) {
    showToast('Gagal: ' + e.message, 'error');
  }
};

window.saveGSEdit = async () => {
  const name = document.getElementById('gs-edit-name').value.trim();
  const bio = document.getElementById('gs-edit-bio').value.trim();
  if (!name) return showToast('Nama grup wajib diisi', 'error');
  if (!currentGroupId) return showToast('Error: ID grup tidak ditemukan', 'error');
  const btn = document.querySelector('#modal-gs-edit .btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan...'; }
  try {
    await updateDoc(doc(db, 'groups', currentGroupId), { name, bio });
    showToast('Grup diperbarui!', 'success');
    closeModal('modal-gs-edit');
    const titleEl = document.getElementById('gs-title');
    if (titleEl) titleEl.textContent = name;
    const chNameEl = document.getElementById('ch-name');
    if (chNameEl && currentChat?.id === currentGroupId) chNameEl.textContent = name;
    await openGroupSettings(currentGroupId);
  } catch(e) {
    showToast('Gagal simpan: ' + e.message, 'error');
    console.error('saveGSEdit error:', e);
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Simpan'; }
};

// Jadikan admin
window.makeAdmin = async (groupId, uid) => {
  if (!confirm('Jadikan user ini admin?')) return;
  await updateDoc(doc(db, 'groups', groupId), { admins: arrayUnion(uid) });
  showToast('Berhasil dijadikan admin', 'success');
  await openGroupSettings(groupId);
};

// Kick dari settings
window.kickFromSettings = async (groupId, uid) => {
  if (!confirm('Keluarkan member ini dari grup?')) return;
  await updateDoc(doc(db, 'groups', groupId), { members: arrayRemove(uid) });
  showToast('Member berhasil dikeluarkan', 'success');
  await openGroupSettings(groupId);
};

// Keluar dari settings
window.leaveGroupFromSettings = async (groupId) => {
  if (!confirm('Yakin mau keluar dari grup ini?')) return;
  await updateDoc(doc(db, 'groups', groupId), { members: arrayRemove(currentUser.uid) });
  showToast('Kamu berhasil keluar dari grup', 'success');
  document.getElementById('group-settings-screen').style.display = 'none';
  document.getElementById('chat-view').classList.remove('active');
  document.getElementById('empty-state').style.display = 'flex';
  clearRoute();
  currentChat = null;
};

// Regenerate invite link
window.regenInvite = async (groupId) => {
  const code = generateCode();
  await updateDoc(doc(db, 'groups', groupId), { inviteCode: code });
  showToast('Link baru dibuat!', 'success');
  await openGroupSettings(groupId);
};

// Search member to add
let gsSearchTimer;
window.gsSearchMember = (val) => {
  clearTimeout(gsSearchTimer);
  if (!val || val.length < 3) { document.getElementById('gs-member-results').innerHTML = ''; return; }
  gsSearchTimer = setTimeout(async () => {
    const q = query(collection(db, 'users'), where('email', '==', val.trim()));
    const snap = await getDocs(q);
    const el = document.getElementById('gs-member-results');
    if (!el) return;
    if (snap.empty) { el.innerHTML = '<div style="color:var(--text2);font-size:12px">User tidak ditemukan</div>'; return; }
    el.innerHTML = snap.docs.map(d => {
      const u = d.data();
      return `<div class="user-search-result" onclick="gsAddMember('${currentChat?.id||currentGroupId}','${u.uid}')">
        <div class="chat-avatar" style="width:34px;height:34px;font-size:13px">${(u.name||'U')[0].toUpperCase()}</div>
        <div><div style="font-size:13px;font-weight:500">${escHtml(u.name)}</div><div style="font-size:11px;color:var(--text2)">${escHtml(u.email)}</div></div>
      </div>`;
    }).join('');
  }, 400);
};

window.gsAddMember = async (groupId, uid) => {
  const snap = await getDoc(doc(db, 'groups', groupId));
  if ((snap.data().members||[]).includes(uid)) return showToast('User sudah member', 'error');
  await updateDoc(doc(db, 'groups', groupId), { members: arrayUnion(uid) });
  showToast('Member ditambahkan!', 'success');
  document.getElementById('gs-add-email').value = '';
  document.getElementById('gs-member-results').innerHTML = '';
  await openGroupSettings(groupId);
};

// ===================== NEW DM =====================
window.openNewDM = () => {
  document.getElementById('dm-search-email').value = '';
  document.getElementById('dm-search-results').innerHTML = '';
  openModal('modal-dm');
};

let dmTimer;
window.searchUserByEmail = (val) => {
  clearTimeout(dmTimer);
  const el = document.getElementById('dm-search-results');
  if (!val || val.length < 2) { el.innerHTML = ''; return; }
  dmTimer = setTimeout(async () => {
    el.innerHTML = '<div style="color:var(--text2);font-size:12px;padding:4px 0">Mencari...</div>';

    // Coba cari by userCode dulu, lalu by email
    let users = [];

    // Cari by userCode
    const qCode = query(collection(db, 'users'), where('userCode', '==', val.trim().toUpperCase()));
    const snapCode = await getDocs(qCode);
    if (!snapCode.empty) {
      users = snapCode.docs.map(d => d.data());
    } else {
      // Cari by email
      const qEmail = query(collection(db, 'users'), where('email', '==', val.trim()));
      const snapEmail = await getDocs(qEmail);
      users = snapEmail.docs.map(d => d.data());
    }

    users = users.filter(u => u.uid !== currentUser.uid && u.isPublic !== false);

    if (!users.length) {
      el.innerHTML = '<div style="color:var(--text2);font-size:13px;padding:8px 0">User tidak ditemukan</div>';
      return;
    }

    el.innerHTML = users.map(u => {
      const emailDisplay = u.showEmail === false ? '' : `<div class="email" style="font-size:11px;color:var(--text2)">${escHtml(u.email)}</div>`;
      const avatarHtml = u.avatar
        ? `<img src="${u.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
        : (u.name||'U')[0].toUpperCase();
      return `<div class="user-search-result" onclick="startDM('${u.uid}')">
        <div class="chat-avatar" style="width:38px;height:38px;font-size:15px;overflow:hidden">${avatarHtml}</div>
        <div>
          <div class="name">${escHtml(u.name)}</div>
          ${emailDisplay}
          <div style="font-size:11px;color:var(--accent);font-family:'Space Mono',monospace">#${escHtml(u.userCode||'')}</div>
        </div>
      </div>`;
    }).join('');
  }, 400);
};

window.startDM = async (uid2) => {
  const q = query(collection(db, 'chats'), where('participants', 'array-contains', currentUser.uid));
  const snap = await getDocs(q);
  let existingId = null;
  snap.forEach(d => { if (d.data().participants.includes(uid2)) existingId = d.id; });
  if (!existingId) {
    const ref = await addDoc(collection(db, 'chats'), {
      participants: [currentUser.uid, uid2], createdAt: serverTimestamp(),
      lastMessage: '', lastMessageAt: serverTimestamp()
    });
    existingId = ref.id;
  }
  closeModal('modal-dm');
  await openChat('dm', existingId);
};

// ===================== CREATE GROUP =====================
window.openCreateGroup = () => {
  document.getElementById('cg-name').value = '';
  document.getElementById('cg-bio').value = '';
  openModal('modal-create-group');
};

window.createGroup = async () => {
  const name = document.getElementById('cg-name').value.trim();
  const bio = document.getElementById('cg-bio').value.trim();
  if (!name) return showToast('Nama grup wajib diisi', 'error');
  const btn = document.getElementById('create-group-btn');
  btn.disabled = true; btn.textContent = 'Membuat...';
  try {
    const ref = await addDoc(collection(db, 'groups'), {
      name, bio, avatar: '', members: [currentUser.uid],
      admin: currentUser.uid, admins: [currentUser.uid],
      inviteCode: generateCode(), createdAt: serverTimestamp(),
      lastMessage: '', lastMessageAt: serverTimestamp()
    });
    closeModal('modal-create-group');
    showToast('Grup berhasil dibuat!', 'success');
    await openChat('group', ref.id);
  } catch(e) { showToast('Gagal: ' + e.message, 'error'); }
  btn.disabled = false; btn.textContent = 'Buat Grup';
};

// ===================== JOIN GROUP =====================
window.openJoinGroup = () => {
  document.getElementById('join-code-input').value = '';
  document.getElementById('join-result').textContent = '';
  openModal('modal-join-group');
};

window.joinGroupByCode = async () => {
  let code = document.getElementById('join-code-input').value.trim();
  if (!code) return;
  if (code.includes('join/')) code = code.split('join/')[1].split('&')[0].trim();
  const el = document.getElementById('join-result');
  el.style.color = 'var(--text2)'; el.textContent = 'Mencari grup...';
  try {
    const q = query(collection(db, 'groups'), where('inviteCode', '==', code));
    const snap = await getDocs(q);
    if (snap.empty) { el.style.color = 'var(--danger)'; el.textContent = 'Kode tidak valid'; return; }
    const gDoc = snap.docs[0];
    const g = gDoc.data();
    if ((g.members||[]).includes(currentUser.uid)) {
      el.style.color = 'var(--accent)'; el.textContent = 'Kamu sudah member';
      setTimeout(async () => { closeModal('modal-join-group'); await openChat('group', gDoc.id); }, 800);
      return;
    }
    await updateDoc(doc(db, 'groups', gDoc.id), { members: arrayUnion(currentUser.uid) });
    el.style.color = 'var(--accent)'; el.textContent = `Berhasil join "${g.name}"!`;
    setTimeout(async () => { closeModal('modal-join-group'); await openChat('group', gDoc.id); }, 800);
  } catch(e) { el.style.color = 'var(--danger)'; el.textContent = 'Error: ' + e.message; }
};

// ===================== UTILS =====================
window.openModal = (id) => document.getElementById(id)?.classList.add('active');
window.closeModal = (id) => document.getElementById(id)?.classList.remove('active');

document.querySelectorAll('.modal-overlay').forEach(o => {
  o.addEventListener('click', (e) => { if (e.target === o) o.classList.remove('active'); });
});

window.copyText = (text) => {
  navigator.clipboard.writeText(text).then(() => showToast('Berhasil disalin!', 'success'));
};

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = `toast ${type} show`;
  setTimeout(() => t.classList.remove('show'), 3000);
}

function formatTime(date) {
  if (!date) return '';
  const diff = Date.now() - date;
  if (diff < 60000) return 'baru saja';
  if (diff < 3600000) return Math.floor(diff/60000) + 'm';
  if (diff < 86400000) return date.toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' });
  if (diff < 604800000) return date.toLocaleDateString('id-ID', { weekday:'short' });
  return date.toLocaleDateString('id-ID', { day:'numeric', month:'short' });
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/\n/g,'<br>');
}

function generateCode(len=10) {
  const c = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({length:len},()=>c[Math.floor(Math.random()*c.length)]).join('');
}

// ===================== SETTINGS =====================
window.openSettings = async () => {
  const screen = document.getElementById('settings-screen');
  screen.style.display = 'flex';
  hideBottomNav();
  setRoute('/settings');

  // Isi data profil
  const snap = await getDoc(doc(db, 'users', currentUser.uid));
  const userData = snap.exists() ? snap.data() : {};

  // Tampilkan avatar
  const stAv = document.getElementById('st-avatar');
  if (userData.avatar) {
    stAv.innerHTML = `<img src="${userData.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    // Update avatar di sidebar juga
    document.getElementById('my-avatar').innerHTML = `<img src="${userData.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } else {
    stAv.textContent = (currentUser.displayName||'U')[0].toUpperCase();
  }
  const displayName = userData.name || currentUser.displayName || 'User';
  document.getElementById('st-name').textContent = displayName;
  document.getElementById('st-email').textContent = currentUser.email;
  document.getElementById('st-username-input').value = displayName;

  // Tampilkan userCode
  const codeEl = document.getElementById('st-usercode');
  if (codeEl) {
    codeEl.textContent = '#' + (userData.userCode || '...');
    codeEl.onclick = () => {
      navigator.clipboard.writeText(userData.userCode || '');
      showToast('Kode disalin!', 'success');
    };
  }

  // Privacy toggles
  document.getElementById('toggle-show-email').checked = userData.showEmail !== false; // default true
  document.getElementById('toggle-public').checked = userData.isPublic !== false; // default true
};

window.closeSettings = () => {
  document.getElementById('settings-screen').style.display = 'none';
  showBottomNav();
  clearRoute();
};

window.saveUsername = async () => {
  const name = document.getElementById('st-username-input').value.trim();
  if (!name || name.length < 2) return showToast('Nama minimal 2 karakter', 'error');

  const btn = document.getElementById('save-username-btn');
  btn.disabled = true; btn.textContent = 'Menyimpan...';

  try {
    // Ambil avatar terkini — cek dari img element di settings
    const stAvEl = document.getElementById('st-avatar');
    const imgEl = stAvEl?.querySelector('img');
    const avatarUrl = imgEl ? imgEl.src : '';

    // Update Firestore - simpan nama + avatar sekaligus
    const updateData = { name };
    if (avatarUrl) updateData.avatar = avatarUrl;
    await updateDoc(doc(db, 'users', currentUser.uid), updateData);

    // Update Firebase Auth displayName
    const { updateProfile } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
    await updateProfile(auth.currentUser, { displayName: name });

    // Update UI sidebar
    document.getElementById('my-name').textContent = name;
    document.getElementById('st-name').textContent = name;
    if (!avatarUrl) {
      document.getElementById('st-avatar').textContent = name[0].toUpperCase();
      document.getElementById('my-avatar').textContent = name[0].toUpperCase();
    }

    showToast('Profil berhasil diperbarui!', 'success');
  } catch(e) {
    showToast('Gagal: ' + e.message, 'error');
  }

  btn.disabled = false; btn.textContent = 'Simpan Perubahan';
};

window.savePrivacy = async () => {
  const showEmail = document.getElementById('toggle-show-email').checked;
  const isPublic = document.getElementById('toggle-public').checked;
  try {
    await updateDoc(doc(db, 'users', currentUser.uid), { showEmail, isPublic });
    showToast('Pengaturan privasi disimpan', 'success');
  } catch(e) {
    showToast('Gagal simpan: ' + e.message, 'error');
  }
};

// Handle route /settings
const _origHandleRoute = handleRoute;
window.addEventListener('hashchange', async () => {
  if (window.location.hash === '#/settings') {
    await openSettings();
  }
});

// ===================== DELINE UPLOAD =====================
let pendingMediaFile = null;

const uploadDelineFile = async (file) => {
  const ext = file.name?.split('.').pop() || 'bin';
  const mime = file.type || 'application/octet-stream';
  const fd = new FormData();
  fd.append("file", new Blob([await file.arrayBuffer()], { type: mime }), `file.${ext}`);
  const res = await fetch("https://api.deline.web.id/uploader", { method: "POST", body: fd });
  const data = await res.json();
  if (data.status === false) throw new Error(data.message || "Upload gagal");
  const link = data?.result?.link || data?.url || data?.path;
  if (!link) throw new Error("Tidak ada link dari server");
  return link;
};

const checkIsImage = (url) => /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(url) || url.includes('image');
const checkIsVideo = (url) => /\.(mp4|webm|mov|avi)(\?|$)/i.test(url) || url.includes('video');

// ===================== MEDIA DI CHAT =====================
window.handleMediaSelect = (input) => {
  const file = input.files[0];
  if (!file) return;
  pendingMediaFile = file;
  input.value = '';

  const preview = document.getElementById('media-preview-content');
  const url = URL.createObjectURL(file);

  if (file.type.startsWith('image/')) {
    preview.innerHTML = `<img src="${url}" style="max-width:100%;max-height:300px;border-radius:10px;object-fit:contain" />`;
  } else if (file.type.startsWith('video/')) {
    preview.innerHTML = `<video src="${url}" controls style="max-width:100%;max-height:300px;border-radius:10px"></video>`;
  } else {
    preview.innerHTML = `<div style="padding:20px;color:var(--text2)">📄 ${escHtml(file.name)}</div>`;
  }

  document.getElementById('media-caption').value = '';
  openModal('modal-media-preview');
};

window.sendMedia = async () => {
  if (!pendingMediaFile || !currentChat) return;
  const btn = document.getElementById('send-media-btn');
  btn.disabled = true; btn.textContent = 'Mengupload...';

  try {
    const url = await uploadDelineFile(pendingMediaFile);
    const caption = document.getElementById('media-caption').value.trim();
    const isImg = pendingMediaFile.type.startsWith('image/');
    const isVid = pendingMediaFile.type.startsWith('video/');
    const mediaType = isImg ? 'image' : isVid ? 'video' : 'file';

    const msgData = {
      sender_id: currentUser.uid,
      sender_name: currentUser.displayName || 'User',
      text: caption,
      mediaUrl: url,
      mediaType,
      timestamp: serverTimestamp()
    };

    if (currentChat.type === 'dm') {
      await addDoc(collection(db, 'messages'), { ...msgData, chat_id: currentChat.id });
      await updateDoc(doc(db, 'chats', currentChat.id), {
        lastMessage: isImg ? '📷 Foto' : isVid ? '🎥 Video' : '📎 File',
        lastMessageAt: serverTimestamp()
      });
    } else {
      await addDoc(collection(db, 'group_messages'), { ...msgData, group_id: currentChat.id });
      await updateDoc(doc(db, 'groups', currentChat.id), {
        lastMessage: isImg ? '📷 Foto' : isVid ? '🎥 Video' : '📎 File',
        lastMessageAt: serverTimestamp()
      });
    }

    closeModal('modal-media-preview');
    pendingMediaFile = null;
    showToast('Media terkirim!', 'success');
  } catch(e) {
    showToast('Gagal upload: ' + e.message, 'error');
  }

  btn.disabled = false; btn.textContent = 'Kirim';
};

// Override renderMessages untuk support media
const _origRenderMessages = window.renderMessages;
function renderMessages(msgs) {
  const container = document.getElementById('messages-container');
  const wasAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
  if (!msgs.length) { container.innerHTML = '<div class="loading-dots">Belum ada pesan. Mulai ngobrol! 👋</div>'; return; }

  let html = '', lastDate = '';
  msgs.forEach(msg => {
    const isOut = msg.sender_id === currentUser.uid;
    const ts = msg.timestamp?.toDate();
    const dateStr = ts ? ts.toLocaleDateString('id-ID', { weekday:'long', day:'numeric', month:'long' }) : '';
    const timeStr = ts ? ts.toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' }) : '';
    if (dateStr && dateStr !== lastDate) {
      html += `<div class="msg-date-divider"><span>${dateStr}</span></div>`;
      lastDate = dateStr;
    }
    const showSender = !isOut && currentChat.type === 'group';
    const isGroupAdmin = currentChat.type === 'group' &&
      (currentChat.data?.admin === currentUser.uid || (currentChat.data?.admins||[]).includes(currentUser.uid));
    const canDelete = isOut || isGroupAdmin;

    // Build media content
    let mediaHtml = '';
    if (msg.mediaUrl) {
      if (msg.mediaType === 'image') {
        mediaHtml = `<div class="msg-media"><img src="${msg.mediaUrl}" onclick="viewMedia('${msg.mediaUrl}')" loading="lazy" /></div>`;
      } else if (msg.mediaType === 'video') {
        mediaHtml = `<div class="msg-media"><video src="${msg.mediaUrl}" controls preload="metadata"></video></div>`;
      } else {
        mediaHtml = `<div><a href="${msg.mediaUrl}" target="_blank" style="color:var(--accent);font-size:13px">📎 Unduh File</a></div>`;
      }
    }

    html += `<div class="msg-row ${isOut?'out':'in'}" id="msg-${msg.id}">
      <div class="msg-bubble"
        ${canDelete ? `oncontextmenu="showMsgMenu(event,'${msg.id}','${currentChat.type}');return false;"
        ontouchstart="startLP(event,'${msg.id}','${currentChat.type}')" ontouchend="cancelLP()" ontouchmove="cancelLP()"` : ''}>
        ${showSender ? `<div class="msg-sender">${escHtml(msg.sender_name||'User')}</div>` : ''}
        ${mediaHtml}
        ${msg.text ? `<div>${escHtml(msg.text)}</div>` : ''}
        <div class="msg-time">${timeStr}</div>
      </div>
    </div>`;
  });

  container.innerHTML = html;
  if (wasAtBottom || msgs.length < 5) container.scrollTop = container.scrollHeight;
}

window.viewMedia = (url) => { window.open(url, '_blank'); };

// Fix startLP untuk include chatType
window.startLP = (e, msgId, chatType) => {
  longPressTimer = setTimeout(() => showMsgMenu(e, msgId, chatType), 600);
};

// Fix showMsgMenu untuk include chatType
window.showMsgMenu = (e, msgId, chatType) => {
  e.preventDefault();
  if (!msgId) return;
  const type = chatType || currentChat?.type || 'dm';
  document.getElementById('msg-ctx-menu')?.remove();
  const menu = document.createElement('div');
  menu.id = 'msg-ctx-menu';
  const x = e.touches ? e.touches[0].clientX : e.clientX;
  const y = e.touches ? e.touches[0].clientY : e.clientY;
  menu.style.cssText = `position:fixed;left:${Math.min(x,window.innerWidth-160)}px;top:${Math.min(y,window.innerHeight-80)}px;
    background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:6px;z-index:9999;
    min-width:150px;box-shadow:0 8px 24px rgba(0,0,0,0.5)`;
  menu.innerHTML = `<div onclick="deleteMsg('${msgId}','${type}')"
    style="padding:10px 14px;cursor:pointer;color:var(--danger);font-size:14px;border-radius:7px;display:flex;align-items:center;gap:8px"
    onmouseover="this.style.background='var(--border)'" onmouseout="this.style.background='none'">🗑️ Hapus Pesan</div>`;
  document.body.appendChild(menu);
  setTimeout(() => {
    document.addEventListener('click', () => menu.remove(), { once: true });
    document.addEventListener('touchstart', () => menu.remove(), { once: true });
  }, 100);
};

// ===================== FOTO PROFIL =====================
window.openAvatarEdit = () => {
  const url = prompt('Masukkan link foto profil (URL gambar):');
  if (!url || !url.startsWith('http')) return showToast('Link tidak valid', 'error');
  saveAvatarUrl(url);
};

window.uploadAvatar = async (input) => {
  const file = input.files[0];
  if (!file) return;
  showToast('Mengupload foto...', '');
  try {
    const url = await uploadDelineFile(file);
    await saveAvatarUrl(url);
  } catch(e) { showToast('Gagal upload: ' + e.message, 'error'); }
  input.value = '';
};

async function saveAvatarUrl(url) {
  try {
    await updateDoc(doc(db, 'users', currentUser.uid), { avatar: url });
    // Update avatar di sidebar
    const myAvEl = document.getElementById('my-avatar');
    myAvEl.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    showToast('Foto profil diperbarui!', 'success');
    // Refresh settings jika terbuka
    const stAv = document.getElementById('st-avatar');
    if (stAv) stAv.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } catch(e) { showToast('Gagal simpan: ' + e.message, 'error'); }
}

// ===================== AVATAR GRUP =====================
window.uploadGroupAvatar = async (input, groupId) => {
  const file = input.files[0];
  if (!file) return;
  showToast('Mengupload avatar grup...', '');
  try {
    const url = await uploadDelineFile(file);
    await updateDoc(doc(db, 'groups', groupId), { avatar: url });
    showToast('Avatar grup diperbarui!', 'success');
    // Update header chat langsung
    if (currentChat?.id === groupId) {
      document.getElementById('ch-avatar').innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
      if (currentChat.data) currentChat.data.avatar = url;
    }
    await openGroupSettings(groupId);
  } catch(e) { showToast('Gagal: ' + e.message, 'error'); }
  input.value = '';
};

// ===================== STATUS (STORY) =====================
window.openStatus = async () => {
  const screen = document.getElementById('status-screen');
  screen.style.display = 'flex';
  hideBottomNav();
  setRoute('/status');
  document.getElementById('my-status-initial').textContent = (currentUser.displayName||'U')[0].toUpperCase();
  await loadStatuses();
};

window.closeStatus = () => {
  document.getElementById('status-screen').style.display = 'none';
  showBottomNav();
  clearRoute();
};

async function loadStatuses() {
  const container = document.getElementById('status-list');
  const expiryMs = Date.now() - 24 * 60 * 60 * 1000; // 24 jam lalu
  try {
    // Ambil semua status, filter expiry di client (hindari composite index)
    const snap = await getDocs(collection(db, 'statuses'));
    const allStatuses = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(s => {
        const exp = s.expiresAt?.toDate ? s.expiresAt.toDate().getTime() : (s.expiresAt?.seconds * 1000 || 0);
        return exp > expiryMs;
      });

    // Group by user — ambil status terbaru per user
    const byUser = {};
    allStatuses.forEach(s => {
      if (!byUser[s.uid] || (s.createdAt?.seconds||0) > (byUser[s.uid].createdAt?.seconds||0)) {
        byUser[s.uid] = s;
      }
    });

    // Semua status kecuali milik sendiri untuk list terbaru
    const statuses = Object.values(byUser)
      .filter(s => s.uid !== currentUser.uid)
      .sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));

    // Status milik sendiri
    const myStatuses = allStatuses.filter(s => s.uid === currentUser.uid);
    const mySnap = { docs: myStatuses.map(s => ({ id: s.id, data: () => s })) };
    if (false) { // dummy block untuk kompatibilitas kode di bawah
    }
    const myStatus = mySnap.docs[0];
    if (myStatus) {
      const msData = myStatus.data();
      document.getElementById('my-status-time').textContent = formatTime(msData.createdAt?.toDate ? msData.createdAt.toDate() : new Date());
      document.getElementById('my-status-avatar').classList.add('status-ring');
      document.getElementById('my-status-avatar').onclick = () => viewStatus(myStatus.id, msData);
    }

    if (!statuses.length) { container.innerHTML = '<div class="loading-dots">Tidak ada status terbaru</div>'; return; }

    // Fetch user data
    const userIds = [...new Set(statuses.map(s => s.uid))];
    const userDocs = await Promise.all(userIds.map(uid => getDoc(doc(db, 'users', uid))));
    const users = {};
    userDocs.forEach(d => { if (d.exists()) users[d.id] = d.data(); });

    container.innerHTML = statuses.map(s => {
      const u = users[s.uid] || {};
      const safeData = encodeURIComponent(JSON.stringify(s));
      return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;cursor:pointer;border-bottom:1px solid var(--border)"
        onclick="viewStatusEncoded('${safeData}')">
        <div style="width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,var(--accent2),var(--accent));
          display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;color:#fff;
          border:2px solid var(--accent);flex-shrink:0;overflow:hidden">
          ${u.avatar ? `<img src="${u.avatar}" style="width:100%;height:100%;object-fit:cover">` : (u.name||'U')[0].toUpperCase()}
        </div>
        <div>
          <div style="font-size:14px;font-weight:600">${escHtml(u.name||'User')}</div>
          <div style="font-size:12px;color:var(--text2)">${formatTime(s.createdAt?.toDate ? s.createdAt.toDate() : new Date())}</div>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    container.innerHTML = `<div style="color:var(--danger);font-size:13px">Error: ${e.message}</div>`;
  }
}

window.handleStatusUpload = async (input) => {
  const file = input.files[0];
  if (!file) return;
  showToast('Mengupload status...', '');
  try {
    const url = await uploadDelineFile(file);
    const caption = prompt('Tambah keterangan (opsional):') || '';
    const isImg = file.type.startsWith('image/');
    const isVid = file.type.startsWith('video/');

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await addDoc(collection(db, 'statuses'), {
      uid: currentUser.uid,
      name: currentUser.displayName || 'User',
      mediaUrl: url,
      mediaType: isImg ? 'image' : isVid ? 'video' : 'file',
      caption,
      createdAt: serverTimestamp(),
      expiresAt
    });
    showToast('Status berhasil dibuat!', 'success');
    await loadStatuses();
  } catch(e) { showToast('Gagal: ' + e.message, 'error'); }
  input.value = '';
};

let statusTimer = null;
window.viewStatus = (statusId, statusData) => {
  if (!statusData) return showToast('Data status tidak ditemukan', 'error');
  if (typeof statusData === 'string') {
    try { statusData = JSON.parse(statusData); } catch(e) { return showToast('Gagal buka status', 'error'); }
  }

  const viewer = document.getElementById('status-viewer');
  viewer.style.display = 'flex';
  hideBottomNav();

  // Handle nama
  const name = statusData.name || statusData.userName || 'User';
  document.getElementById('sv-name').textContent = name;
  document.getElementById('sv-avatar').textContent = name[0].toUpperCase();

  // Handle timestamp
  let timeStr = 'baru saja';
  if (statusData.createdAt) {
    const ts = statusData.createdAt.toDate ? statusData.createdAt.toDate() : new Date(statusData.createdAt.seconds * 1000);
    timeStr = formatTime(ts);
  }
  document.getElementById('sv-time').textContent = timeStr;
  document.getElementById('sv-caption').textContent = statusData.caption || '';

  const isOwner = statusData.uid === currentUser.uid;
  document.getElementById('sv-delete').style.display = isOwner ? 'block' : 'none';
  if (isOwner) document.getElementById('sv-delete').onclick = () => deleteMyStatus(statusId);

  // Tampilkan media
  const svContent = document.getElementById('sv-content');
  if (!statusData.mediaUrl) {
    svContent.innerHTML = '<div style="color:var(--text2);padding:20px">Media tidak tersedia</div>';
    return;
  }

  if (statusData.mediaType === 'image') {
    svContent.innerHTML = `<img src="${statusData.mediaUrl}" style="max-width:100%;max-height:80vh;object-fit:contain" onerror="this.parentElement.innerHTML='<div style=color:var(--danger);padding:20px>Gagal load gambar</div>'" />`;
  } else if (statusData.mediaType === 'video') {
    svContent.innerHTML = `<video src="${statusData.mediaUrl}" autoplay controls style="max-width:100%;max-height:80vh" playsinline></video>`;
  } else {
    svContent.innerHTML = `<a href="${statusData.mediaUrl}" target="_blank" style="color:var(--accent);font-size:16px">📎 Buka File</a>`;
  }

  // Progress bar 5 detik untuk gambar
  if (statusData.mediaType === 'image') {
    const prog = document.getElementById('sv-progress');
    prog.style.transition = 'none'; prog.style.width = '0%';
    setTimeout(() => { prog.style.transition = 'width 5s linear'; prog.style.width = '100%'; }, 50);
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => closeStatusViewer(), 5000);
  }
};

window.closeStatusViewer = () => {
  document.getElementById('status-viewer').style.display = 'none';
  if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
  document.getElementById('sv-progress').style.width = '0%';
  // Jangan tampilkan bottom nav — masih di halaman status
};

window.deleteMyStatus = async (statusId) => {
  if (!statusId || !confirm('Hapus status ini?')) return;
  try {
    await deleteDoc(doc(db, 'statuses', statusId));
    closeStatusViewer();
    showToast('Status dihapus', 'success');
    await loadStatuses();
  } catch(e) { showToast('Gagal: ' + e.message, 'error'); }
};

// ===================== BOTTOM NAVBAR =====================
// ===================== BOTTOM NAV VISIBILITY =====================
function showBottomNav() {
  const nav = document.getElementById('bottom-nav');
  if (nav) nav.style.display = 'flex';
}

function hideBottomNav() {
  const nav = document.getElementById('bottom-nav');
  if (nav) nav.style.display = 'none';
}

window.switchBottomTab = (tab) => {
  // Highlight active tab
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById(`nav-${tab}`)?.classList.add('active');
};

// Set active tab saat buka chat
const _origOpenChat = window.openChat;
window.openChat = async (type, id) => {
  await _origOpenChat(type, id);
  switchBottomTab('chats');
};

// Set active saat buka status/settings
const _origOpenStatus = window.openStatus;
window.openStatus = async () => {
  await _origOpenStatus();
  switchBottomTab('status');
};

const _origOpenSettings = window.openSettings;
window.openSettings = async () => {
  await _origOpenSettings();
  switchBottomTab('settings');
};

// Init active tab
switchBottomTab('chats');

// ===================== AVATAR HELPER =====================
// Fungsi global untuk render avatar dengan foto atau inisial
window.avatarHtml = (user, size = 40) => {
  const name = user?.name || user?.displayName || 'U';
  const avatar = user?.avatar || user?.photoURL || '';
  const initial = name[0].toUpperCase();
  if (avatar) {
    return `<div style="width:${size}px;height:${size}px;border-radius:50%;overflow:hidden;flex-shrink:0">
      <img src="${avatar}" style="width:100%;height:100%;object-fit:cover">
    </div>`;
  }
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:linear-gradient(135deg,var(--accent2),var(--accent));
    display:flex;align-items:center;justify-content:center;font-size:${Math.floor(size*0.4)}px;
    font-weight:700;color:#fff;flex-shrink:0;font-family:'Space Mono',monospace">${initial}</div>`;
};

// Helper viewStatus pakai encoded data (menghindari masalah JSON escape di HTML)
window.viewStatusEncoded = (encoded) => {
  try {
    const data = JSON.parse(decodeURIComponent(encoded));
    viewStatus(data.id, data);
  } catch(e) {
    showToast('Gagal buka status', 'error');
  }
};
