// GET /recap and POST /recap/seen. Fixtures only: no live tick and no production Firestore.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { describe, test } from 'node:test';
import { createServer } from '../proxy/server.js';
import { buildRecapMoments, hashId, lifeStore } from '../proxy/life.js';

const SALT = 'test-salt';
const ALICE = 'aliceUid000000000001';
const BOB = 'bobUid00000000000002';
const OTHER = 'h_0123456789abcdef0123';

function store() {
  const usage = new Map();
  const moments = new Map();
  const bag = (uid) => moments.get(uid) || moments.set(uid, new Map()).get(uid);
  return {
    usage, moments,
    getUsage: async (uid) => usage.get(uid) || null,
    listMoments: async (uid) => [...bag(uid).values()],
    markMomentsSeen: async (uid, ids, now) => {
      let n = 0;
      for (const id of ids) {
        const m = bag(uid).get(id);
        if (!m) continue;
        m.seenAt = now;
        n++;
      }
      return n;
    },
    getMatchConsent: async () => ({ chats: false }),
    setMatchConsent: async () => {},
    put(uid, m) { bag(uid).set(m.id, { ...m }); },
  };
}

function moment(extra = {}) {
  return {
    id: `meet_${OTHER}_1700000000000`,
    kind: 'meeting',
    text: 'I met Priya.',
    createdAt: 1_700_000_000_000,
    weight: 3,
    source: 'event',
    refs: { meetingId: 'd1', otherAgentId: OTHER, otherAgentName: 'Priya' },
    ...extra,
  };
}

async function withApi(life, fn) {
  const server = createServer({
    admin: null, memory: null, apiKey: 'k', lifeSalt: SALT, lifeStore: life,
    rateLimiter: { allow: async () => true },
    verifyIdToken: async (t) => {
      const [uid, prov] = t.split('.');
      if (prov === 'bad') throw new Error('bad');
      return { uid, provider: prov === 'anon' ? 'anonymous' : 'google.com' };
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (uid, method, path, body, prov = 'g') => {
    const r = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(uid ? { authorization: `Bearer ${uid}.${prov}.sig` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* plain body */ }
    return { status: r.status, type: r.headers.get('content-type') || '', text, json };
  };
  try { return await fn(call); } finally { server.closeAllConnections(); server.close(); }
}

describe('GET /recap and POST /recap/seen', () => {
  test('auth, JSON contract, away gate, seen, and privacy', async () => {
    const s = store();
    const now = Date.now();
    s.usage.set(ALICE, { lastSessionEndAt: now - 16 * 60 * 1000, lastSeenAt: now });
    s.put(ALICE, moment());
    s.put(ALICE, moment({
      id: 'poison',
      text: `I met ${BOB}`,
      otherUid: BOB,
      threadId: 't_' + 'a'.repeat(24),
      uid: ALICE,
    }));
    s.put(ALICE, {
      id: `friend_${OTHER}`,
      kind: 'friend',
      text: 'Priya and I are friends now.',
      createdAt: now - 1000,
      source: 'event',
      weight: 99,
      refs: { meetingId: 'd1', otherAgentId: OTHER, otherAgentName: 'Priya', threadId: 'no', uid: ALICE },
    });
    s.put(BOB, moment({ id: 'bobsecret', text: 'BOB_SECRET', createdAt: now }));
    await withApi(s, async (call) => {
      const health = await call(null, 'GET', '/');
      assert.equal(health.status, 200);
      assert.equal(health.text, 'ok');
      assert.equal(health.json, null);

      assert.equal((await call(null, 'GET', '/recap')).status, 401);
      assert.equal((await call(ALICE, 'GET', '/recap', null, 'anon')).status, 403);
      const recap = await call(ALICE, 'GET', '/recap');
      assert.equal(recap.status, 200);
      assert.match(recap.type, /application\/json/);
      assert.equal(recap.json.show, true);
      assert.equal(recap.json.lastSessionEndAt, s.usage.get(ALICE).lastSessionEndAt);
      assert.equal(recap.json.moments.length, 2);
      assert.equal(recap.text.includes('ok'), false);
      const blob = JSON.stringify(recap.json);
      for (const leak of [ALICE, BOB, 'BOB_SECRET', 'threadId', 'otherUid']) assert.equal(blob.includes(leak), false, leak);
      const friend = recap.json.moments.find((m) => m.kind === 'friend');
      assert.equal(friend.weight, 5);
      assert.deepEqual(Object.keys(friend.refs).sort(), ['meetingId', 'otherAgentId', 'otherAgentName']);
      assert.equal(friend.refs.otherAgentId, OTHER);
      assert.equal(friend.source, 'event');

      const recent = store();
      recent.usage.set(ALICE, { lastSessionEndAt: Date.now() - 5 * 60 * 1000 });
      recent.put(ALICE, moment());
      await withApi(recent, async (call2) => {
        const quiet = await call2(ALICE, 'GET', '/recap');
        assert.equal(quiet.json.show, false);
        assert.equal(quiet.json.moments.length, 1);
        assert.equal(quiet.json.lastSessionEndAt, recent.usage.get(ALICE).lastSessionEndAt);
      });

      const seen = await call(ALICE, 'POST', '/recap/seen', { ids: [moment().id, 'missing_id'] });
      assert.equal(seen.status, 200);
      assert.deepEqual(seen.json, { ok: true });
      assert.equal(s.moments.get(ALICE).has('missing_id'), false);
      assert.ok(s.moments.get(ALICE).get(moment().id).seenAt > 0);
      const again = await call(ALICE, 'GET', '/recap');
      assert.equal(again.json.moments.some((m) => m.id === moment().id), false);
      assert.equal((await call(ALICE, 'POST', '/recap/seen', { ids: [moment().id] })).status, 200);

      assert.equal((await call(ALICE, 'POST', '/recap/seen', { ids: '../x' })).status, 400);
      assert.equal((await call(ALICE, 'POST', '/recap/seen', { ids: Array.from({ length: 21 }, (_, i) => `id${i}`) })).status, 400);
      for (const [method, path, body] of [['POST', '/recap', { ids: [moment().id] }], ['POST', '/recap/reply', { text: 'hi' }], ['GET', '/recap/seen', undefined]]) {
        const denied = await call(ALICE, method, path, body);
        assert.equal(denied.status, 404, `${method} ${path}`);
        assert.equal(denied.json.error, 'not found');
        assert.notEqual(denied.text, 'ok');
      }
      const consent = await call(ALICE, 'GET', '/me/match-consent');
      assert.equal(consent.status, 200);
      assert.deepEqual(consent.json, { chats: false });
    });
  });

  test('a stale lastSeenAt still shows before the opening heartbeat, then the heartbeat cannot hide it', async () => {
    const s = store();
    const seenAt = Date.now() - 20 * 60 * 1000;
    s.usage.set(ALICE, { lastSeenAt: seenAt });
    s.put(ALICE, moment());
    await withApi(s, async (call) => {
      const first = await call(ALICE, 'GET', '/recap');
      assert.equal(first.json.show, true);
      assert.equal(first.json.lastSessionEndAt, seenAt);
    });
  });

  test('recap reads are rate limited', async () => {
    await withApi(store(), async (call) => {
      let last;
      for (let i = 0; i < 31; i++) last = await call(ALICE, 'GET', '/recap');
      assert.equal(last.status, 429);
    });
  });
});

test('lifeStore.addMoment is create-only on agents/{uid}/moments and never stores a raw id', async () => {
  const calls = [];
  let exists = false;
  const s = lifeStore({
    projectId: 'virtual-world-8ac82',
    accessToken: async () => 't',
    fetchImpl: async (u, i) => {
      calls.push([String(u), i]);
      if (String(u).includes('/moments?')) {
        if (exists) return { ok: false, status: 409, json: async () => ({ error: { status: 'ALREADY_EXISTS' } }) };
        exists = true;
        return { ok: true, status: 200, json: async () => ({ name: `projects/virtual-world-8ac82/databases/default/documents/agents/${ALICE}/moments/x` }) };
      }
      return { ok: true, status: 200, json: async () => ([]) };
    },
  });
  const friend = buildRecapMoments({
    otherAgentId: hashId(BOB, SALT), otherName: 'Priya', shared: ['tech'], at: 1_700_000_000_000, meetingId: 'd1', isNewFriend: true,
  }).find((m) => m.kind === 'friend');
  assert.equal(await s.addMoment(ALICE, friend.id, { ...friend, threadId: 't_secret', uid: BOB }), true);
  assert.equal(await s.addMoment(ALICE, friend.id, friend), false);
  const post = calls.find(([u]) => u.includes('/moments?'));
  assert.match(post[0], /databases\/default\/documents\/agents\/aliceUid000000000001\/moments/);
  assert.equal(post[0].includes('(default)'), false);
  const fields = JSON.parse(post[1].body).fields;
  assert.equal(fields.threadId, undefined);
  assert.equal(fields.uid, undefined);
  assert.equal(fields.refs.mapValue.fields.otherAgentId.stringValue, hashId(BOB, SALT));
  assert.equal(fields.refs.mapValue.fields.threadId, undefined);
  assert.equal(JSON.stringify(fields).includes(BOB), false);
  assert.equal(await s.addMoment(ALICE, friend.id, { ...friend, refs: { otherAgentId: BOB, otherAgentName: 'Priya' } }), false);
});
