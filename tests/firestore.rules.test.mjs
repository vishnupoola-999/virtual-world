// Firestore security rules for agents/{uid}. Run only through the emulator:
//   npm run test:rules
// which is `firebase emulators:exec --only firestore`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  setLogLevel,
  Timestamp,
} from 'firebase/firestore';

setLogLevel('silent');

const PROJECT_ID = 'demo-virtual-world';
const ALICE = 'alice';
const BOB = 'bob';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST is not set. Run `npm run test:rules` so firebase emulators:exec starts the emulator.');
}

/** @type {import('@firebase/rules-unit-testing').RulesTestEnvironment} */
let testEnv;

function db(uid) {
  const context = uid ? testEnv.authenticatedContext(uid) : testEnv.unauthenticatedContext();
  return context.firestore();
}

function agentRef(uid, owner = uid) {
  return doc(db(owner), 'agents', uid);
}

function agent(overrides = {}) {
  return {
    name: 'Ada',
    look: { color: '#7e57c2', emoji: '🤖' },
    personality: 'friendly study buddy',
    ownerName: 'Vishnu',
    lat: 18.00577,
    lon: 79.5319,
    approx: { lat: 18.01, lon: 79.53 },
    preciseVisibility: 'private',
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

const GIRL_LOOK = { v: 1, base: 'girl', skin: '#d9a07a', hair: 'long', hairColour: '#1b1512', outfit: 'kurta', outfitColour: '#ff7043', bottomColour: '#26324f', acc: ['glasses', 'bindi'] };
const BOY_LOOK = { v: 1, base: 'boy', skin: '#6e4630', hair: 'curly', hairColour: '#3b2618', outfit: 'kurta', outfitColour: '#eef2ff', bottomColour: '#26324f', acc: ['cap'] };

function minimal(overrides = {}) {
  return {
    name: 'A',
    look: { color: '#fff', emoji: '🤖' },
    lat: 0,
    lon: 0,
    preciseVisibility: 'private',
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

async function seed(uid, data) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'agents', uid), data);
  });
}

describe('agents/{uid} rules', { concurrency: false }, () => {
  before(async () => {
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
        host,
        port: Number(port),
      },
    });
  });

  after(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  test('owner can create a full agent document', async () => {
    const snap = await assertSucceeds(setDoc(agentRef(ALICE), agent()));
    assert.equal(snap, undefined);
    const stored = await assertSucceeds(getDoc(agentRef(ALICE)));
    assert.equal(stored.exists(), true);
    assert.equal(stored.get('name'), 'Ada');
    assert.equal(stored.get('preciseVisibility'), 'private');
    assert.equal(stored.get('look.emoji'), '🤖');
    assert.deepEqual(stored.get('approx'), { lat: 18.01, lon: 79.53 });
  });

  test('owner can mark an agent spot as approximate (location fallback)', async () => {
    await assertSucceeds(setDoc(agentRef(ALICE), agent({ spotApprox: true })));
    const stored = await assertSucceeds(getDoc(agentRef(ALICE)));
    assert.equal(stored.get('spotApprox'), true);
  });

  test('owner can create a minimal agent without optional fields', async () => {
    await assertSucceeds(setDoc(agentRef(ALICE), minimal()));
    const stored = await assertSucceeds(getDoc(agentRef(ALICE)));
    assert.equal(stored.get('name'), 'A');
    assert.equal(stored.get('personality'), undefined);
    assert.equal(stored.get('ownerName'), undefined);
    assert.equal(stored.get('approx'), undefined);
  });

  test('owner can read, update, and delete their agent', async () => {
    await seed(ALICE, agent());
    const before = await assertSucceeds(getDoc(agentRef(ALICE)));
    assert.equal(before.get('name'), 'Ada');

    await assertSucceeds(setDoc(agentRef(ALICE), agent({ name: 'Ada Lovelace', lat: -90, lon: 180 })));
    const after = await assertSucceeds(getDoc(agentRef(ALICE)));
    assert.equal(after.get('name'), 'Ada Lovelace');
    assert.equal(after.get('lat'), -90);
    assert.equal(after.get('lon'), 180);

    await assertSucceeds(deleteDoc(agentRef(ALICE)));
    const gone = await assertSucceeds(getDoc(agentRef(ALICE)));
    assert.equal(gone.exists(), false);
  });

  test('accepts boundary lengths and coordinates', async () => {
    await assertSucceeds(setDoc(agentRef(ALICE), agent({
      name: 'n'.repeat(40),
      personality: 'p'.repeat(300),
      ownerName: 'o'.repeat(80),
      look: { color: '#12345678', emoji: 'e'.repeat(16) },
      lat: 90,
      lon: -180,
    })));
  });

  test('owner can save v1 character looks for both bases', async () => {
    await assertSucceeds(setDoc(agentRef(ALICE), agent({ look: GIRL_LOOK })));
    const stored = await assertSucceeds(getDoc(agentRef(ALICE)));
    assert.equal(stored.get('look.base'), 'girl');
    await assertSucceeds(setDoc(agentRef(ALICE), agent({ look: BOY_LOOK })));
    await assertSucceeds(setDoc(agentRef(ALICE), agent({ look: { ...BOY_LOOK, acc: [] } })));
  });

  test('signed-out users cannot read, write, or delete an agent', async () => {
    await seed(ALICE, agent());
    const guest = db(null);
    await assertFails(getDoc(doc(guest, 'agents', ALICE)));
    await assertFails(setDoc(doc(guest, 'agents', ALICE), agent()));
    await assertFails(deleteDoc(doc(guest, 'agents', ALICE)));
  });

  test('another signed-in user cannot read, write, or delete the agent', async () => {
    await seed(ALICE, agent());
    await assertFails(getDoc(agentRef(ALICE, BOB)));
    await assertFails(setDoc(agentRef(ALICE, BOB), agent()));
    await assertFails(deleteDoc(agentRef(ALICE, BOB)));
  });

  test('the owner cannot list every agent', async () => {
    await seed(ALICE, agent());
    await seed(BOB, agent({ name: 'Bob' }));
    await assertFails(getDocs(collection(db(ALICE), 'agents')));
    await assertSucceeds(getDoc(agentRef(ALICE)));
  });

  test('owner writes are rejected when the document is invalid', async () => {
    /** @type {{name: string, data: Record<string, unknown>}[]} */
    const cases = [
      { name: 'empty name', data: agent({ name: '' }) },
      { name: 'name longer than 40', data: agent({ name: 'n'.repeat(41) }) },
      { name: 'missing name', data: omit(agent(), 'name') },
      { name: 'extra field', data: agent({ email: 'ada@example.com' }) },
      { name: 'lat above 90', data: agent({ lat: 90.1 }) },
      { name: 'lat below -90', data: agent({ lat: -90.1 }) },
      { name: 'lon above 180', data: agent({ lon: 180.1 }) },
      { name: 'lon below -180', data: agent({ lon: -180.1 }) },
      { name: 'lat is a string', data: agent({ lat: '18' }) },
      { name: 'preciseVisibility public', data: agent({ preciseVisibility: 'public' }) },
      { name: 'missing preciseVisibility', data: omit(agent(), 'preciseVisibility') },
      { name: 'updatedAt is not request.time', data: agent({ updatedAt: Timestamp.fromMillis(0) }) },
      { name: 'missing updatedAt', data: omit(agent(), 'updatedAt') },
      { name: 'look has an extra key', data: agent({ look: { color: '#7e57c2', emoji: '🤖', hat: true } }) },
      { name: 'color longer than 9', data: agent({ look: { color: '#123456789', emoji: '🤖' } }) },
      { name: 'emoji longer than 16', data: agent({ look: { color: '#fff', emoji: 'e'.repeat(17) } }) },
      { name: 'missing look.color', data: agent({ look: { emoji: '🤖' } }) },
      { name: 'v1 look with unknown base', data: agent({ look: { ...GIRL_LOOK, base: 'cat' } }) },
      { name: 'v1 look with wrong version', data: agent({ look: { ...GIRL_LOOK, v: 2 } }) },
      { name: 'v1 look with bad colour', data: agent({ look: { ...GIRL_LOOK, skin: 'red' } }) },
      { name: 'v1 look with uppercase colour', data: agent({ look: { ...GIRL_LOOK, skin: '#D9A07A' } }) },
      { name: 'boy look with girl-only hair', data: agent({ look: { ...BOY_LOOK, hair: 'long' } }) },
      { name: 'boy look with dress', data: agent({ look: { ...BOY_LOOK, outfit: 'dress' } }) },
      { name: 'boy look with bindi', data: agent({ look: { ...BOY_LOOK, acc: ['bindi'] } }) },
      { name: 'v1 look with unknown accessory', data: agent({ look: { ...GIRL_LOOK, acc: ['crown'] } }) },
      { name: 'v1 look missing acc', data: agent({ look: omit(GIRL_LOOK, 'acc') }) },
      { name: 'v1 look with extra key', data: agent({ look: { ...GIRL_LOOK, hat: true } }) },
      { name: 'look mixing legacy and v1 keys', data: agent({ look: { ...GIRL_LOOK, emoji: '🤖' } }) },
      { name: 'personality longer than 300', data: agent({ personality: 'p'.repeat(301) }) },
      { name: 'personality is not a string', data: agent({ personality: 12 }) },
      { name: 'ownerName longer than 80', data: agent({ ownerName: 'o'.repeat(81) }) },
      { name: 'approx missing lon', data: agent({ approx: { lat: 1 } }) },
      { name: 'approx lat is a string', data: agent({ approx: { lat: '1', lon: 2 } }) },
      { name: 'spotApprox is not a bool', data: agent({ spotApprox: 'yes' }) },
    ];

    const failures = [];
    for (const c of cases) {
      await testEnv.clearFirestore();
      try {
        await assertFails(setDoc(agentRef(ALICE), c.data));
      } catch (err) {
        failures.push(`${c.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    assert.deepEqual(failures, [], `invalid documents were not all denied:\n${failures.join('\n')}`);
  });

  test('an invalid stored agent can still be deleted by its owner', async () => {
    await seed(ALICE, { name: '' });
    await assertSucceeds(deleteDoc(agentRef(ALICE)));
  });

  test('other paths are denied, including agent subcollections', async () => {
    const alice = db(ALICE);
    const guest = db(null);
    await assertFails(getDoc(doc(alice, 'users', ALICE)));
    await assertFails(setDoc(doc(alice, 'users', ALICE), { name: 'Ada' }));
    await assertFails(getDoc(doc(guest, 'users', ALICE)));
    await assertFails(setDoc(doc(guest, 'profiles', ALICE), agent()));
    await assertFails(getDoc(doc(alice, 'agents', ALICE, 'notes', 'secret')));
    await assertFails(getDoc(doc(alice, 'agents', ALICE, 'messages', 'm1', 'x', 'y')));
    await assertFails(setDoc(doc(alice, 'agents', ALICE, 'notes', 'secret'), { text: 'nope' }));
  });
});

describe('agent memory and chat history rules', { concurrency: false }, () => {
  before(async () => {
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host, port: Number(port) },
    });
  });
  after(async () => { await testEnv.cleanup(); });
  beforeEach(async () => { await testEnv.clearFirestore(); });

  const msg = (overrides = {}) => ({ role: 'user', content: 'I study at KU', at: serverTimestamp(), ...overrides });
  const msgRef = (owner, uid = owner, id = 'm1') => doc(db(owner), 'agents', uid, 'messages', id);
  async function seedMemory(uid) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'agents', uid), { ...agent(), updatedAt: Timestamp.now(), memory: { facts: '- studies at KU', updatedAt: Timestamp.now() } });
    });
  }

  test('owner can read the server-written memory, others cannot', async () => {
    await seedMemory(ALICE);
    const snap = await assertSucceeds(getDoc(agentRef(ALICE)));
    assert.equal(snap.data().memory.facts, '- studies at KU');
    await assertFails(getDoc(agentRef(ALICE, BOB)));
    await assertFails(getDoc(doc(db(null), 'agents', ALICE)));
  });

  test('owner cannot create or change memory, but can save the agent with memory untouched', async () => {
    await assertFails(setDoc(agentRef(ALICE), agent({ memory: { facts: 'fake' } })));
    await seedMemory(ALICE);
    await assertFails(setDoc(agentRef(ALICE), agent({ memory: { facts: 'fake' } }), { merge: true }));
    await assertFails(setDoc(agentRef(ALICE), agent()));
    await assertSucceeds(setDoc(agentRef(ALICE), agent({ name: 'Bea' }), { merge: true }));
  });

  test('owner can add, list and delete their messages', async () => {
    await assertSucceeds(setDoc(msgRef(ALICE), msg()));
    await assertSucceeds(setDoc(msgRef(ALICE, ALICE, 'm2'), msg({ role: 'assistant', content: 'Nice!' })));
    const all = await assertSucceeds(getDocs(collection(db(ALICE), 'agents', ALICE, 'messages')));
    assert.equal(all.size, 2);
    await assertSucceeds(deleteDoc(msgRef(ALICE)));
  });

  test('messages are private to the owner', async () => {
    await assertSucceeds(setDoc(msgRef(ALICE), msg()));
    await assertFails(getDoc(msgRef(BOB, ALICE)));
    await assertFails(getDocs(collection(db(BOB), 'agents', ALICE, 'messages')));
    await assertFails(setDoc(msgRef(BOB, ALICE, 'm9'), msg()));
    await assertFails(deleteDoc(msgRef(BOB, ALICE)));
    await assertFails(getDoc(doc(db(null), 'agents', ALICE, 'messages', 'm1')));
  });

  test('invalid or edited messages are rejected', async () => {
    await assertFails(setDoc(msgRef(ALICE), msg({ role: 'system' })));
    await assertFails(setDoc(msgRef(ALICE), msg({ content: '' })));
    await assertFails(setDoc(msgRef(ALICE), msg({ content: 'x'.repeat(2001) })));
    await assertFails(setDoc(msgRef(ALICE), msg({ at: Timestamp.fromMillis(0) })));
    await assertFails(setDoc(msgRef(ALICE), msg({ extra: 1 })));
    await assertSucceeds(setDoc(msgRef(ALICE), msg({ content: 'x'.repeat(2000) })));
    await assertFails(setDoc(msgRef(ALICE), msg({ content: 'edited' })));
  });
});

describe('rate limit counter rules', { concurrency: false }, () => {
  before(async () => {
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host, port: Number(port) },
    });
  });
  after(async () => { await testEnv.cleanup(); });
  beforeEach(async () => { await testEnv.clearFirestore(); });

  const windowRef = (owner, uid = owner) => doc(db(owner), 'rateLimits', uid, 'windows', 'm-1700000000000');

  test('clients cannot read or write rate-limit counters', async () => {
    await assertFails(setDoc(windowRef(ALICE), { count: 1 }));
    await assertFails(getDoc(windowRef(ALICE)));
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'rateLimits', ALICE, 'windows', 'm-1700000000000'), { count: 6 });
    });
    await assertFails(getDoc(windowRef(ALICE)));
    await assertFails(getDocs(collection(db(ALICE), 'rateLimits', ALICE, 'windows')));
    await assertFails(setDoc(windowRef(ALICE), { count: 7 }));
    await assertFails(deleteDoc(windowRef(ALICE)));
    await assertFails(getDoc(windowRef(BOB, ALICE)));
    await assertFails(setDoc(doc(db(null), 'rateLimits', ALICE, 'windows', 'm-1700000000000'), { count: 1 }));
  });

  test('owner can save 3-5 interests and a bio; bad tags are rejected', async () => {
    await seed(ALICE, agent({ updatedAt: Timestamp.now() }));
    const ref = agentRef(ALICE);
    await assertSucceeds(setDoc(ref, { interests: ['tech', 'science', 'cricket'], bio: 'Builds drones', updatedAt: serverTimestamp() }, { merge: true }));
    await assertSucceeds(setDoc(ref, { interests: ['a', 'b', 'c', 'd', 'e'], updatedAt: serverTimestamp() }, { merge: true }));
    await assertFails(setDoc(ref, { interests: ['tech', 'science'], updatedAt: serverTimestamp() }, { merge: true }));
    await assertFails(setDoc(ref, { interests: ['a', 'b', 'c', 'd', 'e', 'f'], updatedAt: serverTimestamp() }, { merge: true }));
    await assertFails(setDoc(ref, { interests: ['tech', 'tech', 'music'], updatedAt: serverTimestamp() }, { merge: true }));
    await assertFails(setDoc(ref, { interests: ['Tech', 'music', 'art'], updatedAt: serverTimestamp() }, { merge: true }));
    await assertFails(setDoc(ref, { bio: 'x'.repeat(121), updatedAt: serverTimestamp() }, { merge: true }));
  });

  test('owner cannot write life-loop fields (life, friends, isTest) or the diary', async () => {
    await assertFails(setDoc(agentRef(ALICE), agent({ life: { actions: 0 } })));
    await assertFails(setDoc(agentRef(ALICE), agent({ isTest: true })));
    await assertFails(setDoc(agentRef(ALICE), agent({ status: { kind: 'idle', label: 'Resting' } })));
    await seed(ALICE, agent({ updatedAt: Timestamp.now(), life: { actions: 12, day: '2026-10-24' }, friends: { bob: { name: 'B' } } }));
    await assertFails(setDoc(agentRef(ALICE), { life: { actions: 0, day: '2026-10-24' }, updatedAt: serverTimestamp() }, { merge: true }));
    await assertFails(setDoc(agentRef(ALICE), { friends: {}, updatedAt: serverTimestamp() }, { merge: true }));
    await assertFails(setDoc(agentRef(ALICE), { status: { kind: 'walking', label: 'fake' }, updatedAt: serverTimestamp() }, { merge: true }));
    await assertSucceeds(setDoc(agentRef(ALICE), { name: 'Ada2', updatedAt: serverTimestamp() }, { merge: true }));
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'agents', ALICE, 'diary', 'd1'), { kind: 'diary', text: 'hi' });
    });
    await assertSucceeds(getDoc(doc(db(ALICE), 'agents', ALICE, 'diary', 'd1')));
    await assertFails(getDoc(doc(db(BOB), 'agents', ALICE, 'diary', 'd1')));
    await assertFails(setDoc(doc(db(ALICE), 'agents', ALICE, 'diary', 'd2'), { kind: 'diary', text: 'fake' }));
    await assertSucceeds(deleteDoc(doc(db(ALICE), 'agents', ALICE, 'diary', 'd1')));
  });
});

function omit(data, key) {
  const copy = { ...data };
  delete copy[key];
  return copy;
}
