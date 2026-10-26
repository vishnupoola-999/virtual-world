// Town characters + motion polish (design/town-chars-polish). /feed and publicAgents are mocked, as in feed.spec.js.
import { test, expect } from '@playwright/test';
const SHOTS = process.env.POLISH_SHOTS, PFX = process.env.POLISH_PREFIX || '';
const shot = (page, n) => SHOTS ? page.screenshot({ path: `${SHOTS}/${PFX}${n}.png` }) : null;
test.use({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2 });
const ago = (m) => Date.now() - m * 60000;
const FEED = { myId: 'h_me', mine: [
  { id: '1', kind: 'meet', withId: 'h_a', withName: 'Mira', shared: ['music', 'chess'], lines: [{ speaker: 'Mira', text: 'Every evening.' }], at: ago(12) },
  { id: '3', kind: 'meet', withId: 'town-coder', withName: 'Coder Arjun (town)', town: true, shared: ['tech'], at: ago(40) },
  { id: '2', kind: 'diary', text: 'Walked to the park and watched the sunset.', at: ago(90) },
], town: [{ id: 't1', aName: 'Ravi', bName: 'Librarian Meera (town)', shared: ['books', 'science'], at: ago(30) }, { id: 't2', aName: 'Kiran', bName: 'Mira', shared: [], at: ago(200) }] };
const MEET = { name: 'Bs', lat: 17.4505, lon: 78.3805, status: { kind: 'meeting', label: 'With Coder Arjun (town)', withAgentId: 'town-coder', withName: 'Coder Arjun (town)' } };

async function boot(page) {
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));
  await page.route('https://firestore.googleapis.com/**/publicAgents**', (r) => r.fulfill({ json: { documents: [] } }));
  await page.route('https://virtual-world-ai.onrender.com/feed**', (r) => r.fulfill({ json: FEED }));
  await page.goto('/?onb=0#18.5/17.4505/78.3805/0/30', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__map?.loaded() && globalThis.__vw?.town && globalThis.__vw?.tabs, null, { timeout: 45_000 });
  await page.evaluate(() => { globalThis.__fakeUser = { isAnonymous: false, getIdToken: async () => 'test-token' };
    globalThis.__vw.agent._preview({ name: 'Bs', lat: 17.4505, lon: 78.3805, look: { base: 'boy' } }); globalThis.__vw.tabs.set('world'); });
}
const openSec = (page, sec) => page.evaluate((s) => globalThis.document.querySelector(`#rail [data-open="${s}"]`).dispatchEvent(new globalThis.MouseEvent('click')), sec);

test('town agent meet: a character appears beside yours, no "(town)" text, leaves after', async ({ page }) => {
  await boot(page);
  await page.evaluate((m) => globalThis.__vw.living.showOwn(m), MEET);
  await page.waitForTimeout(2500);
  await shot(page, 'town-meet');
  await expect(page.locator('.ag.town')).toHaveCount(1);
  // it stands beside yours on screen (not stuck at the map corner)
  const [m, t] = await page.evaluate(() => ['me', 'town-coder'].map((i) => globalThis.__vw.agents.get(i).el.getBoundingClientRect().toJSON()));
  expect(Math.abs(t.y - m.y)).toBeLessThan(60); expect(Math.abs(t.x - m.x)).toBeGreaterThan(20); expect(Math.abs(t.x - m.x)).toBeLessThan(160);
  await expect(page.locator('.ag.town .pill')).toBeHidden();
  await expect(page.locator('#liveHint')).toContainText('Chatting with Arjun');
  expect(await page.evaluate(() => globalThis.document.body.innerText)).not.toContain('(town)');
  // the two characters face each other
  // ~30 degrees toward each other, eased (yawNow follows the target), and no connecting line on the map
  const yaw = await page.evaluate(() => ['me', 'town-coder'].map((i) => { const a = globalThis.__vw.agents.get(i); return [a.yaw, a.yawNow]; }));
  expect(Math.abs(yaw[0][0])).toBeCloseTo(Math.PI / 6, 3); expect(yaw[1][0]).toBeCloseTo(-yaw[0][0], 5);
  for (const [t, now] of yaw) if (typeof now === 'number') expect(now).toBeCloseTo(t, 1);
  expect(await page.evaluate(() => !!globalThis.__map.getLayer('lv-link') || !!globalThis.__map.getSource('lv-link'))).toBe(false);
  // card says it, so the pill above your head does not repeat it; dots only, no text in the bubble
  await expect(page.locator('.ag.mine .stat')).toBeHidden();
  await page.evaluate(() => globalThis.__vw.living.showOwn({ name: 'Bs', lat: 17.4505, lon: 78.3805, status: { kind: 'idle', label: 'Resting' } }));
  await expect(page.locator('.ag.town')).toHaveCount(0, { timeout: 3000 });
  // yours turns back to its default pose
  expect(await page.evaluate(() => globalThis.__vw.agents.get('me').yaw)).toBeUndefined();
});

test('status card cross-fades and pills stay 16px inside the edges', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => globalThis.__vw.living.showOwn({ name: 'Bs', lat: 17.4505, lon: 78.3805, status: { kind: 'walking', label: 'Heading to coding spot', destination: { name: 'coding spot', lngLat: [78.383, 17.452] } } }));
  await page.waitForTimeout(1500);
  await shot(page, 'status-card');
  await expect(page.locator('#liveHint')).toContainText('Heading to coding spot');
  for (const r of await page.locator('.ag .stat:visible, .ag .bubble:visible').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
    expect(r.left).toBeGreaterThanOrEqual(15.5); expect(r.right).toBeLessThanOrEqual(360 - 15.5);
  }
});

test('feed and agent chats: no "(town)", aligned rows, staggered', async ({ page }) => {
  await boot(page);
  await openSec(page, 'feed');
  await page.evaluate(() => globalThis.__vw.town.loadFeed(globalThis.__fakeUser));
  await expect(page.locator('#feedList')).toContainText('Met', { timeout: 10_000 });
  await page.waitForTimeout(600);
  await shot(page, 'feed');
  await expect(page.locator('#feedList')).not.toContainText('(town)');
  await expect(page.locator('#feedList')).not.toContainText('Ravi');
  await expect(page.locator('#feedList')).not.toContainText('Around town');
  const h = await page.locator('#feedList .fd .fdHead').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  expect(new Set(h.map(Math.round)).size).toBe(1);
  await openSec(page, 'agentchats');
  await page.evaluate(() => globalThis.__vw.town.loadActivity(globalThis.__fakeUser));
  await expect(page.locator('#agentChats')).toContainText('Log', { timeout: 10_000 });
  await page.waitForTimeout(600);
  await shot(page, 'agent-chats');
  await expect(page.locator('#agentChats')).not.toContainText('(town)');
  await expect(page.locator('#agentChats')).toContainText('Met Arjun');
});

test('PR #45 fields (optional): partner offset and colour place the meet partner; nearby[] town characters drawn without pills', async ({ page }) => {
  const feed = { ...FEED, mine: [{ id: '9', kind: 'meet', withId: 'town-coder', withName: 'Arjun', town: true, shared: ['ai'], at: ago(1),
    partner: { id: 'town-coder', name: 'Arjun', look: { seed: 3, colorIndex: 2 }, offsetM: { east: 25, north: 0 }, town: true } }],
    nearby: [{ id: 'town-chai', name: 'Ravi', look: { seed: 1, colorIndex: 4 }, offsetM: { east: -120, north: 90 } }, { id: 'town-guide', name: 'Kiran', look: { colorIndex: 0 }, offsetM: { east: 150, north: -60 } }] };
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));
  await page.route('https://firestore.googleapis.com/**/publicAgents**', (r) => r.fulfill({ json: { documents: [] } }));
  await page.route('https://virtual-world-ai.onrender.com/feed**', (r) => r.fulfill({ json: feed }));
  await page.goto('/?onb=0#17/17.4505/78.3805/0/0', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__map?.loaded() && globalThis.__vw?.town, null, { timeout: 45_000 });
  await page.evaluate(async () => { globalThis.__fakeUser = { isAnonymous: false, getIdToken: async () => 'test-token' };
    globalThis.__vw.agent._preview({ name: 'Bs', lat: 17.4505, lon: 78.3805, look: { base: 'boy' } }); globalThis.__vw.tabs.set('world');
    await globalThis.__vw.town.refreshMap(globalThis.__fakeUser); });
  await expect(page.locator('.ag.nearby')).toHaveCount(2);
  await expect(page.locator('.ag.nearby .pill')).toHaveCount(2); await expect(page.locator('.ag.nearby .pill').first()).toBeHidden();
  await page.evaluate((m) => globalThis.__vw.living.showOwn({ ...m, status: { ...m.status, withName: 'Arjun', label: 'With Arjun' } }), MEET);
  await page.waitForTimeout(2200);
  const g = await page.evaluate(() => { const a = globalThis.__vw.agents.get('town-coder'); return { lon: a.lon, lat: a.lat, look: a.look }; });
  expect(g.lat).toBeCloseTo(17.4505, 5); expect(g.lon).toBeCloseTo(78.3805, 5); // fix/ambient-meet-dedupe: partner sits beside you in screen space (MEET_DX), not by /feed metres
  const want = await page.evaluate(async () => (await import('./src/character-data.js')).townLook({ seed: 3, colorIndex: 2 })); expect(g.look).toEqual(want);
  await expect(page.locator('#liveHint')).toContainText('Chatting with Arjun');
});

test('without PR #45 fields nothing extra is drawn', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => globalThis.__vw.town.refreshMap(globalThis.__fakeUser));
  await expect(page.locator('.ag.nearby')).toHaveCount(0);
});
