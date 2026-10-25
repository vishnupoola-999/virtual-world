import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { cleanAction, parseModelReply, TOOL_DECLARATIONS } from '../proxy/tools.js';
import { prepareChat } from '../proxy/server.js';
import { createGoogleTools, composeReply, hdr, forgetToken, rawEmail, _tokenState, SCOPES, calendarInsertBody } from '../src/google-tools.js';
import { buildMailtoUrl as mailtoUrl, buildGmailComposeUrl as gmailComposeUrl, buildCalendarUrl, buildIcs, MAILTO_MAX } from '../src/agentTools.js';
import { toolsApiEnabled } from '../src/tools-config.js';

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

function harness({ confirm = async () => ({ confirmed: true }), responses = [], api = true, log = () => {}, timeZone = () => 'UTC' } = {}) {
  forgetToken();
  const calls = [], asked = [];
  const tools = createGoogleTools({
    requestAccess: async (s) => { asked.push(s); return { accessToken: `tok${asked.length}`, expiresIn: 3600 }; },
    confirm,
    apiEnabled: () => api,
    fetchImpl: async (url, init) => { calls.push({ url, init }); return responses.shift() || okRes({ items: [] }); },
    log,
    timeZone,
  });
  return { tools, calls, asked };
}
const send = { name: 'send_email', args: { to: 'a@b.com', subject: 'S', body: 'B' }, confirm: false };

for (const name of ['send_email', 'add_event']) {
  test(`${name} never runs without confirm (even if server says confirm:false)`, async () => {
    const args = name === 'add_event' ? { title: 't', start: '2026-10-25T10:00:00Z', end: '2026-10-25T11:00:00Z' } : send.args;
    for (const answer of [false, undefined, 'yes', 1]) {
      const h = harness({ confirm: async () => ({ confirmed: answer }) });
      await assert.rejects(h.tools.run({ name, args, confirm: false }), (e) => e.code === 'cancelled');
      assert.equal(h.calls.length, 0);
      assert.equal(h.asked.length, 0);
    }
  });
}

test('send runs after confirm with bearer token', async () => {
  const seen = [];
  const h = harness({ confirm: async (a) => { seen.push(a.kind + ':' + a.mode); return { confirmed: true }; } });
  const msg = await h.tools.run(send);
  assert.match(msg, /Sent/);
  assert.deepEqual(seen, ['email:api']);
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
  const t = createGoogleTools({ apiEnabled: () => true, requestAccess: async () => { throw new Error('popup closed'); }, confirm: async () => ({ confirmed: true }), fetchImpl: async () => okRes() });
  await assert.rejects(t.run(send), (e) => e.code === 'consent');
  const n = createGoogleTools({ apiEnabled: () => true, requestAccess: async () => ({ accessToken: 't' }), confirm: async () => ({ confirmed: true }), fetchImpl: async () => { throw new TypeError('net'); } });
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

const ev = { title: 'Lunch, team; ok\nnext', start: '2026-10-25T10:00:00+05:30', end: '2026-10-25T11:00:00+05:30', description: 'a\\b', details: 'a\\b', location: 'T-Hub & co' };
const gcalTemplateUrl = buildCalendarUrl;
const icsEvent = (e, now) => buildIcs(e, now());

test('mailto and Gmail compose URLs are encoded', () => {
  const e = { to: 'a@b.com', subject: 'Hi & bye?', body: 'line1\nline2 #1 100%' };
  const m = mailtoUrl(e);
  assert.equal(m, 'mailto:a%40b.com?subject=Hi%20%26%20bye%3F&body=line1%0Aline2%20%231%20100%25');
  const g = new URL(gmailComposeUrl(e));
  assert.equal(g.origin + g.pathname, 'https://mail.google.com/mail/');
  assert.equal(g.searchParams.get('view'), 'cm');
  assert.equal(g.searchParams.get('to'), 'a@b.com');
  assert.equal(g.searchParams.get('su'), 'Hi & bye?');
  assert.equal(g.searchParams.get('body'), e.body);
  assert.doesNotMatch(mailtoUrl({ ...e, to: 'a@b.com\r\nBcc: x@y.com' }), /%0D|%0A.*subject/i);
});

test('Google Calendar template URL uses UTC dates and encodes fields', () => {
  const u = new URL(gcalTemplateUrl(ev));
  assert.equal(u.searchParams.get('action'), 'TEMPLATE');
  assert.equal(u.searchParams.get('dates'), '20261025T043000Z/20261025T053000Z');
  assert.equal(u.searchParams.get('text'), 'Lunch, team; ok next');
  assert.equal(u.searchParams.get('location'), 'T-Hub & co');
  assert.equal(u.searchParams.get('details'), 'a\\b');
});

test('.ics is valid RFC 5545 with escaping and UTC times', () => {
  const ics = icsEvent({ ...ev, details: 'x'.repeat(200) + ', é', guests: [{ name: 'Ravi', email: 'r@x.com' }] }, () => Date.parse('2026-10-24T17:00:00Z'));
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(ics.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n'));
  assert.doesNotMatch(ics.replace(/\r\n/g, ''), /\n/);
  assert.match(ics, /\r\nDTSTART:20261025T043000Z\r\n/);
  assert.match(ics, /\r\nDTEND:20261025T053000Z\r\n/);
  assert.match(ics, /\r\nDTSTAMP:20261024T170000Z\r\n/);
  assert.match(ics, /SUMMARY:Lunch\\, team\\; ok\\nnext/);
  assert.match(ics, /LOCATION:T-Hub & co/);
  for (const l of ics.split('\r\n')) assert.ok(new TextEncoder().encode(l).length <= 75, l);
  assert.match(ics, /\r\n /);
  assert.match(ics, /ATTENDEE;CN="Ravi":mailto:r@x.com/);
  assert.match(icsEvent({ ...ev, start: new Date('2026-10-25T04:30:00Z'), end: new Date('2026-10-25T05:30:00Z') }, () => 0), /DTSTART:20261025T043000Z/);
});

test('flag off: no scope request, no Google API call, links offered after confirm', async () => {
  for (const name of ['draft_email', 'send_email', 'add_event', 'list_events']) {
    const seen = [];
    const h = harness({ api: false, confirm: async (a) => { seen.push(a); return { confirmed: true }; } });
    const args = name === 'add_event' ? ev : name === 'list_events' ? { days: 3 } : send.args;
    await h.tools.run({ name, args });
    assert.equal(h.asked.length, 0, name);
    assert.equal(h.calls.length, 0, name);
    if (name !== 'list_events') { assert.equal(seen[0].mode, 'links'); assert.equal(seen[0].kind, name === 'add_event' ? 'calendar' : 'email'); assert.ok(seen[0].email || seen[0].event); }
  }
  const h = harness({ api: false, confirm: async () => ({ confirmed: false }) });
  await assert.rejects(h.tools.run(send), (e) => e.code === 'cancelled');
});

test('draft_email never uses the API (no gmail.compose scope)', async () => {
  const h = harness({ api: true });
  await h.tools.run({ name: 'draft_email', args: send.args });
  assert.equal(h.asked.length, 0);
  assert.deepEqual(SCOPES.gmail, ['https://www.googleapis.com/auth/gmail.send']);
});

test('API flag is allowlist-only', () => {
  assert.equal(toolsApiEnabled(null), false);
  assert.equal(toolsApiEnabled({ email: 'someone@gmail.com' }), false);
  assert.equal(toolsApiEnabled({ email: 'SrilathaPoola6@gmail.com', emailVerified: true }), true);
  assert.equal(toolsApiEnabled({ email: 'srilathapoola6@gmail.com', emailVerified: false }), false);
});

test('mailto supports arrays, cc and stays under 2,000 chars', () => {
  const u = mailtoUrl({ to: ['a@b.com', 'c@d.com'], cc: ['e@f.com'], subject: 's', body: 'y'.repeat(5000) });
  assert.ok(u.startsWith('mailto:a%40b.com,c%40d.com?cc=e%40f.com&subject=s&body='));
  assert.ok(u.length <= MAILTO_MAX);
  assert.match(decodeURIComponent(u), /Message shortened/);
  const c = new URL(buildCalendarUrl({ ...ev, guests: [{ email: 'g@h.com' }, 'i@j.com'] }));
  assert.equal(c.searchParams.get('add'), 'g@h.com,i@j.com');
});

test('list_events output is ephemeral, never persisted', () => {
  const r = composeReply('Here you go.', [{ name: 'list_events', text: '• Dentist (2026-10-25)' }, { name: 'add_event', text: 'Opened Google Calendar.' }]);
  assert.equal(r.persist, 'Here you go.\nOpened Google Calendar.');
  assert.equal(r.ephemeral, '• Dentist (2026-10-25)');
  assert.doesNotMatch(r.persist, /Dentist/);
  const chat = readFileSync(new URL('../src/chat.js', import.meta.url), 'utf8');
  assert.match(chat, /if \(ephemeral\) add\('assistant', ephemeral, 'ephemeral'\)/);
  assert.doesNotMatch(chat, /remember\([^)]*ephemeral/);
});

test('real calendar add includes location', async () => {
  const h = harness();
  await h.tools.run({ name: 'add_event', args: { title: 't', start: '2026-10-25T10:00:00Z', end: '2026-10-25T11:00:00Z', location: 'T-Hub' } });
  assert.equal(JSON.parse(h.calls[0].init.body).location, 'T-Hub');
});

test('hdr strips all control characters', () => {
  assert.equal(hdr('a\x00b\tc\x1fd\x7fe\r\nf'), 'a b c d e f');
  const raw = Buffer.from(rawEmail({ to: 'a@b.com\x0bBcc: x', subject: 's\x00', body: 'b' }), 'base64url').toString();
  // eslint-disable-next-line no-control-regex
  assert.doesNotMatch(raw.split('\r\n\r\n')[0], /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/);
});

test('calendar insert sends an RFC3339 offset and the owner time zone', async () => {
  const bare = calendarInsertBody(
    { title: 'Meet Rajesh', description: '', location: 'Cafe', start: '2026-10-27T21:30:00', end: '2026-10-27T22:30:00' },
    'Asia/Kolkata',
  );
  assert.equal(bare.start.dateTime, '2026-10-27T21:30:00+05:30');
  assert.equal(bare.end.dateTime, '2026-10-27T22:30:00+05:30');
  assert.equal(bare.start.timeZone, 'Asia/Kolkata');
  assert.equal(bare.end.timeZone, 'Asia/Kolkata');
  assert.equal(bare.location, 'Cafe');
  const compact = calendarInsertBody({ title: 't', start: '2026-10-27T21:30:00+0530', end: '2026-10-27T22:30:00+0530' }, 'Asia/Kolkata');
  assert.equal(compact.start.dateTime, '2026-10-27T21:30:00+05:30');
  const zulu = calendarInsertBody({ title: 't', start: '2026-10-25T10:00:00Z', end: '2026-10-25T11:00:00Z' }, 'Asia/Kolkata');
  assert.equal(zulu.start.dateTime, '2026-10-25T10:00:00Z');
  assert.equal(zulu.start.timeZone, 'Asia/Kolkata');

  const h = harness({ timeZone: () => 'Asia/Kolkata' });
  await h.tools.run({ name: 'add_event', args: { title: 'Meet Rajesh', start: '2026-10-27T21:30:00', end: '2026-10-27T22:30:00', location: 'Cafe' } });
  const sent = JSON.parse(h.calls[0].init.body);
  assert.equal(sent.start.dateTime, '2026-10-27T21:30:00+05:30');
  assert.equal(sent.start.timeZone, 'Asia/Kolkata');
  assert.equal(sent.location, 'Cafe');
  assert.doesNotMatch(h.calls[0].init.headers.Authorization, /2026-10-27T21:30:00"/);
});

test('calendar insert failure is logged without the token and offers the link fallback', async () => {
  const logs = [];
  const seen = [];
  const body = { error: { message: 'Missing time zone definition for start time.', errors: [{ reason: 'required' }] } };
  const h = harness({
    log: (...parts) => logs.push(parts.join(' ')),
    confirm: async (sheet) => { seen.push(sheet); sheet.onResult = (r) => seen.push(r); return { confirmed: true }; },
    responses: [{ ok: false, status: 400, json: async () => body }],
    timeZone: () => 'Asia/Kolkata',
  });
  await assert.rejects(
    h.tools.run({ name: 'add_event', args: { title: 'Meet Rajesh', start: '2025-05-13T21:30:00', end: '2025-05-13T22:30:00' } }),
    (e) => e.code === 'failed',
  );
  assert.match(logs.join('\n'), /google api failed 400 required Missing time zone definition/);
  assert.doesNotMatch(logs.join('\n'), /Bearer|tok1/);
  assert.equal(seen[1].ok, false);
  assert.equal(seen[1].fallback, true);
  const sent = JSON.parse(h.calls[0].init.body);
  assert.equal(sent.start.dateTime, '2025-05-13T21:30:00+05:30');
  assert.equal(sent.start.timeZone, 'Asia/Kolkata');
});

test('a disabled Calendar API is logged with Google\'s message, not treated as a consent miss', async () => {
  const logs = [];
  const message = 'Google Calendar API has not been used in project 38479190061 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=38479190061';
  const h = harness({
    log: (...parts) => logs.push(parts.join(' ')),
    responses: [{ ok: false, status: 403, json: async () => ({ error: { message, errors: [{ reason: 'forbidden' }], status: 'PERMISSION_DENIED' } }) }],
  });
  await assert.rejects(
    h.tools.run({ name: 'add_event', args: { title: 't', start: '2026-10-27T21:30:00+05:30', end: '2026-10-27T22:30:00+05:30' } }),
    (e) => e.code === 'disabled' && /not enabled/.test(e.message),
  );
  assert.match(logs.join('\n'), /calendar-json\.googleapis\.com/);
  assert.doesNotMatch(logs.join('\n'), /Bearer|tok1/);
});

test('api-mode onResult reports success/failure and ignores callback throws', async () => {
  const results = [];
  const hook = (fn) => async (sheet) => { sheet.onResult = fn; return { confirmed: true }; };
  let h = harness({ confirm: hook((r) => results.push(r)) });
  await h.tools.run(send);
  h = harness({ confirm: hook((r) => results.push(r)), responses: [{ ok: false, status: 503 }] });
  await assert.rejects(h.tools.run(send), (e) => e.code === 'busy');
  assert.deepEqual(results[0], { ok: true });
  assert.equal(results[1].ok, false);
  assert.match(results[1].error, /busy/);
  h = harness({ confirm: hook(() => { throw new Error('ui bug'); }) });
  assert.match(await h.tools.run(send), /Sent/);
});
