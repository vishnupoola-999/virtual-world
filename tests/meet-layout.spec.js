// Meet layout: partner side by side (~1.2 creature widths), clear of your "You" pill; dots only while a reply is pending.
import { test, expect } from '@playwright/test';
test.use({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2 });
const ME = { lat: 18.00577, lon: 79.5319 };
test('meet partner stands beside yours and the dots follow the pending reply', async ({ page }) => {
  await page.route('https://firestore.googleapis.com/**/publicAgents**', (r) => r.fulfill({ json: { documents: [] } }));
  await page.goto(`/?onb=0#18.6/${ME.lat}/${ME.lon}/0/45`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__map?.loaded() && globalThis.__vw?.living, null, { timeout: 45_000 });
  await page.evaluate((me) => { globalThis.__vw.agent._preview({ name: 'Bs', ...me, look: { creature: 'blob', accessory: 'none' } }); globalThis.__vw.tabs.set('world');
    globalThis.__vw.living.showOwn({ name: 'Bs', ...me, status: { kind: 'meeting', label: 'With Buddy', withAgentId: 'town-buddy', withName: 'Buddy' } }); }, ME);
  await page.waitForTimeout(2200);
  const g = await page.evaluate(() => { const r = (i, s) => globalThis.__vw.agents.get(i).el.querySelector(s).getBoundingClientRect().toJSON();
    return { me: r('me', 'canvas'), p: r('town-buddy', 'canvas'), pill: r('me', '.pill') }; });
  const cx = (b) => b.x + b.width / 2;
  expect(Math.abs(g.p.bottom - g.me.bottom)).toBeLessThan(3);           // same baseline
  expect(cx(g.p) - cx(g.me)).toBeGreaterThan(66); expect(cx(g.p) - cx(g.me)).toBeLessThan(90); // ~1.2 creature widths
  expect(g.p.x).toBeGreaterThanOrEqual(g.pill.right - 4);                // never covers the "You" pill
  const bubble = page.locator('.ag.mine .bubble');
  await expect(bubble).toBeHidden();                                       // a meet alone shows no dots
  await page.evaluate(() => globalThis.__vw.agents.setState('me', 'busy')); await expect(bubble).toBeVisible();
  await page.evaluate(() => globalThis.__vw.agents.setState('me', 'talking')); await expect(bubble).toBeHidden(); // reply arrived
});
