// App connections (Connect v1, docs/DESIGN.md "Connect apps API"). Provider registry, encrypted token store,
// pending agent actions and the HTTP handlers. Add Notion/Spotify by adding a provider + APP_DEFS entries.
import { randomBytes } from 'node:crypto';
import * as google from './google.js';
import { decrypt, encrypt, parseKey, signState, verifyState } from './crypto.js';

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

// Firestore REST store for connectorTokens/{uid}: one field `data` = AES-GCM(JSON record), uid as AAD.
// firestore.rules deny this collection to every client; only the proxy's admin token can touch it.
export function firestoreTokenStore(admin, key, db = 'default') {
  if (!admin || !key) return null;
  const url = (uid) => `https://firestore.googleapis.com/v1/projects/${admin.projectId}/databases/${encodeURIComponent(db)}/documents/connectorTokens/${uid}`;
  const auth = async () => ({ Authorization: `Bearer ${await admin.accessToken()}` });
  return {
    async get(uid) {
      if (!UID_RE.test(uid)) return null;
      const r = await admin.fetchImpl(url(uid), { headers: await auth(), signal: AbortSignal.timeout(5000) });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`token read ${r.status}`);
      const blob = (await r.json()).fields?.data?.stringValue;
      return blob ? JSON.parse(decrypt(key, blob, uid)) : null;
    },
    async put(uid, rec) {
      if (!UID_RE.test(uid)) throw new Error('bad uid');
      const body = { fields: { data: { stringValue: encrypt(key, JSON.stringify(rec), uid) }, updatedAt: { timestampValue: new Date(admin.now()).toISOString() } } };
      const r = await admin.fetchImpl(url(uid), { method: 'PATCH', headers: { ...await auth(), 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`token write ${r.status}`);
    },
    async del(uid) {
      if (!UID_RE.test(uid)) return;
      await admin.fetchImpl(url(uid), { method: 'DELETE', headers: await auth(), signal: AbortSignal.timeout(8000) });
    },
  };
}

export function createConnectors({ env = process.env, admin = null, store, fetchImpl = fetch, now = () => Date.now() } = {}) {
  const key = parseKey(env.CONNECTOR_TOKEN_KEY);
  const cfg = { google: google.config(env) };
  const tokens = store !== undefined ? store : firestoreTokenStore(admin, key, env.FIRESTORE_DATABASE_ID || 'default');
  const ready = (provider) => !!(provider && cfg[provider] && key && tokens);
  const pending = new Map(); // actionId -> {uid, name, args, app, kind, title, summary, expiresAt, state, timeZone, result}
  const notConfigured = () => new ConnectHttpError(503, 'not configured');

  async function record(uid) { return (await tokens.get(uid)) || {}; }
  function appState(def, rec) {
    if (def.linkOnly) return 'connected';
    if (!ready(def.provider)) return 'soon';
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
      return { id: d.id, name: d.name, state, ...(rec[d.provider]?.account && state !== 'connect' ? { account: rec[d.provider].account } : {}), ...(used ? { lastUsed: used } : {}), scopes: d.scopes };
    });
  }

  async function startConnect(uid, appId) {
    const def = BY_ID.get(appId);
    if (!def) throw new ConnectHttpError(404, 'unknown app');
    if (def.linkOnly) throw new ConnectHttpError(400, 'no sign-in needed');
    if (!ready(def.provider)) throw notConfigured();
    const rec = await record(uid);
    // Incremental: ask for this app's scopes; include_granted_scopes keeps the ones already granted.
    const have = (rec[def.provider]?.apps || []).filter((a) => a !== def.app && !rec[def.provider]?.broken);
    const state = signState(key, { uid, provider: def.provider, apps: [...have, def.app], ret: appId }, now());
    return { authUrl: PROVIDERS[def.provider].authUrl(cfg[def.provider], [def.app], state) };
  }

  // Returns the URL to send the browser back to. Never throws: failures become result=error.
  async function callback(provider, query) {
    const back = (appId, result) => `${APP_RETURN}#/me?app=${encodeURIComponent(appId || '')}&result=${result}`;
    if (!ready(provider)) return back('', 'error');
    const st = verifyState(key, query.get('state'), now());
    if (!st || st.provider !== provider || !BY_ID.has(st.ret)) return back('', 'error');
    const code = query.get('code');
    if (!code || query.get('error')) return back(st.ret, 'error');
    try {
      const P = PROVIDERS[provider];
      const ex = await P.exchangeCode(cfg[provider], code, fetchImpl);
      const rec = await record(st.uid);
      const prev = rec[provider] || {};
      const refreshToken = ex.refreshToken || prev.rt;
      if (!refreshToken) return back(st.ret, 'error');
      const granted = P.appsFromScopes(ex.scopes);
      const apps = [...new Set([...(prev.broken ? [] : prev.apps || []), ...st.apps])].filter((a) => granted.includes(a));
      if (!apps.includes(BY_ID.get(st.ret).app)) return back(st.ret, 'error'); // user unticked the scope
      rec[provider] = { rt: refreshToken, apps, scopes: ex.scopes, lastUsed: prev.lastUsed || {}, connectedAt: now() };
      await tokens.put(st.uid, rec);
      return back(st.ret, 'ok');
    } catch (e) {
      console.error('connect callback failed', e.code || String(e.message).slice(0, 80));
      return back(st.ret, 'error');
    }
  }

  async function disconnect(uid, appId) {
    const def = BY_ID.get(appId);
    if (!def) throw new ConnectHttpError(404, 'unknown app');
    if (def.linkOnly) throw new ConnectHttpError(400, 'nothing to disconnect');
    if (!ready(def.provider)) throw notConfigured();
    const rec = await record(uid);
    const p = rec[def.provider];
    if (p) {
      p.apps = (p.apps || []).filter((a) => a !== def.app);
      if (!p.apps.length) {
        // Last app on this provider: revoke the grant at Google, then forget the token.
        await PROVIDERS[def.provider].revoke(p.rt, fetchImpl);
        delete rec[def.provider];
      }
      if (Object.keys(rec).length) await tokens.put(uid, rec); else await tokens.del(uid);
    }
    for (const [id, a] of pending) if (a.uid === uid && a.app === appId) pending.delete(id);
    return { state: 'connect' };
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
    const rec = await record(uid);
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

  return { configured: () => ready('google'), listApps, startConnect, callback, disconnect, toolsFor, isTool, handleCall, decide, _pending: pending };
}

export function describe(name, args) {
  if (name === 'calendar_create_event') return { title: 'Add event to Calendar', summary: [args.title, `${args.start} → ${args.end}`, args.location].filter(Boolean).join('\n') };
  if (name === 'gmail_compose') return { title: `Email ${args.to} in Gmail`, summary: [`To: ${args.to}`, `Subject: ${args.subject || '(no subject)'}`, args.body.slice(0, 140)].join('\n') };
  return { title: name, summary: '' };
}
