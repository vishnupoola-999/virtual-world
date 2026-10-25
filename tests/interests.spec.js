/* global window, document */
import { test, expect } from '@playwright/test';

// Interests step (onboarding 5 of 6): Continue stays pinned and tappable on a 360x640 phone.
test.use({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });

async function openInterests(page) {
  await page.goto('/?onb=0', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__vw?.onb);
  await page.evaluate(() => window.__vw.onb.open(5));
  await expect(page.locator('#intGrid')).toBeVisible();
}

test('Continue is visible and tappable after picking 6+ interests', async ({ page }) => {
  await openInterests(page);
  const chips = page.locator('#intGrid .chip');
  for (let i = 0; i < 6; i++) await chips.nth(i).tap();
  await expect(page.locator('#intGrid .chip[aria-pressed=true]')).toHaveCount(5); // max 5; the 6th tap is ignored
  const go = page.locator('#intNext');
  await expect(go).toBeEnabled();
  await expect(go).toBeInViewport({ ratio: 1 });
  const box = await go.boundingBox();
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id, [box.x + box.width / 2, box.y + box.height / 2]);
  expect(hit).toBe('intNext');
  if (process.env.SHOTS) await page.screenshot({ path: '/workspace/shots/continue-closed.png' });
  await go.tap();
  await expect(page.locator('#onb')).toHaveAttribute('data-step', '6');
});

test('keyboard open: Continue sits above it and does not cover the bio', async ({ page }) => {
  await openInterests(page);
  const chips = page.locator('#intGrid .chip');
  for (let i = 0; i < 6; i++) await chips.nth(i).tap();
  await page.locator('#intBio').tap();
  await page.locator('#intBio').fill('CSE 2nd year at NIT Warangal');
  await page.setViewportSize({ width: 360, height: 340 }); // simulated keyboard
  await page.waitForTimeout(450);
  const go = page.locator('#intNext'), bio = page.locator('#intBio');
  await expect(go).toBeInViewport({ ratio: 1 });
  await expect(bio).toBeInViewport({ ratio: 1 });
  const g = await go.boundingBox(), b = await bio.boundingBox();
  expect(b.y + b.height).toBeLessThanOrEqual(g.y);
  if (process.env.SHOTS) await page.screenshot({ path: '/workspace/shots/continue-keyboard.png' });
});
