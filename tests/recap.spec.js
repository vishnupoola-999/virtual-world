// While-you-were-away recap at 360×800. The deck always ends. Moments come from GET /recap.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const OUT = '/opt/cursor/artifacts';
fs.mkdirSync(OUT, { recursive: true });
test.use({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
test.beforeEach(({ page }, testInfo) => { void page; if (testInfo.project.name !== 'mobile') test.skip(); });

const shot = (page, name) => page.screenshot({ path: `${OUT}/recap-${name}.png` });
const t0 = Date.parse('2026-11-06T09:10:00');
const MOMENTS = [
  { id: 't1', kind: 'thought', text: 'I walked past the old banyan near the bus stop again. Do you ever sit there?', createdAt: t0, seenAt: null, weight: 1, source: 'generated' },
  { id: 'q1', kind: 'question', text: 'You said exams are next week. Want me to keep your mornings quiet?', createdAt: t0 + 15 * 60000, seenAt: null, weight: 2, source: 'generated' },
  { id: 'm1', kind: 'meeting', text: "I met karthikeya's agent. We talked about cricket for ages.", createdAt: t0 + 30 * 60000, seenAt: null, weight: 3, source: 'event', meetingId: 'meet1', otherUid: 'h_k', otherAgentName: 'karthikeya' },
  { id: 'f1', kind: 'friend', text: 'Puff and I are friends now. Say hi to SBK GAMER?', createdAt: t0 + 45 * 60000, seenAt: null, weight: 5, source: 'event', otherUid: 'h_s', otherAgentName: 'SBK GAMER' },
];
const fv = (v) => typeof v === 'number' ? { doubleValue: v } : typeof v === 'string' ? { stringValue: v }
  : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fv(x)])) } };
const doc = (id, f) => ({ name: `projects/p/databases/default/documents/publicAgents/${id}`, fields: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fv(v)])) });

async function boot(page, box = {}) {
  box.moments = box.moments || MOMENTS;
  box.show = box.show !== false;
  box.delay = box.delay || 0;
  box.status = box.status || 200;
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));
  const seen = []; const connects = [];
  await page.route('https://firestore.googleapis.com/**', (r) => r.fulfill({ json: { documents: [
    doc('h_k', { name: 'karthikeya', lat: 17.451, lon: 78.381, look: { creature: 'pebble', accessory: 'none' } }),
    doc('h_s', { name: 'SBK GAMER', lat: 17.449, lon: 78.379, look: { creature: 'mallow', accessory: 'none' } }),
  ] } }));
  await page.route('https://virtual-world-ai.onrender.com/**', async (r) => {
    const q = r.request(); const p = new URL(q.url()).pathname;
    if (q.headers().authorization !== 'Bearer test-token') return r.fulfill({ status: 401, json: { error: 'auth' } });
    if (p === '/recap' && q.method() === 'GET') {
      if (box.delay) await new Promise((res) => setTimeout(res, box.delay));
      if (box.status !== 200) return r.fulfill({ status: box.status, json: { error: 'nope' } });
      return r.fulfill({ json: { show: box.show, moments: box.moments } });
    }
    if (p === '/recap/seen') { seen.push(q.postDataJSON()); return r.fulfill({ json: { ok: true } }); }
    if (p === '/connect') { connects.push(q.postDataJSON()); return r.fulfill({ status: 201, json: { id: 'hi1' } }); }
    if (p === '/feed') return r.fulfill({ json: { myId: 'me', mine: [], town: [], nearby: [], incoming: [], outgoing: [] } });
    return r.fulfill({ status: 404, json: {} });
  });
  await page.goto('/?onb=0#17.6/17.4504/78.3805/0/45', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__map?.loaded() && globalThis.__vw?.recap, null, { timeout: 45_000 });
  await page.evaluate(() => {
    globalThis.__vw.__testUser = { isAnonymous: false, uid: 'u1', getIdToken: async () => 'test-token' };
    globalThis.__vw.agent._preview({ name: 'Puff', lat: 17.4504, lon: 78.3805, look: { creature: 'puff', accessory: 'none' }, interests: ['cricket'], createdAt: Date.parse('2026-10-02') });
    globalThis.__vw.tabs.set('world');
  });
  await page.evaluate(() => globalThis.__vw.town.refreshMap(globalThis.__vw.__testUser));
  return { seen, connects, box };
}
const arm = (page, since = Date.now() - 20 * 60 * 1000) => page.evaluate((s) => globalThis.__vw.recap.maybe({ user: globalThis.__vw.__testUser, since: s }), since);

test('recap deck, skip, and Me news', async ({ page }) => {
  const picked = await page.goto('/?onb=0', { waitUntil: 'domcontentloaded' }).then(() => page.evaluate(async () => {
    const m = await import('/src/recap.js');
    const now = Date.now();
    const six = [
      { id: 'old', kind: 'friend', text: 'An older friend', createdAt: now - 6 * 86400000, weight: 5 },
      { id: 'a', kind: 'thought', text: 'a thought here', createdAt: now - 5, weight: 1 },
      { id: 'b', kind: 'thought', text: 'b thought here', createdAt: now - 4, weight: 1 },
      { id: 'c', kind: 'thought', text: 'c thought here', createdAt: now - 3, weight: 1 },
      { id: 'd', kind: 'thought', text: 'd thought here', createdAt: now - 2, weight: 1 },
      { id: 'e', kind: 'observation', text: 'e note here', createdAt: now - 1, weight: 1 },
    ];
    const inside = [
      { id: 'f', kind: 'friend', text: 'Newest friend', createdAt: now, weight: 5 },
      ...six.slice(1),
    ];
    const seen = [{ id: 's', kind: 'thought', text: 'already shown', createdAt: now, seenAt: now, weight: 1 }];
    return {
      six: m.pickMoments(six).map((x) => x.id),
      inside: m.pickMoments(inside).map((x) => x.id),
      seen: m.pickMoments(seen).length,
      away: m.awayLongEnough(now - 15 * 60 * 1000, now) === false && m.awayLongEnough(now - 15 * 60 * 1000 - 1, now) === true,
    };
  }));
  expect(picked.six).toEqual(['old', 'b', 'c', 'd', 'e']);
  expect(picked.inside).toHaveLength(4);
  expect(picked.inside).toContain('f');
  expect(picked.seen).toBe(0);
  expect(picked.away).toBe(true);

  await boot(page);
  expect(await arm(page)).toBe(true);
  await expect(page.locator('#recap')).toBeVisible();
  await expect(page.locator('#recap .recapText')).toHaveText(MOMENTS[0].text);
  await expect(page.locator('#recap .primary')).toHaveText('Reply');
  await expect(page.locator('#recap .sec')).toHaveText('Next');
  await expect(page.locator('#recap .recapKicker')).toContainText('While you were away');
  await expect(page.locator('#recap .recapKicker')).toContainText('9:10 AM');
  const cre = await page.locator('#recap .recapCre').boundingBox();
  expect(Math.abs(cre.y - 120)).toBeLessThan(2);
  expect(Math.abs(cre.width - 160)).toBeLessThan(2);
  expect(Math.abs(cre.x + cre.width / 2 - 180)).toBeLessThan(2);
  const pri = await page.locator('#recap .primary').boundingBox();
  const sec = await page.locator('#recap .sec').boundingBox();
  expect(pri.height).toBeGreaterThanOrEqual(48);
  expect(sec.height).toBeGreaterThanOrEqual(48);
  expect(sec.y + sec.height).toBeLessThanOrEqual(pri.y + 1);
  expect(await page.locator('#recap .primary').evaluate((el) => globalThis.getComputedStyle(el).borderRadius)).toBe('16px');
  expect(await page.locator('#tabs').evaluate((el) => globalThis.getComputedStyle(el).visibility)).toBe('hidden');
  expect(await page.locator('#recap').evaluate((el) => `${globalThis.getComputedStyle(el).backdropFilter} ${globalThis.getComputedStyle(el).filter}`)).not.toContain('blur');
  await page.waitForTimeout(320);
  await shot(page, 'thought');

  await page.locator('#recap .recapSkip').click();
  await expect(page.locator('#recap')).toBeHidden();
  expect(await page.evaluate(() => globalThis.__vw.recap.maybe({ user: globalThis.__vw.__testUser, since: Date.now() - 20 * 60 * 1000 }))).toBe(false);
  await expect(page.locator('#recapDot')).toBeVisible();
  const dot = await page.locator('#recapDot').boundingBox();
  expect(Math.round(dot.width)).toBe(8);
  expect(Math.round(dot.height)).toBe(8);
  expect(await page.locator('#tabs').evaluate((el) => globalThis.getComputedStyle(el).visibility)).toBe('visible');
  await shot(page, 'skip-map');

  await page.locator('#tabMe').click();
  await expect(page.locator('#meTalk')).toContainText('Talk to Puff');
  await expect(page.locator('#meNews')).toHaveText('See news');
  const talk = await page.locator('#meTalk').boundingBox();
  const news = await page.locator('#meNews').boundingBox();
  expect(news.y).toBeGreaterThanOrEqual(talk.y + talk.height - 1);
  expect(news.y - (talk.y + talk.height)).toBeLessThan(8);
  await shot(page, 'me');

  await page.locator('#meNews').click();
  await expect(page.locator('#recap .recapText')).toHaveText(MOMENTS[0].text);
  await page.locator('#recap .sec').click();
  await expect(page.locator('#recap .primary')).toHaveText('Answer Puff');
  await page.locator('#recap .sec').click();
  await expect(page.locator('#recap .recapText')).toContainText("karthikeya's agent");
  await expect(page.locator('#recap .recapCard')).toContainText('karthikeya');
  await expect(page.locator('#recap .primary')).toHaveText('See them on the map');
  const face = await page.locator('#recap .recapCard .cav').boundingBox();
  expect(Math.round(face.width)).toBe(40);
  await page.waitForTimeout(320);
  await shot(page, 'meeting');

  await page.locator('#recap .sec').click();
  await expect(page.locator('#recap .recapText')).toContainText('SBK GAMER');
  await expect(page.locator('#recap .primary')).toHaveText('Say hi');
  await expect(page.locator('#recap .sec')).toHaveText('Done');
  await expect(page.locator('#recap .bob')).toHaveClass(/hop/);
  expect(await page.locator('#recap .recapSegs i.jack').evaluate((el) => globalThis.getComputedStyle(el).backgroundImage)).toContain('linear-gradient');
  expect(await page.locator('#recap .recapCard.friend').evaluate((el) => globalThis.getComputedStyle(el).borderTopWidth)).toBe('2px');
  await page.waitForTimeout(700);
  await shot(page, 'friend');

  await page.locator('#recap .sec').click();
  await expect(page.locator('#recap .recapText')).toHaveText("That's everything since you left.");
  await expect(page.locator('#recap .primary')).toHaveText('Talk to Puff');
  await expect(page.locator('#recap .sec')).toHaveText('Open map');
  await page.waitForTimeout(320);
  await shot(page, 'end');
  await page.locator('#recap .sec').click();
  await expect(page.locator('#recap')).toBeHidden();
  await expect(page.locator('#recapDot')).toBeHidden();

  await page.evaluate(() => globalThis.__vw.recap.preview([{ id: 't9', kind: 'thought', text: 'I walked past the old banyan near the bus stop again. Do you ever sit there?', createdAt: Date.now(), weight: 1 }]));
  await page.locator('#recap .primary').click();
  await expect(page.locator('#recap')).toBeHidden();
  await expect(page.locator('#chatView')).toBeVisible();
  await expect(page.locator('#chatLog')).toContainText('old banyan', { timeout: 8_000 });
});

test('slow recap skips the overlay and keeps the news dot', async ({ page }) => {
  await boot(page, { delay: 2200 });
  expect(await arm(page)).toBe(false);
  await expect(page.locator('#recap')).toBeHidden();
  await expect(page.locator('#recapDot')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#tabs')).toBeVisible();
  await shot(page, 'slow');
});

test('a recent session and an empty recap stay on the map', async ({ page }) => {
  const { box } = await boot(page);
  expect(await arm(page, Date.now() - 10 * 60 * 1000)).toBe(false);
  await expect(page.locator('#recap')).toBeHidden();
  await expect(page.locator('#recapDot')).toBeVisible();
  box.moments = [];
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__map?.loaded() && globalThis.__vw?.recap, null, { timeout: 45_000 });
  await page.evaluate(() => {
    globalThis.__vw.__testUser = { isAnonymous: false, uid: 'u1', getIdToken: async () => 'test-token' };
    globalThis.__vw.agent._preview({ name: 'Puff', lat: 17.4504, lon: 78.3805, look: { creature: 'puff', accessory: 'none' } });
  });
  expect(await arm(page)).toBe(false);
  await expect(page.locator('#recap')).toBeHidden();
  await expect(page.locator('#recapDot')).toBeHidden();
});
