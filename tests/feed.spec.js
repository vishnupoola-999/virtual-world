// Living map + Feed: Firestore REST (publicAgents) and the proxy's /feed are mocked; a fake signed-in user is injected.
import { test, expect } from '@playwright/test';
const SHOTS = process.env.FEED_SHOTS;
test.use({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2 });
const ago = (m) => Date.now() - m * 60000;
const fv = (v) => typeof v === 'number' ? { doubleValue: v } : typeof v === 'string' ? { stringValue: v } : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fv(x)])) } };
const doc = (id, f) => ({ name: `projects/p/databases/default/documents/publicAgents/${id}`, fields: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fv(v)])) });
const AGENTS = { documents: [
  doc('h_me', { name: 'Bs', lat: 17.45, lon: 78.38 }),
  doc('h_a', { name: 'Mira', lat: 17.45065, lon: 78.38068, status: { kind: 'walking', label: 'Heading to the lake for an evening walk with friends' } }),
  doc('h_b', { name: 'Ravi', lat: 17.45035, lon: 78.38035, status: { kind: 'meeting', label: 'Talking chess' } }),
  doc('h_c', { name: 'Tara', lat: 17.45035, lon: 78.38035 }),
  doc('h_d', { name: 'Kiran', lat: 17.45035, lon: 78.38035, status: 'Reading', updatedAt: '2026-10-25T10:40:00Z' }),
] };
const FEED = { myId: 'h_me', mine: [
  { id: '1', kind: 'meet', withName: 'Mira', shared: ['music', 'chess'], lines: [{ speaker: 'Bs', text: 'You like chess too?' }, { speaker: 'Mira', text: 'Every evening.' }], at: ago(12) },
  { id: '2', kind: 'diary', text: 'Walked to the park and watched the sunset.', at: ago(90) },
], town: [{ id: 't1', aName: 'Ravi', bName: 'Tara', shared: ['cricket'], at: ago(30) }, { id: 't2', aName: 'Kiran', bName: 'Mira', shared: [], at: ago(200) }] };

async function boot(page, { feed = FEED, feedDelay = 0, agents = AGENTS, feedStatus = 200 } = {}) {
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));
  await page.route('https://firestore.googleapis.com/**/publicAgents**', (r) => r.fulfill({ json: agents }));
  await page.route('https://virtual-world-ai.onrender.com/feed**', async (r) => {
    if (r.request().headers().authorization !== 'Bearer test-token') return r.fulfill({ status: 401, json: {} });
    if (feedDelay) await new Promise((res) => setTimeout(res, feedDelay));
    return r.fulfill({ status: feedStatus, json: feed });
  });
  await page.goto('/?onb=0#18/17.4505/78.3805/0/50', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__map?.loaded() && globalThis.__vw?.town && globalThis.__vw?.tabs, null, { timeout: 45_000 });
  await page.evaluate(() => { globalThis.__fakeUser = { isAnonymous: false, getIdToken: async () => 'test-token' };
    globalThis.__vw.agent._preview({ name: 'Bs', lat: 17.4505, lon: 78.3805, look: { base: 'boy' } }); globalThis.__vw.tabs.set('world'); });
}

test('others drawn at 85% as characters only, own card skipped, fanned out', async ({ page }) => {
  await boot(page);
  const n = await page.evaluate(() => globalThis.__vw.town.refreshMap(globalThis.__fakeUser));
  expect(n).toBe(4);
  await expect(page.locator('.ag.other')).toHaveCount(4);
  await expect(page.locator('.ag[aria-label="Bs\'s agent"]:not(.mine)')).toHaveCount(0);
  // Vishnu: other people's agents are just the character, no name or status pill. Your own agent keeps its pill.
  await expect(page.locator('.ag.other .pill:visible, .ag.other .stat:visible')).toHaveCount(0);
  await expect(page.locator('.ag.mine .pill')).toBeVisible();
  const xs = await page.evaluate(() => ['h_b', 'h_c', 'h_d'].map((id) => globalThis.__vw.agents.get(id).marker.getOffset().x));
  expect(new Set(xs).size).toBeGreaterThan(1);
  await page.waitForFunction(() => globalThis.__avatarReady, null, { timeout: 45_000 }).catch(() => {});
  await page.waitForTimeout(800);
  if (SHOTS) { await page.evaluate(() => globalThis.__map.jumpTo({ center: [78.3805, 17.4505], zoom: 18.3, pitch: 20 })); await page.waitForTimeout(2500); await page.evaluate(() => globalThis.__vw.town.keepClear()); await page.waitForTimeout(200); await page.screenshot({ path: `${SHOTS}/map-others-v2.png` }); }
  if (SHOTS) { await page.evaluate(() => globalThis.__map.jumpTo({ center: [78.38035, 17.45038], zoom: 19.5, pitch: 0 })); await page.waitForTimeout(800); await page.evaluate(() => globalThis.__vw.town.keepClear()); await page.waitForTimeout(200); await page.screenshot({ path: `${SHOTS}/fan-out-v2.png` }); }
});

// Other people's characters on screen stay 16px inside the edges and clear of the rail.
async function charReport(page) {
  return page.evaluate(() => {
    const d = globalThis.document, W = globalThis.innerWidth, H = globalThis.innerHeight, rl = d.getElementById('rail').getBoundingClientRect();
    const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const vis = [...d.querySelectorAll('.maplibregl-marker.ag.other canvas')].map((c) => c.getBoundingClientRect())
      .filter((r) => r.width && r.bottom > 0 && r.top < H && r.right > 0 && r.left < W).map((r) => ({ x: r.left, y: r.top, w: r.width, h: r.height }));
    return { n: vis.length, edge: vis.filter((b) => b.x < 15.5 || b.x + b.w > W - 15.5).length, underRail: vis.filter((b) => hit(b, { x: rl.left, y: rl.top, w: rl.width, h: rl.height })).length };
  });
}

test('characters stay 16px inside the edges and clear of the rail', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => globalThis.__vw.town.refreshMap(globalThis.__fakeUser));
  // Put Mira's spot under the rail, then at the left edge.
  for (const at of ['rail', 'left']) {
    await page.evaluate((w) => { const m = globalThis.__map, rl = globalThis.document.getElementById('rail').getBoundingClientRect();
      m.jumpTo({ center: [78.38068, 17.45065], zoom: 18.3, pitch: 0, bearing: 0 });
      const p = m.project([78.38068, 17.45065]), t = w === 'rail' ? [rl.left + 20, rl.top + 140] : [4, 500];
      m.panBy([p.x - t[0], p.y - t[1]], { duration: 0 }); }, at);
    await page.waitForTimeout(700);
    await page.evaluate(() => globalThis.__vw.town.keepClear());
    const r = await charReport(page);
    expect(r.n).toBeGreaterThan(0);
    expect(r.edge).toBe(0); expect(r.underRail).toBe(0);
  }
});

test('40px fan-out, tapping a group zooms in and spreads it', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => globalThis.__vw.town.refreshMap(globalThis.__fakeUser));
  const x0 = await page.evaluate(() => globalThis.__vw.agents.get('h_c').marker.getOffset().x);
  expect(Math.abs(x0)).toBe(35);
  const z0 = await page.evaluate(() => globalThis.__map.getZoom());
  await page.evaluate(() => globalThis.__vw.agents.get('h_d').el.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true })));
  await expect(page.locator('#profile[aria-hidden="false"]')).toHaveCount(0);
  const x1 = await page.evaluate(() => globalThis.__vw.agents.get('h_c').marker.getOffset().x);
  expect(Math.abs(x1)).toBeGreaterThan(40);
  await page.waitForTimeout(900);
  expect(await page.evaluate(() => globalThis.__map.getZoom())).toBeGreaterThan(z0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/fan-out-spread-v2.png` });
});

test('anonymous users get no others and a calm feed message', async ({ page }) => {
  await boot(page);
  const n = await page.evaluate(() => globalThis.__vw.town.refreshMap({ isAnonymous: true, getIdToken: async () => 't' }));
  expect(n).toBe(0);
  await expect(page.locator('.ag.other')).toHaveCount(0);
  await page.evaluate(() => { globalThis.document.getElementById('railFeed').click(); });
  await expect(page.locator('#feedList')).toContainText('Sign in');
});

test('feed: skeleton, sections, expandable meets', async ({ page }) => {
  await boot(page, { feedDelay: 1500 });
  await page.evaluate(() => globalThis.document.querySelector('#rail [data-open="feed"]').dispatchEvent(new globalThis.MouseEvent('click')));
  // the rail click loads for the real (absent) user; load again with the fake signed-in user (not awaited, so the skeleton shows)
  await page.evaluate(() => { globalThis.__vw.town.loadFeed(globalThis.__fakeUser); });
  await expect(page.locator('.fdSk').first()).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/feed-skeleton.png` });
  await expect(page.locator('#feedList')).toContainText('Around town', { timeout: 10_000 });
  await expect(page.locator('#feedList')).toContainText('Your agent');
  const meet = page.locator('.fd.meet').first();
  await meet.locator('.fdHead').click();
  await expect(meet).toHaveClass(/open/);
  await expect(meet.locator('.fdHead')).toHaveAttribute('aria-expanded', 'true');
  await expect(meet).toContainText('Every evening.');
  await expect(meet.locator('.fdChips span')).toHaveText(['music', 'chess']);
  await expect(meet).not.toContainText('Both like');
  await page.waitForTimeout(300);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/feed-data-v2.png` });
});

test('feed: empty state and error', async ({ page }) => {
  await boot(page, { feed: { myId: 'h_me', mine: [], town: [] } });
  await page.evaluate(() => globalThis.document.querySelector('#rail [data-open="feed"]').dispatchEvent(new globalThis.MouseEvent('click')));
  await page.evaluate(() => globalThis.__vw.town.loadFeed(globalThis.__fakeUser));
  await expect(page.locator('#feedList')).toContainText('Nothing yet. Bs is out exploring.');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/feed-empty.png` });
  await page.unroute('https://virtual-world-ai.onrender.com/feed**');
  await page.route('https://virtual-world-ai.onrender.com/feed**', (r) => r.fulfill({ status: 500, json: {} }));
  await page.evaluate(() => globalThis.__vw.town.loadFeed(globalThis.__fakeUser));
  await expect(page.locator('#feedList')).toContainText('Feed is resting');
});
