import assert from 'node:assert/strict';
import { once } from 'node:events';
import { describe, test } from 'node:test';
import { createServer } from '../proxy/server.js';
import {
  LIFE, capAllows, checkTickSecret, cleanInterests, countAction, dayKey, parseConversation, parseDecision,
  pickMatch, placeNear, runTick, shouldAct, similarity,
} from '../proxy/life.js';
import { TEST_AGENTS } from '../scripts/seed-test-agents.mjs';

const NOW = Date.parse('2026-10-24T12:00:00Z');
const SECRET = 'a'.repeat(32);

function agent(uid, interests, extra = {}) {
  return { uid, name: `Agent ${uid}`, interests, bio: `bio ${uid}`, ownerName: `REAL_NAME_${uid}`, memory: { facts: `SECRET_MEMORY_${uid}` },
    lat: 17.123456, lon: 78.654321, approx: { lat: 17.12, lon: 78.65 }, updatedAt: NOW - 3_600_000, ...extra };
}

function fakeStore(agents) {
  const s = { lives: {}, diary: {}, friends: {} };
  s.listAgents = async () => agents.map((a) => ({ ...a }));
  s.saveLife = async (uid, life) => { s.lives[uid] = life; };
  s.addDiary = async (uid, e) => { (s.diary[uid] ||= []).push(e); };
  s.addFriend = async (uid, other, fact) => { (s.friends[uid] ||= {})[other] = fact; };
  return s;
}

describe('matching', () => {
  test('jaccard similarity on cleaned tags', () => {
    assert.equal(similarity(['tech', 'science'], ['Tech', 'science ']), 1);
    assert.equal(similarity(['tech', 'science', 'music'], ['tech', 'art']), 0.25);
    assert.equal(similarity(['tech'], []), 0);
    assert.deepEqual(cleanInterests(['Tech', 'tech', '', 'a'.repeat(30), 'ai', 'x', 'y', 'z', 'w']), ['tech', 'ai', 'x', 'y', 'z']);
  });
  test('picks the most similar agent, skips self, zero overlap and recently met', () => {
    const me = agent('me', ['tech', 'science', 'space'], { life: { met: { best: NOW - 3600_000 } } });
    const others = [me, agent('best', ['tech', 'science', 'space']), agent('mid', ['tech', 'science', 'music']), agent('none', ['cricket', 'food', 'art'])];
    assert.equal(pickMatch(me, others, NOW).agent.uid, 'mid');
    me.life.met.best = NOW - LIFE.meetCooldownMs - 1;
    assert.equal(pickMatch(me, others, NOW).agent.uid, 'best');
    assert.equal(pickMatch(me, [agent('none', ['cricket', 'food', 'art'])], NOW), null);
  });
  test('places stay within ~2 km of the approximate home', () => {
    const p = placeNear(agent('me', ['tech']), 'tech', NOW);
    assert.ok(Math.abs(p.lat - 17.12) < 0.02 && Math.abs(p.lng - 78.65) < 0.025);
  });
  test('seed agents are marked as tests', () => {
    assert.ok(TEST_AGENTS.length >= 3 && TEST_AGENTS.length <= 5);
    for (const a of TEST_AGENTS) { assert.ok(a.uid.startsWith('test-')); assert.ok(cleanInterests(a.interests).length >= 3); }
  });
});

describe('daily cap and idle skipping', () => {
  test('cap resets each UTC day', () => {
    let life = {};
    for (let i = 0; i < LIFE.dailyCap; i++) { assert.ok(capAllows(life, NOW)); life = countAction(life, NOW); }
    assert.equal(life.actions, LIFE.dailyCap);
    assert.equal(capAllows(life, NOW), false);
    assert.equal(capAllows(life, NOW + 86_400_000), true);
    assert.equal(countAction(life, NOW + 86_400_000).actions, 1);
    assert.equal(life.day, dayKey(NOW));
  });
  test('shouldAct skips capped, recent, inactive and interest-less agents', () => {
    assert.ok(shouldAct(agent('a', ['tech', 'ai', 'x']), NOW));
    assert.equal(shouldAct(agent('a', []), NOW), false);
    assert.equal(shouldAct(agent('a', ['tech'], { life: { lastActionAt: NOW - 60_000 } }), NOW), false);
    assert.equal(shouldAct(agent('a', ['tech'], { life: { day: dayKey(NOW), actions: LIFE.dailyCap } }), NOW), false);
    assert.equal(shouldAct(agent('a', ['tech'], { updatedAt: NOW - 30 * 86_400_000 }), NOW), false);
    assert.ok(shouldAct(agent('a', ['tech'], { updatedAt: 0, isTest: true }), NOW));
  });
  test('capped agents spend no model calls', async () => {
    let calls = 0;
    const store = fakeStore([agent('a', ['tech'], { life: { day: dayKey(NOW), actions: LIFE.dailyCap } })]);
    const r = await runTick({ store, llm: async () => { calls++; return '{"action":"rest"}'; }, now: NOW });
    assert.equal(calls, 0);
    assert.equal(r.skipped, 1);
  });
});

describe('runTick', () => {
  test('meet writes diary + friend facts for both, sharing only name, interests and bio', async () => {
    const store = fakeStore([agent('a', ['tech', 'science', 'ai']), agent('b', ['tech', 'science', 'music'])]);
    const prompts = [];
    const llm = async (p) => { prompts.push(p); return prompts.length === 1 ? '{"action":"meet"}' : 'A: Hi!\nB: Hello!\nA: You like tech?\nB: Yes, and science.\nA: Cool.'; };
    const r = await runTick({ store, llm, now: NOW });
    assert.equal(r.meets, 1);
    assert.equal(store.diary.a[0].kind, 'meet');
    assert.equal(store.diary.b[0].lines.length, 5);
    assert.deepEqual(store.diary.a[0].shared, ['tech', 'science']);
    assert.equal(store.friends.a.b.name, 'Agent b');
    assert.equal(store.friends.b.a.name, 'Agent a');
    assert.ok(store.lives.a.met.b === NOW && store.lives.b.met.a === NOW);
    assert.equal(store.lives.a.actions, 1);
    const everything = JSON.stringify([prompts, store.diary, store.friends, store.lives]);
    for (const leak of ['REAL_NAME', 'SECRET_MEMORY', '17.123456', '78.654321']) assert.ok(!everything.includes(leak), leak);
  });
  test('move stores target and status; rest spends nothing', async () => {
    const store = fakeStore([agent('a', ['tech', 'science', 'ai'])]);
    await runTick({ store, llm: async () => '{"action":"move","interest":"science","status":"Off to the science museum"}', now: NOW });
    assert.equal(store.lives.a.status, 'Off to the science museum');
    assert.ok(Number.isFinite(store.lives.a.target.lat) && Number.isFinite(store.lives.a.target.lng));
    const s2 = fakeStore([agent('a', ['tech', 'science', 'ai'])]);
    await runTick({ store: s2, llm: async () => 'garbage', now: NOW });
    assert.deepEqual(s2.lives, {});
  });
  test('decision and conversation parsing are defensive', () => {
    const me = { interests: ['tech'] };
    assert.deepEqual(parseDecision('{"action":"meet"}', me, false), { action: 'rest' });
    assert.equal(parseDecision('```json\n{"action":"move","interest":"nope"}\n```', me, false).interest, 'tech');
    assert.equal(parseDecision('{"action":"diary","text":"' + 'x'.repeat(300) + '"}', me, false).text.length, 140);
    assert.equal(parseConversation('A: hi\nB: yo', { name: 'A' }, { name: 'B' }), null);
  });
});

describe('POST /tick auth', () => {
  test('checkTickSecret', () => {
    assert.ok(checkTickSecret(SECRET, SECRET));
    assert.equal(checkTickSecret('wrong', SECRET), false);
    assert.equal(checkTickSecret(undefined, SECRET), false);
    assert.equal(checkTickSecret('short', 'short'), false);
    assert.equal(checkTickSecret('', undefined), false);
  });
  test('endpoint requires x-tick-secret and runs a tick', async () => {
    const store = fakeStore([agent('a', ['tech', 'ai', 'x'])]);
    const server = createServer({ admin: null, memory: null, rateLimiter: { allow: async () => true }, apiKey: 'k', tickSecret: SECRET, lifeStore: store, llm: async () => '{"action":"diary","text":"Nice day"}' });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}/tick`;
    try {
      assert.equal((await fetch(url, { method: 'POST' })).status, 401);
      assert.equal((await fetch(url, { method: 'POST', headers: { 'x-tick-secret': 'b'.repeat(32) } })).status, 401);
      const ok = await fetch(url, { method: 'POST', headers: { 'x-tick-secret': SECRET } });
      assert.equal(ok.status, 200);
      assert.equal((await ok.json()).diary, 1);
      assert.equal(store.diary.a[0].text, 'Nice day');
    } finally { server.close(); }
  });
  test('endpoint is 401 when TICK_SECRET is unset', async () => {
    const server = createServer({ admin: null, memory: null, rateLimiter: { allow: async () => true }, tickSecret: '', lifeStore: fakeStore([]) });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const r = await fetch(`http://127.0.0.1:${server.address().port}/tick`, { method: 'POST', headers: { 'x-tick-secret': '' } });
      assert.equal(r.status, 401);
    } finally { server.close(); }
  });
});
