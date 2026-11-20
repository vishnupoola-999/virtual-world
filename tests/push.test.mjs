import assert from 'node:assert/strict';
import { once } from 'node:events';
import { describe, test } from 'node:test';
import { createServer } from '../proxy/server.js';
import {
  PUSH, applySent, dailyNote, dispatchPushes, fcmDropToken, groupLive, liveNote, localClock, momentsOnDay,
  planPush, quietHour, removeToken, tokenId, upsertToken,
} from '../proxy/push.js';

const TOKEN = `web${'a'.repeat(40)}`;
const AT_7PM = Date.parse('2026-11-07T13:30:00Z'); // 19:00 Asia/Kolkata
const AT_10PM = Date.parse('2026-11-07T16:30:00Z'); // 22:00
const AT_759 = Date.parse('2026-11-07T02:29:00Z'); // 07:59
const AT_8AM = Date.parse('2026-11-07T02:30:00Z'); // 08:00
const AT_530PM = Date.parse('2026-11-07T12:00:00Z'); // 17:30

function device(extra = {}) {
  return {
    enabled: true, timeZone: 'Asia/Kolkata',
    tokens: [{ id: tokenId(TOKEN), token: TOKEN, platform: 'web', updatedAt: 1 }],
    day: '', sent: 0, lastLiveAt: 0, dailySentOn: '', ...extra,
  };
}
const moment = {
  id: 'meet_h_0123456789abcdef0123_1', kind: 'meeting', weight: 3, createdAt: AT_7PM,
  text: 'I met Arjun. We both like tech.',
  refs: { meetingId: 'd1', otherAgentId: 'h_0123456789abcdef0123', otherAgentName: 'Arjun' },
};

describe('push caps, quiet hours, and copy', () => {
  test('quiet hours are 22:00–08:00 local and 7pm is the daily hour', () => {
    assert.equal(quietHour(localClock(AT_10PM, 'Asia/Kolkata').hour), true);
    assert.equal(quietHour(localClock(AT_759, 'Asia/Kolkata').hour), true);
    assert.equal(quietHour(localClock(AT_8AM, 'Asia/Kolkata').hour), false);
    assert.equal(localClock(AT_7PM, 'Asia/Kolkata').hour, PUSH.dailyHour);
    assert.equal(PUSH.maxPerDay, 3);
  });

  test('live is one an hour, counts toward 3 a day, and is not sent at night', () => {
    const live = { agentName: 'Pandu', otherName: 'Arjun', shared: ['tech'], momentId: moment.id, meetingId: 'd1' };
    const first = planPush({ now: AT_530PM, device: device(), live, moments: [] });
    assert.equal(first.kind, 'live');
    assert.equal(first.title, 'Pandu just met Arjun');
    assert.equal(first.body, "They're talking about tech. Tap to see.");
    assert.equal(first.data.momentId, moment.id);
    assert.equal(first.data.meetingId, 'd1');
    assert.equal(JSON.stringify(first).includes('6tMG'), false);
    const again = planPush({ now: AT_530PM + 60_000, device: applySent(device(), 'live', AT_530PM), live, moments: [] });
    assert.equal(again, null);
    const third = planPush({ now: AT_530PM + PUSH.liveGapMs, device: { ...applySent(device(), 'live', AT_530PM), sent: 3, day: localClock(AT_530PM, 'Asia/Kolkata').day }, live, moments: [] });
    assert.equal(third, null);
    assert.equal(planPush({ now: AT_10PM, device: device(), live, moments: [] }), null);
    const plain = liveNote({ agentName: 'Pandu', otherName: 'Arjun', shared: [] });
    assert.equal(plain.body, 'Tap to see.');
    assert.equal(/miss you|come back|don't forget/i.test(plain.body), false);
  });

  test('daily fires once in the 7pm hour only when a real moment exists', () => {
    assert.equal(planPush({ now: AT_7PM, device: device(), live: null, moments: [], agentName: 'Pandu' }), null);
    const note = planPush({ now: AT_7PM, device: device(), live: null, moments: [moment], agentName: 'Pandu' });
    assert.equal(note.kind, 'daily');
    assert.equal(note.title, 'Pandu had a day');
    assert.equal(note.body, 'Met Arjun and talked about tech. Tap to see.');
    const sent = applySent(device(), 'daily', AT_7PM);
    assert.equal(planPush({ now: AT_7PM + 15 * 60_000, device: sent, live: null, moments: [moment], agentName: 'Pandu' }), null);
    const friend = { ...moment, id: 'friend_h_0123456789abcdef0123', kind: 'friend', weight: 5, text: 'Arjun and I are friends now.' };
    assert.equal(momentsOnDay([moment, friend], AT_7PM, 'Asia/Kolkata').length, 2);
    assert.equal(dailyNote({ agentName: 'Pandu', moment: friend }).body, 'Met Arjun. Tap to see.');
    assert.equal(planPush({ now: AT_8AM, device: device(), live: null, moments: [moment], agentName: 'Pandu' }), null);
  });

  test('one tick keeps a single live ping per person', () => {
    const events = [
      { uid: 'a', at: 1, agentName: 'A', otherName: 'B', shared: [] },
      { uid: 'a', at: 2, agentName: 'A', otherName: 'C', shared: ['music'] },
      { uid: 'b', at: 2, agentName: 'B', otherName: 'A', shared: [] },
    ];
    const grouped = groupLive(events);
    assert.equal(grouped.length, 2);
    assert.equal(grouped.find((e) => e.uid === 'a').otherName, 'C');
  });

  test('an invalid FCM token is dropped and a good one still counts', async () => {
    const bad = `bad${'b'.repeat(40)}`;
    const dev = device({ tokens: [
      { id: tokenId(TOKEN), token: TOKEN, platform: 'android', updatedAt: 2 },
      { id: tokenId(bad), token: bad, platform: 'web', updatedAt: 1 },
    ] });
    const saved = [];
    await dispatchPushes({
      now: AT_530PM,
      live: [{ uid: 'owner', agentName: 'Pandu', otherName: 'Arjun', shared: ['tech'], momentId: moment.id, meetingId: 'd1', at: AT_530PM }],
      getDevice: async () => dev,
      listDevices: async () => [],
      send: async (token) => {
        if (token === bad) {
          const error = new Error('fcm 404');
          error.drop = fcmDropToken(404, { error: { status: 'NOT_FOUND', message: 'UNREGISTERED' } });
          throw error;
        }
      },
      save: async (uid, next) => saved.push({ uid, next }),
    });
    assert.equal(saved.length, 1);
    assert.equal(saved[0].next.tokens.length, 1);
    assert.equal(saved[0].next.tokens[0].token, TOKEN);
    assert.equal(saved[0].next.sent, 1);
    assert.equal(fcmDropToken(500, { error: { status: 'INTERNAL' } }), false);
    assert.equal(fcmDropToken(400, { error: { status: 'INVALID_ARGUMENT', message: 'The registration token is not a valid FCM registration token' } }), true);
    const gone = removeToken(dev, TOKEN);
    assert.equal(gone.tokens.some((t) => t.token === TOKEN), false);
    const added = upsertToken(null, { token: TOKEN, platform: 'android', enabled: true, timeZone: 'Asia/Kolkata', now: 5 });
    assert.equal(added.enabled, true);
    assert.equal(added.tokens[0].platform, 'android');
  });
});

describe('POST /me/push', () => {
  const ORIGIN = 'https://vishnupoola-999.github.io';
  test('auth, opt-in flag, and the token is not echoed', async () => {
    const saved = [];
    const lifeStore = {
      getPush: async () => saved[0] || null,
      savePush: async (uid, device) => { saved[0] = { uid, ...device }; },
    };
    const server = createServer({
      apiKey: 'k', admin: null, memory: null, lifeStore, fcm: null,
      rateLimiter: { allow: async () => true },
      verifyIdToken: async (token) => (token.endsWith('anon') ? { uid: 'a'.repeat(20), provider: 'anonymous' } : { uid: 'ownerUid000000000001', provider: 'google.com' }),
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}/me/push`;
    const headers = { Origin: ORIGIN, 'Content-Type': 'application/json', Authorization: 'Bearer x.y.good' };
    try {
      assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, Authorization: '' }, body: '{}' })).status, 401);
      assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, Authorization: 'Bearer x.y.anon' }, body: '{}' })).status, 403);
      const bad = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ token: TOKEN, platform: 'ios', enabled: true }) });
      assert.equal(bad.status, 400);
      const ok = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ token: TOKEN, platform: 'web', enabled: true, timeZone: 'Asia/Kolkata' }) });
      const body = await ok.json();
      assert.equal(ok.status, 200);
      assert.equal(body.enabled, true);
      assert.equal(body.count, 1);
      assert.equal(JSON.stringify(body).includes(TOKEN), false);
      assert.equal(saved[0].tokens[0].token, TOKEN);
      const off = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ token: TOKEN, platform: 'android', enabled: false }) });
      assert.equal((await off.json()).enabled, false);
      const del = await fetch(url, { method: 'DELETE', headers, body: JSON.stringify({ token: TOKEN }) });
      assert.equal((await del.json()).count, 0);
    } finally {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  });
});
