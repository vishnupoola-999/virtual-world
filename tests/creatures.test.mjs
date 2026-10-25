// Creatures v2 look data: migration of old looks, deterministic town looks, and the saved shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CREATURES, ACCESSORIES, toLook, townLook, migrateHuman, sanitize, nearestCreature } from '../src/character-data.js';

test('six creatures and six accessory options, in picker order', () => {
  assert.deepEqual(CREATURES, ['blob', 'puff', 'sprout', 'pebble', 'drip', 'mallow']);
  assert.deepEqual(ACCESSORIES, ['none', 'glasses', 'beanie', 'tuft', 'headphones', 'bow']);
});
test('saved shape is exactly {creature, accessory}', () => {
  assert.deepEqual(sanitize({ creature: 'drip', accessory: 'bow', extra: 1 }), { creature: 'drip', accessory: 'bow' });
  assert.deepEqual(sanitize({ creature: 'dragon', accessory: 'crown' }), { creature: 'blob', accessory: 'none' });
  assert.deepEqual(toLook({ creature: 'mallow', accessory: 'glasses' }), { creature: 'mallow', accessory: 'glasses' });
});
test('old v1 human looks migrate to a creature (existing users keep working)', () => {
  const boy = { v: 1, base: 'boy', skin: '#d9a07a', hair: 'short', hairColour: '#1b1512', outfit: 'tee', outfitColour: '#1e88e5', bottomColour: '#26324f', acc: [] };
  const girl = { v: 1, base: 'girl', skin: '#d9a07a', hair: 'long', hairColour: '#1b1512', outfit: 'dress', outfitColour: '#ff7043', bottomColour: '#26324f', acc: ['glasses', 'bindi'] };
  assert.deepEqual(toLook(boy), { creature: 'blob', accessory: 'none' });
  assert.deepEqual(toLook(girl), { creature: 'pebble', accessory: 'glasses' });
  assert.deepEqual(migrateHuman({ ...boy, outfitColour: '#3ddc97', acc: ['cap'] }), { creature: 'sprout', accessory: 'beanie' });
  assert.equal(migrateHuman({ ...boy, outfitColour: '#ffc861' }).creature, 'drip');
  assert.equal(migrateHuman({ ...boy, outfitColour: '#eef2ff' }).creature, 'mallow');
  assert.equal(migrateHuman({ ...girl, outfitColour: '#7e57c2', acc: [] }).creature, 'puff');
  assert.ok(CREATURES.includes(migrateHuman({ ...boy, outfitColour: '#123456' }).creature));
});
test('legacy {color, emoji} looks and missing looks still give a valid creature', () => {
  assert.equal(nearestCreature('#ffc24a'), 'drip');
  assert.deepEqual(toLook({ color: '#45c8d8', emoji: 'x' }), { creature: 'mallow', accessory: 'none' });
  for (const l of [null, undefined, {}, { base: 'boy' }, { color: 'red' }]) assert.ok(CREATURES.includes(toLook(l, 'Vishnu').creature));
  assert.deepEqual(toLook(null, 'Vishnu'), toLook(null, 'Vishnu'));
});
test('town looks are deterministic from seed and colorIndex, and use all creatures', () => {
  assert.deepEqual(townLook({ seed: 3, colorIndex: 2 }), townLook({ seed: 3, colorIndex: 2 }));
  assert.deepEqual(toLook({ seed: 3, colorIndex: 2 }), townLook({ seed: 3, colorIndex: 2 }));
  const seen = new Set(), acc = new Set();
  for (let s = 0; s < 400; s++) { const l = townLook({ seed: s * 7919, colorIndex: s % 8 }); seen.add(l.creature); acc.add(l.accessory); }
  assert.equal(seen.size, 6); assert.equal(acc.size, 6);
  assert.notDeepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((c) => townLook({ seed: 12345, colorIndex: c }).creature).filter((x, i, a) => a.indexOf(x) === i).length, 1);
  assert.ok(CREATURES.includes(townLook({ colorIndex: 4 }).creature)); // seed missing
  assert.ok(CREATURES.includes(townLook({ seed: 4294967295, colorIndex: -3 }).creature));
});
