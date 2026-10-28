// connect-v1: adapter shapes, feature detection, SSE parsing, card/tile markup. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sseParser, normAction, normApp, listApps, decide, chat, continueChat, connectApp, isMissing, resetDetection } from '../src/connect-api.js';
import { takeWords, RETRY_LINES } from '../src/stream-ui.js';
import { appsHtml, sheetHtml, cardHtml, stateChip, ago } from '../src/connect.js';

const U = { getIdToken: async () => 'tok' };
const res = (status, body, type = 'application/json') => ({ status, ok: status >= 200 && status < 300, headers: { get: () => type }, json: async () => body, body: null });
const withFetch = async (fn, impl) => { const f = globalThis.fetch; globalThis.fetch = impl; try { return await fn(); } finally { globalThis.fetch = f; } };

test('SSE parser: events split across chunks, comments, CRLF, multi-line data', () => {
  const p = sseParser();
  assert.deepEqual(p('event: token\ndata: {"t":"Hel'), []);
  assert.deepEqual(p('lo "}\n\n: ping\n\nevent: done\r\ndata: {"messageId":"m1"}\r\n\r\n'), [{ event: 'token', data: { t: 'Hello ' } }, { event: 'message', data: {} }, { event: 'done', data: { messageId: 'm1' } }]);
});
test('normAction: confirmed shape {id, app, kind, summary, expiresAt}; junk dropped', () => {
  assert.equal(normAction(null), null); assert.equal(normAction({ id: 'a', app: 'myspace' }), null); assert.equal(normAction({ app: 'gcal' }), null);
  const a = normAction({ id: 'a1', app: 'gcal', kind: 'write', summary: 'x', expiresAt: 5 });
  assert.deepEqual(a, { id: 'a1', app: 'gcal', kind: 'write', title: '', summary: 'x', expiresAt: 5 });
  assert.equal(normAction({ actionId: 'b', app: 'gmail', kind: 'nuke' }).kind, 'write');
});
test('normApp: unknown ids/states and bad scopes are cleaned', () => {
  assert.equal(normApp({ id: 'x' }), null);
  assert.deepEqual(normApp({ id: 'gcal', state: 'weird', scopes: { read: ['a', 3, ' '] } }).state, 'none');
  assert.deepEqual(normApp({ id: 'gcal', scopes: { read: ['a', 3, ' '] } }).scopes.read, ['a']);
});
test('feature detection: 404/405/HTML/network on /apps => null (hide Apps), remembered for the session', async () => {
  for (const r of [res(404, {}), res(405, {}), res(200, null, 'text/html')]) {
    resetDetection();
    assert.equal(await withFetch(() => listApps(U), async () => r), null); assert.equal(isMissing('apps'), true);
  }
  resetDetection(); assert.equal(await withFetch(() => listApps(U), async () => { throw new TypeError('net'); }), null);
  resetDetection();
  const list = await withFetch(() => listApps(U), async () => res(200, [{ id: 'spotify', state: 'expired' }, { id: 'gdrive', state: 'connected' }]));
  assert.deepEqual(list.map((a) => a.id), ['gdrive', 'spotify']); // spec order
});
test('decide: only approve|cancel; /actions 404 marks actions missing', async () => {
  await assert.rejects(decide(U, 'a', 'yes'));
  resetDetection();
  const calls = [];
  const r = await withFetch(() => decide(U, 'a 1', 'approve'), async (u, o) => { calls.push([u, o.method, o.body]); return res(200, { state: 'done', result: { summary: 'Added', at: 9 } }); });
  assert.deepEqual(r, { state: 'done', result: { summary: 'Added', at: 9 } });
  assert.deepEqual(calls, [['https://virtual-world-ai.onrender.com/actions/a%201', 'POST', '{"decision":"approve"}']]);
  await assert.rejects(withFetch(() => decide(U, 'a', 'cancel'), async () => res(404, {}))); assert.equal(isMissing('actions'), true);
});
test('connectApp: only an https consent URL is accepted', async () => {
  resetDetection();
  assert.equal(await withFetch(() => connectApp(U, 'gcal'), async () => res(200, { url: 'https://accounts.example/o' })), 'https://accounts.example/o');
  await assert.rejects(withFetch(() => connectApp(U, 'gcal'), async () => res(200, { url: 'javascript:alert(1)' })));
});
const sse = (chunks, id) => ({ status: 200, ok: true, headers: { get: (k) => (k === 'x-message-id' ? id || null : 'text/event-stream') }, body: new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(new TextEncoder().encode(x)); c.close(); } }) });
test('chat: POST /agent/chat SSE (X-Message-Id, tokens, actions, done); error.code; no done => cut_off', async () => {
  resetDetection();
  const toks = [], acts = [], seen = [];
  const r = await withFetch(() => chat(U, {}, { onStart: (id) => seen.push(id), onToken: (t) => toks.push(t), onAction: (a) => acts.push(a.id) }), async (u, o) => { seen.push(u); assert.match(o.headers.Accept, /text\/event-stream/);
    return sse(['event: token\ndata: {"t":"Hi "}\n\nevent: action\ndata: {"id":"x","app":"gcal","kind":"write","summary":"s","expiresAt":1}\n\nevent: token\ndata: {"t":"there"}\n\nevent: done\ndata: {"messageId":"m","text":"Hi there","actions":[{"id":"y","app":"gmail","kind":"send","summary":"s","expiresAt":1}]}\n\n'], 'm'); });
  assert.deepEqual([seen, toks, acts, r], [['https://virtual-world-ai.onrender.com/agent/chat', 'm'], ['Hi ', 'there'], ['x', 'y'], { stream: true, done: true, messageId: 'm', text: 'Hi there' }]);
  const cut = await withFetch(() => chat(U, {}), async () => sse(['event: token\ndata: {"t":"Hi"}\n\n'])); assert.equal(cut.error, 'cut_off');
  for (const code of ['cut_off', 'failed', 'rate_limited']) assert.equal((await withFetch(() => chat(U, {}), async () => sse([`event: error\ndata: {"code":"${code}","message":"m"}\n\n`]))).error, code);
  assert.equal((await withFetch(() => chat(U, {}), async () => sse(['event: error\ndata: {"code":"boom"}\n\n']))).error, 'failed');
});
test('chat: /agent/chat 404 => old POST /chat JSON for the session', async () => {
  resetDetection(); const urls = [];
  const j = await withFetch(() => chat(U, {}), async (u) => { urls.push(u); return u.endsWith('/agent/chat') ? res(404, {}) : res(200, { choices: [] }); });
  assert.deepEqual(j, { status: 200, ok: true, json: { choices: [] } }); assert.equal(isMissing('stream'), true);
  await withFetch(() => chat(U, {}), async (u) => { urls.push(u); return res(200, { choices: [] }); });
  assert.deepEqual(urls.map((u) => u.split('.com')[1]), ['/agent/chat', '/chat', '/chat']);
});
test('continueChat: POST /agent/chat/:id/continue streams into the same reply', async () => {
  const urls = [];
  const r = await withFetch(() => continueChat(U, 'm 1', {}), async (u) => { urls.push(u); return sse(['event: done\ndata: {"messageId":"m 1"}\n\n']); });
  assert.equal(urls[0], 'https://virtual-world-ai.onrender.com/agent/chat/m%201/continue'); assert.equal(r.done, true);
});
test('stream-ui: whole words only until final; one retry line per reason', () => {
  assert.deepEqual(takeWords('Since you an'), { words: ['Since ', 'you '], rest: 'an' });
  assert.deepEqual(takeWords('an', true), { words: ['an'], rest: '' });
  assert.deepEqual(Object.keys(RETRY_LINES), ['stopped', 'cut_off', 'cut_off_continue', 'failed', 'rate_limited']);
  assert.equal(new Set(['stopped', 'cut_off', 'failed', 'rate_limited'].map((k) => RETRY_LINES[k].lead)).size, 4);
  assert.equal(RETRY_LINES.stopped.act, 'Continue');
});
test('markup: tiles, sheet copy, card states, escaping', () => {
  assert.match(stateChip('connected'), /Connected/); assert.match(stateChip('expired'), /Sign in again/); assert.match(stateChip('error'), /Try again/); assert.match(stateChip('connecting'), /Connecting…/); assert.match(stateChip('none'), /class="st c">Connect/);
  const h = appsHtml([{ id: 'gdrive', name: '<b>x</b>', state: 'connected' }, { id: 'notion', name: 'Notion', state: 'none' }]);
  assert.match(h, /1 of 2 connected/); assert.doesNotMatch(h, /<b>x/); assert.match(h, /always asks before it sends, pays or submits/);
  const s = sheetHtml({ id: 'gcal', name: 'Calendar', state: 'none', scopes: {} });
  assert.match(s, /Google · not connected/); assert.match(s, /Connect with Google Calendar/); assert.match(s, /only after you tap Approve/); assert.match(s, /You can disconnect any time/);
  assert.match(sheetHtml({ id: 'gcal', name: 'Calendar', state: 'expired', scopes: {} }), /Sign in to Calendar again/);
  assert.match(sheetHtml({ id: 'gcal', name: 'Calendar', state: 'connected', account: 'v@x', scopes: {} }), /Connected · v@x[\s\S]*Not used yet[\s\S]*Disconnect Calendar/);
  const a = { id: '1', app: 'gmail', kind: 'send', title: 'Send email to <Pooja>', summary: 'To pooja@x', expiresAt: Date.now() + 1e5 };
  assert.match(cardHtml(a), /Needs your OK[\s\S]*Send email to &lt;Pooja&gt;[\s\S]*Cancel[\s\S]*Approve/);
  assert.match(cardHtml(a, 'working'), /Working…/); assert.match(cardHtml(a, 'cancelled'), /Cancelled · nothing was sent/);
  assert.match(cardHtml(a, 'error'), /Couldn't send. Nothing went out.[\s\S]*Try again/); assert.match(cardHtml(a, 'reauth'), /Gmail · sign-in expired[\s\S]*Sign in again/);
  assert.match(cardHtml(a, 'expired'), /This request expired. Ask again./); assert.doesNotMatch(cardHtml(a, 'expired'), /button/);
  assert.match(cardHtml({ ...a, app: 'gcal', title: 'Add event to Calendar' }, 'done', { result: { summary: 'Added', at: Date.parse('2026-10-28T13:42:00') } }), /Added · 13:42/);
  assert.equal(ago(Date.now() - 2 * 3600e3), '2 hours ago');
});
