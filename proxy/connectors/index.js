// App connections (Connect v1, docs/DESIGN.md "Connect apps API"). Provider registry, encrypted token store,
// pending agent actions and the HTTP handlers. Add Notion/Spotify by adding a provider + APP_DEFS entries.
import { randomBytes } from 'node:crypto';
import * as google from './google.js';
import { decrypt, encrypt, KeyMismatchError, newNonce, parseKey, signState, verifyState } from './crypto.js';

// Public app ids (Diggy's spec) -> provider + provider-local app.
export const APP_DEFS = [
  { id: 'gdrive', name: 'Google Drive', provider: 'google', app: 'drive', scopes: { read: ['Only files you open with Virtual World or it created'], do: ['Find those files'], never: ['Sees the rest of your Drive, deletes or shares files'] } },
  { id: 'gcal', name: 'Google Calendar', provider: 'google', app: 'calendar', scopes: { read: ['Event titles, times, places', 'Who\'s invited'], do: ['Suggest free times', 'Add events, only after you tap Approve'], never: ['Deletes events or shares your calendar'] } },
  // Gmail needs no sign-in: the agent prepares a compose link and you send it yourself from Gmail.
  { id: 'gmail', name: 'Gmail', provider: null, linkOnly: true, scopes: { read: ['Nothing. No access to your mail'], do: ['Open a prefilled email in Gmail after you tap Approve'], never: ['Reads, sends or deletes mail'] } },
  { id: 'notion', name: 'Notion', provider: null, scopes: { read: ['Pages you share with it'], do: ['Create and edit pages, only after you tap Approve'], never: ['Deletes pages'] } },
  { id: 'spotify', name: 'Spotify', provider: null, scopes: { read: ['What you\'re playing and your playlists'], do: ['Play, pause, add to playlist, only after you tap Approve'], never: ['Changes your plan or account'] } },
];
const BY_ID = new Map(APP_DEFS.map((d) => [d.id, d]));
const PROVIDERS = { google };
export const ACTION_TTL_MS = 15 * 60_000;
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const APP_RETURN = 'https://vishnupoola-999.github.io/virtual-world/';

export class ConnectHttpError extends Error { constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; } }

// Firestore REST store. connectorTokens/{uid}: one field `data` = AES-GCM(JSON record), uid as AAD.
// connectorPending/{nonce}: OAuth state nonces and exchanged-but-unconfirmed grants, AES-GCM with the nonce as AAD.
// firestore.rules deny both collections to every client; only the proxy's admin token can touch them.
// Logs carry HTTP status codes only.
export function firestoreTokenStore(admin, key, db = 'default') {
  if (!admin || !key) return null;
  const base = `https://firestore.googleapis.com/v1/projects/${admin.projectId}/databases/${encodeURIComponent(db)}/documents`;
  const url = (uid) => `${base}/connectorTokens/${uid}`;
  const purl = (n) => `${base}/connectorPending/${n}`;
  const auth = async () => ({ Authorization: `Bearer ${await admin.accessToken()}` });
  const write = async (u, blob, extra = {}) => {
    const body = { fields: { data: { stringValue: blob }, updatedAt: { timestampValue: new Date(admin.now()).toISOString() }, ...extra } };
    const r = await admin.fetchImpl(u, { method: 'PATCH', headers: { ...await auth(), 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`token write ${r.status}`);
  };
  return {
    async get(uid) {
      if (!UID_RE.test(uid)) return null;
      const r = await admin.fetchImpl(url(uid), { headers: await auth(), signal: AbortSignal.timeout(5000) });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`token read ${r.status}`);
      const blob = (await r.json()).fields?.data?.stringValue;
      if (!blob) return null;
      // Wrong/rotated key or damaged doc: treat as signed out (state 'reauth'), never a 500.
      try { return JSON.parse(decrypt(key, blob, uid)); } catch (e) { console.warn('connector record unreadable', e instanceof KeyMismatchError ? 'key id mismatch' : 'decrypt failed'); return { _corrupt: true }; }
    },
    async put(uid, rec) {
      if (!UID_RE.test(uid)) throw new Error('bad uid');
      await write(url(uid), encrypt(key, JSON.stringify(rec), uid));
    },
    async del(uid) {
      if (!UID_RE.test(uid)) return;
      const r = await admin.fetchImpl(url(uid), { method: 'DELETE', headers: await auth(), signal: AbortSignal.timeout(8000) });
      if (!r.ok) console.warn('connector token delete failed', r.status);
    },
    async putPending(nonce, rec) {
      if (!NONCE_RE.test(nonce)) throw new Error('bad nonce');
      await write(purl(nonce), encrypt(key, JSON.stringify(rec), `pending:${nonce}`), { expireAt: { timestampValue: new Date(rec.exp).toISOString() } });
    },
    // Single use: read, then delete with an updateTime precondition. Only one caller can win the delete.
    async takePending(nonce) {
      if (!NONCE_RE.test(nonce)) return null;
      const r = await admin.fetchImpl(purl(nonce), { headers: await auth(), signal: AbortSignal.timeout(5000) });
      if (!r.ok) return null;
      const doc = await r.json();
      const d = await admin.fetchImpl(`${purl(nonce)}?currentDocument.updateTime=${encodeURIComponent(doc.updateTime || '')}`, { method: 'DELETE', headers: await auth(), signal: AbortSignal.timeout(5000) });
      if (!d.ok) { console.warn('connector pending consume failed', d.status); return null; }
      try { return JSON.parse(decrypt(key, doc.fields?.data?.stringValue, `pending:${nonce}`)); } catch { return null; }
    },
  };
}

export const STATE_TTL_MS = 10 * 60_000;
export const CONFIRM_TTL_MS = 10 * 60_000;
const NONCE_RE = /^[A-Za-z0-9_-]{16,40}$/;

export function createConnectors({ env = process.env, admin = null, store, fetchImpl = fetch, now = () => Date.now() } = {}) {
  const key = parseKey(env.CONNECTOR_TOKEN_KEY);
  const cfg = { google: google.config(env) };
  const tokens = store !== undefined ? store : firestoreTokenStore(admin, key, env.FIRESTORE_DATABASE_ID || 'default');
  const ready = (provider) => !!(provider && cfg[provider] && key && tokens);
  const pending = new Map(); // actionId -> {uid, name, args, app, kind, title, summary, expiresAt, state, timeZone, result}
  const notConfigured = () => new ConnectHttpError(503, 'not configured');

  async function record(uid) { return (await tokens.get(uid)) || {}; }
  const clean = (rec) => (rec._corrupt ? {} : rec);
  function appState(def, rec) {
    if (def.linkOnly) return 'connected';
    if (!ready(def.provider)) return 'soon';
    if (rec._corrupt) return 'reauth';
    const p = rec[def.provider];
    if (!p || !(p.apps || []).includes(def.app)) return 'connect';
    return p.broken ? 'reauth' : 'connected';
  }

  async function listApps(uid) {
    let rec = {};
    if (tokens && key) { try { rec = await record(uid); } catch (e) { console.error('connectors read', String(e.message).slice(0, 80)); } }
    return APP_DEFS.map((d) => {
      const state = appState(d, rec);
      const used = rec[d.provider]?.lastUsed?.[d.app];
      return { id: d.id, name: d.name, state, ...(rec[d.provider]?.account && state === 'connected' ? { email: rec[d.provider].account } : {}), ...(used ? { lastUsed: used } : {}), scopes: d.scopes };
    });
  }

  async function startConnect(uid, appId) {
    const def = BY_ID.get(appId);
    if (!def) throw new ConnectHttpError(404, 'unknown app');
    if (def.linkOnly) throw new ConnectHttpError(400, 'no sign-in needed');
    if (!ready(def.provider)) throw notConfigured();
    const rec = clean(await record(uid));
    // Incremental: ask for this app's scopes; include_granted_scopes keeps the ones already granted.
    const have = (rec[def.provider]?.apps || []).filter((a) => a !== def.app && !rec[def.provider]?.broken);
    const nonce = newNonce();
    const apps = [...have, def.app];
    await tokens.putPending(nonce, { stage: 'state', uid, provider: def.provider, apps, ret: appId, exp: now() + STATE_TTL_MS });
    const state = signState(key, { uid, provider: def.provider, apps, ret: appId, nonce }, now());
    return { authUrl: PROVIDERS[def.provider].authUrl(cfg[def.provider], [def.app], state) };
  }

  // Browser redirect from Google. Consumes the state nonce (single use), exchanges the code, and parks the result
  // under a new confirm id. Nothing is saved to the user's record until the signed-in app calls confirm().
  async function callback(provider, query) {
    const back = (appId, result, nonce) => `${APP_RETURN}?connect=${encodeURIComponent(appId || '')}${result === 'ok' ? `&nonce=${nonce}` : '&result=error'}#/me`;
    if (!ready(provider)) return back('', 'error');
    const st = verifyState(key, query.get('state'), now());
    if (!st || st.provider !== provider || !BY_ID.has(st.ret)) return back('', 'error');
    try {
      const saved = await tokens.takePending(st.nonce);
      if (!saved || saved.stage !== 'state' || saved.uid !== st.uid || saved.ret !== st.ret || saved.exp < now()) return back(st.ret, 'error');
      const code = query.get('code');
      if (!code || query.get('error')) return back(st.ret, 'error');
      const P = PROVIDERS[provider];
      const ex = await P.exchangeCode(cfg[provider], code, fetchImpl);
      const granted = P.appsFromScopes(ex.scopes);
      if (!granted.includes(BY_ID.get(st.ret).app)) return back(st.ret, 'error'); // user unticked the scope
      const c = newNonce();
      await tokens.putPending(c, { stage: 'exchanged', uid: st.uid, provider, apps: saved.apps, ret: st.ret, exp: now() + CONFIRM_TTL_MS, rt: ex.refreshToken, scopes: ex.scopes, email: ex.email || '' });
      return back(st.ret, 'ok', c);
    } catch (e) {
      console.error('connect callback failed', e.code || 'error');
      return back(st.ret, 'error');
    }
  }

  // POST /apps/:id/confirm {nonce}. The caller's Firebase uid must match the uid that started the flow.
  async function confirm(uid, appId, c) { // c = the confirm nonce from the redirect
    const def = BY_ID.get(appId);
    if (!def) throw new ConnectHttpError(404, 'unknown app');
    if (!ready(def.provider)) throw notConfigured();
    if (typeof c !== 'string' || !NONCE_RE.test(c)) throw new ConnectHttpError(400, 'bad request');
    const p = await tokens.takePending(c);
    if (!p || p.stage !== 'exchanged' || p.ret !== appId || p.provider !== def.provider) throw new ConnectHttpError(410, 'expired');
    if (p.uid !== uid) throw new ConnectHttpError(403, 'not your connection');
    if (p.exp < now()) throw new ConnectHttpError(410, 'expired');
    const rec = clean(await record(uid));
    const prev = rec[def.provider] || {};
    const refreshToken = p.rt || (prev.broken ? '' : prev.rt);
    if (!refreshToken) throw new ConnectHttpError(409, 'reauth');
    const granted = PROVIDERS[def.provider].appsFromScopes(p.scopes);
    const apps = [...new Set([...(prev.broken ? [] : prev.apps || []), ...p.apps])].filter((a) => granted.includes(a));
    rec[def.provider] = { rt: refreshToken, apps, scopes: p.scopes, account: p.email || prev.account || '', lastUsed: prev.lastUsed || {}, connectedAt: now() };
    await tokens.put(uid, rec);
    return { state: 'connected', ...(rec[def.provider].account ? { email: rec[def.provider].account } : {}) };
  }

  // Google can't revoke one scope, so disconnecting any Google app revokes the whole grant. Other Google apps
  // stay listed as 'reauth' (Sign in again); the UI says so before the owner confirms.
  async function disconnect(uid, appId) {
    const def = BY_ID.get(appId);
    if (!def) throw new ConnectHttpError(404, 'unknown app');
    if (def.linkOnly) throw new ConnectHttpError(400, 'nothing to disconnect');
    if (!ready(def.provider)) throw notConfigured();
    const rec = clean(await record(uid));
    const p = rec[def.provider];
    let others = [];
    if (p) {
      if (p.rt) {
        const status = await PROVIDERS[def.provider].revoke(p.rt, fetchImpl);
        if (status !== 200) console.warn('connector revoke failed', status);
      }
      others = (p.apps || []).filter((a) => a !== def.app);
      if (others.length) rec[def.provider] = { apps: others, broken: true, account: p.account || '', lastUsed: p.lastUsed || {} };
      else delete rec[def.provider];
    }
    if (Object.keys(rec).length) await tokens.put(uid, rec); else await tokens.del(uid);
    for (const [id, a] of pending) if (a.uid === uid && (a.app === appId || others.length)) pending.delete(id);
    const reauth = APP_DEFS.filter((d) => d.provider === def.provider && others.includes(d.app)).map((d) => d.id);
    return { state: 'connect', ...(reauth.length ? { reauth } : {}) };
  }

  // ---- chat integration -------------------------------------------------------------------
  // Tool declarations for the apps this user has connected (empty when none / not configured).
  async function toolsFor(uid) {
    const link = Object.values(google.TOOLS).filter((t) => t.link).map((t) => t.declaration);
    if (!ready('google')) return { declarations: link, apps: ['gmail'] };
    let rec = {};
    try { rec = await record(uid); } catch { /* link-only tools still work */ }
    const g = rec.google;
    const apps = g && !g.broken ? g.apps || [] : [];
    const declarations = Object.values(google.TOOLS).filter((t) => t.link || apps.includes(t.app)).map((t) => t.declaration);
    return { declarations, apps: [...apps, 'gmail'] };
  }
  const isTool = (name) => Object.hasOwn(google.TOOLS, name);
  const appIdOf = (name) => (google.TOOLS[name].link ? 'gmail' : APP_DEFS.find((d) => d.provider === 'google' && d.app === google.TOOLS[name].app).id);

  async function accessToken(uid) {
    const rec = clean(await record(uid));
    const g = rec.google;
    if (!g?.rt || g.broken) throw new google.ConnectorError('revoked', 'Sign in again to finish this.', 409);
    try { return await google.refreshAccess(cfg.google, g.rt, fetchImpl); } catch (e) {
      if (e.code === 'revoked') { g.broken = true; await tokens.put(uid, rec).catch(() => {}); }
      throw e;
    }
  }
  async function markUsed(uid, app, summary) {
    try { const rec = await record(uid); if (rec.google) { rec.google.lastUsed = { ...(rec.google.lastUsed || {}), [app]: { at: now(), summary: summary.slice(0, 120) } }; await tokens.put(uid, rec); } } catch { /* best effort */ }
  }

  // Handles one model functionCall. Reads run now and return {result}; writes become a pending action.
  async function handleCall(uid, call, timeZone) {
    if (!call || !isTool(call.name)) return null;
    const tool = google.TOOLS[call.name];
    const args = google.cleanArgs(call.name, call.args);
    if (!args) return null;
    const app = appIdOf(call.name);
    if (!tool.write) {
      try {
        const out = await google.runTool(call.name, args, { token: await accessToken(uid), fetchImpl, now: now(), timeZone });
        return { result: { name: call.name, app, text: out.text } };
      } catch (e) {
        return { result: { name: call.name, app, text: e.message || 'That didn\'t work. Try again.', error: e.code === 'revoked' || e.code === 'expired' ? 'reauth' : 'error' } };
      }
    }
    const id = `act_${randomBytes(12).toString('hex')}`;
    const view = describe(call.name, args);
    const a = { id, uid, name: call.name, args, app, kind: 'write', ...view, expiresAt: now() + ACTION_TTL_MS, state: 'pending', timeZone };
    pending.set(id, a);
    if (pending.size > 5000) for (const [k, v] of pending) if (v.expiresAt < now()) pending.delete(k);
    return { action: actionOut(a) };
  }
  const actionOut = (a) => ({ id: a.id, app: a.app, kind: a.kind, title: a.title, summary: a.summary, expiresAt: a.expiresAt, state: a.state });

  async function decide(uid, id, decision) {
    const a = pending.get(id);
    if (!a || a.uid !== uid) throw new ConnectHttpError(404, 'unknown action');
    if (a.state === 'working' || a.state === 'done' || a.state === 'cancelled') return { state: a.state, app: a.app, ...(a.result ? { result: a.result } : {}) }; // idempotent
    if (a.expiresAt < now()) { pending.delete(id); return { state: 'expired', app: a.app }; }
    if (decision === 'cancel') { a.state = 'cancelled'; return { state: 'cancelled', app: a.app }; }
    if (decision !== 'approve') throw new ConnectHttpError(400, 'bad decision');
    if (google.TOOLS[a.name].link) {
      // No Google call: hand back the compose link; the card opens it and the owner sends from Gmail.
      a.state = 'done';
      a.result = { summary: 'Opened in Gmail. Nothing is sent until you send it.', at: now(), ...google.composeLinks(a.args) };
      return { state: 'done', app: a.app, result: a.result };
    }
    a.state = 'working';
    try {
      const out = await google.runTool(a.name, a.args, { token: await accessToken(uid), fetchImpl, now: now(), timeZone: a.timeZone });
      a.state = 'done';
      a.result = { summary: out.text, at: now(), ...(out.data?.link ? { link: out.data.link } : {}) };
      await markUsed(uid, google.TOOLS[a.name].app, a.title);
      return { state: 'done', app: a.app, result: a.result };
    } catch (e) {
      // Leave it approvable again (Try again / after Sign in again). Never auto-runs.
      a.state = 'pending';
      if (e.code === 'revoked' || e.code === 'expired' || e.code === 'consent') return { state: 'reauth', app: a.app };
      return { state: 'error', app: a.app, error: e.message };
    }
  }

  return { configured: () => ready('google'), listApps, startConnect, callback, confirm, disconnect, toolsFor, isTool, handleCall, decide, _pending: pending };
}

export function describe(name, args) {
  if (name === 'calendar_create_event') return { title: 'Add event to Calendar', summary: [args.title, `${args.start} → ${args.end}`, args.location].filter(Boolean).join('\n') };
  if (name === 'gmail_compose') return { title: `Email ${args.to} in Gmail`, summary: [`To: ${args.to}`, `Subject: ${args.subject || '(no subject)'}`, args.body.slice(0, 140)].join('\n') };
  return { title: name, summary: '' };
}
