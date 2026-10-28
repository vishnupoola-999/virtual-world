/* global window, document, location, getComputedStyle, NodeFilter */
// connect-v1: Me -> Apps, app sheet, confirm cards, streaming replies. Backend mocked (shapes are unconfirmed);
// SSE is driven through a fetch stub so a test can hold a stream open mid-reply.
import { test, expect } from '@playwright/test';
const SHOTS = globalThis.process?.env.CX_SHOTS;
test.use({ timezoneId: 'Asia/Kolkata' }); // times in cards (13:42) are local
test.use({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3 });
const H = 3600e3;
const APPS = () => [
  { id: 'gdrive', name: 'Google Drive', state: 'connected', account: 'vishnu@gmail.com' },
  { id: 'gcal', name: 'Calendar', state: 'connected', account: 'vishnu@gmail.com', lastUsed: { at: Date.now() - 2 * H, summary: 'Added “Planetarium with Pooja”, Sun 11:00' } },
  { id: 'gmail', name: 'Gmail', state: 'connected' }, // #63: no sign-in, always on
  { id: 'notion', name: 'Notion', state: 'connect' },
  { id: 'spotify', name: 'Spotify', state: 'reauth', account: 'vishnu@gmail.com' }];
function server(o = {}) { return { apps: o.apps === undefined ? APPS() : o.apps, actions: {}, decisions: [], deletes: [], connects: [], confirms: [], confirm: 'ok', chatJson: o.chatJson || null }; }
const HIST = [['user', 'Hi'], ['assistant', 'Hi Vishnu, I am here.'], ['user', 'Anything fun nearby?'], ['assistant', 'Cubbon Park is lovely in the morning, and the metro gets you there in ten minutes.'],
  ['user', 'And this weekend?'], ['assistant', 'There is a food market on Church Street on Saturday from 10.'],
  ['user', 'Is it crowded?'], ['assistant', 'It gets busy after noon, so go early if you can. The stalls near the metro exit are the best ones.'],
  ['user', 'Thanks'], ['assistant', 'Any time. Tell me if you want me to plan the whole day.']].map(([role, content]) => ({ role, content }));

async function boot(page, s, { hist = [] } = {}) {
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));
  await page.addInitScript(({ hist }) => {
    localStorage.setItem('vw-arrive', new Date().toDateString());
    localStorage.setItem('vw-chat-u1', JSON.stringify(hist));
    // SSE stub for POST /agent/chat and /agent/chat/:id/continue (Buildy #62): window.__sse.mode = 'stream' | 'fail'.
    // Unset mode: requests go to the network (Playwright route), where /agent/chat is a 404 => old /chat JSON.
    const real = window.fetch.bind(window);
    window.__sse = { mode: null, ctl: null, calls: [], n: 0 };
    window.fetch = (u, o = {}) => {
      const url = String(u);
      if (!window.__sse.mode || !/\/agent\/chat(\/[^/]+\/(continue|stop))?$/.test(url)) return real(u, o);
      window.__sse.calls.push(url.split('.com')[1]);
      if (url.endsWith('/stop')) return Promise.resolve(new Response('{}', { headers: { 'content-type': 'application/json' } }));
      if (window.__sse.mode === 'fail') return Promise.reject(new TypeError('Failed to fetch'));
      const id = url.endsWith('/continue') ? url.split('/').at(-2) : 'm-' + (++window.__sse.n);
      const body = new ReadableStream({ start(c) { window.__sse.ctl = c; o.signal?.addEventListener('abort', () => { try { c.error(new DOMException('aborted', 'AbortError')); } catch { /* closed */ } }); } });
      return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream', 'x-message-id': id } }));
    };
    window.__ssePush = (ev, data) => window.__sse.ctl.enqueue(new TextEncoder().encode(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`));
    window.open = (url) => { (window.__opened ||= []).push(url); return null; };
  }, { hist });
  await page.route('https://firestore.googleapis.com/**', (r) => r.fulfill({ json: { documents: [] } }));
  await page.route('https://virtual-world-ai.onrender.com/**', async (r) => {
    const q = r.request(), p = new URL(q.url()).pathname, m = q.method();
    if (q.headers().authorization !== 'Bearer test-token') return r.fulfill({ status: 401, json: {} });
    if (p === '/apps' && m === 'GET') return s.apps ? r.fulfill({ json: s.apps }) : r.fulfill({ status: 404, json: {} });
    let x = p.match(/^\/apps\/([^/]+)\/connect$/); if (x && s.apps) { s.connects.push(x[1]); return r.fulfill({ json: { url: 'https://accounts.example.com/consent?app=' + x[1] } }); }
    x = p.match(/^\/apps\/([^/]+)\/confirm$/); if (x && m === 'POST' && s.apps) { s.confirms.push([x[1], q.postDataJSON().c]);
      if (s.confirm === 'missing') return r.fulfill({ status: 404, json: {} }); if (s.confirm !== 'ok') return r.fulfill({ status: 410, json: { error: 'gone' } });
      const a = s.apps.find((y) => y.id === x[1]); Object.assign(a, { state: 'connected', account: 'vishnu@gmail.com' }); return r.fulfill({ json: { state: 'connected', account: 'vishnu@gmail.com' } }); }
    x = p.match(/^\/apps\/([^/]+)$/); if (x && m === 'DELETE' && s.apps) { s.deletes.push(x[1]); const a = s.apps.find((y) => y.id === x[1]); if (a) { a.state = 'connect'; delete a.account; }
      const other = { gdrive: 'gcal', gcal: 'gdrive' }[x[1]], o = s.apps.find((y) => y.id === other); if (o?.state === 'connected') o.state = 'reauth'; // one Google grant
      return r.fulfill({ json: { state: 'connect', reauth: o ? [other] : [] } }); }
    x = p.match(/^\/actions\/([^/]+)$/); if (x && m === 'POST' && s.apps) { const d = q.postDataJSON().decision; s.decisions.push([x[1], d]);
      const want = s.actions[x[1]] || 'done'; if (want === 'hold') return; // never answers (Working… stays)
      return r.fulfill({ json: d === 'cancel' ? { state: 'cancelled' } : want === 'done' ? { state: 'done', result: { summary: 'Added', at: Date.parse('2026-10-28T13:42:00+05:30') } }
        : want === 'compose' ? { state: 'done', app: 'gmail', result: { summary: 'Ready in Gmail', at: Date.parse('2026-10-28T13:42:00+05:30'), link: 'https://mail.google.com/mail/?view=cm&to=pooja@example.com', mailto: 'mailto:pooja@example.com' } } : { state: want } }); }
    if (p === '/chat' && s.chatJson) return r.fulfill({ json: s.chatJson });
    return r.fulfill({ status: 404, json: {} });
  });
  await page.goto('/?onb=0#17.6/17.4504/78.3805/0/45', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__map?.loaded() && globalThis.__vw?.v4 && globalThis.__vw?.connect, null, { timeout: 45_000 });
  await page.evaluate(() => { globalThis.__fakeUser = globalThis.__vw.__testUser = { isAnonymous: false, uid: 'u1', getIdToken: async () => 'test-token' };
    globalThis.__vw.agent._preview({ name: 'Vishnu', lat: 17.4504, lon: 78.3805, look: { creature: 'sprout', accessory: 'none' }, interests: ['tech', 'space', 'music', 'science'], createdAt: Date.parse('2026-10-02') });
    globalThis.__vw.tabs.set('world'); });
}
const shot = async (page, n) => { if (SHOTS) { await page.waitForTimeout(700); await page.screenshot({ path: `${SHOTS}/${n}.png` }); } };
const openMe = async (page) => { await page.evaluate(() => globalThis.__vw.v4.refreshHud(globalThis.__fakeUser)); await page.locator('#tabMe').click(); await expect(page.locator('#v4Me .meHero')).toBeVisible(); };
const openChat = async (page) => { await openMe(page); await page.locator('#meTalk').click(); await expect(page.locator('#chatView')).toBeVisible(); await expect(page.locator('#chatLog .msg.sys').first()).toBeVisible(); };
const say = async (page, text) => { await page.locator('#chatIn').fill(text); await page.locator('#chatF button.send').click(); };

test('1 Me -> Apps: order, every tile state, count, footnote; whole tile opens the sheet', async ({ page }) => {
  const s = server(); await boot(page, s); await openMe(page);
  const box = page.locator('#meApps'); await expect(box).toBeVisible();
  await expect(box.locator('.tile .tn')).toHaveText(['Google Drivevishnu@gmail.com', 'Calendarvishnu@gmail.com', 'Gmail', 'Notion', 'Spotifyvishnu@gmail.com']);
  await expect(box.locator('.tile .acct')).toHaveCount(3); // the Google account on each signed-in tile
  await expect(box.locator('.tile .mk')).toHaveText(['D', 'C', 'M', 'N', 'S']);
  await expect(box.locator('.tile .st')).toHaveText(['Connected', 'Connected', 'Always on', 'Connect', 'Sign in again']);
  await expect(box.locator('.cxHead .meta')).toHaveText('3 of 5 connected');
  await expect(box.locator('.cxFoot')).toHaveText('Your agent always asks before it sends, pays or submits.');
  const t = await box.locator('.tile').first().evaluate((e) => { const c = getComputedStyle(e); return [e.getBoundingClientRect().height, c.backgroundColor, c.borderRadius]; });
  expect(t).toEqual([48, 'rgb(22, 24, 31)', '12px']);
  // Apps sits after Interests and before Privacy.
  expect(await page.locator('#v4Me').evaluate((m) => { const k = [...m.querySelectorAll('.capLbl,.cxApps .cap')].map((x) => x.textContent.trim().toLowerCase()); return [k.indexOf('interests') < k.indexOf('apps'), k.indexOf('apps') < k.indexOf('privacy')]; })).toEqual([true, true]);
  // Me sheet: last row (Colour) clears the tab pill (pill height + 16px padding).
  const clear = await page.locator('#v4Me').evaluate((m) => { const b = m.closest('.body'); b.scrollTop = b.scrollHeight; const last = [...m.querySelectorAll('*')].filter((e) => e.offsetHeight).at(-1).getBoundingClientRect().bottom; return document.getElementById('tabs').getBoundingClientRect().top - last; });
  expect(clear).toBeGreaterThanOrEqual(0);
  await page.locator('#v4Me').evaluate((m) => { m.closest('.body').scrollTop = 0; });
  await shot(page, '1-me-apps');
  // Gmail: always on, no Connect / Disconnect.
  await box.locator('.tile[data-app="gmail"]').click(); const sh = page.locator('#cxSheet'); await expect(sh).toHaveClass(/on/);
  await expect(sh.locator('.cxTop .meta')).toHaveText('● Always on · no sign-in'); await expect(sh.locator('button')).toHaveCount(0); expect(s.connects).toEqual([]);
});

test('Apps hidden without the API (404); chat falls back to the JSON reply; connect actions are dropped, never run', async ({ page }) => {
  const s = server({ apps: null, chatJson: { choices: [{ message: { content: 'Sure, here is a plan.' } }], actions: [{ id: 'a9', app: 'gcal', kind: 'write', summary: 'x', expiresAt: Date.now() + 9e5 }] } });
  await boot(page, s); await openMe(page);
  await page.waitForTimeout(500); await expect(page.locator('#meApps')).toBeHidden();
  await page.locator('#sheetClose').click(); await openChat(page);
  await say(page, 'Plan my Sunday');
  await expect(page.locator('#chatLog .msg.bot .agent-text').last()).toHaveText('Sure, here is a plan.', { timeout: 15_000 });
  await expect(page.locator('.cxCard')).toHaveCount(0); expect(s.decisions).toEqual([]);
});

test('2 connect sheet: plain-words lists, Connect -> Connecting… + consent tab, failure line, success flips to Connected', async ({ page }) => {
  const s = server(); s.apps[1] = { id: 'gcal', name: 'Calendar', state: 'connect' }; await boot(page, s); await openMe(page);
  await page.locator('#meApps .tile[data-app="gcal"]').click();
  const sh = page.locator('#cxSheet'); await expect(sh).toHaveClass(/on/);
  await expect(sh.locator('.cxTop h2')).toHaveText('Calendar'); await expect(sh.locator('.cxTop .meta')).toHaveText('Google · not connected');
  await expect(sh.locator('.cap')).toHaveText(['Your agent can read', 'Your agent can do', 'It never']);
  await expect(sh.locator('.li')).toHaveText(['✓Event titles, times and places on your calendars', '✓Who else is invited', '✓Suggest times that are free', '✓Add or move events, only after you tap Approve', '✕Deletes events or shares your calendar']);
  await expect(sh.locator('.primary')).toHaveText('Connect with Google Calendar'); await expect(sh.locator('.cxNote')).toHaveText('You can disconnect any time');
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('cxScrim')).backdropFilter)).toBe('none');
  await shot(page, '2-connect-sheet');
  await sh.locator('.primary').click();
  await expect(sh.locator('.primary')).toHaveText('Connecting…'); await expect(sh.locator('.primary')).toBeDisabled();
  await expect(page.locator('#meApps .tile[data-app="gcal"] .st')).toHaveText('Connecting…');
  await expect.poll(() => page.evaluate(() => globalThis.__opened)).toEqual(['https://accounts.example.com/consent?app=gcal']);
  await page.evaluate(() => { location.hash = '#/me?app=gcal&result=error'; });
  await expect(sh.locator('.cxErr')).toHaveText("Couldn't connect Calendar. Try again."); await expect(sh.locator('.primary')).toHaveText('Try again');
  await expect(page.locator('#meApps .tile[data-app="gcal"] .st')).toHaveText('Try again');
  // Only the server can say "connected": a success return re-reads GET /apps.
  // A stale / foreign confirm id (410) is a failure, not a connection.
  s.confirm = 'gone'; await sh.locator('.primary').click(); await page.evaluate(() => { location.hash = '#/me?app=gcal&result=ok&c=old'; });
  await expect(sh.locator('.cxErr')).toHaveText("Couldn't connect Calendar. Try again."); await expect(page.locator('#meApps .cxHead .meta')).toHaveText('2 of 5 connected');
  // Connected only after the authed POST /apps/:id/confirm {c}.
  s.confirm = 'ok'; await sh.locator('.primary').click();
  await page.evaluate(() => { location.hash = '#/me?app=gcal&result=ok&c=c123'; });
  await expect(sh.locator('.cxTop .meta')).toHaveText('● Connected · vishnu@gmail.com'); await expect(page.locator('#meApps .cxHead .meta')).toHaveText('3 of 5 connected');
  expect(s.confirms).toEqual([['gcal', 'old'], ['gcal', 'c123']]);
  await page.locator('#cxScrim').click({ position: { x: 20, y: 20 } }); await expect(sh).not.toHaveClass(/on/);
});

test('3 connected sheet: last used, Disconnect with inline confirm; expired asks to sign in again', async ({ page }) => {
  const s = server(); await boot(page, s); await openMe(page);
  await page.locator('#meApps .tile[data-app="gcal"]').click(); const sh = page.locator('#cxSheet'); await expect(sh).toHaveClass(/on/);
  await expect(sh.locator('.cxTop .meta')).toHaveText('● Connected · vishnu@gmail.com');
  await expect(sh.locator('.cxLast b')).toHaveText('Last used 2 hours ago'); await expect(sh.locator('.cxLast small')).toHaveText('Added “Planetarium with Pooja”, Sun 11:00');
  await expect(sh.locator('.cxAskDisc')).toHaveText('Disconnect Calendar'); await expect(sh.locator('.primary')).toHaveCount(0);
  await shot(page, '3-connected-sheet');
  await sh.locator('.cxAskDisc').click(); await expect(sh.locator('.cxConfirm p')).toHaveText('Disconnect? Your agent loses access straight away. Google signs out Drive and Calendar together, so you sign in to the other one again.');
  await expect(sh.locator('.primary')).toHaveCount(1); await sh.locator('.cxCancel').click(); await expect(sh.locator('.cxAskDisc')).toBeVisible(); expect(s.deletes).toEqual([]);
  await sh.locator('.cxAskDisc').click(); await sh.locator('.cxDisc').click();
  await expect(sh.locator('.primary')).toHaveText('Connect with Google Calendar'); expect(s.deletes).toEqual(['gcal']);
  await expect(page.locator('#meApps .tile[data-app="gdrive"] .st')).toHaveText('Sign in again'); // revoking one Google app revokes both
  await page.locator('#cxScrim').click({ position: { x: 20, y: 20 } }); await expect(page.locator('#cxScrim')).toBeHidden(); await page.locator('#meApps .tile[data-app="spotify"]').click();
  await expect(sh.locator('.cxTop .meta')).toHaveText('Sign-in expired'); await expect(sh.locator('.primary')).toHaveText('Sign in to Spotify again');
});

test('4 confirm cards: needs OK, done, error + Try again, sign-in expired; one Approve per action; cancel; expiry', async ({ page }) => {
  const exp = Date.now() + 15 * 60000;
  const acts = [{ id: 'c1', app: 'gcal', kind: 'write', title: 'Add event to Calendar', summary: 'Planetarium with Pooja\nSun 2 Nov · 11:00–13:00 · Invite pooja@…', expiresAt: exp },
    { id: 'c2', app: 'gcal', kind: 'write', title: 'Add event to Calendar', summary: 'Planetarium with Pooja', expiresAt: exp },
    { id: 'c3', app: 'gmail', kind: 'send', title: 'Send email to Pooja', summary: 'To pooja@example.com', expiresAt: exp },
    { id: 'c4', app: 'spotify', kind: 'write', title: 'Add to playlist', summary: 'Space Oddity', expiresAt: exp }];
  const s = server({ chatJson: { choices: [{ message: { content: '' } }], actions: acts } }); s.actions = { c2: 'done', c3: 'error', c4: 'reauth' };
  await boot(page, s, { hist: HIST.slice(0, 2) }); await page.evaluate(() => globalThis.__vw.connect.refresh()); await openChat(page);
  await say(page, 'Plan Sunday with Pooja');
  const card = (id) => page.locator(`.cxCard[data-action="${id}"]`);
  await expect(page.locator('.cxCard')).toHaveCount(4, { timeout: 15_000 });
  expect(s.decisions).toEqual([]); // nothing runs without a tap
  await expect(card('c1').locator('.cap')).toHaveText('Needs your OK'); await expect(card('c1').locator('.cxRow button')).toHaveText(['Cancel', 'Approve']);
  await card('c2').locator('.cxYes').dblclick(); await expect(card('c2').locator('.meta')).toHaveText('✓ Added · 13:42'); await expect(card('c2').locator('.cap')).toHaveText('Calendar');
  expect(s.decisions.filter((d) => d[0] === 'c2')).toEqual([['c2', 'approve']]); // second tap ignored
  await card('c3').locator('.cxYes').click(); await expect(card('c3').locator('.meta')).toHaveText("Couldn't send. Nothing went out."); await expect(card('c3').locator('.cxRetry')).toHaveText('Try again');
  expect(await card('c3').locator('.cxRetry').evaluate((b) => { const c = getComputedStyle(b); return [c.color, c.fontSize, c.fontWeight, b.getBoundingClientRect().height]; })).toEqual(['rgb(255, 255, 255)', '14px', '500', 44]);
  await card('c4').locator('.cxYes').click(); await expect(card('c4').locator('.cap')).toHaveText('Spotify · sign-in expired'); await expect(card('c4').locator('.cxReauth')).toHaveText('Sign in again');
  await page.locator('#chatLog').evaluate((l) => { l.scrollTop = l.scrollHeight; });
  await shot(page, '4-confirm-card');
  // Try again returns to needs-OK; it does not re-run on its own.
  const n = s.decisions.length; await card('c3').locator('.cxRetry').click(); await expect(card('c3').locator('.cxYes')).toHaveText('Approve'); expect(s.decisions.length).toBe(n);
  // Sign in again -> consent tab; back to needs-OK only after the app is connected again; never auto-runs.
  await card('c4').locator('.cxReauth').click(); await expect.poll(() => page.evaluate(() => globalThis.__opened?.at(-1) || '')).toContain('app=spotify');
  s.apps[4].state = 'connected'; await page.evaluate(() => { location.hash = '#/me?app=spotify&result=ok'; });
  await expect(card('c4').locator('.cxYes')).toHaveText('Approve'); expect(s.decisions.length).toBe(n);
  await card('c1').locator('.cxNo').click(); await expect(card('c1').locator('.meta')).toHaveText('Cancelled · nothing was sent'); expect(s.decisions.at(-1)).toEqual(['c1', 'cancel']);
  // Working…: both disabled while the server is busy.
  s.actions.c3 = 'hold'; await card('c3').locator('.cxYes').click(); await expect(card('c3').locator('.cxYes')).toHaveText('Working…'); await expect(card('c3').locator('.cxNo')).toBeDisabled();
});

test('4c Gmail action: Approve gives a Gmail compose link (and mailto), opened only on tap', async ({ page }) => {
  const s = server({ chatJson: { choices: [{ message: { content: 'Drafted it.' } }], actions: [{ id: 'g1', app: 'gmail', kind: 'send', title: 'Email Pooja', summary: 'To pooja@example.com', expiresAt: Date.now() + 9e5 }] } });
  s.actions.g1 = 'compose'; await boot(page, s, { hist: HIST.slice(0, 2) }); await page.evaluate(() => globalThis.__vw.connect.refresh()); await openChat(page);
  await say(page, 'Email Pooja'); const c = page.locator('.cxCard[data-action="g1"]'); await c.locator('.cxYes').click();
  await expect(c.locator('.cxOpen')).toHaveText('Open in Gmail'); await expect(c.locator('.cxMailto')).toHaveAttribute('href', 'mailto:pooja@example.com');
  expect(await page.evaluate(() => globalThis.__opened || [])).toEqual([]);
  await c.locator('.cxOpen').click(); await expect.poll(() => page.evaluate(() => globalThis.__opened?.at(-1))).toBe('https://mail.google.com/mail/?view=cm&to=pooja@example.com');
});

test('4b expired request: buttons removed, nothing sent', async ({ page }) => {
  const s = server({ chatJson: { choices: [{ message: { content: 'Here you go.' } }], actions: [{ id: 'e1', app: 'gmail', kind: 'send', title: 'Send email to Pooja', summary: 'x', expiresAt: Date.now() + 9000 }] } });
  await boot(page, s); await page.evaluate(() => globalThis.__vw.connect.refresh()); await openChat(page); await say(page, 'mail pooja');
  const c = page.locator('.cxCard'); await expect(c.locator('.cxYes')).toBeVisible({ timeout: 15_000 });
  await expect(c.locator('.meta')).toHaveText('This request expired. Ask again.', { timeout: 12_000 }); await expect(c.locator('button')).toHaveCount(0); expect(s.decisions).toEqual([]);
});

test('5 streaming: dots then words with caret, replying…, Stop button, follow bottom and Jump to latest', async ({ page }) => {
  const s = server(); await boot(page, s, { hist: HIST }); await openChat(page);
  await page.evaluate(() => { globalThis.__sse.mode = 'stream'; });
  await say(page, 'What can I do in Bengaluru this Sunday?');
  const b = page.locator('#chatLog .cxStream').last();
  await expect(b.locator('.cxDots i')).toHaveCount(3); await expect(page.locator('.cxStop')).toBeVisible(); await expect(page.locator('#chatF button.send')).toBeHidden();
  await expect(page.locator('#chatSub')).toHaveText('thinking…', { timeout: 3000 });
  await page.locator('#chatIn').fill('typing while it streams'); await expect(page.locator('#chatIn')).toHaveValue('typing while it streams'); await page.locator('#chatIn').fill('');
  await page.evaluate(() => { for (const w of 'Since you and Pooja both like space, the planetarium has a show at 11:00. After that, Cubbon Park is a short '.split(/(?<= )/)) globalThis.__ssePush('token', { t: w }); });
  await expect(b.locator('.agent-text')).toContainText('Cubbon Park is a short'); await expect(b.locator('.cxDots')).toHaveCount(0); await expect(b.locator('.caret')).toHaveCount(1);
  await expect(page.locator('#chatSub')).toHaveText('replying…');
  expect(await page.locator('#chatLog').evaluate((l) => l.scrollHeight - l.scrollTop - l.clientHeight)).toBeLessThanOrEqual(48);
  await page.locator('#chatLog').evaluate((l) => { l.scrollTop = Math.max(0, l.scrollTop - 52); l.dispatchEvent(new Event('scroll')); });
  await expect(page.locator('.cxJump')).toBeVisible(); await expect(page.locator('.cxJump')).toHaveText('↓ Jump to latest');
  // Chip sits 12px above the input bar.
  await expect.poll(() => page.evaluate(() => Math.round(document.getElementById('chatF').getBoundingClientRect().top - document.querySelector('.cxJump').getBoundingClientRect().bottom))).toBe(12);
  // Right edge, 16px in; static fade (no blur) behind the bar + chip, starting above the chip.
  await expect.poll(() => page.evaluate(() => { const c = document.querySelector('.cxJump').getBoundingClientRect(), f = document.querySelector('.cxFade'), fs = getComputedStyle(f), r = f.getBoundingClientRect();
    return [Math.round(globalThis.innerWidth - c.right), fs.opacity, fs.backdropFilter, fs.filter, r.top < c.top - 8, Math.round(r.bottom) === Math.round(document.getElementById('chatView').getBoundingClientRect().bottom), fs.pointerEvents]; }))
    .toEqual([16, '1', 'none', 'none', true, true, 'none']);

  // Shot: nearest scroll-up (>48px) where the chip covers no glyphs (it may sit over the fade or bubble padding).
  await page.locator('#chatLog').evaluate((l) => {
    const chip = document.querySelector('.cxJump'), max = l.scrollHeight - l.clientHeight;
    const clear = () => { const c = chip.getBoundingClientRect(), w = document.createTreeWalker(l, NodeFilter.SHOW_TEXT); let n;
      while ((n = w.nextNode())) { const rg = document.createRange(); rg.selectNodeContents(n); for (const r of rg.getClientRects()) if (r.right > c.left && r.left < c.right && r.bottom > c.top && r.top < c.bottom) return false; } return true; };
    for (let y = max - 50; y > max - 400 && y > 0; y -= 2) { l.scrollTop = y; if (clear()) break; }
    l.dispatchEvent(new Event('scroll'));
  });
  await shot(page, '5-streaming');
  // Back at the bottom by scrolling: both fade out with opacity, then the chip is hidden.
  await page.locator('#chatLog').evaluate((l) => { l.scrollTop = l.scrollHeight; l.dispatchEvent(new Event('scroll')); });
  await expect.poll(() => page.evaluate(() => [getComputedStyle(document.querySelector('.cxJump')).opacity, getComputedStyle(document.querySelector('.cxFade')).opacity])).toEqual(['0', '0']);
  await expect(page.locator('.cxJump')).toBeHidden();
  await page.locator('#chatLog').evaluate((l) => { l.scrollTop = Math.max(0, l.scrollTop - 52); l.dispatchEvent(new Event('scroll')); }); await expect(page.locator('.cxJump')).toBeVisible();
  await page.locator('.cxJump').click(); await expect(page.locator('.cxJump')).toBeHidden();
  await page.evaluate(() => { globalThis.__ssePush('token', { t: 'walk away.' }); globalThis.__ssePush('done', { messageId: 'm1' }); globalThis.__sse.ctl.close(); });
  await expect(b.locator('.agent-text')).toHaveText(/short walk away\.$/); await expect(b.locator('.caret')).toHaveCount(0);
  await expect(page.locator('.cxStop')).toBeHidden(); await expect(page.locator('#chatSub')).toHaveText('Online');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('vw-chat-u1')).at(-1).content)).toMatch(/walk away\.$/);
});

test('6 stopped, cut off, failed, rate limited: partial kept, one line each, Continue resumes, never saved as memory', async ({ page }) => {
  const s = server(); await boot(page, s, { hist: HIST.slice(0, 2) }); await openChat(page);
  await page.evaluate(() => { globalThis.__sse.mode = 'stream'; });
  await say(page, 'What can I do in Bengaluru this Sunday?');
  await page.evaluate(() => { for (const w of ['Since ', 'you ', 'and ', 'Pooja ', 'both ', 'like ', 'space, ', 'the ', 'planetarium ', 'has ', 'a ', 'show ', 'at ', '11:00. ', 'After ', 'that, ']) globalThis.__ssePush('token', { t: w }); });
  const b1 = page.locator('#chatLog .cxStream').nth(0); await expect(b1.locator('.agent-text')).toContainText('After that,');
  await page.locator('.cxStop').click();
  await expect(b1.locator('.cxLine')).toHaveText('Stopped · Continue'); await expect(b1.locator('.caret')).toHaveCount(0); await expect(b1.locator('.agent-text')).toHaveText(/After that,\s*$/);
  await expect.poll(() => page.evaluate(() => globalThis.__sse.calls)).toEqual(['/agent/chat', '/agent/chat/m-1/stop']);
  await say(page, 'Any good dosa places nearby?');
  await page.evaluate(() => { for (const w of ['Vidyarthi ', 'Bhavan ', 'in ', 'Basavanagudi ', 'is ']) globalThis.__ssePush('token', { t: w }); });
  const b2 = page.locator('#chatLog .cxStream').nth(1); await expect(b2.locator('.agent-text')).toContainText('Basavanagudi is');
  await page.evaluate(() => globalThis.__sse.ctl.close()); // stream ended without done
  await expect(b2.locator('.cxLine')).toHaveText('Reply cut off · Continue'); await expect(b2.locator('.cxLine')).toHaveClass(/e/);
  await page.evaluate(() => { globalThis.__sse.mode = 'fail'; });
  await say(page, 'And for dinner?');
  const b3 = page.locator('#chatLog .cxStream').nth(2);
  await expect(b3.locator('.agent-text')).toHaveText("Couldn't reach your agent. Check your connection."); await expect(b3.locator('.cxLine')).toHaveText('Tap to retry');
  await expect(page.locator('#chatBanner')).toBeHidden(); await expect(page.locator('#chatSub')).toHaveText('Online');
  const mem = await page.evaluate(() => JSON.parse(localStorage.getItem('vw-chat-u1')).map((m) => m.content).join('|'));
  expect(mem).not.toContain('Vidyarthi'); expect(mem).not.toContain('planetarium'); // partials are not memory
  await page.locator('#chatLog').evaluate((l) => { const c = l.querySelector('.cxStream'); l.scrollTop = c.offsetTop - 70; });
  await shot(page, '6-stream-stopped-error');
  // Continue (stopped) resumes the same message into the same bubble.
  await page.evaluate(() => { globalThis.__sse.mode = 'stream'; });
  await b1.locator('.cxLine button').click();
  await expect.poll(() => page.evaluate(() => globalThis.__sse.calls.at(-1))).toBe('/agent/chat/m-1/continue');
  await page.evaluate(() => { globalThis.__ssePush('token', { t: 'Cubbon Park is a short walk.' }); globalThis.__ssePush('done', { messageId: 'm-1' }); globalThis.__sse.ctl.close(); });
  await expect(b1.locator('.agent-text')).toHaveText(/After that, Cubbon Park is a short walk\.$/); await expect(b1.locator('.cxLine')).toHaveCount(0);
  // Continue (cut off) uses the cut-off message's id; rate limited gets its own line.
  await b2.locator('.cxLine button').click();
  await expect.poll(() => page.evaluate(() => globalThis.__sse.calls.at(-1))).toBe('/agent/chat/m-2/continue');
  await page.evaluate(() => { globalThis.__ssePush('error', { code: 'rate_limited', message: 'slow' }); globalThis.__sse.ctl.close(); });
  await expect(b2.locator('.cxLine')).toHaveText('Too many messages. Wait a minute · Try again');
  // Tap to retry on a failed reply replaces that bubble.
  await b3.locator('.cxLine button').click(); await page.evaluate(() => { globalThis.__ssePush('token', { t: 'Try Toit for dinner.' }); globalThis.__ssePush('done', { messageId: 'm-3' }); globalThis.__sse.ctl.close(); });
  await expect(page.locator('#chatLog .cxStream', { hasText: "Couldn't reach" })).toHaveCount(0);
  await expect(page.locator('#chatLog .cxStream').last().locator('.agent-text')).toHaveText('Try Toit for dinner.');
});
