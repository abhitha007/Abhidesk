(() => {
const $ = s => document.querySelector(s);
firebase.initializeApp(FIREBASE_CONFIG);
const db = firebase.firestore();
const TS = firebase.firestore.FieldValue.serverTimestamp;
const gen = () => String(Math.floor(1e8 + Math.random() * 9e8));
const fmt = id => id.replace(/(\d{3})(?=\d)/g, '$1 ');
const video = $('#remoteVideo');

let myId = localStorage.getItem('abhidesk_id') || gen();
localStorage.setItem('abhidesk_id', myId);
let pc, ch, ref, role = null, stream, agent, pendingCands = [], unsubs = [];
let controlling = false, controlGranted = false, warnedAgent = false, idleTimer;

function toast(t, ms = 3000) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), ms); }
function badge(state, text) { const b = $('#connBadge'); b.className = 'conn ' + state; b.querySelector('span').textContent = text; }
function ask(title, text, yes, no) {
  return new Promise(res => {
    $('#mTitle').textContent = title; $('#mText').textContent = text;
    $('#mYes').textContent = yes; $('#mNo').textContent = no; $('#modal').hidden = false;
    const done = v => { $('#modal').hidden = true; res(v); };
    $('#mYes').onclick = () => done(true); $('#mNo').onclick = () => done(false);
  });
}
const showId = () => $('#myId').textContent = fmt(myId);
showId();

// ---------- Signaling ----------
const listen = u => unsubs.push(u);
function newPC(outCol) {
  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  pendingCands = [];
  pc.onicecandidate = e => e.candidate && ref.collection(outCol).add(e.candidate.toJSON());
  pc.onconnectionstatechange = () => {
    const s = pc && pc.connectionState;
    if (s === 'connected') badge('on', 'Connected');
    if ((s === 'failed' || s === 'closed' || s === 'disconnected') && role) { toast('Connection ended'); hangup(); }
  };
}
async function flushCands() { for (const c of pendingCands) await pc.addIceCandidate(c).catch(() => {}); pendingCands = []; }
function onCands(snap) {
  snap.docChanges().forEach(c => {
    if (c.type !== 'added' || !pc) return;
    const cand = new RTCIceCandidate(c.doc.data());
    if (pc.remoteDescription) pc.addIceCandidate(cand).catch(() => {}); else pendingCands.push(cand);
  });
}

// ---------- Controller (viewer) ----------
$('#connectBtn').onclick = async () => {
  const to = $('#partnerId').value.replace(/\D/g, '');
  const msg = $('#homeMsg'); msg.textContent = '';
  if (to.length !== 9) return msg.textContent = 'Enter the full 9-digit ID.';
  if (to === myId) return msg.textContent = 'That is your own ID.';
  if (role) return;
  role = 'controller'; badge('wait', 'Waiting for the other side…');
  ref = db.collection('sessions').doc();
  newPC('callerCandidates');
  pc.addTransceiver('video', { direction: 'recvonly' });
  ch = pc.createDataChannel('ctrl'); wireChannel();
  pc.ontrack = e => { video.srcObject = e.streams[0]; enterStage('controller'); };
  const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
  await ref.set({ from: myId, to, status: 'pending', offer: { type: offer.type, sdp: offer.sdp }, created: TS() });
  listen(ref.onSnapshot(async s => {
    const d = s.data(); if (!d || !pc) return;
    if (d.status === 'declined' || d.status === 'busy') { toast(d.status === 'busy' ? 'That desk is busy.' : 'Request declined.'); return hangup(); }
    if (d.answer && !pc.currentRemoteDescription) { await pc.setRemoteDescription(d.answer); flushCands(); }
  }));
  listen(ref.collection('calleeCandidates').onSnapshot(onCands));
  setTimeout(() => { if (role === 'controller' && pc && pc.connectionState !== 'connected') { toast('No response. Check the ID.'); hangup(); } }, 60000);
};

// ---------- Sharer (host) ----------
function watchIncoming() {
  db.collection('sessions').where('to', '==', myId).where('status', '==', 'pending').onSnapshot(s => {
    s.docChanges().forEach(async c => {
      if (c.type !== 'added') return;
      if (role) return c.doc.ref.update({ status: 'busy' });
      role = 'pending';
      const ok = await ask('Connection request', `${fmt(c.doc.data().from)} wants to view your screen.`, 'Accept', 'Decline');
      if (!ok) { await c.doc.ref.update({ status: 'declined' }); role = null; return; }
      accept(c.doc);
    });
  });
}
async function accept(doc) {
  const d = doc.data(); ref = doc.ref;
  try { stream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: false }); }
  catch (e) { await ref.update({ status: 'declined' }); role = null; return toast('Screen sharing was cancelled.'); }
  role = 'host';
  newPC('calleeCandidates');
  pc.ondatachannel = e => { ch = e.channel; wireChannel(); };
  await pc.setRemoteDescription(d.offer);
  stream.getTracks().forEach(t => pc.addTrack(t, stream));
  stream.getVideoTracks()[0].onended = hangup;
  const ans = await pc.createAnswer(); await pc.setLocalDescription(ans);
  await ref.update({ answer: { type: ans.type, sdp: ans.sdp }, status: 'active' });
  flushCands();
  listen(ref.collection('callerCandidates').onSnapshot(onCands));
  $('#sharingWith').textContent = fmt(d.from); enterStage('host');
}

// ---------- Control protocol over data channel ----------
function send(o) { if (ch && ch.readyState === 'open') ch.send(JSON.stringify(o)); }
function wireChannel() {
  ch.onmessage = async e => {
    const m = JSON.parse(e.data);
    if (role === 'host') {
      if (m.t === 'req') {
        const ok = await ask('Control request', `${$('#sharingWith').textContent} wants to control your mouse and keyboard.`, 'Allow', 'Keep view only');
        setControl(ok); send({ t: 'ctl', ok });
      } else if (controlGranted) forward(e.data);
    } else if (m.t === 'ctl') {
      controlling = m.ok; $('#stage').classList.toggle('ctl', m.ok);
      $('#ctlBtn').textContent = m.ok ? 'Controlling' : 'Request control';
      toast(m.ok ? 'You now control the remote screen.' : 'Control was declined.');
    } else if (m.t === 'revoked') {
      controlling = false; $('#stage').classList.remove('ctl'); $('#ctlBtn').textContent = 'Request control';
      toast('The host stopped control.');
    }
  };
}
function setControl(on) {
  controlGranted = on;
  $('#ctlState').textContent = on ? 'They can control your computer.' : 'View only.';
  $('#revokeBtn').hidden = !on;
  if (on) connectAgent(); else if (agent) { agent.close(); agent = null; }
}
function connectAgent() {
  try { agent = new WebSocket(AGENT_URL); agent.onerror = () => { if (!warnedAgent) { warnedAgent = true; toast('Control agent not running, so they can only view.', 5000); } }; } catch (e) {}
}
function forward(raw) {
  if (agent && agent.readyState === 1) agent.send(raw);
  else if (!warnedAgent) { warnedAgent = true; toast('Start the AbhiDesk agent to allow control.', 5000); }
}
$('#revokeBtn').onclick = () => { setControl(false); send({ t: 'revoked' }); };

// ---------- Controller input capture ----------
function norm(e) {
  const r = video.getBoundingClientRect(), vw = video.videoWidth, vh = video.videoHeight; if (!vw) return null;
  const s = Math.min(r.width / vw, r.height / vh), w = vw * s, h = vh * s;
  const x = (e.clientX - r.left - (r.width - w) / 2) / w, y = (e.clientY - r.top - (r.height - h) / 2) / h;
  return x < 0 || x > 1 || y < 0 || y > 1 ? null : { x, y };
}
let lastMove = 0;
video.addEventListener('mousemove', e => { if (!controlling || Date.now() - lastMove < 25) return; lastMove = Date.now(); const p = norm(e); if (p) send({ t: 'mm', ...p }); });
video.addEventListener('mousedown', e => { if (!controlling) return; const p = norm(e); if (p) send({ t: 'md', b: e.button, ...p }); });
video.addEventListener('mouseup', e => { if (controlling) send({ t: 'mu', b: e.button }); });
video.addEventListener('contextmenu', e => controlling && e.preventDefault());
video.addEventListener('wheel', e => { if (!controlling) return; e.preventDefault(); send({ t: 'wh', dy: Math.sign(e.deltaY) * 3 }); }, { passive: false });
window.addEventListener('keydown', e => { if (!controlling) return; e.preventDefault(); send({ t: 'kd', key: e.key }); });
$('#ctlBtn').onclick = () => { if (!controlling) { send({ t: 'req' }); toast('Waiting for permission…'); } };

// ---------- Stage / teardown ----------
function enterStage(r) {
  $('#home').hidden = true; $('#stage').hidden = false;
  $('#bar').hidden = r === 'host'; $('#sharing').hidden = r !== 'host';
  $('#barLabel').textContent = 'Remote desktop'; badge('on', 'Connected');
}
function hangup() {
  unsubs.forEach(u => u()); unsubs = [];
  if (ref && role) ref.update({ status: 'ended' }).catch(() => {});
  if (ch) try { ch.close(); } catch (e) {}
  if (pc) { pc.onconnectionstatechange = null; pc.close(); }
  if (stream) stream.getTracks().forEach(t => { t.onended = null; t.stop(); });
  if (agent) agent.close();
  pc = ch = ref = stream = agent = null; role = null; controlling = controlGranted = warnedAgent = false;
  video.srcObject = null; $('#stage').classList.remove('ctl');
  $('#stage').hidden = true; $('#home').hidden = false; $('#ctlBtn').textContent = 'Request control';
  $('#revokeBtn').hidden = true; badge('', 'Ready');
}
$('#endBtn').onclick = hangup; $('#stopBtn').onclick = hangup;
$('#fsBtn').onclick = () => document.fullscreenElement ? document.exitFullscreen() : $('#stage').requestFullscreen();
$('#stage').addEventListener('mousemove', () => { $('#stage').classList.remove('idle'); clearTimeout(idleTimer); idleTimer = setTimeout(() => $('#stage').classList.add('idle'), 3000); });
$('#copyBtn').onclick = () => navigator.clipboard.writeText(myId).then(() => toast('ID copied'));
$('#newIdBtn').onclick = () => { if (role) return; myId = gen(); localStorage.setItem('abhidesk_id', myId); location.reload(); };
$('#partnerId').addEventListener('input', e => e.target.value = fmt(e.target.value.replace(/\D/g, '').slice(0, 9)));
$('#partnerId').addEventListener('keydown', e => e.key === 'Enter' && $('#connectBtn').click());
window.addEventListener('beforeunload', () => { if (ref && role) ref.update({ status: 'ended' }); });
watchIncoming();
})();
