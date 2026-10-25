/* global window, document, getComputedStyle */
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

  // Signed out: onboarding opens on the night globe, and Get started leads to one-tap sign-in.
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle('Virtual World');
  await expect(page.locator('#onb')).toBeVisible();
  await expect(page.locator('#onb h1')).toContainText('Your agent is waiting to be born.');
  await page.locator('#onbGo').click();
  await expect(page.locator('#onbSign')).toBeVisible();
  await expect(page.locator('#onbSign')).toBeEnabled();
  await page.locator('#onbBack').click();
  await expect(page.locator('#onbGo')).toBeVisible();

  // The rest checks the app shell with onboarding off.
  await page.goto('/?onb=0', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#onb')).toBeHidden();
  await expect(page.locator('#topbar .search')).toContainText('Search places');
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

// Live sharing must keep the user's own 3D character on screen at the live position, not swap it for a plain dot.
test('own character follows live location while sharing', async ({ page, context, baseURL }) => {
  await context.grantPermissions(['geolocation'], { origin: new URL(baseURL).origin });
  await context.setGeolocation({ latitude: 17.4485, longitude: 78.3908, accuracy: 8 });
  page.on('dialog', (d) => d.accept('Tester'));
  await page.goto('/?onb=0#19.3/17.4485/78.3908/0/60', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__map?.loaded() && globalThis.__vw?.agent, null, { timeout: 45_000 });
  // Saved spot ~400 m away, off screen.
  await page.evaluate(() => { globalThis.__vw.agent._preview({ name: 'Buddy', lat: 17.451, lon: 78.387, look: { base: 'boy' } }); globalThis.__vw.tabs.set('world'); });
  await page.waitForFunction(() => globalThis.__avatarReady, null, { timeout: 45_000 });
  await page.evaluate(() => globalThis.document.getElementById('liveBtn').click());
  await expect(page.locator('#liveBtn')).toContainText('Stop sharing');
  await expect(page.locator('.agLabel')).toBeVisible();
  await expect(page.locator('#map .me')).toHaveCount(0);
  const near = await page.evaluate(() => {
    const r = globalThis.document.querySelector('.agLabel').getBoundingClientRect();
    const q = globalThis.__map.project([78.3908, 17.4485]);
    return Math.abs(r.left + r.width / 2 - q.x) < 40 && q.y - r.bottom < 200 && q.y > r.bottom;
  });
  expect(near).toBe(true);
  // Stopping puts the character back at its saved spot.
  await page.evaluate(() => globalThis.document.getElementById('liveBtn').click());
  await expect(page.locator('#liveBtn')).toContainText('Share my live location');
});

// Regression: chat.js once grabbed the first <button> in #chatF (the "+" button),
// so typing never enabled the real Send button.
test('typing enables the chat Send button', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => document.getElementById('chatF')?.onsubmit);
  const state = await page.evaluate(() => {
    const input = document.getElementById('chatIn');
    input.value = 'hello';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const f = document.getElementById('chatF');
    return { send: f.querySelector('button.send').disabled, plus: f.querySelector('#chatPlus').disabled };
  });
  expect(state).toEqual({ send: false, plus: false });
});

// Regression: `body[data-tab=chat] .ag{display:none}` (meant for map markers) also hid chat replies,
// which were `.msg.ag` (now `.msg.bot`), so the agent looked like it never answered. Replies must render on the Chat tab.
test('agent replies are visible on the Chat tab', async ({ page }) => {
  await page.goto('/?onb=0');
  await page.waitForFunction(() => document.getElementById('chatLog'));
  await page.evaluate(() => {
    document.body.dataset.tab = 'chat';
    const d = document.createElement('div');
    d.className = 'msg bot';
    d.id = 'probeReply';
    d.innerHTML = '<div class="mbody"><div class="agent-text">I am at the park.</div></div>';
    document.getElementById('chatLog').append(d);
  });
  const display = await page.locator('#probeReply').evaluate((el) => getComputedStyle(el).display);
  expect(display).not.toBe('none');
  // Map markers still hide on the Chat tab.
  const marker = await page.evaluate(() => {
    const m = document.createElement('div');
    m.className = 'ag';
    document.body.append(m);
    return getComputedStyle(m).display;
  });
  expect(marker).toBe('none');
});

// Regression: chat replies used the map-marker class `.ag` (width:64px), so on phones bot text
// wrapped one or two words per line under the avatar. Replies are now `.msg.bot`: full width, no avatar.
test('bot replies are full width with no avatar at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/?onb=0');
  await page.waitForFunction(() => document.getElementById('chatLog'));
  await page.evaluate(() => {
    document.body.classList.remove('onb');
    document.body.dataset.tab = 'chat';
    document.getElementById('chatView').hidden = false;
    const log = document.getElementById('chatLog');
    const me = document.createElement('div');
    me.className = 'msg user';
    me.textContent = 'What are you doing?';
    const d = document.createElement('div');
    d.className = 'msg bot';
    d.id = 'probeBot';
    d.innerHTML = '<div class="mbody"><div class="agent-text">Right now I am walking to the park near your place to see who is around.</div></div>';
    log.append(me, d);
  });
  const r = await page.evaluate(() => {
    const el = document.getElementById('probeBot');
    const me = document.querySelector('#chatLog .msg.user');
    return {
      w: el.querySelector('.agent-text').getBoundingClientRect().width,
      vw: window.innerWidth,
      avatars: document.querySelectorAll('#chatLog .mini, #chatLog .name, #chatLog .ag').length,
      userRight: Math.round(window.innerWidth - me.getBoundingClientRect().right),
      userW: me.getBoundingClientRect().width,
    };
  });
  expect(r.w).toBeGreaterThan(250);
  expect(r.w).toBeGreaterThan(r.vw * 0.6);
  expect(r.avatars).toBe(0);
  expect(r.userW).toBeLessThanOrEqual(r.vw * 0.8 + 1);
  expect(r.userRight).toBeLessThan(24);
  // The header avatar is not a per-message avatar: it must still show the agent's character face.
  const hero = page.locator('#hero .av #heroCv');
  await expect(hero).toBeVisible();
  const blank = await hero.screenshot();
  await page.evaluate(async () => {
    const m = await import('/src/chat-hero-3d.js');
    const h = m.chatHero(document.getElementById('heroCv'));
    h.set({ name: 'Bs' });
    h.start();
  });
  await expect.poll(async () => Buffer.compare(await hero.screenshot(), blank) !== 0, { timeout: 15_000 }).toBe(true);
  const box = await hero.boundingBox();
  expect(box.width).toBeGreaterThan(30);
});

// Regression: on phones the floating Chat/World tab bar overlapped the "Ask ... anything" input.
// The composer now sits 12px above the 56px tab pill, which keeps safe-area padding.
test('chat input sits above the tab bar at 360x740', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/?onb=0');
  await page.waitForFunction(() => document.getElementById('chatF'));
  await page.evaluate(() => {
    document.body.classList.remove('onb');
    document.body.dataset.tab = 'chat';
    document.getElementById('chatView').hidden = false;
  });
  const r = await page.evaluate(() => {
    const a = document.getElementById('chatF').getBoundingClientRect();
    const t = document.getElementById('tabs').getBoundingClientRect();
    return { inBottom: a.bottom, inH: a.height, tabTop: t.top, tabBottom: t.bottom, tabH: t.height, vh: window.innerHeight };
  });
  expect(r.inH).toBeGreaterThan(0);
  expect(r.inBottom).toBeLessThanOrEqual(r.tabTop - 8);
  expect(r.tabBottom).toBeLessThanOrEqual(r.vh);
  expect(Math.round(r.inH)).toBe(52);
  expect(Math.round(r.tabH)).toBe(56);
});
