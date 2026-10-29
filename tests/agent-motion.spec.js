// Agent motion (design/agent-motion): eased walks from the drawn position, world-space heading independent of the camera.
import { test, expect } from '@playwright/test';
const SHOTS = process.env.MOTION_SHOTS;
const shot = (page, n) => SHOTS ? page.screenshot({ path: `${SHOTS}/${n}.png` }) : null;
test.use({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2 });
async function boot(page) {
  await page.route('https://firestore.googleapis.com/**/publicAgents**', (r) => r.fulfill({ json: { documents: [] } }));
  await page.route('https://virtual-world-ai.onrender.com/feed**', (r) => r.fulfill({ json: { mine: [], town: [] } }));
  await page.goto('/?onb=0#19/17.4505/78.3805/0/55', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__map?.loaded() && globalThis.__vw?.agents && globalThis.__vw?.tabs, null, { timeout: 45_000 });
  await page.evaluate(() => { globalThis.__vw.agent._preview({ name: 'Bs', lat: 17.4505, lon: 78.3805, look: { base: 'boy' } }); globalThis.__vw.tabs.set('world'); });
  await page.waitForFunction(() => globalThis.__avatarReady && typeof globalThis.__vw.agents.get('me')?.yawNow === 'number', null, { timeout: 45_000 });
}
const yawNow = (page) => page.evaluate(() => globalThis.__vw.agents.get('me').yawNow);
const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));

test('rotating the camera does not rotate the agent with it', async ({ page }) => {
  await boot(page);
  const y0 = await yawNow(page);await shot(page, 'bearing-000');
  for (const b of [90, 180, 270]) {
    await page.evaluate((d) => globalThis.__map.jumpTo({ bearing: d }), b);await page.waitForTimeout(400);
    const y = await yawNow(page);expect(Math.abs(wrap(y - y0 - b * Math.PI / 180))).toBeLessThan(.05); // screen yaw follows the bearing, so the world heading holds
    await shot(page, `bearing-${String(b).padStart(3, '0')}`);
  }
});

test('a walk is eased from the drawn position, never a jump', async ({ page }) => {
  await boot(page);
  const xs = await page.evaluate(async () => {
    const ag = globalThis.__vw.agents, a = ag.get('me'), m = globalThis.__map;
    ag.put({ ...a, look: a.look, lat: 17.4505, lon: 78.3809 }); // ~43 m east
    const out = [];const t0 = performance.now();
    await new Promise((res) => { const f = () => { out.push([performance.now(), m.project(a.marker.getLngLat()).x]); if (performance.now() - t0 < 1700) globalThis.requestAnimationFrame(f); else res(); }; globalThis.requestAnimationFrame(f); });
    return out;
  });
  const steps = xs.slice(1).map(([, x], i) => x - xs[i][1]);
  const x0 = xs[0][1], total = xs.at(-1)[1] - x0;expect(total).toBeGreaterThan(50);
  // a teleport lands in one frame; a walk starts where it was drawn and passes in-between positions
  const mid = xs.filter(([, x]) => x > x0 + total * .1 && x < x0 + total * .9);
  // (judged by progress, not frame count: headless rAF stalls under a loaded test run)
  expect(xs[1][1] - x0).toBeLessThan(total * .25);expect(mid.length).toBeGreaterThan(0);
  expect(steps.every((s) => s >= -0.5)).toBe(true); // never snaps back
});

test('frame sequence of a walk (shots only)', async ({ page }) => {
  test.skip(!SHOTS, 'MOTION_SHOTS not set');
  await boot(page);
  await page.evaluate(() => { const ag = globalThis.__vw.agents, a = ag.get('me'); ag.put({ ...a, look: a.look, lat: 17.4503, lon: 78.3809 }); });
  for (let i = 0; i < 8; i++) { await shot(page, `walk-${i}`); await page.waitForTimeout(220); }
});
