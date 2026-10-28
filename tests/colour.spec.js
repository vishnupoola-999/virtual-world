// design/body-colour: Colour row under Extra, recoloured picker tiles and map creatures (own and others), look.color saved.
import { test, expect } from '@playwright/test';
const SHOTS = globalThis.process?.env.COLOUR_SHOTS;
test.use({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3 });
const fv = (v) => typeof v === 'number' ? { doubleValue: v } : typeof v === 'string' ? { stringValue: v } : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fv(x)])) } };
const doc = (id, f) => ({ name: `projects/p/databases/default/documents/publicAgents/${id}`, fields: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fv(v)])) });
const shot = async (page, n) => { if (SHOTS) { await page.waitForTimeout(900); await page.screenshot({ path: `${SHOTS}/${n}.png` }); } };
// Mean colour of the centre of a creature canvas.
const tint = (loc) => loc.evaluate((c) => { const k = globalThis.document.createElement('canvas'); k.width = c.width; k.height = c.height; const x = k.getContext('2d'); x.drawImage(c, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data; let r = 0, g = 0, b = 0, n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 220 && d[i] + d[i + 1] + d[i + 2] > 180) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; } return n ? [r / n, g / n, b / n] : null; });

test('colour row: Default + 8 presets + More + picker under Extra; selection ring; look.color in value', async ({ page }) => {
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));
  await page.goto('/?onb=0', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__vw?.agent, null, { timeout: 45_000 });
  await page.evaluate(() => { const d = globalThis.document; globalThis.__vw.openSheet('agent'); d.getElementById('agForm').hidden = false; const st = d.createElement('style'); st.textContent = '#agentBox,#agForm{display:block!important}'; d.head.appendChild(st); d.getElementById('agView') && (d.getElementById('agView').hidden = true); });
  await page.locator('#lkBase button[data-creature="blob"]').click();
  await page.locator('#lkAcc button[data-acc="beanie"]').click();
  const row = page.locator('#lkCol'); await expect(row.locator('.swc')).toHaveCount(10); await expect(row.locator('input[type=color]')).toHaveCount(1);
  const extraBox = await page.locator('#lkAcc').boundingBox(), colBox = await row.boundingBox(); expect(colBox.y).toBeGreaterThan(extraBox.y + extraBox.height - 1);
  await expect(row.locator('.swc.def')).toHaveAttribute('aria-checked', 'true');
  // Diggy: one row, never wraps; 44px tap targets; scrolls sideways inside the sheet.
  const geo = await row.evaluate((r) => ({ tops: [...new Set([...r.children].map((c) => Math.round(c.getBoundingClientRect().top)))].length, w: r.clientWidth, sw: r.scrollWidth, sz: [...r.children].map((c) => Math.round(c.getBoundingClientRect().width)), ox: globalThis.getComputedStyle(r).overflowX }));
  expect(geo.tops).toBe(1); expect(geo.sw).toBeGreaterThan(geo.w); expect(geo.ox).toBe('auto'); for (const z of geo.sz) expect(z).toBe(44);
  await row.locator('.swc[data-col="#ff8fab"]').click();
  await expect(row.locator('.swc[data-col="#ff8fab"]')).toHaveClass(/on/); await expect(row.locator('.swc.def')).toHaveAttribute('aria-checked', 'false');
  await page.waitForFunction(() => [...globalThis.document.querySelectorAll('#lkBase img')].every((i) => i.src.startsWith('data:')), null, { timeout: 15_000 });
  await page.locator('#lkCol').scrollIntoViewIfNeeded(); await shot(page, '1-sheet-colour-row');
  await row.locator('input[type=color]').evaluate((i) => { i.value = '#00c2a8'; i.dispatchEvent(new globalThis.Event('input', { bubbles: true })); });
  await expect(row.locator('.swc.cust')).toHaveClass(/on/);
  await page.locator('#lkBase').scrollIntoViewIfNeeded(); await shot(page, '2-recoloured-tiles-custom');
  await row.locator('.swc.def').click(); await expect(row.locator('.swc.def')).toHaveClass(/on/);
});

test('own and other agents render their body colour on the map; null colour falls back', async ({ page }) => {
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));
  const agents = { documents: [doc('h_me', { name: 'Bs', lat: 17.45, lon: 78.38 }),
    doc('h_v', { name: 'Vishnu', lat: 17.4508, lon: 78.3809, look: { creature: 'mallow', accessory: 'none', color: '#ff6b6b' } }),
    doc('h_m', { name: 'Mira', lat: 17.4502, lon: 78.3812, look: { creature: 'mallow', accessory: 'none' } })] };
  await page.route('https://firestore.googleapis.com/**/publicAgents**', (r) => r.fulfill({ json: agents }));
  await page.route('https://virtual-world-ai.onrender.com/**', (r) => r.fulfill({ json: { myId: 'h_me', mine: [], threads: [] } }));
  await page.goto('/?onb=0#18.6/17.4506/78.381/0/50', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__map?.loaded() && globalThis.__vw?.town, null, { timeout: 45_000 });
  await page.evaluate(() => { globalThis.__fakeUser = { isAnonymous: false, getIdToken: async () => 'test-token' };
    globalThis.__vw.agent._preview({ name: 'Bs', lat: 17.4505, lon: 78.3805, look: { creature: 'blob', accessory: 'beanie', color: '#f472b6' } }); globalThis.__vw.tabs.set('world'); });
  await page.evaluate(() => globalThis.__vw.town.refreshMap(globalThis.__fakeUser));
  await expect(page.locator('.ag.other')).toHaveCount(2);
  await page.waitForTimeout(2500);
  const red = await tint(page.locator('.ag[aria-label^="Vishnu"] canvas')), teal = await tint(page.locator('.ag[aria-label^="Mira"] canvas'));
  expect(red[0]).toBeGreaterThan(red[2] + 40); // #ff6b6b body
  expect(teal[2]).toBeGreaterThan(teal[0]);    // default mallow teal
  await shot(page, '3-map-colours');
  const v = await page.evaluate(async () => { const d = await import('./src/character-data.js'); return [d.sanitize({ creature: 'puff', accessory: 'bow', color: '#ABCDEF' }), d.sanitize({ creature: 'puff', accessory: 'bow', color: 'red' }), d.toLook({ creature: 'puff', accessory: 'none', color: null })]; });
  expect(v).toEqual([{ creature: 'puff', accessory: 'bow', color: '#abcdef' }, { creature: 'puff', accessory: 'bow' }, { creature: 'puff', accessory: 'none' }]);
});
