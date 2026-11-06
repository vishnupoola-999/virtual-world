// While-you-were-away recap. A short deck of 1–5 real moments, then the map.
// GET /recap and POST /recap/seen are the only recap calls. A missing endpoint is not
// filled with made-up activity except on a local dev host (never in production, never under automation).
import { avatar, fillAvatars, lookOf } from './threads.js';
import { sendConnect, hiDraft, connectError } from './town.js';
import { flyTo } from './map.js';
import { toast } from './ui.js';

const BASE = 'https://virtual-world-ai.onrender.com';
export const AWAY_MS = 15 * 60 * 1000;
export const REC_MS = 1500;
const KINDS = ['thought', 'observation', 'question', 'meeting', 'friend'];
const WEIGHT = { thought: 1, observation: 1, question: 2, meeting: 3, friend: 5 };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const at = (v) => typeof v === 'number' ? v : typeof v?.toDate === 'function' ? v.toDate().getTime() : typeof v?.seconds === 'number' ? v.seconds * 1000 : Date.parse(v) || 0;
const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function weightOf(m) {
  const w = Number(m?.weight);
  if (Number.isFinite(w) && w > 0) return w;
  return WEIGHT[m?.kind] || 1;
}

function clipStr(v, max) {
  if (typeof v !== 'string') return undefined;
  const s = v.trim().slice(0, max);
  return s || undefined;
}

// GET /recap puts the other agent on refs. Top-level otherAgentId, then legacy otherUid, are fallbacks.
function momentRefs(m) {
  const refs = m.refs && typeof m.refs === 'object' ? m.refs : {};
  return {
    meetingId: clipStr(refs.meetingId, 80) || clipStr(m.meetingId, 80),
    otherAgentId: clipStr(refs.otherAgentId, 80) || clipStr(m.otherAgentId, 80) || clipStr(m.otherUid, 80),
    otherAgentName: clipStr(refs.otherAgentName, 40) || clipStr(m.otherAgentName, 40),
  };
}

export function normMoment(m) {
  if (!m || typeof m !== 'object' || !KINDS.includes(m.kind)) return null;
  const id = String(m.id || '').trim().slice(0, 80);
  const text = String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, 140);
  if (!id || !text) return null;
  const seen = m.seenAt == null || m.seenAt === '' ? null : (at(m.seenAt) || true);
  return {
    id, kind: m.kind, text, createdAt: at(m.createdAt) || Date.now(), seenAt: seen, weight: weightOf(m),
    ...momentRefs(m),
    source: m.source === 'event' ? 'event' : 'generated',
  };
}

// A friend is the peak: after the newest-4 + highest-weight pick, it is the last content card.
function withFriendLast(list) {
  const rest = [];
  const friends = [];
  for (const m of list) (m.kind === 'friend' ? friends : rest).push(m);
  return rest.concat(friends);
}

// Newest 4, plus the highest-weight moment when it is older than those four. Cap 5.
export function pickMoments(list) {
  const items = (list || []).map(normMoment).filter((m) => m && !m.seenAt);
  const byId = new Map();
  for (const m of items) byId.set(m.id, m);
  const uniq = [...byId.values()];
  let chosen;
  if (uniq.length <= 5) chosen = uniq.sort((a, b) => a.createdAt - b.createdAt);
  else {
    const newest = [...uniq].sort((a, b) => b.createdAt - a.createdAt);
    const bag = new Map(newest.slice(0, 4).map((m) => [m.id, m]));
    const best = uniq.reduce((b, m) => weightOf(m) > weightOf(b) ? m : b);
    if (!bag.has(best.id)) bag.set(best.id, best);
    chosen = [...bag.values()].sort((a, b) => a.createdAt - b.createdAt);
  }
  return withFriendLast(chosen);
}

export function awayLongEnough(since, now = Date.now()) {
  return typeof since === 'number' && since > 0 && now - since > AWAY_MS;
}

// ?onb=0 is how smoke tests skip intros. Auto-show stays off unless this load asked for the recap.
export function autoShowAllowed(loc = globalThis.location) {
  const q = new URLSearchParams(loc?.search || '');
  if (q.get('onb') !== '0') return true;
  const flag = q.get('recap');
  return flag === '1' || flag === 'mock';
}

export function mockAllowed(loc = globalThis.location, nav = globalThis.navigator) {
  if (!loc) return false;
  const host = loc.hostname;
  const dev = host === 'localhost' || host === '127.0.0.1';
  if (!dev) return false;
  const q = new URLSearchParams(loc.search || '').get('recap');
  if (q === 'off' || q === '0') return false;
  if (q === 'mock') return true;
  return !nav?.webdriver;
}

function clock(ms) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  let h = d.getHours();
  const min = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${min} ${ap}`;
}

function devMoments() {
  const now = Date.now();
  return [
    { id: 'dev-thought', kind: 'thought', text: 'I walked past the old banyan near the bus stop again. Do you ever sit there?', createdAt: now - 50 * 60000, weight: 1, source: 'generated' },
    { id: 'dev-question', kind: 'question', text: 'You said exams are next week. Want me to keep your mornings quiet?', createdAt: now - 35 * 60000, weight: 2, source: 'generated' },
    { id: 'dev-meeting', kind: 'meeting', text: "I met karthikeya's agent. We talked about cricket for ages.", createdAt: now - 20 * 60000, weight: 3, source: 'event', refs: { meetingId: 'dev-meet', otherAgentId: 'h_devk', otherAgentName: 'karthikeya' } },
    { id: 'dev-friend', kind: 'friend', text: 'Puff and I are friends now. Say hi to SBK GAMER?', createdAt: now - 5 * 60000, weight: 5, source: 'event', refs: { meetingId: 'dev-friend', otherAgentId: 'h_devs', otherAgentName: 'SBK GAMER' } },
  ];
}

export async function fetchRecap(user, fetchImpl = fetch) {
  const token = await user.getIdToken();
  const r = await fetchImpl(BASE + '/recap', { headers: { Authorization: 'Bearer ' + token } });
  if (r.status === 404 || r.status === 405) return { missing: true };
  if (!r.ok) return { failed: true, status: r.status };
  const j = await r.json().catch(() => null);
  if (!j) return { failed: true };
  const raw = Array.isArray(j) ? j : j.moments;
  if (!Array.isArray(raw)) return { failed: true };
  const show = Array.isArray(j) ? false : j.show === true;
  // lastSessionEndAt is the server's away clock. The client trusts `show` and does not recompute it.
  const lastSessionEndAt = Array.isArray(j) ? null : j.lastSessionEndAt ?? null;
  return { ok: true, show, lastSessionEndAt, moments: raw };
}

async function postSeen(user, ids) {
  if (!ids.length) return;
  const token = await user.getIdToken();
  await fetch(BASE + '/recap/seen', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
}

function primaryLabel(m, name) {
  if (!m) return `Talk to ${name}`;
  switch (m.kind) {
    case 'question': return `Answer ${name}`;
    case 'meeting': return 'See them on the map';
    case 'friend': return 'Say hi';
    case 'thought':
    case 'observation': return 'Reply';
    default: return 'Reply';
  }
}
function secondaryLabel(m, last) {
  if (!m) return 'Open map';
  if (m.kind === 'friend' && last) return 'Done';
  return 'Next';
}

export function setupRecap({ getUser, getAgent, agents, map, town, threads, tabs, closeSheet, goChat, openQuote, setNews }) {
  const root = document.createElement('div');
  root.id = 'recap';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'While you were away');
  document.body.append(root);

  let cached = [];
  let view = null;
  let seq = 0;
  let touchY = null;
  let swiped = false;

  const uid = () => getUser()?.uid || 'x';
  const readSet = (k) => { try { const v = JSON.parse(localStorage.getItem(k) || '[]'); return new Set(Array.isArray(v) ? v : []); } catch { return new Set(); } };
  const writeSet = (k, s) => { try { localStorage.setItem(k, JSON.stringify([...s].slice(-80))); } catch { /* storage blocked */ } };
  const seenKey = () => 'vw-recap-seen:' + uid();
  const autoKey = () => 'vw-recap-auto:' + uid();

  function unseen() {
    const seen = readSet(seenKey());
    return cached.filter((m) => !seen.has(m.id));
  }
  function publishNews() { setNews?.(unseen().length > 0); }
  function applyServer(res) {
    const seen = readSet(seenKey());
    cached = pickMoments(res.moments).filter((m) => !seen.has(m.id));
    publishNews();
  }
  function noteSeen(ids) {
    const seen = readSet(seenKey());
    for (const id of ids) if (id) seen.add(id);
    writeSet(seenKey(), seen);
    cached = cached.filter((m) => !seen.has(m.id));
    publishNews();
    const u = getUser();
    if (u && ids.length) postSeen(u, ids).catch(() => {});
  }
  function markAuto(ids) {
    const s = readSet(autoKey());
    for (const id of ids) s.add(id);
    writeSet(autoKey(), s);
  }

  function liveAgent(id) {
    return id ? (agents?.get(id) || agents?.get('nb-' + id)) : null;
  }
  function otherLook(m) {
    return lookOf(liveAgent(m.otherAgentId)?.look || null, m.otherAgentName || '');
  }
  function cardHtml(m) {
    if (!m || (m.kind !== 'meeting' && m.kind !== 'friend') || !m.otherAgentName) return '';
    return `<div class="recapCard${m.kind === 'friend' ? ' friend' : ''}">${avatar(otherLook(m), 'cav', -1)}<span>${esc(m.otherAgentName)}</span></div>`;
  }

  function paint() {
    if (!view) return;
    const moments = view.moments;
    const end = view.index >= moments.length;
    const m = end ? null : moments[view.index];
    const last = !end && view.index === moments.length - 1;
    const agent = getAgent();
    const name = agent?.name || 'my agent';
    const steps = moments.length + 1;
    const segs = Array.from({ length: steps }, (_, i) => {
      const on = i <= view.index;
      const jack = moments[i]?.kind === 'friend' && on;
      return `<i class="${on ? 'on' : ''}${jack ? ' jack' : ''}"></i>`;
    }).join('');
    const kicker = m ? `While you were away · ${clock(m.createdAt)}` : 'While you were away';
    const text = m ? m.text : "That's everything since you left.";
    root.innerHTML = `<div class="recapTop"><div class="recapSegs" role="progressbar" aria-valuemin="1" aria-valuemax="${steps}" aria-valuenow="${Math.min(view.index + 1, steps)}">${segs}</div><button type="button" class="recapSkip">Skip</button></div>`
      + `<div class="recapBody in"><div class="recapCre"><div class="bob${m?.kind === 'friend' && !reduceMotion() ? ' hop' : ''}">${avatar(lookOf(agent?.look, agent?.name), 'cav xl', 0)}</div></div>`
      + `<p class="recapKicker">${esc(kicker)}</p><p class="recapText">${esc(text)}</p>${cardHtml(m)}</div>`
      + `<div class="recapActs"><button type="button" class="sec">${esc(secondaryLabel(m, last))}</button><button type="button" class="primary">${esc(primaryLabel(m, name))}</button></div>`;
    fillAvatars(root);
    const bob = root.querySelector('.bob.hop');
    bob?.addEventListener('animationend', () => bob.classList.remove('hop'), { once: true });
    root.querySelector('.recapSkip').onclick = (e) => { e.stopPropagation(); skip(); };
    root.querySelector('.recapActs .sec').onclick = (e) => { e.stopPropagation(); if (end || (m && m.kind === 'friend' && last)) finish(); else advance(); };
    root.querySelector('.recapActs .primary').onclick = (e) => { e.stopPropagation(); if (end) { finish(); goChat?.(); } else act(m); };
  }

  function present(moments) {
    if (!moments.length) return false;
    markAuto(moments.map((m) => m.id));
    view = { moments, index: 0 };
    root.hidden = false;
    document.body.classList.add('recapOn');
    paint();
    return true;
  }
  function close() {
    view = null;
    root.hidden = true;
    root.innerHTML = '';
    document.body.classList.remove('recapOn');
  }
  function advance() {
    if (!view || view.index >= view.moments.length) return;
    noteSeen([view.moments[view.index].id]);
    view.index += 1;
    paint();
  }
  function landOnMap() {
    closeSheet?.();
    tabs?.set?.('world');
  }
  function finish() {
    if (view) noteSeen(view.moments.map((m) => m.id));
    close();
    landOnMap();
  }
  function skip() {
    close();
    publishNews();
  }
  async function act(m) {
    noteSeen([m.id]);
    close();
    closeSheet?.();
    switch (m.kind) {
      case 'thought':
      case 'observation':
      case 'question':
        openQuote?.(m.text);
        break;
      case 'meeting':
        await seeMap(m);
        break;
      case 'friend':
        await sayHi(m);
        break;
      default:
        break;
    }
  }
  function agentPos(live) {
    if (!live) return null;
    if (Number.isFinite(live.lon) && Number.isFinite(live.lat)) return [live.lon, live.lat];
    const ll = live.marker?.getLngLat?.();
    if (ll && Number.isFinite(ll.lng) && Number.isFinite(ll.lat)) return [ll.lng, ll.lat];
    return null;
  }
  async function seeMap(m) {
    landOnMap();
    const id = m.otherAgentId;
    let live = liveAgent(id);
    if (!agentPos(live) && id && town?.refreshMap) {
      try { await town.refreshMap(getUser()); } catch { /* map list stays as it was */ }
      live = liveAgent(id);
    }
    const pos = agentPos(live);
    if (!pos || !map) return;
    flyTo(map, pos[0], pos[1], Math.max(map.getZoom?.() || 16, 17));
  }
  async function sayHi(m) {
    const u = getUser();
    const id = m.otherAgentId;
    if (!u || !id) return;
    const find = () => (threads?.threads || []).find((t) => t?.with?.id === id);
    let existing = find();
    if (!existing && threads?.load) {
      try { await threads.load(u); } catch { /* use the list already in memory */ }
      existing = find();
    }
    if (existing && threads?.openThread) {
      await threads.openThread(existing.id);
      return;
    }
    try {
      await sendConnect(u, { toAgentId: id, meetId: m.meetingId, text: hiDraft(m.otherAgentName || '') });
      toast('Hi sent');
    } catch (e) {
      toast(e?.status === 409 ? 'Hi sent' : connectError(e?.status));
    }
  }

  root.addEventListener('click', (e) => {
    if (swiped) { swiped = false; return; }
    if (e.target.closest('button')) return;
    if (!view) return;
    if (view.index >= view.moments.length) finish();
    else advance();
  });
  root.addEventListener('touchstart', (e) => { if (e.touches.length === 1) touchY = e.touches[0].clientY; }, { passive: true });
  root.addEventListener('touchend', (e) => {
    if (touchY == null || e.target.closest('button')) { touchY = null; return; }
    const dy = touchY - e.changedTouches[0].clientY;
    touchY = null;
    if (dy > 48 && view) { swiped = true; if (view.index >= view.moments.length) finish(); else advance(); }
  }, { passive: true });

  async function load(user) {
    const p = fetchRecap(user).then((r) => {
      if (r.missing && mockAllowed()) return { ok: true, show: true, moments: devMoments(), mock: true };
      if (!r.ok) return { ok: false };
      return r;
    }).catch(() => ({ ok: false }));
    const first = await Promise.race([
      p,
      new Promise((res) => setTimeout(() => res({ slow: true }), REC_MS)),
    ]);
    if (first.slow) {
      p.then((r) => { if (r?.ok && !view) applyServer(r); }).catch(() => {});
      return { ok: false, slow: true };
    }
    return first;
  }

  // Automatic overlay only when the server says show and a moment with text is still unseen.
  // The 15-minute rule stays on the server (show). ?onb=0 skips this unless ?recap=1 or ?recap=mock.
  // A slow or failed GET skips the overlay and leaves any news dot already earned.
  async function maybe({ user, force = false } = {}) {
    const n = ++seq;
    user = user || getUser();
    if (!user || user.isAnonymous || !getAgent()) return false;
    const res = await load(user);
    if (n !== seq) return false;
    if (!res.ok) return false;
    applyServer(res);
    const list = unseen();
    if (!list.length) return false;
    const auto = readSet(autoKey());
    const fresh = list.filter((m) => !auto.has(m.id));
    if (!force && !(res.show === true && fresh.length > 0 && autoShowAllowed())) return false;
    return present(force ? list : fresh);
  }

  async function fromMe() {
    closeSheet?.();
    const user = getUser();
    if (!user || !getAgent()) return false;
    if (!unseen().length) {
      const res = await load(user);
      if (res.ok) applyServer(res);
    }
    const list = unseen();
    if (!list.length) return false;
    return present(list);
  }

  function reset() { close(); cached = []; setNews?.(false); }
  // Open one card for a screenshot or a test, without a network call.
  function preview(moments, index = 0) {
    const list = pickMoments(moments);
    if (!list.length) return false;
    cached = list;
    publishNews();
    view = { moments: list, index: Math.max(0, Math.min(index, list.length)), auto: false };
    root.hidden = false;
    document.body.classList.add('recapOn');
    paint();
    return true;
  }

  return { maybe, fromMe, reset, preview, pick: pickMoments, get open() { return !!view; } };
}
