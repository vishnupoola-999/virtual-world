// Phone-size close-ups for design/crisp-v43 (not in CI): SHOTS=dir PFX=before- npx playwright test -c playwright.crisp.config.js
import { test } from '@playwright/test';
const SHOTS = process.env.SHOTS || 'test-results', PFX = process.env.PFX || '';
test.use({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3 });
const FEED = { myId: 'h_me', mine: [{ id: '9', kind: 'meet', withId: 'town-coder', withName: 'Arjun', town: true, shared: ['ai'], at: Date.now() - 60000,
  partner: { id: 'town-coder', name: 'Arjun', look: { seed: 3, colorIndex: 2 }, offsetM: { east: 14, north: 0 }, town: true } }],
nearby: [{ id: 'town-chai', name: 'Ravi', look: { seed: 11, colorIndex: 4 }, offsetM: { east: -22, north: 18 } }, { id: 'town-guide', name: 'Kiran', look: { seed: 7, colorIndex: 0 }, offsetM: { east: 24, north: -20 } }], town: [] };
async function boot(page, zoom) {
  await page.route('https://firestore.googleapis.com/**/publicAgents**', (r) => r.fulfill({ json: { documents: [] } }));
  await page.route('https://virtual-world-ai.onrender.com/feed**', (r) => r.fulfill({ json: FEED }));
  await page.goto(`/?onb=0#${zoom}/17.4505/78.3805/0/30`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__map?.loaded() && globalThis.__vw?.town && globalThis.__vw?.tabs, null, { timeout: 45_000 });
  await page.evaluate(async () => { globalThis.__fakeUser = { isAnonymous: false, getIdToken: async () => 'test-token' };
    globalThis.__vw.agent._preview({ name: 'Bs', lat: 17.4505, lon: 78.3805, look: { creature: 'pebble', accessory: 'beanie' } }); globalThis.__vw.tabs.set('world');
    await globalThis.__vw.town.refreshMap(globalThis.__fakeUser); });
}
test('map close-up', async ({ page }) => { await boot(page, 19.6); await page.waitForTimeout(3500);
  await page.screenshot({ path: `${SHOTS}/${PFX}map-closeup.png` });
  await page.screenshot({ path: `${SHOTS}/${PFX}map-crop.png`, clip: { x: 60, y: 260, width: 240, height: 240 } }); });
test('meet close-up', async ({ page }) => { await boot(page, 19.6);
  await page.evaluate(() => globalThis.__vw.living.showOwn({ name: 'Bs', lat: 17.4505, lon: 78.3805, status: { kind: 'meeting', label: 'With Arjun', withAgentId: 'town-coder', withName: 'Arjun' } }));
  await page.waitForTimeout(3000); await page.screenshot({ path: `${SHOTS}/${PFX}meet-closeup.png` }); });
test('profile close-up', async ({ page }) => { await boot(page, 19); await page.waitForTimeout(2000);
  await page.evaluate(() => globalThis.__vw.agents.openProfile(globalThis.__vw.agents.get('me'))); await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SHOTS}/${PFX}profile-closeup.png` }); });
