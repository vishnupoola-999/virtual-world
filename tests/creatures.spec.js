// Creatures v2: picker (six, no labels, no default, optional accessory), saved look shape, triangle budget, town creatures.
import { test, expect } from '@playwright/test';
test.use({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2 });

test('picker: six creatures side by side with no labels or default, then an optional accessory row', async ({ page }) => {
  await page.goto('/?onb=0', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__vw?.onb, null, { timeout: 45_000 });
  await page.evaluate(() => globalThis.__vw.onb.open(4));
  const cards = page.locator('#onbCards button');
  await expect(cards).toHaveCount(6);
  expect(await cards.evaluateAll((b) => b.map((x) => x.dataset.creature))).toEqual(['blob', 'puff', 'sprout', 'pebble', 'drip', 'mallow']);
  expect(await cards.evaluateAll((b) => b.map((x) => x.textContent.trim()).join(''))).toBe('');
  expect(await cards.evaluateAll((b) => b.filter((x) => x.getAttribute('aria-checked') === 'true').length)).toBe(0);
  // one row: all six share a top edge and fit inside 360 px
  const boxes = await cards.evaluateAll((b) => b.map((x) => x.getBoundingClientRect().toJSON()));
  expect(new Set(boxes.map((r) => Math.round(r.top))).size).toBe(1);
  for (const r of boxes) { expect(r.left).toBeGreaterThanOrEqual(0); expect(r.right).toBeLessThanOrEqual(360); expect(r.width).toBeGreaterThanOrEqual(44); }
  await expect(page.locator('#onbAcc')).toBeHidden();
  await expect(page.locator('#onbCreate')).toBeDisabled();
  await cards.nth(4).click();
  await expect(cards.nth(4)).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#onbAcc button')).toHaveCount(6);
  await expect(page.locator('#onbAcc button.on')).toHaveAttribute('data-acc', 'none');
  await page.locator('#onbAcc button[data-acc="headphones"]').click();
  await expect(page.locator('#onbAcc button[data-acc="headphones"]')).toHaveAttribute('aria-checked', 'true');
  await page.fill('#onbName', 'Chinni');
  await expect(page.locator('#onbCreate')).toBeEnabled();
});

test('agent sheet editor saves look as {creature, accessory} and opens old human looks migrated', async ({ page }) => {
  await page.goto('/?onb=0', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__vw?.agent, null, { timeout: 45_000 });
  const m = await page.evaluate(async () => { const d = await import('./src/character-data.js');
    return [d.toLook({ v: 1, base: 'girl', outfitColour: '#e25d9b', acc: ['cap'] }), d.toLook({ creature: 'sprout', accessory: 'tuft' })]; });
  expect(m).toEqual([{ creature: 'puff', accessory: 'beanie' }, { creature: 'sprout', accessory: 'tuft' }]);
  await expect(page.locator('#lkBase button')).toHaveCount(6);
});

test('triangle budget: every creature with every accessory is under 4k triangles', async ({ page }) => {
  await page.goto('/?onb=0', { waitUntil: 'domcontentloaded' });
  const tris = await page.evaluate(async () => { const c = await import('./src/character.js'); const out = {};
    for (const cr of c.CREATURES) for (const a of c.ACCESSORIES) { const ch = c.createCharacter({ creature: cr, accessory: a }); out[`${cr}+${a}`] = ch.triangles(); }
    return { out, budget: c.TRI_BUDGET }; });
  console.log('tris', JSON.stringify(tris.out));
  for (const [k, n] of Object.entries(tris.out)) { expect(n, k).toBeLessThan(tris.budget); expect(n, k).toBeGreaterThan(500); }
});

test('town characters get deterministic creatures from seed and colorIndex', async ({ page }) => {
  const feed = { myId: 'h_me', mine: [], town: [], nearby: [{ id: 'town-chai', name: 'Ravi', look: { seed: 11, colorIndex: 4 }, offsetM: { east: -40, north: 30 } }] };
  await page.route('https://firestore.googleapis.com/**/publicAgents**', (r) => r.fulfill({ json: { documents: [] } }));
  await page.route('https://virtual-world-ai.onrender.com/feed**', (r) => r.fulfill({ json: feed }));
  await page.goto('/?onb=0#17/17.4505/78.3805/0/0', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__map?.loaded() && globalThis.__vw?.town, null, { timeout: 45_000 });
  const got = await page.evaluate(async () => { globalThis.__fakeUser = { isAnonymous: false, getIdToken: async () => 'test-token' };
    globalThis.__vw.agent._preview({ name: 'Bs', lat: 17.4505, lon: 78.3805, look: { creature: 'blob', accessory: 'none' } }); globalThis.__vw.tabs.set('world');
    await globalThis.__vw.town.refreshMap(globalThis.__fakeUser); const d = await import('./src/character-data.js');
    return { look: globalThis.__vw.agents.get('nb-town-chai')?.look, want: d.townLook({ seed: 11, colorIndex: 4 }), me: globalThis.__vw.agents.get('me').look }; });
  expect(got.look).toEqual(got.want);
  expect(got.me).toEqual({ creature: 'blob', accessory: 'none' });
  await expect(page.locator('.ag.nearby .pill')).toBeHidden();
});
