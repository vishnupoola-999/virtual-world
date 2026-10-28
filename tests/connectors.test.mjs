import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { signState, verifyState, encrypt, decrypt, parseKey } from '../proxy/connectors/crypto.js';
import { cleanArgs, runTool, authUrl, appsFromScopes, SCOPES } from '../proxy/connectors/google.js';
import { createConnectors, ACTION_TTL_MS } from '../proxy/connectors/index.js';
import { createServer } from '../proxy/server.js';

const KEY = randomBytes(32);
const json = (status, body) => ({ ok: status < 400, status, json: async () => body });

test('state: signed, bound to uid, tamper/expiry/wrong-key rejected', () => {
  const s = signState(KEY, { uid: 'u1', provider: 'google', apps: ['drive'], ret: 'gdrive' }, 1000);
  assert.deepEqual(verifyState(KEY, s, 2000), { uid: 'u1', provider: 'google', apps: ['drive'], ret: 'gdrive' });
  const [body, mac] = s.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), u: 'attacker' })).toString('base64url');
  assert.equal(verifyState(KEY, `${forged}.${mac}`, 2000), null);
  assert.equal(verifyState(randomBytes(32), s, 2000), null);
  assert.equal(verifyState(KEY, s, 1000 + 11 * 60_000), null);
  assert.equal(verifyState(KEY, 'garbage', 2000), null);
  assert.equal(verifyState(KEY, `${s}.x`, 2000), null);
});

test('encryption: round trip, bound to uid', () => {
  const blob = encrypt(KEY, 'refresh-xyz', 'u1');
  assert.ok(!blob.includes('refresh-xyz'));
  assert.equal(decrypt(KEY, blob, 'u1'), 'refresh-xyz');
  assert.throws(() => decrypt(KEY, blob, 'u2'));
  assert.equal(parseKey('short'), null);
  assert.equal(parseKey(KEY.toString('base64')).length, 32);
  assert.equal(parseKey(KEY.toString('hex')).length, 32);
});

test('consent URL: offline, incremental, only the asked scopes', () => {
  const u = new URL(authUrl({ clientId: 'cid', redirectUri: 'https://x/cb' }, ['gmail'], 'st'));
  assert.equal(u.searchParams.get('scope'), SCOPES.gmail[0]);
  assert.equal(u.searchParams.get('include_granted_scopes'), 'true');
  assert.equal(u.searchParams.get('access_type'), 'offline');
  assert.equal(u.searchParams.get('state'), 'st');
  assert.deepEqual(appsFromScopes([SCOPES.drive[0], SCOPES.gmail[0]]), ['drive', 'gmail']);
});

test('cleanArgs validates', () => {
  assert.equal(cleanArgs('gmail_create_draft', { to: 'nope', subject: 's', body: 'b' }), null);
  assert.equal(cleanArgs('gmail_create_draft', { to: 'a@b.co', subject: 'x\r\nBcc: e@v.il', body: 'b' }).subject, 'x  Bcc: e@v.il');
  assert.equal(cleanArgs('calendar_create_event', { title: 't', start: '2026-11-01T10:00:00+05:30', end: '2026-11-01T09:00:00+05:30' }), null);
  assert.equal(cleanArgs('drive_search', { limit: 99 }).limit, 10);
  assert.equal(cleanArgs('calendar_upcoming', {}).days, 7);
  assert.equal(cleanArgs('send_email', {}), null);
});

test('tool handlers call the right Google APIs (mocked)', async () => {
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    seen.push({ url: String(url), init });
    if (String(url).includes('/drive/v3/files')) return json(200, { files: [{ id: 'f1', name: 'Trip plan', webViewLink: 'https://d/f1' }] });
    if (String(url).includes('/events?')) return json(200, { items: [{ summary: 'Standup', start: { dateTime: '2026-10-29T10:00:00+05:30' } }] });
    if (String(url).endsWith('/events')) return json(200, { id: 'e1', htmlLink: 'https://c/e1' });
    if (String(url).endsWith('/drafts')) return json(200, { id: 'd1' });
    return json(404, {});
  };
  const ctx = { token: 'AT', fetchImpl, now: Date.parse('2026-10-28T08:00:00Z'), timeZone: 'Asia/Kolkata' };
  const d = await runTool('drive_search', cleanArgs('drive_search', { query: "o'brien" }), ctx);
  assert.match(d.text, /Trip plan/);
  assert.match(new URL(seen[0].url).searchParams.get('q'), /name contains 'o\\'brien'/);
  assert.equal(seen[0].init.headers.Authorization, 'Bearer AT');
  assert.match((await runTool('calendar_upcoming', { days: 3 }, ctx)).text, /Standup/);
  const ev = await runTool('calendar_create_event', cleanArgs('calendar_create_event', { title: 'Lunch', start: '2026-11-01T13:00:00+05:30', end: '2026-11-01T14:00:00+05:30' }), ctx);
  assert.equal(ev.data.link, 'https://c/e1');
  assert.equal(JSON.parse(seen[2].init.body).start.timeZone, 'Asia/Kolkata');
  const dr = await runTool('gmail_create_draft', { to: 'a@b.co', subject: 'Hi', body: 'Hello' }, ctx);
  assert.match(dr.text, /hasn't been sent/);
  assert.ok(seen[3].url.endsWith('/users/me/drafts'));
  assert.ok(!seen.some((s) => s.url.includes('/send')));
  await assert.rejects(runTool('calendar_upcoming', { days: 1 }, { ...ctx, fetchImpl: async () => json(403, { error: { status: 'SERVICE_DISABLED' } }) }), (e) => e.code === 'disabled');
});

function harness() {
  const docs = new Map();
  const store = { get: async (u) => (docs.has(u) ? structuredClone(docs.get(u)) : null), put: async (u, r) => { docs.set(u, structuredClone(r)); }, del: async (u) => { docs.delete(u); } };
  const calls = [];
  let t = 1_000_000;
  const all = [SCOPES.drive[0], SCOPES.calendar[0], SCOPES.gmail[0]].join(' ');
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), body: String(init.body || '') });
    if (url.includes('oauth2.googleapis.com/token')) return init.body.includes('authorization_code') ? json(200, { access_token: 'AT', refresh_token: 'RT1', scope: all }) : json(200, { access_token: 'AT2' });
    if (url.includes('/revoke')) return json(200, {});
    if (url.includes('/events?')) return json(200, { items: [] });
    if (url.endsWith('/drafts')) return json(200, { id: 'd1' });
    return json(404, {});
  };
  const env = { GOOGLE_OAUTH_CLIENT_ID: 'cid', GOOGLE_OAUTH_CLIENT_SECRET: 'sec', CONNECTOR_TOKEN_KEY: KEY.toString('base64') };
  const c = createConnectors({ env, store, fetchImpl, now: () => t });
  return { c, docs, calls, tick: (ms) => { t += ms; } };
}

test('connect flow: start, callback stores encrypted-at-rest record, list, disconnect revokes', async () => {
  const { c, docs, calls } = harness();
  assert.equal((await c.listApps('u1')).find((a) => a.id === 'gmail').state, 'connect');
  assert.equal((await c.listApps('u1')).find((a) => a.id === 'notion').state, 'soon');
  const { authUrl: url } = await c.startConnect('u1', 'gmail');
  const state = new URL(url).searchParams.get('state');
  const back = await c.callback('google', new URLSearchParams({ state, code: 'CODE' }));
  assert.match(back, /#\/me\?app=gmail&result=ok$/);
  assert.equal(docs.get('u1').google.rt, 'RT1');
  const apps = await c.listApps('u1');
  assert.equal(apps.find((a) => a.id === 'gmail').state, 'connected');
  assert.equal(apps.find((a) => a.id === 'gdrive').state, 'connect');
  assert.match(await c.callback('google', new URLSearchParams({ state: state.slice(0, -2) + 'xx', code: 'C' })), /result=error/);
  await c.disconnect('u1', 'gmail');
  assert.ok(calls.some((x) => x.url.includes('/revoke') && x.body.includes('RT1')));
  assert.equal(docs.has('u1'), false);
});

test('agent actions: read runs now, write waits for approve, idempotent, cancel, expiry', async () => {
  const { c, tick, calls } = harness();
  const st = new URL((await c.startConnect('u1', 'gcal')).authUrl).searchParams.get('state');
  await c.callback('google', new URLSearchParams({ state: st, code: 'C' }));
  const st2 = new URL((await c.startConnect('u1', 'gmail')).authUrl).searchParams.get('state');
  await c.callback('google', new URLSearchParams({ state: st2, code: 'C' }));
  assert.deepEqual((await c.toolsFor('u1')).apps.sort(), ['calendar', 'gmail']);
  const read = await c.handleCall('u1', { name: 'calendar_upcoming', args: { days: 2 } }, 'UTC');
  assert.match(read.result.text, /Nothing on your calendar/);
  const before = calls.length;
  const { action } = await c.handleCall('u1', { name: 'gmail_create_draft', args: { to: 'p@x.io', subject: 'Hi', body: 'Yo' } }, 'UTC');
  assert.equal(calls.length, before, 'proposing must not call Google');
  assert.deepEqual(Object.keys(action).sort(), ['app', 'expiresAt', 'id', 'kind', 'state', 'summary', 'title']);
  assert.equal(action.app, 'gmail');
  await assert.rejects(c.decide('u2', action.id, 'approve'), (e) => e.status === 404);
  const done = await c.decide('u1', action.id, 'approve');
  assert.equal(done.state, 'done');
  const n = calls.filter((x) => x.url.endsWith('/drafts')).length;
  assert.equal((await c.decide('u1', action.id, 'approve')).state, 'done');
  assert.equal(calls.filter((x) => x.url.endsWith('/drafts')).length, n, 'second approve ignored');
  const b = (await c.handleCall('u1', { name: 'gmail_create_draft', args: { to: 'p@x.io', subject: 'a', body: 'b' } }, 'UTC')).action;
  assert.equal((await c.decide('u1', b.id, 'cancel')).state, 'cancelled');
  const e = (await c.handleCall('u1', { name: 'calendar_create_event', args: { title: 'x', start: '2026-11-01T10:00:00Z', end: '2026-11-01T11:00:00Z' } }, 'UTC')).action;
  tick(ACTION_TTL_MS + 1);
  assert.equal((await c.decide('u1', e.id, 'approve')).state, 'expired');
  assert.equal(await c.handleCall('u1', { name: 'gmail_create_draft', args: { to: 'bad' } }, 'UTC'), null);
});

test('not configured: /apps says soon, connect returns 503', async () => {
  const server = createServer({ verifyIdToken: async () => ({ uid: 'u1', provider: 'google.com' }), connectors: createConnectors({ env: {}, store: null }), admin: null, memory: null, apiKey: 'k' });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const h = { Authorization: 'Bearer a.b.c' };
  try {
    const l = await (await fetch(`${base}/apps`, { headers: h })).json();
    assert.equal(l.configured, false);
    assert.ok(l.apps.every((a) => a.state === 'soon'));
    assert.equal((await fetch(`${base}/apps/gmail/connect`, { method: 'POST', headers: h })).status, 503);
    assert.equal((await fetch(`${base}/apps`)).status, 401);
    const cb = await fetch(`${base}/connect/google/callback?state=x&code=y`, { redirect: 'manual' });
    assert.equal(cb.status, 302);
    assert.match(cb.headers.get('location'), /result=error/);
  } finally { server.close(); }
});

test('chat: connected tools are offered and a write comes back as a pending action, not executed', async () => {
  const { c } = harness();
  const st = new URL((await c.startConnect('u1', 'gmail')).authUrl).searchParams.get('state');
  await c.callback('google', new URLSearchParams({ state: st, code: 'C' }));
  let sent;
  const fetchImpl = async (url, init) => {
    sent = JSON.parse(init.body);
    return json(200, { candidates: [{ content: { parts: [{ text: 'Here is a draft.' }, { functionCall: { name: 'gmail_create_draft', args: { to: 'p@x.io', subject: 'Hi', body: 'Yo' } } }] } }] });
  };
  const server = createServer({ verifyIdToken: async () => ({ uid: 'u1', provider: 'google.com' }), connectors: c, fetchImpl, admin: null, memory: null, apiKey: 'k', rateLimiter: { allow: async () => true } });
  await new Promise((r) => server.listen(0, r));
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/chat`, { method: 'POST', headers: { Origin: 'https://vishnupoola-999.github.io', Authorization: 'Bearer a.b.c', 'Content-Type': 'application/json' }, body: JSON.stringify({ agent: { name: 'Bs' }, messages: [{ role: 'user', content: 'draft a mail to p@x.io' }], tools: true, timeZone: 'Asia/Kolkata' }) });
    const j = await r.json();
    assert.equal(r.status, 200);
    const names = sent.tools[0].functionDeclarations.map((d) => d.name);
    assert.ok(names.includes('gmail_create_draft') && !names.includes('draft_email'));
    assert.equal(j.actions.length, 1);
    assert.match(j.actions[0].id, /^act_[0-9a-f]{24}$/);
    assert.equal(c._pending.get(j.actions[0].id).state, 'pending');
  } finally { server.close(); }
});
