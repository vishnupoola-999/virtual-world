import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fanOut, cardStatus, clip, feedHtml, activityHtml, noteText, worthMeeting, setupTown, EMPTY, clearShift, FAN_PX } from '../src/town.js';

test('clip caps at 40 chars with ellipsis', () => { assert.equal(clip('a'.repeat(50)).length, 40); assert.equal(clip('short'), 'short'); });
test('cardStatus handles string, object and junk', () => {
  assert.deepEqual(cardStatus('Reading at the library'), { kind: 'walking', label: 'Reading at the library' });
  assert.equal(cardStatus({ kind: 'meeting', label: 'x'.repeat(60) }).label.length, 40);
  assert.equal(cardStatus(null), null); assert.equal(cardStatus(''), null);
});
test('fanOut spreads agents in the same spot by 40px', () => {
  const o = fanOut([{ id: 'a', lat: 17.45, lon: 78.38 }, { id: 'b', lat: 17.45, lon: 78.38 }, { id: 'c', lat: 17.5, lon: 78.4 }]);
  assert.deepEqual(o.get('c'), [0, 0]);
  const [ax] = o.get('a'), [bx] = o.get('b');
  assert.equal(FAN_PX, 40); assert.ok(Math.abs(ax - bx) <= 80 && (ax !== 0 || bx !== 0 || o.get('a')[1] !== o.get('b')[1]));
});
test('Feed shows only Around town; Activity shows only my agent (no duplicates), chips, escaping', () => {
  const f = { mine: [{ kind: 'meet', withName: '<b>Zed', shared: ['chess'], lines: [{ speaker: 'Bs', text: 'hi' }], at: Date.now() }], town: [{ aName: 'A', bName: 'B', shared: [], at: Date.now() }] };
  const h = feedHtml(f), a = activityHtml(f);
  assert.match(h, /Around town/); assert.doesNotMatch(h, /Zed|Your agent/);
  assert.match(a, /&lt;b&gt;Zed/); assert.match(a, /Worth meeting/); assert.match(a, /Say hi/); assert.doesNotMatch(a, /A and B met|Around town/); assert.match(a, /aria-expanded="false"/);
  assert.match(activityHtml({ mine: [] }), new RegExp(EMPTY.replace('.', '\\.')));
  assert.match(feedHtml({ town: [] }), /No meets around town yet/);
});
test('refreshMap skips myId, ignores anonymous users, survives errors', async () => {
  const put = []; const removed = [];
  const agents = { put: (d) => put.push(d.id), get: () => ({ marker: { setOffset() {} } }), remove: (id) => removed.push(id) };
  const user = { isAnonymous: false, getIdToken: async () => 't' };
  const t = setupTown({ agents, living: {}, getUser: () => user, deps: {
    fetchFeed: async () => ({ myId: 'h_me', mine: [], town: [] }),
    fetchPublicAgents: async () => [{ id: 'h_me', lat: 1, lon: 1 }, { id: 'h_x', lat: 1, lon: 1, name: 'X' }, { id: 'h_bad' }] } });
  assert.equal(await t.refreshMap(), 1); assert.deepEqual(put, ['h_x']);
  assert.equal(await t.refreshMap({ isAnonymous: true, getIdToken: async () => 't' }), 0); assert.deepEqual(removed, ['h_x']);
  const t2 = setupTown({ agents, living: {}, getUser: () => user, deps: { fetchFeed: async () => { throw new Error('x'); }, fetchPublicAgents: async () => { throw new Error('y'); } } });
  assert.equal(await t2.refreshMap(), 0);
});

test('clearShift: 16px from edges and 8px clear of the rail', () => {
  const rail = { x: 300, y: 50, w: 48, h: 170 };
  assert.equal(clearShift({ x: 2, y: 400, w: 60, h: 90 }, { w: 360, rail }), 14);
  assert.ok(250 + clearShift({ x: 250, y: 100, w: 60, h: 90 }, { w: 360, rail }) + 60 <= rail.x - 8);
  assert.ok(330 + clearShift({ x: 330, y: 500, w: 60, h: 90 }, { w: 360, rail }) + 60 <= 360 - 16);
  assert.equal(clearShift({ x: 100, y: 400, w: 60, h: 90 }, { w: 360, rail }), 0);
});

const GAPS = /undefined|null|\$\{|\{|\}|\s[,.]|\s{2}/;
test('worth-meeting: never for town meets or meets without shared interests', () => {
  const f = { mine: [{ kind: 'meet', id: 'a', withName: 'Ravi', shared: [] }, { kind: 'meet', id: 't', town: true, withName: 'T', shared: ['art'] }, { kind: 'meet', id: 'm', withName: 'Mira', shared: ['art'] }, { kind: 'diary', text: 'x' }] };
  assert.deepEqual(worthMeeting(f).map((e) => e.id), ['m']);
  assert.doesNotMatch(activityHtml(f), /data-id="t"/);
});
test('worth-meeting: one fallback line, no template gaps', () => {
  assert.equal(noteText({ withName: 'Priya', shared: ['space'] }), 'Met Priya, you both like space.');
  assert.equal(noteText({ withName: 'Arjun', shared: ['music', 'chess', 'tea'] }), 'Met Arjun, you both like music and chess.');
  assert.equal(noteText({ withName: '', shared: ['art'] }), 'Met someone new, you both like art.');
  assert.equal(noteText({ withName: 'X', shared: [] }), '');
  assert.equal(noteText({ withName: '<img>', shared: ['<b>'] }), 'Met &lt;img&gt;, you both like &lt;b&gt;.');
  for (const e of [{ withName: 'A', shared: ['x'] }, { shared: ['x', 'y'] }, { withName: ' ', shared: ['x', ' '] }]) assert.doesNotMatch(noteText(e), GAPS);
});
test('worth-meeting: note from /feed wins, escaped and capped at 90', () => {
  assert.equal(noteText({ withName: 'P', shared: ['x'], note: 'Priya would <3 to meet you' }), 'Priya would &lt;3 to meet you');
  const long = noteText({ shared: ['x'], note: 'a'.repeat(300) });
  assert.equal(long.length, 90); assert.ok(long.endsWith('…'));
});
