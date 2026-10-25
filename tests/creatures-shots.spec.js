// Before/after screenshots for design/creatures-v2 (not part of CI: run with SHOTS=dir PFX=before- npx playwright test -c playwright.shots.config.js).
import { test } from '@playwright/test';
const SHOTS = process.env.SHOTS || 'test-results', PFX = process.env.PFX || '';
test.use({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2 });
const ago = (m) => Date.now() - m * 60000;
const FEED = { myId: 'h_me', mine: [{ id: '9', kind: 'meet', withId: 'town-coder', withName: 'Arjun', town: true, shared: ['ai'], at: ago(1),
  partner: { id: 'town-coder', name: 'Arjun', look: { seed: 3, colorIndex: 2 }, offsetM: { east: 18, north: 0 }, town: true } }],
nearby: [{ id: 'town-chai', name: 'Ravi', look: { seed: 11, colorIndex: 4 }, offsetM: { east: -40, north: 30 } }, { id: 'town-guide', name: 'Kiran', look: { seed: 7, colorIndex: 0 }, offsetM: { east: 45, north: -35 } }, { id: 'town-lib', name: 'Meera', look: { seed: 20, colorIndex: 5 }, offsetM: { east: -30, north: -50 } }], town: [] };
const LOOK = process.env.LOOK ? JSON.parse(process.env.LOOK) : { base: 'boy' };
async function boot(page, zoom = 18.3) {
  await page.route('https://firestore.googleapis.com/**/publicAgents**', (r) => r.fulfill({ json: { documents: [] } }));
  await page.route('https://virtual-world-ai.onrender.com/feed**', (r) => r.fulfill({ json: FEED }));
  await page.goto(`/?onb=0#${zoom}/17.4505/78.3805/0/30`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__map?.loaded() && globalThis.__vw?.town && globalThis.__vw?.tabs, null, { timeout: 45_000 });
  await page.evaluate(async (look) => { globalThis.__fakeUser = { isAnonymous: false, getIdToken: async () => 'test-token' };
    globalThis.__vw.agent._preview({ name: 'Bs', lat: 17.4505, lon: 78.3805, look }); globalThis.__vw.tabs.set('world');
    await globalThis.__vw.town.refreshMap(globalThis.__fakeUser); }, LOOK);
}
test('map', async ({ page }) => { await boot(page); await page.waitForTimeout(3500); await page.screenshot({ path: `${SHOTS}/${PFX}map.png` }); });
test('meet', async ({ page }) => { await boot(page, 19);
  await page.evaluate(() => globalThis.__vw.living.showOwn({ name: 'Bs', lat: 17.4505, lon: 78.3805, status: { kind: 'meeting', label: 'With Arjun', withAgentId: 'town-coder', withName: 'Arjun' } }));
  await page.waitForTimeout(3000); await page.screenshot({ path: `${SHOTS}/${PFX}meet.png` }); });
test('picker', async ({ page }) => { await page.goto('/?onb=0', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__vw?.onb, null, { timeout: 45_000 });
  await page.evaluate(() => globalThis.__vw.onb.open(4)); await page.waitForTimeout(2500);
  const b = page.locator('#onbCards button').nth(1); await b.click(); await page.waitForTimeout(400);
  const acc = page.locator('#onbAcc button[data-acc="beanie"]'); if (await acc.count()) await acc.click();
  await page.waitForTimeout(1500); await page.screenshot({ path: `${SHOTS}/${PFX}picker.png` }); });
test('closeup', async ({ page }) => { await boot(page, 19); await page.waitForTimeout(2000);
  await page.evaluate(() => globalThis.__vw.agents.openProfile(globalThis.__vw.agents.get('me'))); await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SHOTS}/${PFX}closeup.png` }); });
