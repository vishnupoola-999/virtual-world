import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { cleanAction, parseModelReply, TOOL_DECLARATIONS } from '../proxy/tools.js';
import { prepareChat } from '../proxy/server.js';
import { createGoogleTools, forgetToken, rawEmail, _tokenState } from '../src/google-tools.js';

const fc = (name, args) => ({ candidates: [{ content: { parts: [{ text: 'Sure.' }, { functionCall: { name, args } }] } }] });
const okRes = (body = {}) => ({ ok: true, status: 200, json: async () => body });

test('parses and validates tool proposals', () => {
  const r = parseModelReply(fc('send_email', { to: 'a@b.com', subject: 'Hi\r\nBcc: x@y.com', body: 'yo' }));
  assert.equal(r.text, 'Sure.');
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].confirm, true);
  assert.ok(!/\r|\n/.test(r.actions[0].args.subject));
  assert.equal(parseModelReply(fc('delete_all', {})).actions.length, 0);
  assert.equal(cleanAction({ name: 'send_email', args: { to: 'not an email', subject: '', body: '' } }), null);
  assert.equal(cleanAction({ name: 'add_event', args: { title: 't', start: '2026-10-25T10:00:00+05:30', end: '2026-10-25T09:00:00+05:30' } }), null);
  assert.equal(cleanAction({ name: 'list_events', args: { days: 99 } }).args.days, 14);
  assert.equal(cleanAction({ name: 'list_events', args: {} }).confirm, false);
  assert.deepEqual(parseModelReply({}), { text: '', actions: [] });
  assert.equal(TOOL_DECLARATIONS[0].functionDeclarations.length, 4);
});

test('prepareChat only adds tools when asked', () => {
  const base = { agent: { name: 'A' }, messages: [{ role: 'user', content: 'hi' }] };
  assert.equal(prepareChat(base).tools, false);
  assert.equal(prepareChat({ ...base, tools: true }).tools, true);
  assert.equal(prepareChat({ ...base, tools: 'yes' }).tools, false);
});

function harness({ confirm = async () => true, responses = [] } = {}) {
  forgetToken();
  const calls = [], asked = [];
  const tools = createGoogleTools({
    requestAccess: async (s) => { asked.push(s); return { accessToken: `tok${asked.length}`, expiresIn: 3600 }; },
    confirm,
    fetchImpl: async (url, init) => { calls.push({ url, init }); return responses.shift() || okRes({ items: [] }); },
  });
  return { tools, calls, asked };
}
const send = { name: 'send_email', args: { to: 'a@b.com', subject: 'S', body: 'B' }, confirm: false };

for (const name of ['send_email', 'draft_email', 'add_event']) {
  test(`${name} never runs without confirm (even if server says confirm:false)`, async () => {
    const args = name === 'add_event' ? { title: 't', start: '2026-10-25T10:00:00Z', end: '2026-10-25T11:00:00Z' } : send.args;
    for (const answer of [false, undefined, 'yes', 1]) {
      const h = harness({ confirm: async () => answer });
      await assert.rejects(h.tools.run({ name, args, confirm: false }), (e) => e.code === 'cancelled');
      assert.equal(h.calls.length, 0);
      assert.equal(h.asked.length, 0);
    }
  });
}

test('send runs after confirm with bearer token', async () => {
  const seen = [];
  const h = harness({ confirm: async (a) => { seen.push(a.name); return true; } });
  const msg = await h.tools.run(send);
  assert.match(msg, /Sent/);
  assert.deepEqual(seen, ['send_email']);
  assert.match(h.calls[0].url, /messages\/send$/);
  assert.equal(h.calls[0].init.headers.Authorization, 'Bearer tok1');
});

test('list_events is read-only and needs no confirm', async () => {
  const h = harness({ confirm: async () => { throw new Error('should not ask'); }, responses: [okRes({ items: [{ summary: 'Standup', start: { dateTime: 'x' } }] })] });
  assert.match(await h.tools.run({ name: 'list_events', args: { days: 3 } }), /Standup/);
  assert.equal(h.calls[0].init.method, undefined);
});

test('expired token re-prompts once, then friendly error', async () => {
  const h = harness({ responses: [{ ok: false, status: 401 }, okRes()] });
  await h.tools.run(send);
  assert.equal(h.asked.length, 2);
  const h2 = harness({ responses: [{ ok: false, status: 401 }, { ok: false, status: 401 }] });
  await assert.rejects(h2.tools.run(send), (e) => e.code === 'expired');
});

test('busy, consent and network errors are friendly', async () => {
  await assert.rejects(harness({ responses: [{ ok: false, status: 503 }] }).tools.run(send), (e) => e.code === 'busy');
  await assert.rejects(harness({ responses: [{ ok: false, status: 403 }] }).tools.run(send), (e) => e.code === 'consent');
  forgetToken();
  const t = createGoogleTools({ requestAccess: async () => { throw new Error('popup closed'); }, confirm: async () => true, fetchImpl: async () => okRes() });
  await assert.rejects(t.run(send), (e) => e.code === 'consent');
  const n = createGoogleTools({ requestAccess: async () => ({ accessToken: 't' }), confirm: async () => true, fetchImpl: async () => { throw new TypeError('net'); } });
  await assert.rejects(n.run(send), (e) => e.code === 'busy');
});

test('token is never persisted', async () => {
  const src = readFileSync(new URL('../src/google-tools.js', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|setDoc|addDoc/);
  const fb = readFileSync(new URL('../src/firebase.js', import.meta.url), 'utf8');
  const fn = fb.slice(fb.indexOf('requestGoogleAccess'));
  assert.doesNotMatch(fn, /localStorage|sessionStorage|setDoc|addDoc/);
  const h = harness();
  await h.tools.run(send);
  assert.ok(_tokenState());
  forgetToken();
  assert.equal(_tokenState(), null);
});

test('rawEmail strips header injection', () => {
  const raw = Buffer.from(rawEmail({ to: 'a@b.com\r\nBcc: evil@x.com', subject: 'hé', body: 'B' }), 'base64url').toString();
  assert.doesNotMatch(raw, /\r\nBcc:/);
  assert.match(raw, /Subject: =\?UTF-8\?B\?/);
});
