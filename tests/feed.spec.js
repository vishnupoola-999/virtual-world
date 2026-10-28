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
  { id: '1', kind: 'meet', withId: 'h_a', withName: 'Mira', shared: ['music', 'chess'], lines: [{ speaker: 'Bs', text: 'You like chess too?' }, { speaker: 'Mira', text: 'Every evening.' }], at: ago(12) },
  { id: '2', kind: 'diary', text: 'Walked to the park and watched the sunset.', at: ago(90) },
], town: [{ id: 't1', aName: 'Ravi', bName: 'Tara', shared: ['cricket'], at: ago(30) }, { id: 't2', aName: 'Kiran', bName: 'Mira', shared: [], at: ago(200) }] };

async function boot(page, { feed = FEED, feedDelay = 0, agents = AGENTS, feedStatus = 200 } = {}) {
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));
  await page.route('https://firestore.googleapis.com/**/publicAgents**', (r) => r.fulfill({ json: agents }));
  await page.route('https://virtual-world-ai.onrender.com/threads**', (r) => r.fulfill({ json: { myId: 'h_me', threads: [] } }));
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
  await expect(page.locator('.ag.mine .pill')).toBeHidden() // Diggy fix 1;
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
  await expect(page.locator('#feedList')).toContainText('Met Mira', { timeout: 10_000 });
  await expect(page.locator('#feedList')).not.toContainText('Around town');
  await expect(page.locator('#feedList')).not.toContainText('Ravi and Tara');
  await expect(page.locator('#feedList')).not.toContainText('Walked to the park');
  const meet = page.locator('#feedList .fd.meet').first();
  await expect(meet.locator('.fdChips span')).toHaveText(['music', 'chess']);
  await meet.locator('.fdHead').click();
  await expect(meet).toHaveClass(/open/);
  await page.waitForTimeout(300);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/feed-data-v2.png` });
});

test('Chat has no activity view', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { globalThis.__vw.tabs.set('chat'); globalThis.document.getElementById('chatView').hidden = false; });
  await expect(page.locator('#chatActBtn, #chatAct')).toHaveCount(0);
  await expect(page.locator('#chatView')).not.toContainText('Met Mira');
  if (SHOTS) { await page.waitForTimeout(500); await page.screenshot({ path: `${SHOTS}/chat-clean-v3.png` }); }
});

test('Agent chats (v4): worth-meeting rows only for interest matches, unread dot, Say hi opens the composer only', async ({ page }) => {
  const feed = { ...FEED, mine: [...FEED.mine, { id: '3', kind: 'meet', withName: 'Dev', shared: [], lines: [{ speaker: 'Dev', text: 'Nice weather.' }], at: ago(40) },
    { id: '4', kind: 'meet', town: true, withName: 'Sam', shared: ['music'], at: ago(50) }] };
  const sent = []; page.on('request', (r) => { if (r.method() !== 'GET') sent.push(r.url()); });
  await boot(page, { feed });
  expect(await page.evaluate(() => globalThis.__vw.town.checkUnread(globalThis.__fakeUser))).toBe(1);
  await expect(page.locator('#chatsDot')).toBeVisible();
  await page.locator('#tabChats').click();
  await page.evaluate(() => globalThis.__vw.town.loadActivity(globalThis.__fakeUser));
  const ac = page.locator('#agentChats');
  await expect(ac.locator('.wmRow')).toHaveCount(1);
  await expect(ac.locator('.wmRow .frMain small')).toHaveText('Likes music, chess');
  await expect(ac).not.toContainText('Sam'); await expect(ac).not.toContainText('Dev'); await expect(ac).not.toContainText(/undefined|null|\$\{/);
  await expect(ac.locator('.caught')).toHaveText('All caught up');
  const n0 = sent.length;
  await ac.locator('.wmRow .hi').click();
  await expect(ac.locator('.wmRow .draft')).toHaveValue(/Hi Mira/);
  await page.waitForTimeout(300);
  expect(sent.slice(n0).filter((u) => !u.includes('google') && !u.includes('gstatic'))).toEqual([]);
});

test('feed: empty state and error', async ({ page }) => {
  await boot(page, { feed: { myId: 'h_me', mine: [], town: [] } });
  await page.evaluate(() => globalThis.document.querySelector('#rail [data-open="feed"]').dispatchEvent(new globalThis.MouseEvent('click')));
  await page.evaluate(() => globalThis.__vw.town.loadFeed(globalThis.__fakeUser));
  await expect(page.locator('#feedList')).toContainText('No meets yet.');
  await page.evaluate(() => globalThis.__vw.town.loadActivity(globalThis.__fakeUser));
  await expect(page.locator('#agentChats')).toContainText('No chats yet. Your agent is out exploring');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/feed-empty.png` });
  await page.unroute('https://virtual-world-ai.onrender.com/feed**');
  await page.route('https://virtual-world-ai.onrender.com/feed**', (r) => r.fulfill({ status: 500, json: {} }));
  await page.evaluate(() => { globalThis.__vw.town.fresh(); return globalThis.__vw.town.loadFeed(globalThis.__fakeUser); });
  await expect(page.locator('#feedList')).toContainText('Feed is resting');
});

async function openChats(page, feed, connect) {
  const posts = [];
  await page.route('https://virtual-world-ai.onrender.com/connect', async (r) => { posts.push({ auth: r.request().headers().authorization, body: r.request().postDataJSON() });
    const c = typeof connect === 'function' ? await connect(posts.length) : connect; return r.fulfill(c); });
  await boot(page, { feed });
  await page.evaluate(() => globalThis.document.querySelector('#rail [data-open="agentchats"]').dispatchEvent(new globalThis.MouseEvent('click')));
  await page.evaluate(() => globalThis.__vw.town.loadActivity(globalThis.__fakeUser));
  return posts;
}

test('Say hi composer (v4): prefill, counter, cancel, send, disabled while sending, then Hi sent', async ({ page }) => {
  let release; const gate = new Promise((r) => { release = r; });
  const posts = await openChats(page, FEED, async () => { await gate; return { status: 201, json: { id: 'c1', createdAt: Date.now() } }; });
  const ac = page.locator('#agentChats'), card = ac.locator('.wmRow');
  await card.locator('.hi').click();
  const t = card.locator('textarea');
  await expect(t).toHaveValue(/^Hi Mira, .*connect\.$/); await expect(t).toHaveAttribute('maxlength', '200');
  const v = await t.inputValue(); await expect(card.locator('.cnt')).toHaveText(`${v.length}/200`);
  await expect(card.locator('.cmp .acts button')).toHaveText(['Cancel', 'Send']);
  await t.fill('   '); await expect(card.locator('.send')).toBeDisabled();
  await card.locator('.cancel').click(); await expect(card.locator('textarea')).toHaveCount(0); await expect(card.locator('.hi')).toBeVisible();
  await card.locator('.hi').click(); await card.locator('textarea').fill('Hi Mira, our agents got on well. Would love to connect.');
  await expect(card.locator('.cnt')).toHaveText('55/200');
  await card.locator('.send').click();
  await expect(card.locator('.send')).toBeDisabled(); await expect(card.locator('.send')).toHaveText('Sending…');
  release();
  await expect(ac.locator('.wmRow .sentTag')).toHaveText('Hi sent'); await expect(ac.locator('.wmRow .hi')).toHaveCount(0);
  expect(posts).toEqual([{ auth: 'Bearer test-token', body: { toAgentId: 'h_a', meetId: '1', text: 'Hi Mira, our agents got on well. Would love to connect.' } }]);
});

test('Say hi errors: friendly message, composer stays editable', async ({ page }) => {
  const codes = [409, 429, 400, 503];
  await openChats(page, FEED, (n) => ({ status: codes[n - 1], json: { error: 'x' } }));
  const card = page.locator('#agentChats .wmRow');
  await card.locator('.hi').click();
  await card.locator('.send').click();
  await expect(card.locator('.err')).toHaveText('You already said hi');
  await expect(card.locator('.send')).toBeEnabled(); await expect(card.locator('textarea')).toBeEnabled();
  if (SHOTS) { await page.waitForTimeout(300); await page.screenshot({ path: `${SHOTS}/error.png` }); }
  await card.locator('.send').click(); await expect(card.locator('.err')).toHaveText('Try again later');
  await card.locator('.send').click(); await expect(card.locator('.err')).toContainText('no links');
  await card.locator('.send').click(); await expect(card.locator('.err')).toContainText('resting');
});

test('incoming hi (v4): Requests card on top, escaped, counts toward unread', async ({ page }) => {
  const feed = { ...FEED, incoming: [{ id: 'in1', fromAgentId: 'h_b', fromName: 'Priya<b>', text: 'Hi! Our agents talked about space <img src=x onerror=alert(1)>', meetId: 'x', createdAt: ago(3) }],
    outgoing: [{ id: 'o1', toAgentId: 'h_zz', createdAt: ago(5), status: 'pending' }] };
  await boot(page, { feed });
  expect(await page.evaluate(() => globalThis.__vw.town.checkUnread(globalThis.__fakeUser))).toBe(2);
  await page.locator('#tabChats').click();
  await page.evaluate(() => globalThis.__vw.town.loadActivity(globalThis.__fakeUser));
  const ac = page.locator('#agentChats'), rq = ac.locator('.reqCard');
  await expect(rq).toHaveCount(1); await expect(rq.locator('b')).toHaveText('Priya<b> wants to say hi');
  expect(await ac.evaluate((e) => e.firstElementChild.querySelector('.reqCard') !== null)).toBe(true);
  await rq.click(); const sh = page.locator('#v4Req'); await expect(sh.locator('.note')).toContainText('<img src=x'); await expect(sh.locator('.note img')).toHaveCount(0);
  expect(await page.evaluate(() => globalThis.__vw.town.checkUnread(globalThis.__fakeUser))).toBe(0);
});
