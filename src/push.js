// Android push registration. Permission is requested only from enablePush()
// (the opt-in sheet's Turn on, or the Me Notifications row). Diggy owns the sheet;
// mountPushStub is a marked placeholder. Web push is not registered here.

export const PUSH_URL = 'https://virtual-world-ai.onrender.com/me/push';
export const DEFAULT_ZONE = 'Asia/Kolkata';
// Same shape proxy/push.js accepts. Shorter or odd tokens are a 400, so they are not sent.
const TOKEN_RE = /^[A-Za-z0-9_:.-]{20,4096}$/;
export const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
export const CHANNEL_ID = 'virtual_world_default';
export const NOT_NOW_PREFIX = 'vw-push-not-now-until';
export const ENABLED_PREFIX = 'vw-push-enabled';
export const TOKEN_PREFIX = 'vw-push-token';

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

export function pushKey(prefix, uid) {
  return uid ? `${prefix}:${uid}` : prefix;
}

function safeGet(storage, key) {
  try { return storage?.getItem(key) ?? null; } catch { return null; }
}
function safeSet(storage, key, value) {
  try { storage?.setItem(key, value); } catch { /* storage blocked */ }
}
function safeRemove(storage, key) {
  try { storage?.removeItem(key); } catch { /* storage blocked */ }
}

export function readTime(storage, key) {
  const n = Number(safeGet(storage, key));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function cleanPushId(value) {
  const s = typeof value === 'string' ? value.trim() : '';
  return ID_RE.test(s) ? s : '';
}

// Open at the moment card. momentId wins; meetingId is the fallback. No match leaves the deck as it was.
export function deckForPush(list, { momentId = '', meetingId = '' } = {}) {
  const items = Array.isArray(list) ? list.filter(Boolean) : [];
  const moment = cleanPushId(momentId);
  const meeting = cleanPushId(meetingId);
  if (moment) {
    const at = items.findIndex((m) => m.id === moment);
    if (at >= 0) return items.slice(at);
  }
  if (meeting) {
    const at = items.findIndex((m) => m.meetingId === meeting || m.id === meeting);
    if (at >= 0) return items.slice(at);
  }
  return items;
}

export function deviceTimeZone(intl = globalThis.Intl) {
  try {
    const zone = intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof zone === 'string' && zone.trim()) return zone.trim();
  } catch { /* Intl missing */ }
  return DEFAULT_ZONE;
}

// Platform is separate: Diggy can ask on the web, and this client only shows its stub on Android.
export function shouldOfferPush({ signedIn, anonymous, enabled, notNowUntil, now }) {
  if (!signedIn || anonymous || enabled) return false;
  if (typeof notNowUntil === 'number' && notNowUntil > now) return false;
  return true;
}

export function registerBody(token, { platform = 'android', enabled = true, timeZone = DEFAULT_ZONE } = {}) {
  if (platform !== 'android' && platform !== 'web') return null;
  if (typeof enabled !== 'boolean') return null;
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
  const zone = typeof timeZone === 'string' && timeZone.trim() ? timeZone.trim() : DEFAULT_ZONE;
  return { token, platform, enabled, timeZone: zone };
}

export function unregisterBody(token) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
  return { token };
}

// GET /me/push. A missing boolean means the catch-all "ok" or a route that is not live yet.
export function readPushState(json) {
  if (!json || typeof json !== 'object' || typeof json.enabled !== 'boolean') return null;
  const platforms = Array.isArray(json.platforms) ? json.platforms.filter((p) => p === 'web' || p === 'android') : [];
  return {
    enabled: json.enabled,
    timeZone: typeof json.timeZone === 'string' && json.timeZone ? json.timeZone : DEFAULT_ZONE,
    count: Number.isFinite(Number(json.count)) ? Number(json.count) : 0,
    platforms,
  };
}

// 404/405 means Buildy has not shipped the route yet. The app keeps going.
export function classifyPushResponse(status) {
  if (status === 404 || status === 405) return 'pending';
  if (status === 401 || status === 403) return 'auth';
  if (status >= 200 && status < 300) return 'ok';
  return 'error';
}

function coerceData(raw) {
  if (typeof raw === 'string') {
    try { return coerceData(JSON.parse(raw)); } catch { return null; }
  }
  if (!raw || typeof raw !== 'object') return null;
  if (raw.notification && typeof raw.notification === 'object' && raw.notification.data != null) {
    return coerceData(raw.notification.data);
  }
  return raw;
}

// Pull momentId out of the proxy's recap url. Other hosts are ignored.
export function momentFromUrl(url) {
  if (typeof url !== 'string' || !url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'vishnupoola-999.github.io') return '';
    const path = parsed.pathname.replace(/\/$/, '');
    if (path !== '/virtual-world') return '';
    return cleanPushId(parsed.searchParams.get('moment'));
  } catch {
    return '';
  }
}

// Proxy data is strings: type live|daily, momentId, meetingId, url.
// momentId opens that card. The url's moment param is the fallback. Otherwise the plain recap.
export function pushTarget(raw) {
  const data = coerceData(raw);
  if (!data) return null;
  const type = typeof data.type === 'string' ? data.type.trim() : '';
  if (type !== 'live' && type !== 'daily') return null;
  const momentId = cleanPushId(data.momentId) || momentFromUrl(data.url);
  const meetingId = cleanPushId(data.meetingId);
  return { type, momentId, meetingId, url: typeof data.url === 'string' ? data.url : '' };
}

function memoryStorage() {
  const bag = new Map();
  return {
    getItem: (k) => (bag.has(k) ? bag.get(k) : null),
    setItem: (k, v) => { bag.set(k, String(v)); },
    removeItem: (k) => { bag.delete(k); },
  };
}

export function browserStorage() {
  try {
    const probe = '__vw_push_probe';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return memoryStorage();
  }
}

// Uses the Capacitor bridge injected into the Android WebView. Importing the npm
// package would 404 on GitHub Pages, which serves these files as plain scripts.
export function capacitorPushBridge(cap = globalThis.Capacitor) {
  if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return null;
  if (typeof cap.getPlatform === 'function' && cap.getPlatform() !== 'android') return null;
  if (typeof cap.nativePromise !== 'function' || typeof cap.addListener !== 'function') return null;
  const receive = (result) => {
    const value = result?.receive;
    if (value === 'granted' || value === 'denied' || value === 'prompt') return value;
    return 'prompt';
  };
  return {
    platform: 'android',
    requestPermissions: () => cap.nativePromise('PushNotifications', 'requestPermissions', {}).then(receive),
    checkPermissions: () => cap.nativePromise('PushNotifications', 'checkPermissions', {}).then(receive),
    register: () => cap.nativePromise('PushNotifications', 'register', {}),
    unregister: () => cap.nativePromise('PushNotifications', 'unregister', {}),
    createChannel: (channel) => cap.nativePromise('PushNotifications', 'createChannel', channel),
    addListener: (event, cb) => cap.addListener('PushNotifications', event, cb),
  };
}

export function createPushClient({
  storage,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  getUser = () => null,
  bridge = null,
  openRecap = () => true,
  url = PUSH_URL,
  timeZone = deviceTimeZone,
  blocked = () => false,
  onOffer = () => {},
} = {}) {
  let user = null;
  let signInOffer = false;
  let recapOffer = false;
  let listening = false;
  let posted = null;
  let remote = null;
  let pendingTarget = null;
  let postChain = Promise.resolve();
  const supports = () => bridge?.platform === 'android';
  const account = () => user || getUser() || null;
  const uidOf = (u) => u?.uid || '';

  function enabledKey(u = account()) { return pushKey(ENABLED_PREFIX, uidOf(u)); }
  function snoozeKey(u = account()) { return pushKey(NOT_NOW_PREFIX, uidOf(u)); }
  function tokenKey(u = account()) { return pushKey(TOKEN_PREFIX, uidOf(u)); }
  function readEnabled(u = account()) { return !!u && safeGet(storage, enabledKey(u)) === '1'; }

  function notNowUntil(u = account()) {
    return readTime(storage, snoozeKey(u));
  }

  function shouldOffer() {
    const u = account();
    return shouldOfferPush({
      signedIn: !!u,
      anonymous: !!u?.isAnonymous,
      enabled: readEnabled(u),
      notNowUntil: notNowUntil(u),
      now: now(),
    });
  }

  function zone() {
    try {
      const value = typeof timeZone === 'function' ? timeZone() : timeZone;
      return typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_ZONE;
    } catch {
      return DEFAULT_ZONE;
    }
  }

  async function readResponse(res) {
    const kind = classifyPushResponse(res?.status);
    if (kind !== 'ok') return { kind, status: res?.status };
    let json;
    try { json = typeof res.json === 'function' ? await res.json() : null; } catch { json = null; }
    const state = readPushState(json);
    if (!state) return { kind: 'pending', status: res?.status };
    return { kind: 'ok', status: res?.status, state };
  }

  async function postToken(token) {
    const u = account();
    const body = registerBody(token, { platform: 'android', enabled: true, timeZone: zone() });
    if (!u || u.isAnonymous || !body || !readEnabled(u)) return { kind: 'skipped' };
    if (posted?.token === body.token && posted.kind === 'ok' && posted.uid === u.uid) return { kind: 'ok', skipped: true };
    let res;
    try {
      const idToken = await u.getIdToken();
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + idToken, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      return { kind: 'error' };
    }
    const parsed = await readResponse(res);
    if (parsed.kind === 'ok' || parsed.kind === 'pending') safeSet(storage, tokenKey(u), body.token);
    if (parsed.state) remote = parsed.state;
    posted = { token: body.token, kind: parsed.kind, uid: u.uid };
    return parsed;
  }

  async function deleteToken(u) {
    const key = tokenKey(u);
    const token = u ? safeGet(storage, key) : null;
    if (u && token && !u.isAnonymous) {
      const body = unregisterBody(token);
      if (body) {
        try {
          const idToken = await u.getIdToken();
          await fetchImpl(url, {
            method: 'DELETE',
            headers: { Authorization: 'Bearer ' + idToken, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
        } catch { /* local token is still dropped so the next sign-in can register again */ }
      }
    }
    if (u) safeRemove(storage, key);
    posted = null;
    remote = null;
    if (supports() && token) {
      try { await bridge.unregister(); } catch { /* the server delete is the one that stops sends */ }
    }
  }

  function status() {
    const local = readEnabled();
    const known = remote && remote.pending !== true && typeof remote.enabled === 'boolean';
    return {
      enabled: known ? remote.enabled || local : local,
      timeZone: remote?.timeZone || '',
      count: remote?.count || 0,
      platforms: remote?.platforms || [],
      pending: remote?.pending === true,
    };
  }

  async function refreshStatus() {
    const u = account();
    if (!u || u.isAnonymous) return status();
    let res;
    try {
      const idToken = await u.getIdToken();
      res = await fetchImpl(url, { headers: { Authorization: 'Bearer ' + idToken } });
    } catch {
      return status();
    }
    const parsed = await readResponse(res);
    if (parsed.kind === 'ok' && parsed.state) {
      remote = parsed.state;
      if (parsed.state.enabled) safeSet(storage, enabledKey(u), '1');
    } else if (parsed.kind === 'pending') {
      remote = { ...(remote || {}), pending: true };
    }
    return status();
  }

  function onToken(token) {
    const run = postChain.then(() => postToken(token));
    postChain = run.then(() => {}, () => {});
    return run;
  }

  function flush() {
    if (!pendingTarget) return false;
    const u = account();
    if (!u || u.isAnonymous) return false;
    let opened;
    try { opened = openRecap(pendingTarget) !== false; } catch { opened = false; }
    if (!opened) return false;
    pendingTarget = null;
    return true;
  }

  function onAction(payload) {
    const target = pushTarget(payload);
    if (!target) return false;
    pendingTarget = target;
    return flush();
  }

  function listen() {
    if (listening || !supports() || typeof bridge.addListener !== 'function') return;
    listening = true;
    try {
      bridge.addListener('registration', (ev) => { void onToken(ev?.value); });
      bridge.addListener('registrationError', () => {});
      bridge.addListener('pushNotificationActionPerformed', (ev) => { onAction(ev); });
    } catch {
      listening = false;
    }
  }

  async function ensureChannel() {
    if (!supports() || typeof bridge.createChannel !== 'function') return;
    try {
      await bridge.createChannel({
        id: CHANNEL_ID,
        name: 'Virtual World',
        description: 'Daily recap and meetings',
        importance: 3,
      });
    } catch { /* MainActivity creates the same channel at process start */ }
  }

  async function enablePush() {
    const u = getUser() || user;
    if (!u || u.isAnonymous) return { ok: false, reason: 'signed-out' };
    user = u;
    if (!supports()) return { ok: false, reason: 'unsupported' };
    let perm;
    try { perm = await bridge.requestPermissions(); } catch { return { ok: false, reason: 'error' }; }
    if (perm !== 'granted') return { ok: false, reason: 'denied' };
    safeSet(storage, enabledKey(u), '1');
    safeRemove(storage, snoozeKey(u));
    signInOffer = false;
    recapOffer = false;
    listen();
    await ensureChannel();
    try { await bridge.register(); } catch { return { ok: false, reason: 'error' }; }
    return { ok: true, reason: 'granted' };
  }

  function snooze(at = now()) {
    const u = account();
    if (!u || u.isAnonymous) return 0;
    const until = at + SNOOZE_MS;
    safeSet(storage, snoozeKey(u), String(until));
    signInOffer = false;
    recapOffer = false;
    return until;
  }

  async function refresh() {
    if (!supports() || !readEnabled()) return;
    let perm;
    try { perm = await bridge.checkPermissions(); } catch { return; }
    if (perm !== 'granted') return;
    listen();
    await ensureChannel();
    try { await bridge.register(); } catch { /* the next sign-in tries again */ }
  }

  function onAuth(next, { restored = false } = {}) {
    if (!next) {
      user = null;
      signInOffer = false;
      return;
    }
    user = next;
    if (!restored && !next.isAnonymous) signInOffer = true;
    flush();
    if (!next.isAnonymous && readEnabled(next)) void refresh();
  }

  async function forget(u) {
    const accountUser = u || user;
    signInOffer = false;
    recapOffer = false;
    await deleteToken(accountUser);
    user = null;
  }

  function onRecapEnd() {
    recapOffer = true;
    return maybeOffer();
  }

  function maybeOffer() {
    if (!signInOffer && !recapOffer) return false;
    if (blocked()) return false;
    if (!shouldOffer()) {
      signInOffer = false;
      recapOffer = false;
      return false;
    }
    // The stub is Android-only. Diggy's sheet calls shouldOffer(), enablePush(), and snooze().
    if (!supports()) return false;
    signInOffer = false;
    recapOffer = false;
    try { onOffer(); } catch { /* the stub is optional */ }
    return true;
  }

  listen();

  return {
    enablePush,
    snooze,
    notNowUntil,
    shouldOffer,
    maybeOffer,
    onAuth,
    onRecapEnd,
    forget,
    flush,
    status,
    refreshStatus,
    supported: supports,
  };
}

// Placeholder sheet. Diggy replaces this. Turn on is the only control that calls enablePush().
export function mountPushStub(doc, client) {
  const dialog = doc.createElement('dialog');
  dialog.id = 'pushOptIn';
  dialog.dataset.stub = 'push-opt-in';
  dialog.dataset.owner = 'diggy';
  dialog.setAttribute('aria-label', 'Notifications');
  const note = doc.createElement('p');
  note.textContent = 'Stub. Diggy replaces this sheet.';
  const turnOn = doc.createElement('button');
  turnOn.type = 'button';
  turnOn.dataset.act = 'on';
  turnOn.textContent = 'Turn on';
  const later = doc.createElement('button');
  later.type = 'button';
  later.dataset.act = 'later';
  later.textContent = 'Not now';
  turnOn.addEventListener('click', () => {
    dialog.close?.();
    void client.enablePush();
  });
  later.addEventListener('click', () => {
    client.snooze();
    dialog.close?.();
  });
  dialog.append(note, turnOn, later);
  doc.body.append(dialog);
  return {
    show() {
      if (dialog.open) return;
      dialog.showModal?.();
    },
    el: dialog,
  };
}

export function installPush(opts = {}) {
  const bridge = opts.bridge === undefined ? capacitorPushBridge() : opts.bridge;
  let stub = null;
  const client = createPushClient({
    storage: opts.storage || browserStorage(),
    fetchImpl: opts.fetchImpl,
    now: opts.now,
    getUser: opts.getUser,
    bridge,
    openRecap: opts.openRecap,
    url: opts.url,
    blocked: opts.blocked,
    onOffer() {
      const doc = opts.document || globalThis.document;
      if (!doc?.createElement || !doc.body) return;
      stub ||= mountPushStub(doc, client);
      stub.show();
    },
  });
  return client;
}
