import assert from 'node:assert/strict';
import { once } from 'node:events';
import { describe, test } from 'node:test';
import { createServer, CHAT_MODEL, pendingAction, streamErrorCode, linkOut } from '../proxy/server.js';

const ORIGIN = 'https://vishnupoola-999.github.io';
const UID = 'ownerUid000000000001';

async function run(options, fn) {
  const server = createServer({ apiKey: 'test-key', admin: null, memory: null, lifeStore: null, rateLimiter: { allow: async () => true }, verifyIdToken: async () => ({ uid: UID }), ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}
const H = { Origin: ORIGIN, 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: 'Bearer a.b.c' };
const post = (url, { auth = true, path = '/agent/chat', body, signal } = {}) => fetch(url + path, { method: 'POST', signal, headers: auth ? H : { ...H, Authorization: '' },
  body: JSON.stringify(body || { agent: { name: 'Nova', personality: 'kind' }, messages: [{ role: 'user', content: 'hi' }] }) });
// Gemini alt=sse body, split mid-event to check buffering.
function geminiSse(chunks, finishReason = 'STOP') {
  const events = chunks.map((c, i) => ({ candidates: [{ content: { parts: [c] }, ...(i === chunks.length - 1 ? { finishReason } : {}) }] }));
  const raw = events.map((e) => `data: ${JSON.stringify(e)}\r\n\r\n`).join('');
  const mid = Math.floor(raw.length / 2);
  return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(raw.slice(0, mid))); c.enqueue(new TextEncoder().encode(raw.slice(mid))); c.close(); } }), { status: 200 });
}
function events(text) {
  return text.trim().split('\n\n').map((b) => {
    const [e, d] = b.split('\n');
    return { event: e.slice(7), data: JSON.parse(d.slice(6)) };
  });
}


// An upstream that sends one token, then waits until the request is aborted.
function hangingSse(first) {
  return (u, init) => new Response(new ReadableStream({ start(c) {
    c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: first }] } }] })}\n\n`));
    init.signal.addEventListener('abort', () => c.error(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  } }), { status: 200 });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('POST /agent/chat (SSE)', () => {
  test('streams token events (no thoughts) then done with messageId and the full reply', async () => {
    let url0;
    const fetchImpl = async (u) => { url0 = u; return geminiSse([{ text: 'secret plan', thought: true }, { text: 'Hello ' }, { text: 'there!' }]); };
    await run({ fetchImpl }, async (url) => {
      for (const path of ['/agent/chat', '/chat/stream']) {
        const r = await post(url, { path });
        assert.equal(r.status, 200);
        assert.match(r.headers.get('content-type'), /text\/event-stream/);
        const id = r.headers.get('x-message-id');
        assert.match(id, /^m_[0-9a-f]{18}$/);
        const ev = events(await r.text());
        assert.deepEqual(ev.map((e) => e.event), ['token', 'token', 'done']);
        assert.equal(ev.filter((e) => e.event === 'token').map((e) => e.data.t).join(''), 'Hello there!');
        assert.deepEqual(ev.at(-1).data, { messageId: id, text: 'Hello there!' });
        const stored = await (await fetch(`${url}/agent/chat/${id}`, { headers: H })).json();
        assert.deepEqual(stored, { messageId: id, text: 'Hello there!' });
      }
    });
    assert.ok(url0.endsWith(`${CHAT_MODEL}:streamGenerateContent?alt=sse`));
  });

  test('link-out tool calls are never action events; they come back as done.links', async () => {
    const call = { functionCall: { name: 'send_email', args: { to: 'pooja@example.com', subject: 'Hi', body: 'Hello' } } };
    await run({ fetchImpl: async () => geminiSse([{ text: 'I can send that.' }, call]) }, async (url) => {
      const ev = events(await (await post(url, { body: { tools: true, timeZone: 'Asia/Kolkata', messages: [{ role: 'user', content: 'email pooja hi' }] } })).text());
      assert.equal(ev.filter((e) => e.event === 'action').length, 0, 'no action event for a link-out');
      const done = ev.at(-1);
      assert.equal(done.event, 'done');
      assert.equal(done.data.actions, undefined);
      assert.equal(done.data.text, 'I can send that.');
      assert.equal(done.data.links.length, 1);
      const [l] = done.data.links;
      assert.deepEqual([l.app, l.name], ['gmail', 'send_email']);
      assert.match(l.label, /pooja@example\.com/);
      assert.match(l.url, /^https:\/\/mail\.google\.com\/mail\/\?view=cm/);
      assert.match(l.url, /su=Hi/);
      assert.match(l.mailto, /^mailto:pooja%40example\.com\?subject=Hi/);
    });
    const p = pendingAction({ name: 'add_event', args: { title: 'Lunch', start: '2026-10-29T13:00' } }, 1000);
    assert.deepEqual([p.app, p.kind, p.expiresAt], ['gcal', 'write', 1000 + 15 * 60_000]);
  });

  test('a link-out with no reply text still ends with done, a short line and the link', async () => {
    const call = { functionCall: { name: 'draft_email', args: { to: 'ravi@example.com', subject: 'Plan', body: 'See you' } } };
    await run({ fetchImpl: async () => geminiSse([call]) }, async (url) => {
      const ev = events(await (await post(url, { body: { tools: true, timeZone: 'Asia/Kolkata', messages: [{ role: 'user', content: 'draft ravi an email' }] } })).text());
      assert.equal(ev.filter((e) => e.event === 'action').length, 0);
      const done = ev.at(-1);
      assert.equal(done.event, 'done');
      assert.equal(done.data.text, 'Tap the link below to finish it.');
      assert.equal(done.data.links[0].name, 'draft_email');
    });
  });

  test('connected-app actions keep their action events and are not links', async () => {
    const act = { id: 'act_' + 'a'.repeat(18), app: 'calendar', kind: 'write', summary: 'Lunch', expiresAt: 99 };
    const connectors = {
      toolsFor: async () => ({ apps: ['calendar'], declarations: [{ name: 'calendar_create_event', description: 'x', parameters: { type: 'OBJECT', properties: {} } }] }),
      isTool: (n) => n === 'calendar_create_event',
      handleCall: async () => ({ action: act }),
    };
    const call = { functionCall: { name: 'calendar_create_event', args: { title: 'Lunch' } } };
    await run({ connectors, fetchImpl: async () => geminiSse([{ text: 'Shall I add it?' }, call]) }, async (url) => {
      const ev = events(await (await post(url, { body: { tools: true, timeZone: 'Asia/Kolkata', messages: [{ role: 'user', content: 'add lunch' }] } })).text());
      const acts = ev.filter((e) => e.event === 'action');
      assert.deepEqual(acts.map((e) => e.data), [act]);
      assert.equal(ev.at(-1).data.links, undefined);
    });
  });

  test('linkOut builds https links only, with a 1h default end for events', () => {
    const e = linkOut({ name: 'add_event', args: { title: 'Lunch', start: '2026-10-29T13:00' } }, 'Asia/Kolkata');
    assert.equal(e.app, 'gcal');
    assert.match(e.url, /dates=20261029T073000Z\/20261029T083000Z/);
    assert.equal(linkOut({ name: 'add_event', args: { title: 'x', start: 'soon' } }, 'UTC'), null);
    assert.equal(linkOut({ name: 'list_events', args: {} }).url, 'https://calendar.google.com/calendar/r');
    assert.equal(linkOut({ name: 'mystery', args: {} }), null);
  });

  test('MAX_TOKENS ends with error cut_off, the partial is stored with partial: cut_off and not sent to memory', async () => {
    let memCalls = 0;
    const memory = { get: async () => '', getLife: async () => '', set: async () => { memCalls++; } };
    await run({ memory, fetchImpl: async (u) => (u.includes('stream') ? geminiSse([{ text: 'One is done. Two is half' }], 'MAX_TOKENS') : (memCalls++, new Response('{}'))) }, async (url) => {
      const r = await post(url);
      const last = events(await r.text()).at(-1);
      assert.equal(last.event, 'error');
      assert.deepEqual(last.data, { code: 'cut_off', message: 'The reply got too long and stopped.', messageId: r.headers.get('x-message-id'), text: 'One is done. Two is half', partial: 'cut_off' });
      assert.equal((await (await fetch(`${url}/agent/chat/${last.data.messageId}`, { headers: H })).json()).partial, 'cut_off');
    });
    assert.equal(memCalls, 0);
  });

  test('saves the full reply to memory at the end', async () => {
    const saved = [];
    const pending = [];
    const memory = { get: async () => '', getLife: async () => '', set: async (uid, facts) => saved.push([uid, facts]) };
    const fetchImpl = async (u, init) => (u.includes('stream')
      ? geminiSse([{ text: 'Nice to ' }, { text: 'meet you, Vishnu.' }])
      : (assert.match(JSON.parse(init.body).contents[0].parts[0].text, /Agent: Nice to meet you, Vishnu\./), new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '- Owner is Vishnu' }] } }] }))));
    await run({ fetchImpl, memory, pending }, async (url) => { await (await post(url)).text(); });
    await Promise.all(pending);
    assert.deepEqual(saved, [[UID, '- Owner is Vishnu']]);
  });

  test('POST /stop keeps the partial as stopped, and /continue streams the rest', async () => {
    const bodies = [];
    let n = 0;
    const fetchImpl = async (u, init) => { bodies.push(JSON.parse(init.body)); return n++ === 0 ? hangingSse('Part one, ')(u, init) : geminiSse([{ text: 'part two.' }]); };
    await run({ fetchImpl }, async (url) => {
      const r = await post(url);
      const id = r.headers.get('x-message-id');
      const textP = r.text();
      await wait(50);
      assert.deepEqual(await (await fetch(`${url}/agent/chat/${id}/stop`, { method: 'POST', headers: H })).json(), { messageId: id, partial: 'stopped' });
      const ev = events(await textP);
      assert.deepEqual(ev.at(-1), { event: 'done', data: { messageId: id, text: 'Part one, ', partial: 'stopped' } });
      const c = await fetch(`${url}/agent/chat/${id}/continue`, { method: 'POST', headers: H });
      const cev = events(await c.text());
      assert.equal(cev.at(-1).data.text, 'part two.');
      const contents = bodies[1].contents;
      assert.deepEqual(contents.slice(-2).map((x) => x.role), ['model', 'user']);
      assert.equal(contents.at(-2).parts[0].text, 'Part one,');
      assert.equal((await fetch(`${url}/agent/chat/${cev.at(-1).data.messageId}/continue`, { method: 'POST', headers: H })).status, 404);
    });
  });

  test('a client abort mid-stream aborts the upstream and stores the partial as stopped', async () => {
    let upstreamSignal;
    const fetchImpl = async (u, init) => { upstreamSignal = init.signal; return hangingSse('Hal')(u, init); };
    await run({ fetchImpl }, async (url) => {
      const ac = new AbortController();
      const r = await post(url, { signal: ac.signal });
      const id = r.headers.get('x-message-id');
      await wait(50);
      ac.abort();
      await wait(80);
      assert.equal(upstreamSignal.aborted, true);
      assert.deepEqual(await (await fetch(`${url}/agent/chat/${id}`, { headers: H })).json(), { messageId: id, text: 'Hal', partial: 'stopped' });
    });
  });

  test('another user cannot read, stop or continue a reply', async () => {
    let who = UID;
    await run({ verifyIdToken: async () => ({ uid: who }), fetchImpl: async () => geminiSse([{ text: 'hi' }]) }, async (url) => {
      const id = (await post(url)).headers.get('x-message-id');
      await wait(30);
      who = 'otherUid00000000000002';
      assert.equal((await fetch(`${url}/agent/chat/${id}`, { headers: H })).status, 404);
      assert.equal((await fetch(`${url}/agent/chat/${id}/continue`, { method: 'POST', headers: H })).status, 404);
    });
  });

  test('falls back on 404 before any bytes are sent', async () => {
    const urls = [];
    const fetchImpl = async (u) => { urls.push(u); return u.includes(CHAT_MODEL) ? new Response('{}', { status: 404 }) : geminiSse([{ text: 'ok' }]); };
    await run({ fetchImpl }, async (url) => assert.equal(events(await (await post(url)).text()).at(-1).data.text, 'ok'));
    assert.match(urls[1], /gemini-flash-latest:streamGenerateContent/);
  });

  test('errors: 401 stays JSON; upstream failure, rate limit and empty reply are error events with a code', async () => {
    await run({ fetchImpl: async () => new Response('{}', { status: 500 }) }, async (url) => {
      assert.equal((await post(url, { auth: false })).status, 401);
      const r = await post(url);
      assert.equal(r.status, 502);
      assert.deepEqual(events(await r.text()).at(-1).data.code, 'failed');
    });
    await run({ rateLimiter: { allow: async () => false }, fetchImpl: async () => geminiSse([{ text: 'x' }]) }, async (url) => {
      const r = await post(url);
      assert.equal(r.status, 429);
      assert.equal(events(await r.text()).at(-1).data.code, 'rate_limited');
    });
    await run({ fetchImpl: async () => geminiSse([{ text: '' }]) }, async (url) => {
      assert.equal(events(await (await post(url)).text()).at(-1).data.code, 'failed');
    });
    assert.equal(streamErrorCode(400), null);
  });

  test('the old non-streaming /chat still works', async () => {
    const fetchImpl = async (u) => { assert.match(u, /:generateContent$/); return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'hey' }] } }] })); };
    await run({ fetchImpl }, async (url) => {
      const r = await fetch(url + '/chat', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', Authorization: 'Bearer a.b.c' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) });
      assert.equal((await r.json()).choices[0].message.content, 'hey');
    });
  });
});
