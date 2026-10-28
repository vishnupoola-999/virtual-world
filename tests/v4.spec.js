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
function server({ presence = false } = {}) {
  const s = { polls: 0, posts: [], next: null, typing: [],
    feed: { myId: 'h_me', mine: [
      { id: 'm1', kind: 'meet', withId: 'h_b', withName: 'Bs', shared: ['tech', 'space'], note: 'Bs builds rockets too.', at: ago(90) },
      { id: 'm2', kind: 'meet', withId: 'h_m', withName: 'Meera', shared: ['music', 'sketching'], at: ago(60 * 26) },
      { id: 'm3', kind: 'meet', withId: 'h_p', withName: 'Pooja', shared: ['space', 'music'], at: ago(60 * 49) },
      { id: 'm9', kind: 'meet', withId: 'h_a', withName: 'Arjun', shared: ['space', 'cricket', 'robotics'], at: ago(60 * 3) }],
    incoming: [{ id: 'c1', fromAgentId: 'h_a', fromName: 'Arjun', text: 'Builds rockets out of bottles. You\'d get along.', meetId: 'm9', createdAt: ago(10), status: 'pending' }],
    outgoing: [{ id: 'o1', toAgentId: 'h_b', status: 'accepted', threadId: 't_b', createdAt: ago(80) }, { id: 'o2', toAgentId: 'h_m', status: 'declined', createdAt: ago(60 * 25) }] },
    threads: [{ id: 't_p', with: { id: 'h_p', name: 'Pooja', interests: ['space', 'music', 'books'], look: { creature: 'drip', accessory: 'none' } }, createdAt: ago(60 * 48), last: { text: 'Haha the telescope one was mine', from: 'them', at: ago(2) }, unread: 1, ...(presence ? { metAt: ago(60 * 49), sharedInterests: ['space', 'music'] } : {}) },
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
    const tm = p.match(/^\/threads\/([^/]+)\/typing$/); if (tm) { s.typing.push(tm[1]); return r.fulfill({ status: s.presence ? 204 : 404, body: '' }); }
    const mm = p.match(/^\/threads\/([^/]+)\/messages$/);
    if (mm && m === 'GET') { s.polls++; const after = +u.searchParams.get('after') || 0;
      return r.fulfill({ json: { threadId: mm[1], messages: (s.msgs[mm[1]] || []).filter((x) => x.at > after), more: false, ...(s.presence ? { typing: true, theirReadAt: Date.now() } : {}) } }); }
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
  await expect(page.locator('.ag.mine .pill')).toContainText('You');
  await expect(page.locator('#tabs .tab')).toHaveText(['World', 'Chats', 'Me']);
  await shot(page, '2-map');
  // Nothing real in the last day: no Today card.
  s.feed = { ...s.feed, mine: s.feed.mine.map((e) => ({ ...e, at: ago(60 * 30) })), incoming: [] };
  await page.evaluate(() => globalThis.__vw.town.fresh()); await page.evaluate(() => globalThis.__vw.v4.refreshHud(globalThis.__fakeUser)); await expect(page.locator('#v4Today')).toBeHidden();
});

test('3 chats sheet: Requests, Friends, Worth meeting (Connected / Hi sent), All caught up', async ({ page }) => {
  const s = server(); await boot(page, s); await chats(page);
  const secs = await page.locator('#agentChats > *').evaluateAll((e) => e.map((x) => x.className));
  expect(secs[0]).toContain('v4Sec'); await expect(page.locator('.reqCard')).toContainText('Arjun wants to say hi');
  await expect(page.locator('.frSec .fr')).toHaveCount(2); await expect(page.locator('.fr.un .udot')).toHaveCount(1); await expect(page.locator('.fr:not(.un) .udot')).toHaveCount(0);
  await expect(page.locator('.wmRow[data-with="h_b"] .connTag')).toHaveText('Connected · Open chat');
  await expect(page.locator('.wmRow[data-with="h_m"] .sentTag')).toHaveText('Hi sent');
  await expect(page.locator('.caught')).toHaveText('All caught up');
  expect(await page.locator('#agentChats').evaluate((e) => [...e.querySelectorAll('.capLbl,.reqCard,.caught')].map((x) => x.textContent.trim().split(' ')[0]))).toEqual(['Arjun', 'Friends', 'Worth', 'All']);
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
  await v.locator('.msg.them').first().dblclick(); await expect(v.locator('.msg.them').first().locator('.rx')).toHaveCount(1);
  s.next = 400; await v.locator('textarea').fill('call 98480 12345'); await v.locator('.dmSend').click();
  await expect(v.locator('.dmNote')).toHaveText("Links and contact details can't be shared here yet."); await expect(v.locator('textarea')).toHaveValue('call 98480 12345');
  await v.locator('textarea').fill('');
  expect(await page.evaluate(() => globalThis.getComputedStyle(globalThis.document.querySelector('.msg.me p')).backgroundImage)).toBe('none');
});

test('4b presence present: typing dots, Seen, metAt line', async ({ page }) => {
  const s = server({ presence: true }); await boot(page, s); await chats(page);
  await page.locator('.fr[data-thread="t_p"] .frBtn').click(); const v = page.locator('#dmView'); await expect(v.locator('.msg')).toHaveCount(3);
  await expect(v.locator('.dmMet')).toContainText('Met 2 days ago'); await expect(v.locator('.dmMet b')).toHaveText('space, music');
  await expect(v.locator('.dmTyping')).toBeVisible(); await expect(v.locator('.dmLive')).toHaveText('typing…');
  await expect(v.locator('.rcpt')).toContainText('Seen');
  await shot(page, '4-chat');
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
  const s = server(); await boot(page, s); await chats(page);
  await page.locator('#tabMe').click(); const m = page.locator('#v4Me');
  await expect(m.locator('.meHero h2')).toHaveText('Vishnu'); await expect(m.locator('.chip:not(.add)')).toHaveCount(4); await expect(m.locator('.chip.add')).toHaveText('+ Add');
  await expect(m.locator('.colRow .swc')).toHaveCount(10); await expect(m.locator('.week')).toContainText('Met 4 agents');
  await expect(m.locator('.primary')).toHaveCount(1); await expect(m.locator('.primary')).toHaveText('Edit my agent');
  await shot(page, '7-me');
});
