// Redesign v4: the seven screens with the backend mocked (#51 API + /feed). Presence fields (typing, read state, metAt,
// sharedInterests) are feature-detected: tests cover both "absent" (nothing shown) and "present".
import { test, expect } from '@playwright/test';
const SHOTS = globalThis.process?.env.V4_SHOTS;
test.use({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3 });
const ago = (m) => Date.now() - m * 60000;
const fv = (v) => typeof v === 'number' ? { doubleValue: v } : typeof v === 'string' ? { stringValue: v } : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fv(x)])) } };
const doc = (id, f) => ({ name: `projects/p/databases/default/documents/publicAgents/${id}`, fields: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fv(v)])) });
const AGENTS = { documents: [doc('h_me', { name: 'Vishnu', lat: 17.45, lon: 78.38 }),
  doc('h_p', { name: 'Pooja', lat: 17.4509, lon: 78.3811, look: { creature: 'drip', accessory: 'none' } }),
  doc('h_a', { name: 'Arjun', lat: 17.4499, lon: 78.3797, look: { creature: 'mallow', accessory: 'headphones' } }),
  doc('h_b', { name: 'Bs', lat: 17.4511, lon: 78.3798, look: { creature: 'pebble', accessory: 'none' } }),
  doc('h_m', { name: 'Meera', lat: 17.4498, lon: 78.3813, look: { creature: 'puff', accessory: 'bow' } })] };
function server({ presence = false, reactions = false } = {}) {
  const s = { polls: 0, posts: [], next: null, typing: [], reactions, rx: {}, reacts: [], rxFail: 0,
    feed: { myId: 'h_me', mine: [
      { id: 'm1', kind: 'meet', withId: 'h_b', withName: 'Bs', shared: ['tech', 'space'], note: 'Bs builds rockets too.', at: ago(90) },
      { id: 'm2', kind: 'meet', withId: 'h_m', withName: 'Meera', shared: ['music', 'sketching'], at: ago(60 * 26) },
      { id: 'm3', kind: 'meet', withId: 'h_p', withName: 'Pooja', shared: ['space', 'music'], at: ago(60 * 49) },
      { id: 'm9', kind: 'meet', withId: 'h_a', withName: 'Arjun', shared: ['space', 'cricket', 'robotics'], at: ago(60 * 3) }],
    incoming: [{ id: 'c1', fromAgentId: 'h_a', fromName: 'Arjun', text: 'Builds rockets out of bottles. You\'d get along.', meetId: 'm9', createdAt: ago(10), status: 'pending' }],
    outgoing: [{ id: 'o1', toAgentId: 'h_b', status: 'accepted', threadId: 't_b', createdAt: ago(80) }, { id: 'o2', toAgentId: 'h_m', status: 'declined', createdAt: ago(60 * 25) }] },
    threads: [{ id: 't_p', with: { id: 'h_p', name: 'Pooja', interests: ['space', 'music', 'books'], look: { creature: 'drip', accessory: 'none' } }, createdAt: ago(60 * 48), last: { text: 'Haha the telescope one was mine', from: 'them', at: ago(2) }, unread: 1, ...(presence || reactions ? { metAt: ago(60 * 49), sharedInterests: ['space', 'music'] } : {}) /* Chat API v4 thread fields; #59 implies #57 is live */ },
      { id: 't_d', with: { id: 'h_d', name: 'Dad', interests: ['cricket'], look: null }, createdAt: ago(60 * 24 * 9), last: { text: 'Calling you after dinner', from: 'me', at: ago(60) }, unread: 0 }],
    msgs: { t_p: [{ id: 'a', from: 'system', text: 'Your agents met in Koramangala. Pooja and you both like space and music.', at: ago(60 * 48) },
      { id: 'b', from: 'them', text: 'Did you see the Saturn photo your agent sent mine?', at: ago(20) }, { id: 'c', from: 'them', text: 'It looked so real', at: ago(19) },
      { id: 'd', from: 'me', text: 'Yes!! Want to go to the planetarium Sunday?', at: ago(5) }],
    t_a: [{ id: 'i', from: 'system', text: 'Vishnu and Arjun both like space.', at: Date.now() }] } };
  s.presence = presence; return s;
}
async function boot(page, s, { arrive = false } = {}) {
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));
  await page.addInitScript((a) => { if (!a) localStorage.setItem('vw-arrive', new Date().toDateString()); localStorage.setItem('vw-last-visit', String(Date.now() - 6 * 3600e3)); }, arrive);
  await page.route('https://firestore.googleapis.com/**/publicAgents**', (r) => r.fulfill({ json: AGENTS }));
  await page.route('https://virtual-world-ai.onrender.com/**', async (r) => {
    const q = r.request(), u = new URL(q.url()), p = u.pathname, m = q.method();
    if (q.headers().authorization !== 'Bearer test-token') return r.fulfill({ status: 401, json: { error: 'auth' } });
    if (p === '/feed') return r.fulfill({ json: s.feed });
    if (p === '/connect/respond') { const b = q.postDataJSON(); const c = s.feed.incoming.find((x) => x.id === b.connectId); if (!c) return r.fulfill({ status: 404, json: { error: 'not found' } });
      if (b.action === 'decline') { c.status = 'declined'; return r.fulfill({ json: { status: 'declined' } }); }
      c.status = 'accepted'; c.threadId = 't_a'; s.threads.unshift({ id: 't_a', with: { id: 'h_a', name: 'Arjun', interests: ['space', 'cricket', 'robotics'], look: { creature: 'mallow', accessory: 'headphones' } }, createdAt: Date.now(), last: { text: 'Vishnu and Arjun both like space.', from: 'system', at: Date.now() }, unread: 0 });
      return r.fulfill({ json: { status: 'accepted', threadId: 't_a' } }); }
    if (p === '/threads') return r.fulfill({ json: { myId: 'h_me', threads: s.threads } });
    const tm = p.match(/^\/threads\/([^/]+)\/typing$/); if (tm) { s.typing.push(tm[1]); return s.presence ? r.fulfill({ json: { typingUntil: Date.now() + 5000 } }) : r.fulfill({ status: 404, json: {} }); }
    const rm = p.match(/^\/threads\/([^/]+)\/read$/); if (rm) { (s.reads ||= []).push(q.postDataJSON().upTo); return s.presence ? r.fulfill({ json: { readUpTo: q.postDataJSON().upTo } }) : r.fulfill({ status: 404, json: {} }); }
    if (p === '/me/chat-settings') { if (!s.presence) return r.fulfill({ status: 404, json: {} }); if (m === 'POST') s.rr = q.postDataJSON().readReceipts; return r.fulfill({ json: { readReceipts: s.rr ?? true } }); }
    const xm = p.match(/^\/threads\/([^/]+)\/messages\/([^/]+)\/react$/);
    if (xm) { if (!s.reactions) return r.fulfill({ status: 404, json: { error: 'nope' } }); const b = q.postDataJSON(); s.reacts.push({ mid: xm[2], ...b });
      if (s.rxFail) return r.fulfill({ status: s.rxFail, json: { error: 'x' } }); const e = (s.rx[xm[2]] ||= { others: 0, mine: false }); e.mine = !!b.on;
      return r.fulfill({ json: { id: xm[2], reactions: { heart: e.others + (e.mine ? 1 : 0), mine: e.mine } } }); }
    const withRx = (x) => { if (!s.reactions) return x; const e = s.rx[x.id] || { others: 0, mine: false }; return { ...x, reactions: { heart: e.others + (e.mine ? 1 : 0), mine: e.mine } }; };
    const mm = p.match(/^\/threads\/([^/]+)\/messages$/);
    if (mm && m === 'GET') { s.polls++; const after = +u.searchParams.get('after') || 0;
      return r.fulfill({ json: { threadId: mm[1], messages: (s.msgs[mm[1]] || []).filter((x) => x.at > after).map(withRx), more: false, ...(s.presence ? { typingUntil: Date.now() + 5000, receipts: s.rr ?? true, seenUpTo: (s.rr ?? true) ? Date.now() : null } : {}) } }); }
    if (mm && m === 'POST') { const { text } = q.postDataJSON(); s.posts.push(text); if (s.next) { const n = s.next; s.next = null; return r.fulfill({ status: n, json: { error: n === 400 ? 'text not allowed' : 'slow' } }); }
      (s.msgs[mm[1]] ||= []).push({ id: 'p' + s.posts.length, from: 'me', text, at: Date.now() }); return r.fulfill({ status: 201, json: { ok: true } }); }
    return r.fulfill({ status: 404, json: { error: 'nope' } });
  });
  await page.goto((arrive ? '/?onb=0&arrive=1' : '/?onb=0') + '#17.6/17.4504/78.3805/0/45', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__map?.loaded() && globalThis.__vw?.v4 && globalThis.__vw?.town, null, { timeout: 45_000 });
  await page.evaluate(() => { globalThis.__fakeUser = { isAnonymous: false, uid: 'u1', getIdToken: async () => 'test-token' };
    globalThis.__vw.agent._preview({ name: 'Vishnu', lat: 17.4504, lon: 78.3805, look: { creature: 'sprout', accessory: 'none' }, interests: ['tech', 'space', 'music', 'science'], createdAt: Date.parse('2026-10-02') });
    globalThis.__vw.tabs.set('world'); });
  await page.evaluate(() => globalThis.__vw.town.refreshMap(globalThis.__fakeUser));
}
const shot = async (page, n) => { if (SHOTS) { await page.waitForTimeout(900); await page.screenshot({ path: `${SHOTS}/${n}.png` }); } };
const chats = async (page) => { await page.evaluate(() => globalThis.__vw.town.fresh()); await page.locator('#tabChats').click(); await page.evaluate(() => globalThis.__vw.town.loadActivity(globalThis.__fakeUser)); await expect(page.locator('#agentChats .fdSk')).toHaveCount(0); };

test('1 arrival: once a day, real-event line, tap skips', async ({ page }) => {
  const s = server(); await boot(page, s, { arrive: true });
  await page.evaluate(() => globalThis.__vw.v4.arrive({ entries: [{ kind: 'meet', at: Date.now() - 3600e3 }, { kind: 'meet', at: Date.now() - 7200e3 }] }));
  const o = page.locator('#v4Arrive'); await expect(o).toBeVisible(); await expect(o).toContainText('Welcome back'); await expect(o).toContainText('Your agent met 2 people while you were away');
  await page.waitForTimeout(500); if (SHOTS) await page.screenshot({ path: `${SHOTS}/1-arrival.png` });
  await page.mouse.click(180, 200); await expect(o).toHaveCount(0);
  expect(await page.evaluate(() => globalThis.localStorage.getItem('vw-arrive'))).toBe(await page.evaluate(() => new Date().toDateString()));
});

test('2 map HUD: status pill, Today card from real events, no name pills except You, tab pill', async ({ page }) => {
  const s = server(); await boot(page, s);
  await page.evaluate(() => globalThis.__vw.v4.refreshHud(globalThis.__fakeUser));
  await expect(page.locator('#v4Status')).toContainText('Agent exploring');
  await expect(page.locator('#v4Today')).toBeVisible(); await expect(page.locator('#v4Today')).toContainText('Today in your world · 3 new');
  await expect(page.locator('.ag.other')).toHaveCount(4);
  expect(await page.locator('.ag:not(.mine) .pill').evaluateAll((p) => p.filter((x) => x.offsetParent !== null).length)).toBe(0);
  await expect(page.locator('.ag.mine .pill')).toBeHidden(); // Diggy fix 1: no You pill under the hero
  await expect(page.locator('#tabs .tab')).toHaveText(['World', 'Chats', 'Me']);
  // Diggy fix 2: scale bar and info icon hidden under the say-hi card; tilt control up under the locate button.
  for (const q of ['.maplibregl-ctrl-scale', '.maplibregl-ctrl-attrib']) expect(await page.locator(q).first().evaluate((e) => +globalThis.getComputedStyle(e.closest('.maplibregl-ctrl-bottom-right,.maplibregl-ctrl-bottom-left')).opacity)).toBe(0);
  expect((await page.locator('.maplibregl-ctrl-top-right').boundingBox()).y).toBeLessThan(140);
  await shot(page, '2-map');
  // Nothing real in the last day: no Today card.
  s.feed = { ...s.feed, mine: s.feed.mine.map((e) => ({ ...e, at: ago(60 * 30) })), incoming: [] };
  await page.evaluate(() => globalThis.__vw.town.fresh()); await page.evaluate(() => globalThis.__vw.v4.refreshHud(globalThis.__fakeUser)); await expect(page.locator('#v4Today')).toBeHidden();
});

test('3 chats sheet: Requests, Friends, Worth meeting (Connected / Hi sent), All caught up', async ({ page }) => {
  const s = server(); await boot(page, s); await chats(page);
  const secs = await page.locator('#agentChats > *').evaluateAll((e) => e.map((x) => x.className));
  expect(secs[0]).toContain('v4Sec'); await expect(page.locator('.reqCard')).toContainText('Arjun wants to say hi');
  await expect(page.locator('.frSec .fr')).toHaveCount(3); await expect(page.locator('.fr.un .udot')).toHaveCount(1); await expect(page.locator('.fr:not(.un) .udot')).toHaveCount(0);
  // Diggy fix 3: Bs is connected (accepted hi), so Bs is a Friend, not Worth meeting.
  await expect(page.locator('.wmRow[data-with="h_b"]')).toHaveCount(0); await expect(page.locator('.frSec .fr').filter({ hasText: 'Bs' })).toHaveCount(1);
  await expect(page.locator('.wmRow[data-with="h_m"] .sentTag')).toHaveText('Hi sent');
  await expect(page.locator('.caught')).toHaveText('All caught up');
  expect(await page.locator('#agentChats').evaluate((e) => [...e.querySelectorAll('.capLbl,.reqCard,.caught')].map((x) => x.textContent.trim().split(' ')[0]))).toEqual(['Arjun', 'Friends', 'Worth', 'All']);
  const sc = page.locator('#agentChats'); await sc.evaluate((e) => { const s2 = e.closest('.sheetBody,#sheet .body') || e.parentElement; for (let n = e; n; n = n.parentElement) if (n.scrollHeight > n.clientHeight + 1) { n.scrollTop = n.scrollHeight; break; } void s2; });
  await page.waitForTimeout(300);
  const [cb, tb] = [await page.locator('.caught').boundingBox(), await page.locator('#tabs').boundingBox()]; expect(cb.y + cb.height).toBeLessThanOrEqual(tb.y); // fix 3: not clipped
  await shot(page, '3-chats');
});

test('4 private chat: header creatures + met line, grouped bubbles, rise in, Sent; no typing/Seen without data', async ({ page }) => {
  const s = server(); await boot(page, s); await chats(page);
  await page.locator('.fr[data-thread="t_p"] .frBtn').click(); const v = page.locator('#dmView'); await expect(v.locator('.msg')).toHaveCount(3);
  await expect(v.locator('.dmPair .cav')).toHaveCount(2); await expect(v.locator('.dmMet')).toHaveText('Both like space, music'); // client-side overlap, no metAt
  await expect(v.locator('.dmTyping')).toBeHidden(); await expect(v.locator('.rcpt')).toHaveText(/Sent/);
  expect(await v.locator('.msg.them').evaluateAll((m) => m.map((x) => x.classList.contains('first')))).toEqual([true, false]);
  await v.locator('textarea').fill('Sunday works!'); await v.locator('.dmSend').click();
  await expect(v.locator('.msg.me').last()).toContainText('Sunday works!');
  await v.locator('.msg.them').first().dblclick(); await expect(v.locator('.msg.them').first().locator('.rx')).toHaveCount(1); // no /react endpoint (404): local-only fallback
  expect(await page.evaluate(() => globalThis.localStorage.getItem('vw-rx'))).toContain('t_p|b');
  s.next = 400; await v.locator('textarea').fill('call 98480 12345'); await v.locator('.dmSend').click();
  await expect(v.locator('.dmNote')).toHaveText("Links and contact details can't be shared here yet."); await expect(v.locator('textarea')).toHaveValue('call 98480 12345');
  await v.locator('textarea').fill('');
  expect(await page.evaluate(() => globalThis.getComputedStyle(globalThis.document.querySelector('.msg.me p')).backgroundImage)).toBe('none');
});

test('4b presence present: typing dots, Seen, metAt line', async ({ page }) => {
  const s = server({ presence: true }); await boot(page, s); await chats(page);
  await page.locator('.fr[data-thread="t_p"] .frBtn').click(); const v = page.locator('#dmView'); await expect(v.locator('.msg')).toHaveCount(3);
  await expect(v.locator('.dmMet')).toContainText('Met 2 days ago'); await expect(v.locator('.dmMet b')).toHaveText('space, music');
  await expect(v.locator('.dmLive')).toHaveText('typing…'); await expect(v.locator('.dmTyping')).toBeHidden(); // Diggy fix 5: header only
  await expect(v.locator('.rcpt')).toContainText('Seen');
  await expect.poll(() => (s.reads || []).length).toBeGreaterThan(0); // POST /threads/:id/read {upTo}
  await expect(v.locator('.dmPair img[src]')).toHaveCount(2, { timeout: 15_000 });
  await shot(page, '4-chat');
  await v.locator('.dmBack').click(); await page.evaluate(() => globalThis.__vw.v4.refreshHud(globalThis.__fakeUser)); await page.locator('#tabMe').click();
  const rr = page.locator('#meRR'); await expect(rr).toHaveAttribute('aria-checked', 'true'); await rr.click();
  await expect(rr).toHaveAttribute('aria-checked', 'false'); expect(s.rr).toBe(false);
});

test('5 request sheet, 6 connect moment, then chat with openers', async ({ page }) => {
  const s = server(); await boot(page, s); await chats(page);
  await page.locator('.reqCard').click(); const r = page.locator('#v4Req'); await expect(r.locator('h2')).toHaveText('Arjun');
  await expect(r.locator('.note')).toContainText('Builds rockets'); await expect(r.locator('.chip.hl')).toContainText('Both like space'); await expect(r.locator('.chip')).toHaveCount(3); await expect(r.locator('.primary')).toHaveText('Accept'); await expect(r.locator('.ghost')).toHaveText('Not now');
  await shot(page, '5-request');
  await r.locator('.primary').click();
  const c = page.locator('#v4Conn'); await expect(c.locator('h2')).toHaveText('You and Arjun are connected'); await expect(c.locator('.primary')).toHaveText('Say hi'); await expect(c.locator('p')).toContainText('You both like space');
  await page.waitForTimeout(400); if (SHOTS) { await page.waitForTimeout(700); await page.screenshot({ path: `${SHOTS}/6-connected.png` }); }
  await c.locator('.primary').click(); const v = page.locator('#dmView'); await expect(v.locator('.sys')).toContainText('both like space');
  await expect(v.locator('.opener')).toHaveCount(3);
});

test('7 Me: hero, interests, colour row, This week (real), one primary', async ({ page }) => {
  const s = server({ presence: true }); await boot(page, s); await chats(page);
  await page.evaluate(() => globalThis.__vw.v4.refreshHud(globalThis.__fakeUser));
  await page.locator('#tabMe').click(); const m = page.locator('#v4Me'); await expect(m.locator('#mePriv')).toBeVisible({ timeout: 15_000 });
  await expect(m.locator('.meHero h2')).toHaveText('Vishnu'); await expect(m.locator('.chip:not(.add)')).toHaveCount(4); await expect(m.locator('.chip.add')).toHaveText('+ Add');
  await expect(m.locator('.colRow .swc')).toHaveCount(10); await expect(m.locator('.week')).toContainText('Met 4 agents');
  await expect(m.locator('.primary')).toHaveCount(1); await expect(m.locator('.primary')).toHaveText('Edit my agent');
  await m.evaluate((e) => { for (let n = e; n; n = n.parentElement) if (n.scrollHeight > n.clientHeight + 1) { n.scrollTop = n.scrollHeight; break; } }); await page.waitForTimeout(300);
  const [mt, tb] = [await m.locator('.meTools').boundingBox(), await page.locator('#tabs').boundingBox()]; expect(Math.abs(tb.y - (mt.y + mt.height) - 16)).toBeLessThan(1.5); // fix 4: exactly 16px
  await shot(page, '7-me');
});

// Server-side reactions (#59). Diggy: 18px badge on the sender's bottom corner, #16181F chip, accent when mine, white when only theirs.
const RX_SHOTS = globalThis.process?.env.RX_SHOTS;
const rxShot = async (page, n) => { if (RX_SHOTS) { await page.waitForTimeout(500); await page.screenshot({ path: `${RX_SHOTS}/${n}.png` }); } };
async function openPooja(page, s) { await boot(page, s); await chats(page); await page.locator('.fr[data-thread="t_p"] .frBtn').click();
  const v = page.locator('#dmView'); await expect(v.locator('.msg')).toHaveCount(3); await expect(v.locator('.dmPair img[src]')).toHaveCount(2, { timeout: 15_000 });
  await expect(v.locator('.dmMet')).toHaveText('Met 2 days ago · Both like space, music'); return v; }
const rxOf = (v, id) => v.locator(`.msg[data-id="${id}"] .rx`);

test('reactions: server hearts, optimistic toggle, sender-side badge, accent only when mine', async ({ page }) => {
  const s = server({ reactions: true }); s.rx.d = { others: 1, mine: false }; // Pooja hearted my message
  await page.addInitScript(() => localStorage.setItem('vw-rx', JSON.stringify(['t_p|c', 'junk', 7]))); // old local-only data
  const v = await openPooja(page, s);
  await expect(rxOf(v, 'd')).toHaveCount(1); await expect(rxOf(v, 'd')).not.toHaveClass(/mine/); await expect(rxOf(v, 'c')).toHaveCount(0); // server wins over old cache
  expect(await page.evaluate(() => globalThis.localStorage.getItem('vw-rx'))).toBeNull(); // old store removed once the server answers
  const st = await rxOf(v, 'd').evaluate((e) => { const c = globalThis.getComputedStyle(e), r = e.getBoundingClientRect(), p = e.parentElement.getBoundingClientRect(); return { bg: c.backgroundColor, color: c.color, h: r.height, right: Math.abs(r.right - p.right) < 8, below: r.bottom > p.bottom }; });
  expect(st).toEqual({ bg: 'rgb(22, 24, 31)', color: 'rgb(255, 255, 255)', h: 18, right: true, below: true });
  await rxShot(page, '2-my-bubble');
  // Double-tap theirs: filled accent right away (before the server answers), on their (left) corner.
  let release; s.gate = new Promise((r) => { release = r; });
  await page.route('**/threads/t_p/messages/b/react', async (r) => { await s.gate; return r.fallback(); });
  await v.locator('.msg[data-id="b"] p').dblclick();
  await expect(rxOf(v, 'b')).toHaveClass(/mine/); expect(await rxOf(v, 'b').evaluate((e) => globalThis.getComputedStyle(e).color)).toBe('rgb(123, 124, 255)');
  expect(await rxOf(v, 'b').evaluate((e) => e.offsetLeft)).toBeLessThanOrEqual(0); // their bubble: left corner (offsetLeft ignores the pop scale)
  expect(await rxOf(v, 'b').evaluate((e) => e.getAnimations().map((a) => a.animationName))).toEqual(['v4Heart']);
  release(); await expect.poll(() => s.reacts.length).toBe(1); expect(s.reacts[0]).toEqual({ mid: 'b', emoji: 'heart', on: true });
  await page.waitForTimeout(400); await rxShot(page, '1-both-sides');
  // Mine too on my bubble: count from the server.
  await v.locator('.msg[data-id="d"] p').dblclick(); await expect(rxOf(v, 'd').locator('b')).toHaveText('2'); await expect(rxOf(v, 'd')).toHaveClass(/mine/);
  await v.locator('.msg[data-id="d"] p').dblclick(); await expect(rxOf(v, 'd')).not.toHaveClass(/mine/); await expect(rxOf(v, 'd').locator('b')).toHaveCount(0);
  // Double-tap again removes mine.
  await v.locator('.msg[data-id="b"] p').dblclick(); await expect(rxOf(v, 'b')).toHaveCount(0); expect(s.reacts.at(-1)).toEqual({ mid: 'b', emoji: 'heart', on: false });
  expect(await page.evaluate(() => globalThis.localStorage.getItem('vw-rx'))).toBeNull();
});

test('reactions: roll back on failure, 429 copy, their-bubble shot', async ({ page }) => {
  const s = server({ reactions: true }); const v = await openPooja(page, s);
  s.rxFail = 500; await v.locator('.msg[data-id="b"] p').dblclick();
  await expect(v.locator('.dmNote')).toHaveText("Couldn't react. Try again."); await expect(rxOf(v, 'b')).toHaveCount(0);
  s.rxFail = 429; await v.locator('.msg[data-id="c"] p').dblclick();
  await expect(v.locator('.dmNote')).toContainText('Too many hearts'); await expect(rxOf(v, 'c')).toHaveCount(0);
  s.rxFail = 0; await v.locator('.msg[data-id="b"] p').dblclick(); await expect(rxOf(v, 'b')).toHaveClass(/mine/);
  await expect.poll(() => s.rx.b?.mine).toBe(true); await expect(v.locator('.dmNote')).toHaveText('');
  await expect(v.locator('.dmMet')).toHaveText('Met 2 days ago · Both like space, music'); // survives polls and reaction merges
  await page.waitForTimeout(400); await rxShot(page, '3-their-bubble');
});
