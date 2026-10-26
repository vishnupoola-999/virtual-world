// Crisp rendering + friendly save errors (design/crisp-v43).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextPixelRatio, startPixelRatio } from '../src/pixel-ratio.js';
import { saveErrorText } from '../src/save-errors.js';

test('pixel ratio starts at device pixels (capped) and only drops below 30 fps', () => {
  assert.equal(startPixelRatio(3), 2); assert.equal(startPixelRatio(3, 3), 3); assert.equal(startPixelRatio(2.75), 2); assert.equal(startPixelRatio(0.5), 1);
  assert.equal(nextPixelRatio(2, 16.7), null); assert.equal(nextPixelRatio(2, 30), null); assert.equal(nextPixelRatio(2, 33), null);
  assert.equal(nextPixelRatio(2, 40), 1.5); assert.equal(nextPixelRatio(1.5, 40), 1); assert.equal(nextPixelRatio(1, 80), null);
  assert.equal(nextPixelRatio(3, 40), 2); assert.equal(nextPixelRatio(1.5, 40, 1.5), null);
});
test('save errors are friendly and never show raw Firestore codes', () => {
  for (const e of [{ code: 'permission-denied' }, { message: 'Missing or insufficient permissions.' }, { code: 'unavailable' }, { code: 'auth/requests-from-referer' }, {}, null]) {
    const t = saveErrorText(e, 'your look');
    assert.doesNotMatch(t, /permission-denied|insufficient|unavailable|auth\/|Error/);
    assert.ok(t.length > 10 && t.length < 120);
  }
  assert.match(saveErrorText({ code: 'permission-denied' }, 'your look'), /Couldn't save your look right now/);
  assert.match(saveErrorText({ code: 'unavailable' }, 'your look'), /offline/);
});
