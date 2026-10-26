// Ambient creatures: deterministic, world-wide, valid looks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambientCreatures, CITIES, AMBIENT_TOTAL } from '../src/ambient.js';
import { CREATURES, ACCESSORIES } from '../src/character-data.js';
test('same crowd on every device, a few hundred to a thousand', () => {
  const a = ambientCreatures(), b = ambientCreatures();
  assert.deepEqual(a, b); assert.ok(a.length >= 300 && a.length <= 1000); assert.ok(a.length <= AMBIENT_TOTAL);
  assert.notDeepEqual(ambientCreatures(1).slice(0, 5), a.slice(0, 5));
  assert.equal(new Set(a.map((x) => x.id)).size, a.length);
});
test('spread across every continent with valid creature looks', () => {
  const a = ambientCreatures();
  for (const x of a) { assert.ok(CREATURES.includes(x.creature)); assert.ok(ACCESSORIES.includes(x.accessory)); assert.ok(Math.abs(x.lat) < 85 && Math.abs(x.lng) <= 180); }
  for (const [lo, hi] of [[-130, -30], [-20, 40], [60, 100], [100, 180]]) assert.ok(a.filter((x) => x.lng > lo && x.lng < hi).length > 30);
  assert.equal(new Set(a.map((x) => x.creature)).size, 6);
  // every city has some, so zooming into any of them finds creatures
  for (const [lng, lat] of CITIES) assert.ok(a.some((x) => Math.abs(x.lng - lng) < 1 && Math.abs(x.lat - lat) < 1), `${lng},${lat}`);
});
import { localCreatures } from '../src/ambient.js';
test('local creatures around your agent: deterministic per cell, 150-500 m away, ids after the world crowd', () => {
  const a = localCreatures(18.00577, 79.5319), b = localCreatures(18.00577, 79.5319);
  assert.deepEqual(a, b); assert.equal(a.length, 6);
  for (const x of a) { const m = Math.hypot((x.lng - 79.5319) * 111320 * Math.cos(18.00577 * Math.PI / 180), (x.lat - 18.00577) * 110540); assert.ok(m > 140 && m < 510, String(m)); }
  assert.ok(a.every((x) => +x.id.slice(4) >= AMBIENT_TOTAL));
});
