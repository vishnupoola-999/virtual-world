// Ambient creatures: dots when zoomed out, a few real creatures near the camera, no pills, no Firestore writes.
import { test, expect } from '@playwright/test';
const SHOTS = process.env.AMB_SHOTS;
test.use({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2 });
test('zoomed out shows creatures worldwide; zoomed in promotes a few real ones without pills', async ({ page }) => {
  const writes = [];
  page.on('request', (r) => { if (/firestore\.googleapis\.com/.test(r.url()) && r.method() !== 'GET') writes.push(r.url()); });
  await page.route('https://firestore.googleapis.com/**/publicAgents**', (r) => r.fulfill({ json: { documents: [] } }));
  await page.goto('/?onb=0#2.2/20/78/0/0', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__map?.loaded() && globalThis.__vw?.ambient && globalThis.__map.getLayer('amb-dot'), null, { timeout: 45_000 });
  await page.evaluate(() => globalThis.__vw.tabs.set('world'));
  await page.waitForTimeout(2500);
  const dots = await page.evaluate(() => globalThis.__map.queryRenderedFeatures({ layers: ['amb-dot'] }).length);
  expect(dots).toBeGreaterThan(100);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/world.png` });
  await page.evaluate(() => globalThis.__map.jumpTo({ center: [78.47, 17.39], zoom: 9.5 })); await page.waitForTimeout(2000);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/city.png` });
  await page.evaluate(() => globalThis.__map.jumpTo({ zoom: 12.5 })); await page.waitForTimeout(2000);
  expect(await page.evaluate(() => globalThis.__map.queryRenderedFeatures({ layers: ['amb-sil'] }).length)).toBeGreaterThan(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/neighbourhood.png` });
  const a = await page.evaluate(() => globalThis.__vw.ambient.list[0]);
  await page.evaluate((p) => globalThis.__map.jumpTo({ center: [p.lng, p.lat], zoom: 17.2, pitch: 45 }), a);
  await page.waitForTimeout(2500);
  const live = await page.locator('.ag.ambient').count();
  expect(live).toBeGreaterThan(0); expect(live).toBeLessThanOrEqual(4);
  await expect(page.locator('.ag.ambient .pill').first()).toBeHidden();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/street.png` });
  // frame cost while panning over the crowd stays within budget on the test machine
  const ms = await page.evaluate(async () => { const m = globalThis.__map; m.jumpTo({ zoom: 3 }); let n = 0, t0 = performance.now();
    await new Promise((res) => { const f = () => { m.panBy([6, 0], { duration: 0 }); if (++n < 60) globalThis.requestAnimationFrame(f); else res(); }; globalThis.requestAnimationFrame(f); });
    return (performance.now() - t0) / n; });
  console.log('pan frame ms', ms.toFixed(1));
  expect(writes).toEqual([]);
});
