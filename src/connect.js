// Connect apps (Me -> Apps, app sheet) and in-chat confirm cards. connect-v1 spec (Diggy).
// Server shapes live in connect-api.js. Nothing here fakes a connection or runs an action without an Approve tap.
import { listApps, connectApp, disconnectApp, confirmApp, decide, isMissing } from './connect-api.js';

const META = {
  gdrive: { name: 'Google Drive', mk: 'D', google: true, connect: 'Connect with Google Drive',
    read: ['File names, and the contents of files you pick'], do: ['Find and summarise files'], never: ['Deletes or shares files'] },
  gcal: { name: 'Calendar', mk: 'C', google: true, connect: 'Connect with Google Calendar',
    read: ['Event titles, times and places on your calendars', 'Who else is invited'], do: ['Suggest times that are free', 'Add or move events, only after you tap Approve'], never: ['Deletes events or shares your calendar'] },
  gmail: { name: 'Gmail', mk: 'M', always: true, // no sign-in (#63): opens a Gmail compose; you send it yourself
    read: ['Nothing in your inbox'], do: ['Write an email and open it in Gmail, after you tap Approve'], never: ['Sends mail itself or reads your inbox'] },
  notion: { name: 'Notion', mk: 'N', connect: 'Connect with Notion',
    read: ['Pages you share with it'], do: ['Create and edit pages, only after you tap Approve'], never: ['Deletes pages'] },
  spotify: { name: 'Spotify', mk: 'S', connect: 'Connect with Spotify',
    read: ["What you're playing and your playlists"], do: ['Play, pause, add to a playlist, only after you tap Approve'], never: ['Changes your plan or account'] },
};
export const appMeta = (id) => META[id] || null;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const buzz = (p) => { try { navigator.vibrate?.(p); } catch { /* no vibration */ } };
const hhmm = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
export function ago(t, now = Date.now()) { const m = Math.max(0, Math.round((now - t) / 60000)); if (m < 1) return 'just now'; if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`; const h = Math.round(m / 60); if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`; const d = Math.round(h / 24); return `${d} day${d === 1 ? '' : 's'} ago`; }

// Tile state label (spec §1).
export function stateChip(state) {
  if (state === 'always') return '<span class="st ok">Always on</span>';
  if (state === 'soon') return '<span class="st c">Soon</span>';
  if (state === 'connected') return '<span class="st ok">Connected</span>';
  if (state === 'connecting') return '<span class="st w pulse">Connecting…</span>';
  if (state === 'expired') return '<span class="st e">Sign in again</span>';
  if (state === 'error') return '<span class="st e">Try again</span>';
  return '<span class="st c">Connect</span>';
}
const rows = (list, glyph) => list.map((t) => `<div class="li"><b aria-hidden="true">${glyph}</b><span>${esc(t)}</span></div>`).join('');
export function appsHtml(apps) {
  if (!apps?.length) return '';
  const n = apps.filter((a) => a.state === 'connected').length;
  return `<div class="cxHead"><span class="cap">Apps</span><span class="meta">${n} of ${apps.length} connected</span></div>`
    + apps.map((a) => `<button type="button" class="tile" data-app="${esc(a.id)}"${a.state === 'soon' ? ' disabled' : ''}><span class="mk" aria-hidden="true">${esc(META[a.id].mk)}</span><span class="tn">${esc(a.name || META[a.id].name)}${a.account && a.state !== 'none' ? `<small class="acct">${esc(a.account)}</small>` : ''}</span>${stateChip(META[a.id].always ? 'always' : a.state)}</button>`).join('')
    + '<p class="cxFoot">Your agent always asks before it sends, pays or submits.</p>';
}
export function sheetHtml(a, { busy = false, err = '', confirm = false } = {}) {
  const m = META[a.id], name = a.name || m.name, sc = a.scopes || {};
  const read = sc.read?.length ? sc.read : m.read, can = sc.do?.length ? sc.do : m.do, never = sc.never?.length ? sc.never : m.never;
  const status = a.state === 'connected' ? `<span class="ok" aria-hidden="true">●</span> Connected${a.account ? ' · ' + esc(a.account) : ''}`
    : a.state === 'expired' ? '<span class="e">Sign-in expired</span>' : `${m.google ? 'Google' : esc(name)} · not connected`;
  let foot;
  if (m.always) {
    return `<div class="grab" aria-hidden="true"></div><div class="cxTop"><span class="mk lg" aria-hidden="true">${esc(m.mk)}</span><div><h2>${esc(name)}</h2><p class="meta"><span class="ok" aria-hidden="true">●</span> Always on · no sign-in</p></div></div>`
      + `<div class="cap">Your agent can read</div>${rows(read, '✕')}<div class="cap">Your agent can do</div>${rows(can, '✓')}<div class="cap">It never</div>${rows(never, '✕')}<p class="cxNote">You send from Gmail yourself.</p>`;
  }
  if (a.state === 'connected') {
    foot = `<div class="cxLast"><b>${a.lastUsed ? 'Last used ' + esc(ago(a.lastUsed.at)) : 'Not used yet'}</b>${a.lastUsed?.summary ? `<small>${esc(a.lastUsed.summary)}</small>` : ''}</div>`
      + (confirm ? `<div class="cxConfirm"><p>Disconnect? Your agent loses access straight away.${m.google ? ' Google signs out Drive and Calendar together, so you sign in to the other one again.' : ''}</p><div class="cxRow"><button type="button" class="ghost cxCancel">Cancel</button><button type="button" class="primary cxDisc"${busy ? ' disabled' : ''}>Disconnect</button></div></div>`
        : `<button type="button" class="ghost danger cxAskDisc">Disconnect ${esc(name)}</button>`);
  } else {
    const label = busy ? 'Connecting…' : err ? 'Try again' : a.state === 'expired' ? `Sign in to ${name} again` : m.connect;
    foot = (err ? `<p class="cxErr" role="alert">${esc(err)}</p>` : '') + `<button type="button" class="primary cxGo"${busy ? ' disabled' : ''}>${esc(label)}</button><p class="cxNote">You can disconnect any time</p>`;
  }
  return `<div class="grab" aria-hidden="true"></div><div class="cxTop"><span class="mk lg" aria-hidden="true">${esc(m.mk)}</span><div><h2>${esc(name)}</h2><p class="meta">${status}</p></div></div>`
    + `<div class="cap">Your agent can read</div>${rows(read, '✓')}<div class="cap">Your agent can do</div>${rows(can, '✓')}<div class="cap">It never</div>${rows(never, '✕')}${foot}`;
}

// Confirm card (spec §4). Pure markup per state; the controller swaps it.
export function cardHtml(a, st = 'pending', { result = null, now = Date.now() } = {}) {
  const m = META[a.app], title = a.title || (a.kind === 'send' ? `Send with ${m.name}` : a.kind === 'pay' ? 'Pay' : a.kind === 'submit' ? `Submit with ${m.name}` : `Update ${m.name}`);
  const head = (cap) => `<div class="cxCardHd"><span class="mk sm" aria-hidden="true">${esc(m.mk)}</span><span class="cap">${esc(cap)}</span></div>`;
  const sum = a.summary ? `<p class="cxSum">${esc(a.summary).replace(/\n/g, '<br>')}</p>` : '';
  if (st === 'pending' || st === 'working') {
    const w = st === 'working';
    return head('Needs your OK') + `<b class="cxT">${esc(title)}</b>${sum}<div class="cxRow"><button type="button" class="ghost cxNo"${w ? ' disabled' : ''}>Cancel</button><button type="button" class="primary cxYes"${w ? ' disabled' : ''}>${w ? 'Working…' : 'Approve'}</button></div>`;
  }
  if (st === 'done') return head(m.name) + `<b class="cxT sm">${esc(title)}</b><p class="meta"><span class="ok" aria-hidden="true">✓</span> ${esc(result?.summary || 'Done')} · ${hhmm(result?.at || now)}</p>`
    + (result?.link ? `<button type="button" class="primary sm cxOpen">Open in Gmail</button>` : '')
    + (result?.mailto ? `<a class="cxMailto" href="${esc(result.mailto)}">Use another mail app</a>` : '');
  if (st === 'cancelled') return head(m.name) + `<b class="cxT sm">${esc(title)}</b><p class="meta">Cancelled · nothing was sent</p>`;
  if (st === 'error') return head(m.name) + `<b class="cxT sm">${esc(title)}</b><p class="meta e" role="alert">Couldn't ${a.kind === 'pay' ? 'pay' : a.kind === 'submit' ? 'submit' : a.kind === 'send' ? 'send' : 'finish'}. Nothing went out.</p><button type="button" class="ghost cxRetry">Try again</button>`;
  if (st === 'reauth') return head(`${m.name} · sign-in expired`) + `<p class="cxSum hi">Sign in to ${esc(m.name)} again to finish this.</p><button type="button" class="primary sm cxReauth">Sign in again</button>`;
  if (st === 'expired') return head(m.name) + `<b class="cxT sm">${esc(title)}</b><p class="meta">This request expired. Ask again.</p>`;
  return '';
}

export function setupConnect({ getUser, open = (u) => window.open(u, '_blank', 'noopener') } = {}) {
  let apps = null, available = false, pending = new Map(), errs = new Map(), sheetId = null, confirmDisc = false, busyDisc = false;
  const listeners = new Set(); let mounted = null;
  const U = () => { const u = getUser(); return u && !u.isAnonymous && typeof u.getIdToken === 'function' ? u : null; };
  const view = (a) => (pending.has(a.id) && a.state !== 'connected' ? { ...a, state: 'connecting' } : errs.has(a.id) && a.state !== 'connected' ? { ...a, state: 'error' } : a);
  const emit = () => { for (const f of listeners) f(); };

  async function refresh() {
    const u = U(); if (!u) { apps = null; available = false; emit(); return null; }
    try { const l = await listApps(u); apps = l; available = !!l?.length; } catch { /* keep last list on a transient error */ }
    for (const a of apps || []) if (a.state === 'connected' && pending.has(a.id)) { pending.delete(a.id); errs.delete(a.id); buzz([15, 40, 15]); document.dispatchEvent(new CustomEvent('cx-app-connected', { detail: a.id })); }
    emit(); drawSheet(); return apps;
  }
  // OAuth return (#63): /#/me?app=:id&result=ok&c=<confirm id> (or result=error); also ?connect=<app>&nonce=<id>.
  // Nothing shows as connected until POST /apps/:id/confirm succeeds (or, while that endpoint is not live, GET /apps says so).
  function handleReturn(hash = location.hash, search = location.search) {
    const m = /^#\/me\?(.*)$/.exec(hash || ''), sq = new URLSearchParams(search || '');
    let id, res, c;
    if (m) { const q = new URLSearchParams(m[1]); id = q.get('app'); res = q.get('result'); c = q.get('c') || q.get('nonce'); }
    else if (sq.get('connect')) { id = sq.get('connect'); res = sq.get('result') || 'ok'; c = sq.get('c') || sq.get('nonce'); }
    if (!META[id] || META[id].always || !/^(ok|error)$/.test(res || '')) return null;
    try { const k = new URLSearchParams(search || ''); for (const x of ['connect', 'nonce', 'c', 'result']) k.delete(x); const qs = k.toString(); history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '')); } catch { /* ignore */ }
    const fail = () => { pending.delete(id); errs.set(id, `Couldn't connect ${META[id].name}. Try again.`); emit(); drawSheet(); };
    if (res === 'error') { fail(); return { id, result: res }; }
    pending.set(id, Date.now()); errs.delete(id); emit(); drawSheet();
    const u = U();
    (async () => {
      if (c && u) { try { await confirmApp(u, id, c); } catch { fail(); await refresh(); return; } }
      await refresh();
      if (c && apps && apps.find((x) => x.id === id)?.state !== 'connected') fail();
    })();
    return { id, result: res };
  }
  async function startConnect(id) {
    const u = U(); if (!u) return;
    errs.delete(id); pending.set(id, Date.now()); emit(); drawSheet();
    try { open(await connectApp(u, id)); }
    catch { pending.delete(id); errs.set(id, `Couldn't connect ${META[id].name}. Try again.`); emit(); drawSheet(); }
  }
  addEventListener('hashchange', () => handleReturn());
  document.addEventListener('visibilitychange', () => { if (!document.hidden && pending.size) refresh(); });

  // ---- Apps section in Me
  function mount(box) {
    if (!box) return;
    const paint = () => { const show = available && apps?.length; box.hidden = !show; box.innerHTML = show ? appsHtml(apps.map(view)) : '';
      for (const b of box.querySelectorAll('.tile')) b.onclick = () => openSheet(b.dataset.app); };
    if (mounted) listeners.delete(mounted); mounted = paint; // one Apps section at a time (Me re-renders)
    listeners.add(paint); paint(); refresh();
  }
  // ---- App sheet (own bottom sheet + scrim; opacity/transform only)
  let sh = null, scrim = null;
  function ensureSheet() {
    if (sh) return;
    scrim = document.createElement('div'); scrim.id = 'cxScrim'; scrim.hidden = true;
    sh = document.createElement('section'); sh.id = 'cxSheet'; sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true'); sh.hidden = true;
    document.body.append(scrim, sh);
    scrim.onclick = closeSheet;
    let y0 = null, dy = 0;
    sh.addEventListener('pointerdown', (e) => { if (e.target.closest('.grab,.cxTop')) { y0 = e.clientY; dy = 0; sh.setPointerCapture?.(e.pointerId); } });
    sh.addEventListener('pointermove', (e) => { if (y0 === null) return; dy = Math.max(0, e.clientY - y0); sh.style.transform = `translateY(${dy}px)`; });
    const end = () => { if (y0 === null) return; y0 = null; sh.style.transform = ''; if (dy > 80) closeSheet(); };
    sh.addEventListener('pointerup', end); sh.addEventListener('pointercancel', end);
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetId) closeSheet(); });
  }
  function drawSheet() {
    if (!sh || !sheetId) return; const a = apps?.find((x) => x.id === sheetId); if (!a) { closeSheet(); return; }
    const v = view(a);
    sh.innerHTML = sheetHtml({ ...v, state: v.state === 'connecting' || v.state === 'error' ? a.state : v.state }, { busy: pending.has(a.id) || busyDisc, err: errs.get(a.id) || '', confirm: confirmDisc });
    sh.setAttribute('aria-label', a.name || META[a.id].name);
    sh.querySelector('.cxGo')?.addEventListener('click', () => startConnect(a.id));
    sh.querySelector('.cxAskDisc')?.addEventListener('click', () => { confirmDisc = true; drawSheet(); sh.querySelector('.cxDisc')?.focus(); });
    sh.querySelector('.cxCancel')?.addEventListener('click', () => { confirmDisc = false; drawSheet(); });
    sh.querySelector('.cxDisc')?.addEventListener('click', async () => {
      const u = U(); if (!u || busyDisc) return; busyDisc = true; drawSheet();
      try { const r = await disconnectApp(u, a.id); confirmDisc = false; for (const x of apps || []) if (r.reauth.includes(x.id)) x.state = 'expired'; } catch { errs.set(a.id, `Couldn't disconnect ${META[a.id].name}. Try again.`); }
      busyDisc = false; await refresh(); errs.delete(a.id);
    });
  }
  function openSheet(id) { ensureSheet(); sheetId = id; confirmDisc = false; drawSheet(); scrim.hidden = false; sh.hidden = false; requestAnimationFrame(() => { scrim.classList.add('on'); sh.classList.add('on'); }); }
  function closeSheet() { if (!sh) return; sheetId = null; scrim.classList.remove('on'); sh.classList.remove('on'); setTimeout(() => { if (!sheetId) { sh.hidden = true; scrim.hidden = true; } }, 320); }

  // ---- Confirm cards. Only shown when the apps API exists; never auto-run.
  const decided = new Set();
  function card(action) {
    if (!available || isMissing('actions')) return null;
    const el = document.createElement('div'); el.className = 'cxCard'; el.dataset.action = action.id; el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'Needs your OK');
    let st = 'pending', result = null, timer = 0;
    const set = (s, r = null) => { st = s; result = r; el.classList.remove('in'); void el.offsetWidth; el.innerHTML = cardHtml(action, st, { result }); el.classList.add('in'); bind(); };
    const arm = () => { clearTimeout(timer); const ms = action.expiresAt - Date.now(); if (ms <= 0) { set('expired'); return; } timer = setTimeout(() => { if (st === 'pending') set('expired'); }, Math.min(ms, 2 ** 31 - 1)); };
    async function go(decision) {
      if (decided.has(action.id) || (st !== 'pending' && st !== 'error')) return; // one decision per actionId
      if (Date.now() > action.expiresAt) { set('expired'); return; }
      const u = U(); if (!u) return; decided.add(action.id); clearTimeout(timer);
      if (decision === 'approve') { buzz(10); set('working'); }
      try { const r = await decide(u, action.id, decision); set(r.state === 'working' ? 'working' : r.state, r.result); if (r.state === 'error' || r.state === 'reauth') decided.delete(action.id); }
      catch { set(decision === 'cancel' ? 'pending' : 'error'); decided.delete(action.id); if (decision === 'cancel') arm(); }
    }
    function bind() {
      el.querySelector('.cxYes')?.addEventListener('click', () => go('approve'));
      el.querySelector('.cxNo')?.addEventListener('click', () => go('cancel'));
      el.querySelector('.cxOpen')?.addEventListener('click', () => { if (result?.link) open(result.link); }); // the owner sends from Gmail
      el.querySelector('.cxRetry')?.addEventListener('click', () => { st = 'pending'; set('pending'); arm(); });
      el.querySelector('.cxReauth')?.addEventListener('click', () => {
        const back = (e) => { if (e.detail !== action.app) return; document.removeEventListener('cx-app-connected', back); set('pending'); arm(); }; // back to needs-OK; never auto-runs
        document.addEventListener('cx-app-connected', back); startConnect(action.app);
      });
    }
    set('pending'); arm(); el.classList.remove('in');
    return el;
  }
  return { refresh, mount, openSheet, closeSheet, card, handleReturn, get available() { return available; }, get apps() { return apps; } };
}
