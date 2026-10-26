// PR B: Requests (Accept/Decline), Chats list, private chat, Connected · Open chat, friend ring. Backend (#51) mocked.
import { test, expect } from '@playwright/test';
const SHOTS = globalThis.process?.env.CHAT_SHOTS;
test.use({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3 });
const ago = (m) => Date.now() - m * 60000;
const fv = (v) => typeof v === 'number' ? { doubleValue: v } : { stringValue: v };
const doc = (id, f) => ({ name: `projects/p/databases/default/documents/publicAgents/${id}`, fields: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fv(v)])) });
const AGENTS = { documents: [doc('h_me', { name: 'Bs', lat: 17.45, lon: 78.38 }), doc('h_v', { name: 'Vishnu', lat: 17.4508, lon: 78.3809 }), doc('h_m', { name: 'Mira', lat: 17.4502, lon: 78.3812 })] };
function server() {
  const s = { feed: { myId: 'h_me', mine: [{ id: 'm1', kind: 'meet', withId: 'h_m', withName: 'Mira', shared: ['music'], note: 'Mira loves live music like you.', at: ago(30) }],
    incoming: [{ id: 'c1', fromAgentId: 'h_v', fromName: 'Vishnu', text: 'Hi Bs, our agents had a lovely chat about rockets. Would love to connect.', createdAt: ago(5), status: 'pending' }],
    outgoing: [{ id: 'o1', toAgentId: 'h_m', createdAt: ago(20), status: 'accepted', threadId: 't_m' }] },
  threads: [{ id: 't_m', with: { id: 'h_m', name: 'Mira', interests: ['music', 'books'], look: null }, createdAt: ago(20), last: { text: 'See you at the gig', from: 'them', at: ago(15) }, unread: 1 }],
  msgs: { t_m: [{ id: 'a', from: 'system', fromId: 'system', text: 'Bs and Mira both like music.', at: ago(20) }, { id: 'b', from: 'them', fromId: 'h_m', text: 'See you at the gig', at: ago(15) }] }, posts: [], polls: 0, next: null };
  return s;
}
async function boot(page, s) {
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));
  await page.route('https://firestore.googleapis.com/**/publicAgents**', (r) => r.fulfill({ json: AGENTS }));
  await page.route('https://virtual-world-ai.onrender.com/**', async (r) => {
    const q = r.request(), u = new URL(q.url()), p = u.pathname, m = q.method();
    if (q.headers().authorization !== 'Bearer test-token') return r.fulfill({ status: 401, json: { error: 'auth' } });
    if (p === '/feed') return r.fulfill({ json: s.feed });
    if (p === '/connect/respond') { const b = q.postDataJSON(); const c = s.feed.incoming.find((x) => x.id === b.connectId);
      if (!c) return r.fulfill({ status: 404, json: { error: 'not found' } });
      if (b.action === 'decline') { c.status = 'declined'; return r.fulfill({ json: { connectId: c.id, status: 'declined' } }); }
      c.status = 'accepted'; c.threadId = 't_v'; s.threads.unshift({ id: 't_v', with: { id: 'h_v', name: 'Vishnu', interests: ['tech', 'space'], bio: '', look: null }, createdAt: Date.now(), last: { text: 'Bs and Vishnu both like tech and space.', from: 'system', at: Date.now() }, unread: 0 });
      s.msgs.t_v = [{ id: 'i', from: 'system', fromId: 'system', text: 'Bs and Vishnu both like tech and space.', at: Date.now() }];
      return r.fulfill({ json: { connectId: c.id, status: 'accepted', threadId: 't_v' } }); }
    if (p === '/threads') return r.fulfill({ json: { myId: 'h_me', threads: s.threads } });
    const mm = p.match(/^\/threads\/([^/]+)\/messages$/);
    if (mm && m === 'GET') { s.polls++; const after = +u.searchParams.get('after') || 0; return r.fulfill({ json: { threadId: mm[1], messages: (s.msgs[mm[1]] || []).filter((x) => x.at > after), more: false } }); }
    if (mm && m === 'POST') { const { text } = q.postDataJSON(); s.posts.push(text);
      if (s.next) { const n = s.next; s.next = null; return r.fulfill({ status: n, json: { error: n === 400 ? 'text not allowed' : 'rate limited' } }); }
      (s.msgs[mm[1]] ||= []).push({ id: 'p' + s.posts.length, from: 'me', fromId: 'h_me', text, at: Date.now() }); return r.fulfill({ status: 201, json: { ok: true } }); }
    return r.fulfill({ status: 404, json: { error: 'nope' } });
  });
  await page.goto('/?onb=0#18/17.4505/78.3805/0/50', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__map?.loaded() && globalThis.__vw?.town && globalThis.__vw?.threads, null, { timeout: 45_000 });
  await page.evaluate(() => { globalThis.__fakeUser = { isAnonymous: false, getIdToken: async () => 'test-token' };
    globalThis.__vw.agent._preview({ name: 'Bs', lat: 17.4505, lon: 78.3805, look: { creature: 'puff' } }); globalThis.__vw.tabs.set('world'); });
}
const openChats = async (page) => { await page.evaluate(() => globalThis.__vw.town.fresh()); await page.locator('#railAgent').click(); await page.evaluate(() => globalThis.__vw.town.loadActivity(globalThis.__fakeUser)); await expect(page.locator('#agentChats .fdSk')).toHaveCount(0); };
const shot = async (page, n) => { if (SHOTS) { await page.waitForTimeout(700); await page.screenshot({ path: `${SHOTS}/${n}.png` }); } };

test('requests, accept opens chat with intro, Chats list, connected card, friend ring', async ({ page }) => {
  const s = server(); await boot(page, s); await openChats(page);
  const sec = page.locator('.frSec'); await expect(sec.locator('.fr')).toHaveCount(1); await expect(sec).toContainText('Mira');
  await expect(page.locator('.wmSec').first()).toHaveClass(/frSec/); // Chats on top
  const req = page.locator('.inSec .inc'); await expect(req).toContainText('Vishnu'); await expect(req.locator('.accept')).toBeVisible(); await expect(req.locator('.cav')).toHaveCount(1);
  await expect(page.locator('.wm.conn .openChat')).toHaveText('Connected · Open chat');
  await shot(page, '1-agent-chats-requests');
  await req.locator('.accept').click();
  const v = page.locator('#dmView'); await expect(v).toBeVisible(); await expect(v.locator('.dmWho b')).toHaveText('Vishnu');
  await expect(v.locator('.dmPair .cav')).toHaveCount(2);
  const sys = v.locator('.sys'); await expect(sys).toContainText('Bs and Vishnu both like tech and space.'); await expect(sys.locator('.cav')).toHaveCount(2);
  await shot(page, '2-chat-intro');
  await v.locator('textarea').fill('Hey Vishnu, rockets this weekend?'); await v.locator('.dmSend').click();
  await expect(v.locator('.msg.me')).toContainText('rockets this weekend'); await shot(page, '3-chat-sent');
  await v.locator('.dmBack').click(); await expect(v).toBeHidden();
  await expect(page.locator('.frSec .fr')).toHaveCount(2); await expect(page.locator('.inSec')).toHaveCount(0); await shot(page, '4-chats-list');
  await page.evaluate(() => globalThis.__vw.town.refreshMap(globalThis.__fakeUser));
  await expect(page.locator('.ag.friend')).toHaveCount(2);
  if (SHOTS) { await page.keyboard.press('Escape'); await page.evaluate(() => globalThis.__map.jumpTo({ center: [78.381, 17.4506], zoom: 18.6 })); await page.waitForTimeout(1500); await shot(page, '7-map-friend-ring'); }
});

test('decline removes the card; null look falls back to a creature', async ({ page }) => {
  const s = server(); await boot(page, s); await openChats(page);
  await page.locator('.inc .decline').click(); await expect(page.locator('.inSec')).toHaveCount(0);
  expect(s.feed.incoming[0].status).toBe('declined');
  await expect(page.locator('.fr .cav')).toHaveAttribute('data-cr', /blob|puff|sprout|pebble|drip|mallow/);
});

test('blocked text keeps the draft and shows the note; 429 fades send; polling stops when closed', async ({ page }) => {
  const s = server(); await boot(page, s); await openChats(page);
  await page.locator('.wm.conn .openChat').click(); const v = page.locator('#dmView'); await expect(v.locator('.msg.them')).toHaveCount(1);
  s.next = 400; await v.locator('textarea').fill('call me on 98480 12345'); await v.locator('.dmSend').click();
  await expect(v.locator('.dmNote')).toHaveText("Links and contact details can't be shared here yet."); await expect(v.locator('textarea')).toHaveValue('call me on 98480 12345');
  await shot(page, '5-chat-blocked');
  s.next = 429; await v.locator('textarea').fill('ok sorry, see you there'); await v.locator('.dmSend').click();
  await expect(v.locator('.dmNote')).toHaveText('Slow down a little, try again in a minute'); await expect(v.locator('.dmSend')).toBeDisabled(); await expect(v).toHaveClass(/cool/);
  await expect(v.locator('textarea')).toHaveValue('ok sorry, see you there'); await shot(page, '6-chat-slow');
  await v.locator('.dmBack').click(); const n = s.polls; await page.waitForTimeout(5000); expect(s.polls).toBe(n);
});
