// Connect apps + streaming replies: the ONE place that knows the server shapes (connect-v1 spec).
// Names confirmed by SWE (apps/actions) and Buildy (SSE), but not live yet, so every endpoint is feature-detected:
// a 404/405 (or a network error) marks it missing for the session and callers hide the UI / fall back.
const BASE = 'https://virtual-world-ai.onrender.com';
export const APP_IDS = ['gdrive', 'gcal', 'gmail', 'notion', 'spotify'];
export const APP_STATES = ['none', 'connecting', 'connected', 'expired', 'error', 'soon'];
// SWE #63 server names -> client states ('connect' = not connected, 'reauth' = sign-in expired / revoked / wrong key).
const SERVER_STATE = { connect: 'none', reauth: 'expired' };
export const ACTION_STATES = ['working', 'done', 'cancelled', 'error', 'reauth', 'expired'];
const missing = new Set();
export const isMissing = (k) => missing.has(k);
export const resetDetection = () => missing.clear();

async function call(user, path, { method = 'GET', body, key } = {}) {
  if (key && missing.has(key)) throw Object.assign(new Error('missing'), { missing: true });
  const token = await user.getIdToken();
  let r;
  try {
    r = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch (e) { throw Object.assign(new Error('network'), { network: true, cause: e }); }
  if (r.status === 404 || r.status === 405) { if (key) missing.add(key); throw Object.assign(new Error('missing'), { missing: true, status: r.status }); }
  const type = r.headers.get('content-type') || '';
  const j = type.includes('json') ? await r.json().catch(() => null) : null;
  if (!r.ok) throw Object.assign(new Error(j?.error || 'http ' + r.status), { status: r.status });
  if (key && !j) { missing.add(key); throw Object.assign(new Error('missing'), { missing: true }); } // e.g. an HTML 200 from a host fallback
  return j;
}

// GET /apps -> list in spec order. Returns null when the endpoint is not there (callers hide the Apps section).
export const normApp = (a) => {
  if (!a || !APP_IDS.includes(a.id)) return null;
  const s = a.scopes || {};
  const arr = (x) => (Array.isArray(x) ? x.filter((v) => typeof v === 'string' && v.trim()).slice(0, 6) : []);
  return { id: a.id, name: String(a.name || ''), state: a.id === 'gmail' ? 'connected' : SERVER_STATE[a.state] || (APP_STATES.includes(a.state) ? a.state : 'none'), // Gmail has no sign-in: always on (#63)
    account: typeof a.account === 'string' ? a.account : typeof a.email === 'string' ? a.email : '',
    lastUsed: a.lastUsed && Number.isFinite(+a.lastUsed.at) ? { at: +a.lastUsed.at, summary: String(a.lastUsed.summary || '') } : null,
    scopes: { read: arr(s.read), do: arr(s.do), never: arr(s.never) } };
};
export async function listApps(user) {
  try {
    const j = await call(user, '/apps', { key: 'apps' });
    const list = (Array.isArray(j) ? j : Array.isArray(j?.apps) ? j.apps : null);
    if (!list) { missing.add('apps'); return null; }
    const by = new Map(list.map(normApp).filter(Boolean).map((a) => [a.id, a]));
    return APP_IDS.filter((id) => by.has(id)).map((id) => by.get(id));
  } catch (e) { if (e.missing || e.network) return null; throw e; }
}
// POST /apps/:app/connect -> consent URL (https only).
export async function connectApp(user, id) {
  const j = await call(user, `/apps/${encodeURIComponent(id)}/connect`, { method: 'POST', body: {}, key: 'connect' });
  const url = j?.url || j?.authUrl || j?.consentUrl;
  if (typeof url !== 'string' || !/^https:\/\//.test(url)) throw new Error('no consent url');
  return url;
}
// DELETE /apps/:id -> {state, reauth?:[ids]} (revoking one Google app revokes the whole grant).
export async function disconnectApp(user, id) {
  if (id === 'gmail') throw new Error('gmail has no sign-in');
  const j = await call(user, `/apps/${encodeURIComponent(id)}`, { method: 'DELETE', key: 'disconnect' });
  return { reauth: Array.isArray(j?.reauth) ? j.reauth.filter((x) => APP_IDS.includes(x)) : [] };
}
// POST /apps/:id/confirm {c} after the OAuth return: only now is the grant saved (#63). 403/410 -> throws.
// Returns null when the endpoint is not there (then the GET /apps state is the only truth).
export async function confirmApp(user, id, c) {
  try {
    const j = await call(user, `/apps/${encodeURIComponent(id)}/confirm`, { method: 'POST', body: { c, nonce: c }, key: 'confirm' });
    return { state: SERVER_STATE[j?.state] || j?.state || 'none', account: typeof j?.account === 'string' ? j.account : typeof j?.email === 'string' ? j.email : '' };
  } catch (e) { if (e.missing) return null; throw e; }
}

// A pending action: {id, app, kind, summary, expiresAt} (+ optional title). Anything else is not a connect action.
export const KINDS = ['send', 'pay', 'submit', 'write'];
export function normAction(a) {
  const id = a?.id ?? a?.actionId;
  if (!a || typeof id !== 'string' || !id || !APP_IDS.includes(a.app)) return null;
  return { id, app: a.app, kind: KINDS.includes(a.kind) ? a.kind : 'write', title: String(a.title || '').slice(0, 120), summary: String(a.summary || '').slice(0, 400),
    expiresAt: Number.isFinite(+a.expiresAt) && +a.expiresAt > 0 ? +a.expiresAt : Date.now() + 15 * 60000 };
}
// POST /actions/:id {decision}. Only ever called from an Approve/Cancel tap.
// A 404 means this one action is unknown or gone (expired / server restarted): that card shows expired.
// It does NOT mark the endpoint missing, so other confirm cards keep working.
export async function decide(user, id, decision) {
  if (decision !== 'approve' && decision !== 'cancel') throw new Error('bad decision');
  let j;
  try { j = await call(user, `/actions/${encodeURIComponent(id)}`, { method: 'POST', body: { decision } }); }
  catch (e) { if (e.status === 404) return { state: 'expired', result: null }; throw e; }
  return { state: ACTION_STATES.includes(j?.state) ? j.state : 'error', result: j?.result && typeof j.result === 'object' ? { summary: String(j.result.summary || ''), at: +j.result.at || Date.now(),
    link: typeof j.result.link === 'string' && /^https:\/\//.test(j.result.link) ? j.result.link : '', mailto: typeof j.result.mailto === 'string' && /^mailto:/i.test(j.result.mailto) ? j.result.mailto : '' } : null };
}

// SSE: "event: x\ndata: {...}\n\n". Incremental parser; returns complete events, keeps the tail.
export function sseParser() {
  let buf = '';
  return (chunk) => {
    buf += chunk.replace(/\r\n?/g, '\n');
    const out = [];
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      let ev = 'message', data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith(':')) continue;
        const k = line.indexOf(':'), f = k < 0 ? line : line.slice(0, k), v = k < 0 ? '' : line.slice(k + 1).replace(/^ /, '');
        if (f === 'event') ev = v; else if (f === 'data') data += (data ? '\n' : '') + v;
      }
      let d; try { d = data ? JSON.parse(data) : {}; } catch { d = { t: data }; }
      out.push({ event: ev, data: d });
    }
    return out;
  };
}
export const ERROR_REASONS = ['cut_off', 'failed', 'rate_limited'];

// Streaming chat (Buildy #62): POST /agent/chat (SSE; X-Message-Id header first). Events: token {t};
// action {id,app,kind,summary,expiresAt}; done {messageId,text,actions?,partial?}; error {code,message,text?,partial?}.
// Stop = abort (+ POST /agent/chat/:id/stop); POST /agent/chat/:id/continue resumes a stopped / cut-off reply.
// If /agent/chat is missing (404/405) we fall back to the old POST /chat JSON reply for the session.
async function readSSE(r, { onToken, onAction, onDone, onError }) {
  const parse = sseParser(), rd = r.body.getReader(), dec = new TextDecoder();
  let ended = null;
  try {
    for (;;) {
      const { value, done } = await rd.read();
      if (done) break;
      for (const { event, data } of parse(dec.decode(value, { stream: true }))) {
        if (event === 'token' && typeof data?.t === 'string') onToken?.(data.t);
        else if (event === 'action') { const a = normAction(data); if (a) onAction?.(a); }
        else if (event === 'done') {
          ended = { done: true, messageId: data?.messageId || null, text: typeof data?.text === 'string' ? data.text : null };
          for (const x of Array.isArray(data?.actions) ? data.actions : []) { const a = normAction(x); if (a) onAction?.(a); }
          onDone?.(ended);
        } else if (event === 'error') {
          const code = data?.code ?? data?.reason;
          ended = { error: ERROR_REASONS.includes(code) ? code : 'failed', message: String(data?.message || ''), text: typeof data?.text === 'string' ? data.text : null }; onError?.(ended);
        }
      }
      if (ended) break;
    }
  } catch (e) { if (e?.name === 'AbortError') return { stream: true, stopped: true }; ended = null; }
  finally { try { rd.cancel(); } catch { /* closed */ } }
  if (!ended) { ended = { error: 'cut_off', message: '', text: null }; onError?.(ended); } // stream ended without done
  return { stream: true, ...ended };
}
async function post(user, path, body, signal, accept) {
  const token = await user.getIdToken();
  return fetch(BASE + path, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Accept: accept, Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
}
export async function chat(user, body, h = {}) {
  if (!missing.has('stream')) {
    const r = await post(user, '/agent/chat', body, h.signal, 'text/event-stream');
    const type = r.headers.get('content-type') || '';
    if (r.ok && type.includes('text/event-stream') && r.body) {
      const id = r.headers.get('x-message-id'); if (id) h.onStart?.(id);
      return readSSE(r, h);
    }
    if (r.status === 404 || r.status === 405 || (r.ok && !type.includes('text/event-stream'))) missing.add('stream');
    else if (r.status === 429) return { status: 429, ok: false, json: null, rateLimited: true };
    else return { status: r.status, ok: false, json: null };
  }
  const r = await post(user, '/chat', body, h.signal, 'application/json');
  const type = r.headers.get('content-type') || '';
  return { status: r.status, ok: r.ok, json: r.ok && type.includes('application/json') ? await r.json() : null };
}
export async function continueChat(user, id, h = {}) {
  const r = await post(user, `/agent/chat/${encodeURIComponent(id)}/continue`, {}, h.signal, 'text/event-stream');
  const type = r.headers.get('content-type') || '';
  if (!r.ok || !type.includes('text/event-stream') || !r.body) return { stream: true, error: r.status === 429 ? 'rate_limited' : 'failed', message: '', text: null };
  return readSSE(r, h);
}
export const stopChat = (user, id) => post(user, `/agent/chat/${encodeURIComponent(id)}/stop`, {}, undefined, 'application/json').then(() => true, () => false);
