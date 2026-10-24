import { expect, test } from '@playwright/test';

// Loads the static site the way GitHub Pages does (plain files, no build) and
// fails on page exceptions or console errors.
//
// Startup contacts a few third-party hosts: unpkg.com (MapLibre), jsdelivr.net
// (three.js), gstatic.com and googleapis.com (Firebase), tiles.openfreemap.org,
// s3.amazonaws.com (terrain), and ntfy.sh (family presence). Those calls are part of a healthy
// load. A console error is ignored only when it names one of those hosts and
// is a transport failure (net::ERR_* or Firebase network-request-failed).
// HTTP statuses, same-origin failures, and any other console error still fail.
// Ignored lines are printed and included in the assertion message. A local run
// with network available ignored nothing.
const BLOCKED_EXTERNAL = [
  /https?:\/\/([^/\s]*\.)?(unpkg\.com|jsdelivr\.net|gstatic\.com|googleapis\.com|google\.com|openfreemap\.org|amazonaws\.com|ntfy\.sh)\b/i,
];

const BLOCKED_NETWORK = /net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|CONNECTION_REFUSED|CONNECTION_RESET|CONNECTION_TIMED_OUT|TIMED_OUT|ADDRESS_UNREACHABLE|NETWORK_CHANGED|BLOCKED_BY)/i;

function isBlockedExternal(entry) {
  const blob = `${entry.text}\n${entry.url}`;
  const namesExternalHost = BLOCKED_EXTERNAL.some((re) => re.test(blob));
  if (!namesExternalHost) return false;
  return BLOCKED_NETWORK.test(blob) || /network-request-failed/i.test(entry.text);
}

test('page loads with no console errors', async ({ page }) => {
  const viewport = page.viewportSize();
  expect(viewport).toBeTruthy();
  const size = `${viewport.width}x${viewport.height}`;
  expect(['390x844', '1280x800']).toContain(size);

  /** @type {{text: string, url: string}[]} */
  const errors = [];
  page.on('pageerror', (err) => {
    errors.push({ text: `pageerror: ${err.message}`, url: '' });
  });
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const location = msg.location();
    errors.push({ text: msg.text(), url: location.url || '' });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle('Virtual World');
  await expect(page.locator('#topbar .brand')).toContainText('Virtual World');
  await expect(page.locator('#acctBtn')).toBeVisible();
  await expect(page.locator('#map')).toBeVisible();
  await expect(page.locator('#map canvas')).toBeVisible();
  await page.locator('#acctBtn').click();
  await expect(page.locator('#signInBtn')).toBeVisible();

  // style.load sets the globe projection. Waiting for it catches a map that
  // never finished initializing, then a short pause picks up late errors.
  await page.waitForFunction(() => {
    const map = globalThis.__map;
    return !!map && map.getProjection?.()?.type === 'globe';
  }, null, { timeout: 45_000 });
  await page.waitForTimeout(1000);

  // The account sheet hides the floating buttons on a phone. Close it, then
  // confirm signed-out chat asks for sign-in and does not open the transcript.
  await page.locator('#sheetClose').click();
  await expect(page.locator('#sheet')).toBeHidden();
  await expect(page.locator('#tabs')).toBeVisible();
  await page.locator('#tabChat').click();
  await expect(page.locator('#toast')).toContainText(/sign in/i);
  await expect(page.locator('#chatView')).toBeHidden();
  await expect(page.locator('#tabWorld')).toHaveAttribute('aria-selected', 'true');

  const format = (entry) => (entry.url ? `${entry.text} (${entry.url})` : entry.text);
  const ignored = errors.filter(isBlockedExternal);
  const unexpected = errors.filter((entry) => !ignored.includes(entry));
  if (ignored.length) {
    console.log(`ignored blocked-external console errors at ${size}:\n${ignored.map(format).join('\n')}`);
  }
  expect(
    unexpected.map(format),
    [
      `console errors at ${size}`,
      ignored.length
        ? `ignored blocked-external errors:\n${ignored.map(format).join('\n')}`
        : 'ignored blocked-external errors: none',
    ].join('\n'),
  ).toEqual([]);
});
