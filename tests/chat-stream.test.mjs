import assert from 'node:assert/strict';
import { once } from 'node:events';
import { describe, test } from 'node:test';
import { createServer, CHAT_MODEL, CUT_NOTE } from '../proxy/server.js';

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
const post = (url, auth = true) => fetch(url + '/chat/stream', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer a.b.c' } : {}) },
  body: JSON.stringify({ agent: { name: 'Nova', personality: 'kind' }, messages: [{ role: 'user', content: 'hi' }] }) });
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

describe('POST /chat/stream', () => {
  test('streams start, deltas (no thoughts) and done with the full reply', async () => {
    let url0;
    const fetchImpl = async (u) => { url0 = u; return geminiSse([{ text: 'secret plan', thought: true }, { text: 'Hello ' }, { text: 'there!' }]); };
    await run({ fetchImpl }, async (url) => {
      const r = await post(url);
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-type'), /text\/event-stream/);
      const ev = events(await r.text());
      assert.deepEqual(ev.map((e) => e.event), ['start', 'delta', 'delta', 'done']);
      assert.equal(ev.filter((e) => e.event === 'delta').map((e) => e.data.text).join(''), 'Hello there!');
      assert.deepEqual(ev.at(-1).data, { text: 'Hello there!', cut: false });
    });
    assert.ok(url0.endsWith(`${CHAT_MODEL}:streamGenerateContent?alt=sse`));
  });

  test('MAX_TOKENS: done carries the trimmed reply and cut: true', async () => {
    const fetchImpl = async () => geminiSse([{ text: 'One is done. Two is half' }], 'MAX_TOKENS');
    await run({ fetchImpl }, async (url) => {
      const done = events(await (await post(url)).text()).at(-1);
      assert.deepEqual(done, { event: 'done', data: { text: 'One is done.' + CUT_NOTE, cut: true } });
    });
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

  test('falls back on 404 before any bytes are sent', async () => {
    const urls = [];
    const fetchImpl = async (u) => { urls.push(u); return u.includes(CHAT_MODEL) ? new Response('{}', { status: 404 }) : geminiSse([{ text: 'ok' }]); };
    await run({ fetchImpl }, async (url) => assert.equal(events(await (await post(url)).text()).at(-1).data.text, 'ok'));
    assert.match(urls[1], /gemini-flash-latest:streamGenerateContent/);
  });

  test('auth and upstream errors are plain JSON, empty replies are an error event', async () => {
    await run({ fetchImpl: async () => new Response('{}', { status: 500 }) }, async (url) => {
      assert.equal((await post(url, false)).status, 401);
      const r = await post(url);
      assert.equal(r.status, 502);
      assert.match(r.headers.get('content-type'), /json/);
    });
    await run({ fetchImpl: async () => geminiSse([{ text: '' }]) }, async (url) => {
      assert.deepEqual(events(await (await post(url)).text()).at(-1), { event: 'error', data: { error: 'empty reply' } });
    });
  });

  test('the old non-streaming /chat still works', async () => {
    const fetchImpl = async (u) => { assert.match(u, /:generateContent$/); return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'hey' }] } }] })); };
    await run({ fetchImpl }, async (url) => {
      const r = await fetch(url + '/chat', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', Authorization: 'Bearer a.b.c' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) });
      assert.equal((await r.json()).choices[0].message.content, 'hey');
    });
  });
});
