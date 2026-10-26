// Before/after phone shots for fix/ambient-meet-dedupe (not in CI): SHOTS=dir PFX=before- npx playwright test -c playwright.fixa.config.js
import { test } from '@playwright/test';
const SHOTS = process.env.SHOTS || 'test-results', PFX = process.env.PFX || '';
test.use({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3 });
const ago = (m) => Date.now() - m * 60000;
const ME = { lat: 18.00577, lon: 79.5319 };
const FEED = { myId: 'h_me', mine: [
  { id: 'm1', kind: 'meet', withId: 'h_bs', withName: 'Bs', shared: ['tech', 'space'], at: ago(5) },
  { id: 'm2', kind: 'meet', withId: 'h_po', withName: 'Pooja', shared: ['science', 'tech', 'startups'], note: 'I met Pooja, she loves science and tech, and I think you two will get along.', at: ago(30) },
  { id: 'm3', kind: 'meet', withId: 'h_bs', withName: 'Bs', shared: ['tech', 'space'], note: 'I met Bs, and since they are into tech and space, I think you two will get along.', at: ago(90) }],
  outgoing: [], incoming: [], town: [] };
async function boot(page, zoom) {
  await page.route('https://firestore.googleapis.com/**/publicAgents**', (r) => r.fulfill({ json: { documents: [] } }));
  await page.route('https://virtual-world-ai.onrender.com/feed**', (r) => r.fulfill({ json: FEED }));
  await page.goto(`/?onb=0#${zoom}/${ME.lat}/${ME.lon}/0/45`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__map?.loaded() && globalThis.__vw?.town && globalThis.__vw?.tabs, null, { timeout: 45_000 });
  await page.evaluate(async (me) => { globalThis.__fakeUser = { isAnonymous: false, getIdToken: async () => 'test-token' };
    globalThis.__vw.agent._preview({ name: 'Bs', ...me, look: { creature: 'blob', accessory: 'glasses' } }); globalThis.__vw.tabs.set('world'); }, ME);
}
test('meet', async ({ page }) => { await boot(page, 18.6);
  await page.evaluate((me) => globalThis.__vw.living.showOwn({ name: 'Bs', ...me, status: { kind: 'meeting', label: 'With Buddy', withAgentId: 'town-buddy', withName: 'Buddy' } }), ME);
  await page.waitForTimeout(3000); await page.screenshot({ path: `${SHOTS}/${PFX}meet.png` }); });
test('agent chats', async ({ page }) => { await boot(page, 17);
  await page.evaluate(() => globalThis.document.querySelector('#rail [data-open="agentchats"]')?.dispatchEvent(new globalThis.MouseEvent('click')));
  await page.evaluate(() => globalThis.__vw.town.loadActivity(globalThis.__fakeUser)); await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/${PFX}agent-chats.png` }); });
test('ambient near you', async ({ page }) => { await boot(page, 15.6); await page.waitForTimeout(4500);
  await page.screenshot({ path: `${SHOTS}/${PFX}ambient-near-you.png` }); });
