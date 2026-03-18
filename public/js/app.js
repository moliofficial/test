
// ===================== MOBILE HELPERS =====================
function isMobile() { return window.innerWidth <= 768; }

function showChatMobile() {
  if (!isMobile()) return;
  document.getElementById('sidebar').classList.add('hidden');
  const chatArea = document.getElementById('chat-area');
  chatArea.classList.add('mobile-active');
  chatArea.style.display = 'flex';
  // Scroll ke bawah setelah animasi
  setTimeout(() => {
    const mc = document.getElementById('messages-container');
    if (mc) mc.scrollTop = mc.scrollHeight;
  }, 100);
}

function showSidebarMobile() {
  if (!isMobile()) return;
  document.getElementById('sidebar').classList.remove('hidden');
  document.getElementById('chat-area').classList.remove('mobile-active');
  document.getElementById('chat-area').style.display = '';
}

import { auth, db, provider } from "./firebase-config.js";

import {
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  collection, doc, setDoc, getDoc, getDocs, addDoc, updateDoc,
  query, where, orderBy, onSnapshot, serverTimestamp, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ===================== STATE =====================
let currentUser = null;
let currentChat = null;
let unsubMessages = null;
let unsubChats = null;
let chatList = [];
let currentTab = 'all';
let currentGroupId = null;

// ===================== ROUTER =====================
function setRoute(type, id) {
  window.location.hash = `/${type}/${id}`;
}

function clearRoute() {
  window.location.hash = '';
}

async function handleRoute() {
  const hash = window.location.hash; // misal #/dm/abc123
  if (!hash || hash === '#' || hash === '#/') return;
  const parts = hash.replace('#/', '').split('/');
  if (parts.length < 2) return;
  const [type, id] = parts;
  if ((type === 'dm' || type === 'group') && id) {
    await openChat(type, id);
  }
}

window.addEventListener('hashchange', handleRoute);


// ===================== AUTH =====================
window.doLoginGoogle = async () => {
  const btn = document.getElementById('login-google-btn');
  btn.disabled = true;
  btn.textContent = 'Menghubungkan...';
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = '🔑 Masuk dengan Google';
    if (e.code !== 'auth/popup-closed-by-user') {
      document.getElementById('auth-error').textContent = 'Gagal login: ' + e.message;
      document.getElementById('auth-error').style.display = 'block';
    }
  }
};

window.doLogout = async () => {
  if (unsubMessages) unsubMessages();
  if (unsubChats) unsubChats();
  await signOut(auth);
};

// ===================== AUTH STATE =====================
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;

    // Simpan/update user di Firestore
    await setDoc(doc(db, 'users', user.uid), {
      uid: user.uid,
      name: user.displayName || 'User',
      email: user.email,
      avatar: user.photoURL || '',
      updatedAt: serverTimestamp()
    }, { merge: true });

    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app-screen').classList.add('active');
    document.getElementById('my-name').textContent = user.displayName || 'User';
    document.getElementById('my-email').textContent = user.email;
    document.getElementById('my-avatar').textContent = (user.displayName || 'U')[0].toUpperCase();

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

  const dmQuery = query(collection(db, 'chats'), where('participants', 'array-contains', currentUser.uid));
  const groupQuery = query(collection(db, 'groups'), where('members', 'array-contains', currentUser.uid));

  let dms = [];
  let groups = [];

  const renderAll = () => {
    chatList = [
      ...dms.map(d => ({ ...d, _type: 'dm' })),
      ...groups.map(g => ({ ...g, _type: 'group' }))
    ].sort((a, b) => {
      const ta = a.lastMessageAt?.seconds || a.createdAt?.seconds || 0;
      const tb = b.lastMessageAt?.seconds || b.createdAt?.seconds || 0;
      return tb - ta;
    });
    renderChatList();
  };

  const unsubDM = onSnapshot(dmQuery, async (snap) => {
    dms = await Promise.all(snap.docs.map(async d => {
      const data = d.data();
      const otherId = data.participants.find(p => p !== currentUser.uid);
      let otherUser = null;
      if (otherId) {
        const uSnap = await getDoc(doc(db, 'users', otherId));
        if (uSnap.exists()) otherUser = uSnap.data();
      }
      return { id: d.id, ...data, _otherUser: otherUser };
    }));
    renderAll();
  });

  const unsubGroup = onSnapshot(groupQuery, (snap) => {
    groups = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAll();
  });

  unsubChats = () => { unsubDM(); unsubGroup(); };
}

function renderChatList() {
  const container = document.getElementById('chat-list');
  const search = document.getElementById('search-input').value.toLowerCase();

  let filtered = chatList.filter(c => {
    if (currentTab === 'dm' && c._type !== 'dm') return false;
    if (currentTab === 'group' && c._type !== 'group') return false;
    if (search) {
      const name = c._type === 'dm' ? (c._otherUser?.name || '') : (c.name || '');
      return name.toLowerCase().includes(search);
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div class="loading-dots">Belum ada chat</div>';
    return;
  }

  container.innerHTML = filtered.map(c => {
    const isDM = c._type === 'dm';
    const name = isDM ? (c._otherUser?.name || 'User') : c.name;
    const initial = name[0]?.toUpperCase() || '?';
    const lastMsg = c.lastMessage ? escHtml(c.lastMessage.substring(0, 40)) : 'Belum ada pesan';
    const time = c.lastMessageAt ? formatTime(c.lastMessageAt.toDate()) : '';
    const isActive = currentChat && currentChat.id === c.id ? 'active' : '';

    return `
      <div class="chat-item ${isActive}" onclick="openChat('${c._type}','${c.id}')">
        <div class="chat-avatar">${initial}</div>
        <div class="chat-info">
          <div class="chat-name">${escHtml(name)}</div>
          <div class="chat-last">${lastMsg}</div>
        </div>
        <div class="chat-meta">
          <div class="chat-time">${time}</div>
        </div>
      </div>
    `;
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
  if (type === 'dm') {
    const snap = await getDoc(doc(db, 'chats', id));
    if (!snap.exists()) return;
    data = snap.data();
    if (!data.participants.includes(currentUser.uid)) return showToast('Akses ditolak', 'error');
    const otherId = data.participants.find(p => p !== currentUser.uid);
    if (otherId) {
      const uSnap = await getDoc(doc(db, 'users', otherId));
      if (uSnap.exists()) data._otherUser = uSnap.data();
    }
  } else {
    const snap = await getDoc(doc(db, 'groups', id));
    if (!snap.exists()) return;
    data = snap.data();
    if (!data.members.includes(currentUser.uid)) return showToast('Kamu bukan member grup ini', 'error');
  }

  currentChat = { type, id, data };
  setRoute(type, id);

  const name = type === 'dm' ? (data._otherUser?.name || 'User') : data.name;
  const initial = name[0]?.toUpperCase() || '?';
  const sub = type === 'dm' ? (data._otherUser?.email || '') : `${data.members?.length || 0} member`;

  document.getElementById('ch-avatar').textContent = initial;
  document.getElementById('ch-name').textContent = name;
  document.getElementById('ch-sub').textContent = sub;
  document.getElementById('group-info-btn').style.display = type === 'group' ? 'flex' : 'none';
  document.getElementById('group-info-panel').classList.remove('active');
  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('chat-view').classList.add('active');
  showChatMobile();

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
    const msgs = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ta = a.timestamp?.seconds || 0;
        const tb = b.timestamp?.seconds || 0;
        return ta - tb;
      });
    renderMessages(msgs);
  });
}

function renderMessages(msgs) {
  const container = document.getElementById('messages-container');
  const wasAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;

  if (msgs.length === 0) {
    container.innerHTML = '<div class="loading-dots">Belum ada pesan. Mulai ngobrol! 👋</div>';
    return;
  }

  let html = '';
  let lastDate = '';

  msgs.forEach(msg => {
    const isOut = msg.sender_id === currentUser.uid;
    const ts = msg.timestamp?.toDate();
    const dateStr = ts ? ts.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
    const timeStr = ts ? ts.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '';

    if (dateStr && dateStr !== lastDate) {
      html += `<div class="msg-date-divider"><span>${dateStr}</span></div>`;
      lastDate = dateStr;
    }

    const showSender = !isOut && currentChat.type === 'group';

    html += `
      <div class="msg-row ${isOut ? 'out' : 'in'}">
        <div class="msg-bubble">
          ${showSender ? `<div class="msg-sender">${escHtml(msg.sender_name || 'User')}</div>` : ''}
          ${escHtml(msg.text)}
          <div class="msg-time">${timeStr}</div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
  if (wasAtBottom || msgs.length < 5) container.scrollTop = container.scrollHeight;
}

// ===================== SEND MESSAGE =====================
window.sendMessage = async () => {
  const input = document.getElementById('message-input');
  const text = input.value.trim();
  if (!text || !currentChat) return;
  input.value = '';
  autoResize(input);

  try {
    if (currentChat.type === 'dm') {
      const snap = await getDoc(doc(db, 'chats', currentChat.id));
      if (!snap.exists() || !snap.data().participants.includes(currentUser.uid)) return showToast('Akses ditolak', 'error');
      await addDoc(collection(db, 'messages'), {
        chat_id: currentChat.id,
        sender_id: currentUser.uid,
        sender_name: currentUser.displayName || 'User',
        text,
        timestamp: serverTimestamp()
      });
      await updateDoc(doc(db, 'chats', currentChat.id), { lastMessage: text, lastMessageAt: serverTimestamp() });
    } else {
      const snap = await getDoc(doc(db, 'groups', currentChat.id));
      if (!snap.exists() || !snap.data().members.includes(currentUser.uid)) return showToast('Kamu bukan member grup ini', 'error');
      await addDoc(collection(db, 'group_messages'), {
        group_id: currentChat.id,
        sender_id: currentUser.uid,
        sender_name: currentUser.displayName || 'User',
        text,
        timestamp: serverTimestamp()
      });
      await updateDoc(doc(db, 'groups', currentChat.id), { lastMessage: text, lastMessageAt: serverTimestamp() });
    }
  } catch (e) {
    showToast('Gagal kirim: ' + e.message, 'error');
  }
};

window.handleEnter = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
};
window.autoResize = (el) => {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
};

// ===================== NEW DM =====================
window.openNewDM = () => {
  document.getElementById('dm-search-email').value = '';
  document.getElementById('dm-search-results').innerHTML = '';
  openModal('modal-dm');
};

let dmSearchTimeout;
window.searchUserByEmail = (val) => {
  clearTimeout(dmSearchTimeout);
  if (!val || val.length < 3) { document.getElementById('dm-search-results').innerHTML = ''; return; }
  dmSearchTimeout = setTimeout(async () => {
    const q = query(collection(db, 'users'), where('email', '==', val.trim()));
    const snap = await getDocs(q);
    const container = document.getElementById('dm-search-results');
    if (snap.empty) { container.innerHTML = '<div style="color:var(--text2);font-size:13px;padding:8px 0">User tidak ditemukan</div>'; return; }
    container.innerHTML = snap.docs.map(d => {
      const u = d.data();
      if (u.uid === currentUser.uid) return '';
      return `
        <div class="user-search-result" onclick="startDM('${u.uid}')">
          <div class="chat-avatar" style="width:38px;height:38px;font-size:15px">${(u.name||'U')[0].toUpperCase()}</div>
          <div>
            <div class="name">${escHtml(u.name)}</div>
            <div class="email">${escHtml(u.email)}</div>
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
    const newChat = await addDoc(collection(db, 'chats'), {
      participants: [currentUser.uid, uid2],
      createdAt: serverTimestamp(),
      lastMessage: '',
      lastMessageAt: serverTimestamp()
    });
    existingId = newChat.id;
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
    const inviteCode = generateCode();
    const groupRef = await addDoc(collection(db, 'groups'), {
      name, bio, avatar: '',
      members: [currentUser.uid],
      admin: currentUser.uid,
      inviteCode,
      createdAt: serverTimestamp(),
      lastMessage: '',
      lastMessageAt: serverTimestamp()
    });
    closeModal('modal-create-group');
    showToast('Grup berhasil dibuat!', 'success');
    await openChat('group', groupRef.id);
  } catch (e) {
    showToast('Gagal buat grup: ' + e.message, 'error');
  }
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
  if (code.includes('invite=')) code = code.split('invite=')[1].split('&')[0].trim();

  const resultEl = document.getElementById('join-result');
  resultEl.style.color = 'var(--text2)';
  resultEl.textContent = 'Mencari grup...';

  try {
    const q = query(collection(db, 'groups'), where('inviteCode', '==', code));
    const snap = await getDocs(q);
    if (snap.empty) { resultEl.style.color = 'var(--danger)'; resultEl.textContent = 'Kode invite tidak valid'; return; }

    const groupDoc = snap.docs[0];
    const groupData = groupDoc.data();

    if (groupData.members.includes(currentUser.uid)) {
      resultEl.style.color = 'var(--accent)';
      resultEl.textContent = 'Kamu sudah member grup ini';
      setTimeout(async () => { closeModal('modal-join-group'); await openChat('group', groupDoc.id); }, 800);
      return;
    }

    await updateDoc(doc(db, 'groups', groupDoc.id), { members: arrayUnion(currentUser.uid) });
    resultEl.style.color = 'var(--accent)';
    resultEl.textContent = `Berhasil join "${groupData.name}"!`;
    setTimeout(async () => { closeModal('modal-join-group'); await openChat('group', groupDoc.id); }, 800);
  } catch (e) {
    resultEl.style.color = 'var(--danger)';
    resultEl.textContent = 'Error: ' + e.message;
  }
};

// ===================== GROUP INFO =====================
window.toggleGroupInfo = async () => {
  const panel = document.getElementById('group-info-panel');
  if (panel.classList.contains('active')) { panel.classList.remove('active'); return; }
  panel.classList.add('active');
  await renderGroupInfo();
};

async function renderGroupInfo() {
  if (!currentChat || currentChat.type !== 'group') return;
  const body = document.getElementById('group-info-body');
  const snap = await getDoc(doc(db, 'groups', currentChat.id));
  if (!snap.exists()) return;
  const g = snap.data();
  const isAdmin = g.admin === currentUser.uid;

  const memberPromises = g.members.map(uid => getDoc(doc(db, 'users', uid)));
  const memberSnaps = await Promise.all(memberPromises);
  const members = memberSnaps.map(s => s.exists() ? s.data() : null).filter(Boolean);

  const inviteUrl = `${location.origin}${location.pathname}?invite=${g.inviteCode}`;

  body.innerHTML = `
    <div class="group-info-avatar">${(g.name||'G')[0].toUpperCase()}</div>
    <div class="group-info-name">${escHtml(g.name)}</div>
    <div class="group-info-bio">${escHtml(g.bio || 'Belum ada deskripsi')}</div>
    ${isAdmin ? `<button class="btn-secondary" onclick="openEditGroup('${currentChat.id}')" style="margin-bottom:16px">✏️ Edit Grup</button>` : ''}
    <div class="section-title">Link Invite</div>
    <div class="invite-box">
      <code>${inviteUrl}</code>
      <button class="copy-btn" onclick="copyText('${escAttr(inviteUrl)}')">Salin</button>
    </div>
    <div class="section-title" style="margin-top:20px">${g.members.length} Member</div>
    ${members.map(m => `
      <div class="member-row">
        <div class="chat-avatar" style="width:34px;height:34px;font-size:13px">${(m.name||'U')[0].toUpperCase()}</div>
        <div class="name">${escHtml(m.name)} ${m.uid === currentUser.uid ? '<span style="color:var(--text2);font-size:11px">(kamu)</span>' : ''}</div>
        ${m.uid === g.admin ? '<span class="badge-admin">Admin</span>' : ''}
        ${isAdmin && m.uid !== currentUser.uid ? `<button class="btn-danger" onclick="kickMember('${currentChat.id}','${m.uid}')">Kick</button>` : ''}
      </div>`).join('')}
    ${!isAdmin ? `<button class="btn-danger" style="width:100%;margin-top:20px;padding:10px" onclick="leaveGroup('${currentChat.id}')">🚪 Keluar Grup</button>` : ''}
  `;
}

window.kickMember = async (groupId, uid) => {
  if (!confirm('Keluarkan member ini dari grup?')) return;
  await updateDoc(doc(db, 'groups', groupId), { members: arrayRemove(uid) });
  showToast('Member berhasil dikeluarkan', 'success');
  await renderGroupInfo();
};

window.leaveGroup = async (groupId) => {
  if (!confirm('Yakin mau keluar dari grup ini?')) return;
  await updateDoc(doc(db, 'groups', groupId), { members: arrayRemove(currentUser.uid) });
  showToast('Kamu berhasil keluar dari grup', 'success');
  document.getElementById('group-info-panel').classList.remove('active');
  document.getElementById('chat-view').classList.remove('active');
  document.getElementById('empty-state').style.display = 'flex';
  currentChat = null;
};

// ===================== EDIT GROUP =====================
window.openEditGroup = async (groupId) => {
  currentGroupId = groupId;
  const snap = await getDoc(doc(db, 'groups', groupId));
  if (!snap.exists()) return;
  const g = snap.data();
  if (g.admin !== currentUser.uid) return showToast('Hanya admin yang bisa edit grup', 'error');

  document.getElementById('eg-name').value = g.name || '';
  document.getElementById('eg-bio').value = g.bio || '';

  const memberPromises = g.members.map(uid => getDoc(doc(db, 'users', uid)));
  const memberSnaps = await Promise.all(memberPromises);
  const members = memberSnaps.map(s => s.exists() ? s.data() : null).filter(Boolean);

  document.getElementById('edit-members-list').innerHTML = members.map(m => `
    <div class="member-row">
      <div class="chat-avatar" style="width:32px;height:32px;font-size:12px">${(m.name||'U')[0].toUpperCase()}</div>
      <div class="name">${escHtml(m.name)} ${m.uid === g.admin ? '<span class="badge-admin">Admin</span>' : ''}</div>
      ${m.uid !== currentUser.uid ? `<button class="btn-danger" onclick="removeFromGroup('${m.uid}')">Hapus</button>` : ''}
    </div>`).join('');

  document.getElementById('add-member-email').value = '';
  document.getElementById('add-member-results').innerHTML = '';
  openModal('modal-edit-group');
};

window.saveGroupEdit = async () => {
  const name = document.getElementById('eg-name').value.trim();
  const bio = document.getElementById('eg-bio').value.trim();
  if (!name) return showToast('Nama grup wajib diisi', 'error');
  await updateDoc(doc(db, 'groups', currentGroupId), { name, bio });
  showToast('Grup diperbarui!', 'success');
  closeModal('modal-edit-group');
  if (currentChat && currentChat.id === currentGroupId) document.getElementById('ch-name').textContent = name;
};

window.removeFromGroup = async (uid) => {
  if (!currentGroupId) return;
  await updateDoc(doc(db, 'groups', currentGroupId), { members: arrayRemove(uid) });
  openEditGroup(currentGroupId);
};

let addMemberTimeout;
window.searchAddMember = (val) => {
  clearTimeout(addMemberTimeout);
  if (!val || val.length < 3) { document.getElementById('add-member-results').innerHTML = ''; return; }
  addMemberTimeout = setTimeout(async () => {
    const q = query(collection(db, 'users'), where('email', '==', val.trim()));
    const snap = await getDocs(q);
    const container = document.getElementById('add-member-results');
    if (snap.empty) { container.innerHTML = '<div style="color:var(--text2);font-size:12px;padding:4px 0">User tidak ditemukan</div>'; return; }
    container.innerHTML = snap.docs.map(d => {
      const u = d.data();
      return `<div class="user-search-result" onclick="addMemberToGroup('${u.uid}')">
        <div class="chat-avatar" style="width:34px;height:34px;font-size:13px">${(u.name||'U')[0].toUpperCase()}</div>
        <div><div class="name" style="font-size:13px">${escHtml(u.name)}</div><div class="email">${escHtml(u.email)}</div></div>
      </div>`;
    }).join('');
  }, 400);
};

window.addMemberToGroup = async (uid) => {
  if (!currentGroupId) return;
  const snap = await getDoc(doc(db, 'groups', currentGroupId));
  if (snap.data().members.includes(uid)) return showToast('User sudah jadi member', 'error');
  await updateDoc(doc(db, 'groups', currentGroupId), { members: arrayUnion(uid) });
  showToast('Member berhasil ditambahkan!', 'success');
  document.getElementById('add-member-email').value = '';
  document.getElementById('add-member-results').innerHTML = '';
  openEditGroup(currentGroupId);
};

// ===================== INVITE LINK =====================
const urlParams = new URLSearchParams(window.location.search);
const inviteCode = urlParams.get('invite');
if (inviteCode) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    setTimeout(() => {
      document.getElementById('join-code-input').value = inviteCode;
      openModal('modal-join-group');
    }, 1000);
    window.history.replaceState({}, '', window.location.pathname);
  });
}

// ===================== UTILS =====================
window.openModal = (id) => document.getElementById(id).classList.add('active');
window.closeModal = (id) => document.getElementById(id).classList.remove('active');

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('active'); });
});

window.copyText = (text) => {
  navigator.clipboard.writeText(text).then(() => showToast('Link berhasil disalin!', 'success'));
};

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(() => t.classList.remove('show'), 3000);
}

function formatTime(date) {
  if (!date) return '';
  const now = new Date();
  const diff = now - date;
  if (diff < 60000) return 'baru saja';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm';
  if (diff < 86400000) return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  if (diff < 604800000) return date.toLocaleDateString('id-ID', { weekday: 'short' });
  return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/\n/g,'<br>');
}

function escAttr(str) {
  if (!str) return '';
  return String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function generateCode(len = 10) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
