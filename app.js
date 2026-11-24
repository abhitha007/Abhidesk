(() => {
const $ = id => document.getElementById(id);
firebase.initializeApp(FIREBASE_CONFIG);
const db = firebase.firestore();
const TS = firebase.firestore.FieldValue.serverTimestamp;

// ---------------- State ----------------
const generateId = () => Math.floor(100000000000 + Math.random() * 900000000000).toString();
let userId = localStorage.getItem('abhi_userid') || generateId();
localStorage.setItem('abhi_userid', userId);
$('userId').innerText = userId;

const partnerInput = $('partnerId'), remoteVideo = $('remoteVideo');
const inviteNotificationEl = $('inviteNotification'), controlNotificationEl = $('controlNotification');
let sessionId = null, partnerId = null, isHost = false;
let pc = null, ch = null, stream = null, agent = null, incoming = null;
let controlAllowed = false, controlling = false, requestBtn = null, warnedAgent = false;
let pending = [], unsubs = [], inviteUnsub = null, inviteTimer = null;

// ---------------- Helpers ----------------
function updateStatus(t) { $('connStatus').innerText = t; $('debugLog').innerText = t; }
function fail(e) { console.error(e); updateStatus('Error: ' + (e.code ? e.code + ' — ' : '') + (e.message || e)); }
function makePC() {
  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  pending = [];
  pc.onconnectionstatechange = () => {
    if (!pc) return;
    if (pc.connectionState === 'connected') updateStatus('Connected');
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') endSession('Connection lost.');
  };
}
async function flush() { for (const c of pending) await pc.addIceCandidate(c).catch(() => {}); pending = []; }
function onCands(snap) {
  snap.docChanges().forEach(ch => {
    if (ch.type !== 'added' || !pc) return;
    const c = new RTCIceCandidate(ch.doc.data());
    if (pc.remoteDescription) pc.addIceCandidate(c).catch(() => {}); else pending.push(c);
  });
}

// ---------------- Invite ----------------
$('inviteBtn').addEventListener('click', async () => {
  try {
    const pid = partnerInput.value.trim();
    if (!pid || pid === userId) { alert('Enter valid partner ID'); return; }
    if (pc || sessionId) { alert('Already in a session'); return; }
    partnerId = pid; isHost = true;
    sessionId = `${userId}_${partnerId}_${Date.now()}`;
    watchCall(sessionId);
    await db.collection('invites').doc(partnerId).set({
      senderId: userId, sessionId, timestamp: TS(), status: 'pending'
    });
    updateStatus('Invitation sent — waiting...');
    $('disconnectBtn').hidden = false;
    clearTimeout(inviteTimer);
    inviteTimer = setTimeout(() => { if (isHost && !pc) endSession('No response from partner.'); }, 90000);
  } catch (e) { fail(e); }
});

$('createBtn').addEventListener('click', () => {
  if (pc || sessionId) return;
  userId = generateId();
  localStorage.setItem('abhi_userid', userId);
  $('userId').innerText = userId;
  listenInvites();
  updateStatus('New ID ready.');
});

// Listen for incoming invites
function listenInvites() {
  if (inviteUnsub) inviteUnsub();
  inviteUnsub = db.collection('invites').doc(userId).onSnapshot(snap => {
    const d = snap.data();
    if (d && d.status === 'pending' && !pc && !sessionId) {
      if (d.timestamp && Date.now() - d.timestamp.toMillis() > 120000) { snap.ref.delete().catch(() => {}); return; }
      incoming = { sessionId: d.sessionId, partnerId: d.senderId };
      $('inviteUser').innerText = d.senderId;
      inviteNotificationEl.classList.add('show');
    } else inviteNotificationEl.classList.remove('show');
  }, fail);
}

$('acceptInvite').addEventListener('click', async () => {
  inviteNotificationEl.classList.remove('show');
  if (!incoming) return;
  sessionId = incoming.sessionId; partnerId = incoming.partnerId; isHost = false;
  try { await db.collection('invites').doc(userId).delete(); } catch (e) {}
  updateStatus('Starting screen share...');
  startScreenShareAsGuest(sessionId, partnerId);
});
$('declineInvite').addEventListener('click', async () => {
  inviteNotificationEl.classList.remove('show');
  try { await db.collection('invites').doc(userId).delete(); } catch (e) {}
  updateStatus('Invitation declined.');
});

// ---------------- Guest = person sharing screen ----------------
async function startScreenShareAsGuest(sid, callerId) {
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
  } catch (err) { updateStatus('Screen sharing denied: ' + err.message); sessionId = partnerId = null; return; }
  try {
    makePC();
    const ref = db.collection('calls').doc(sid);
    stream.getTracks().forEach(t => pc.addTrack(t, stream));
    stream.getVideoTracks()[0].onended = () => endSession('Screen sharing stopped.');
    pc.onicecandidate = e => { if (e.candidate) ref.collection('answerCandidates').add(e.candidate.toJSON()); };
    ch = pc.createDataChannel('controlChannel'); wire();

    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    await ref.set({ offer: { type: offer.type, sdp: offer.sdp }, caller: callerId, callee: userId, created: TS() });

    unsubs.push(ref.onSnapshot(async snap => {
      if (!pc) return;
      if (!snap.exists) return endSession('Partner disconnected.');
      const d = snap.data();
      if (d.answer && !pc.currentRemoteDescription) { await pc.setRemoteDescription(new RTCSessionDescription(d.answer)); flush(); }
    }, fail));
    unsubs.push(ref.collection('offerCandidates').onSnapshot(onCands, fail));
    $('disconnectBtn').hidden = false;
    updateStatus('Screen sharing started!');
  } catch (e) { fail(e); }
}

// ---------------- Host = person viewing ----------------
function watchCall(id) {
  const ref = db.collection('calls').doc(id); let started = false;
  unsubs.push(ref.onSnapshot(async snap => {
    if (started && !snap.exists) return endSession('Partner disconnected.');
    const d = snap.data();
    if (!d || !d.offer || started) return;
    started = true;
    try { await hostAnswer(ref, d); } catch (e) { fail(e); }
  }, fail));
}
async function hostAnswer(ref, data) {
  makePC();
  const inbound = new MediaStream();
  pc.ontrack = ev => { ev.streams[0].getTracks().forEach(t => inbound.addTrack(t)); remoteVideo.srcObject = inbound; };
  pc.onicecandidate = e => { if (e.candidate) ref.collection('offerCandidates').add(e.candidate.toJSON()); };
  pc.ondatachannel = e => { if (e.channel.label === 'controlChannel') { ch = e.channel; wire(); addRequestBtn(); } };
  await pc.setRemoteDescription(new RTCSessionDescription(data.offer)); flush();
  const ans = await pc.createAnswer(); await pc.setLocalDescription(ans);
  await ref.update({ answer: { type: ans.type, sdp: ans.sdp } });
  unsubs.push(ref.collection('answerCandidates').onSnapshot(onCands, fail));
  updateStatus('Receiving partner screen...');
}
function addRequestBtn() {
  if (requestBtn) return;
  requestBtn = document.createElement('button');
  requestBtn.innerText = 'Request Control';
  requestBtn.onclick = () => { if (!controlling) { send({ t: 'req' }); updateStatus('Waiting for permission...'); } };
  $('disconnectBtn').before(requestBtn);
}

// ---------------- Control channel ----------------
function send(o) { if (ch && ch.readyState === 'open') ch.send(JSON.stringify(o)); }
function wire() {
  ch.onclose = () => endSession('Partner disconnected.');
  ch.onmessage = e => {
    const m = JSON.parse(e.data);
    if (!isHost) {                                   // sharer side
      if (m.t === 'req') { $('controlUser').innerText = partnerId; controlNotificationEl.classList.add('show'); }
      else if (controlAllowed) forward(e.data);
    } else if (m.t === 'ctl') {                      // viewer side
      controlling = m.ok;
      remoteVideo.classList.toggle('ctl', m.ok);
      requestBtn.innerText = m.ok ? 'Controlling' : 'Request Control';
      updateStatus(m.ok ? 'You are controlling the remote screen.' : 'Control request declined.');
    }
  };
}
$('acceptControl').onclick = () => {
  controlAllowed = true; controlNotificationEl.classList.remove('show');
  send({ t: 'ctl', ok: true }); connectAgent();
  updateStatus('Partner can control your screen.');
};
$('declineControl').onclick = () => {
  controlAllowed = false; controlNotificationEl.classList.remove('show'); send({ t: 'ctl', ok: false });
};
function connectAgent() {
  try {
    agent = new WebSocket(AGENT_URL);
    agent.onerror = () => { if (!warnedAgent) { warnedAgent = true; updateStatus('Agent not running — partner can only view. Start agent/agent.js to allow control.'); } };
  } catch (e) {}
}
function forward(raw) { if (agent && agent.readyState === 1) agent.send(raw); }

// ---------------- Viewer input capture ----------------
function norm(e) {
  const r = remoteVideo.getBoundingClientRect(), vw = remoteVideo.videoWidth, vh = remoteVideo.videoHeight;
  if (!vw) return null;
  const s = Math.min(r.width / vw, r.height / vh), w = vw * s, h = vh * s;
  const x = (e.clientX - r.left - (r.width - w) / 2) / w, y = (e.clientY - r.top - (r.height - h) / 2) / h;
  return x < 0 || x > 1 || y < 0 || y > 1 ? null : { x, y };
}
let lastMove = 0;
remoteVideo.addEventListener('mousemove', e => { if (!controlling || Date.now() - lastMove < 25) return; lastMove = Date.now(); const p = norm(e); if (p) send({ t: 'mm', ...p }); });
remoteVideo.addEventListener('mousedown', e => { if (!controlling) return; const p = norm(e); if (p) send({ t: 'md', b: e.button, ...p }); });
remoteVideo.addEventListener('mouseup', e => { if (controlling) send({ t: 'mu', b: e.button }); });
remoteVideo.addEventListener('contextmenu', e => { if (controlling) e.preventDefault(); });
remoteVideo.addEventListener('wheel', e => { if (!controlling) return; e.preventDefault(); send({ t: 'wh', dy: Math.sign(e.deltaY) * 3 }); }, { passive: false });
window.addEventListener('keydown', e => {
  if (!controlling || e.target.tagName === 'INPUT') return;
  e.preventDefault(); send({ t: 'kd', key: e.key });
});

// ---------------- End / cleanup ----------------
function endSession(msg) {
  if (!pc && !sessionId) return;
  const sid = sessionId;
  unsubs.forEach(u => u()); unsubs = [];
  clearTimeout(inviteTimer);
  if (ch) { ch.onclose = null; try { ch.close(); } catch (e) {} }
  if (pc) { pc.onconnectionstatechange = null; pc.close(); }
  if (stream) stream.getTracks().forEach(t => { t.onended = null; t.stop(); });
  if (agent) agent.close();
  if (sid) db.collection('calls').doc(sid).delete().catch(() => {});
  if (requestBtn) { requestBtn.remove(); requestBtn = null; }
  pc = ch = stream = agent = sessionId = partnerId = null;
  isHost = controlAllowed = controlling = warnedAgent = false;
  remoteVideo.srcObject = null; remoteVideo.classList.remove('ctl');
  controlNotificationEl.classList.remove('show');
  $('disconnectBtn').hidden = true;
  updateStatus(msg || 'Ready to connect...');
}
$('disconnectBtn').addEventListener('click', () => endSession('Disconnected.'));
window.addEventListener('beforeunload', () => { if (sessionId) db.collection('calls').doc(sessionId).delete(); });

// Fullscreen
$('fullscreenBtn').addEventListener('click', () => document.body.classList.toggle('fullscreen-mode'));
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.body.classList.remove('fullscreen-mode'); });

listenInvites();
})();
