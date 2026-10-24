/* global window, HTMLAnchorElement */
import { test, expect } from '@playwright/test';

const email = { to: ['a@example.com'], subject: 'Hi', body: 'Hello' };
async function load(page) {
  await page.goto('/index.html');
  await page.evaluate(async () => {
    window.__opened = [];
    HTMLAnchorElement.prototype.click = function () { window.__opened.push(this.href); };
    window.__ca = await import('/src/ui/confirmAction.js');
  });
}
const open = (page, action) => page.evaluate((a) => { window.__res = undefined; window.__ca.confirmAction(a).then((r) => { window.__res = r; }); }, action);
const result = (page) => page.waitForFunction(() => window.__res).then((h) => h.jsonValue());

test('nothing confirms without a tap, and Enter on open does not confirm', async ({ page }) => {
  await load(page);
  await open(page, { kind: 'email', mode: 'links', email });
  await expect(page.locator('.cs-sheet[data-open=true]')).toBeVisible();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__res)).toBeUndefined();
  expect(await page.evaluate(() => window.__opened.length)).toBe(0);
  await expect(page.locator('.cs-primary')).not.toBeFocused();
});

for (const how of ['Escape', 'scrim', 'Cancel']) {
  test(`${how} resolves confirmed:false`, async ({ page }) => {
    await load(page);
    await open(page, { kind: 'calendar', mode: 'links', event: { title: 'T', start: '2026-10-31T01:00:00Z', end: '2026-10-31T02:00:00Z' } });
    await expect(page.locator('.cs-sheet[data-open=true]')).toBeVisible();
    if (how === 'Escape') await page.keyboard.press('Escape');
    if (how === 'scrim') await page.locator('.cs-scrim').click({ position: { x: 10, y: 10 } });
    if (how === 'Cancel') await page.locator('.cs-cancel').click();
    expect(await result(page)).toEqual({ confirmed: false });
  });
}

test('tap opens Gmail and resolves confirmed:true', async ({ page }) => {
  await load(page);
  await open(page, { kind: 'email', mode: 'links', email });
  await page.locator('.cs-primary').click();
  expect(await result(page)).toEqual({ confirmed: true });
  expect(await page.evaluate(() => window.__opened[0])).toMatch(/^https:\/\/mail\.google\.com\//);
});

test('openUrl allows only https and mailto', async ({ page }) => {
  await load(page);
  const r = await page.evaluate(() => ['https://x.test', 'mailto:a@b.c', 'javascript:alert(1)', 'http://x.test', 'data:text/html,x', '']
    .map((u) => { try { window.__ca.openUrl(u); return true; } catch { return false; } }));
  expect(r).toEqual([true, true, false, false, false, false]);
});

test('api mode: onResult swaps Sending for Sent, or shows the error', async ({ page }) => {
  await load(page);
  await page.evaluate((email) => { window.__a = { kind: 'email', mode: 'api', email }; window.__ca.confirmAction(window.__a).then((r) => { window.__res = r; }); }, email);
  await page.locator('.cs-primary').click();
  expect(await result(page)).toEqual({ confirmed: true });
  await expect(page.locator('.cs-toast-title')).toHaveText('Sending');
  await page.evaluate(() => window.__a.onResult({ ok: true }));
  await expect(page.locator('.cs-toast-title')).toHaveText('Sent');
  await page.evaluate((email) => { window.__b = { kind: 'email', mode: 'api', email }; window.__ca.confirmAction(window.__b); }, email);
  await page.locator('.cs-sheet[data-open=true] .cs-primary').click();
  await page.evaluate(() => window.__b.onResult({ ok: false, error: 'x' }));
  await expect(page.locator('.cs-sheet[data-open=true] .cs-error')).toBeVisible();
});
