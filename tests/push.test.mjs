// Registration and token delivery. No OS permission prompt and no live FCM send.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  CHANNEL_ID,
  PUSH_URL,
  SNOOZE_MS,
  classifyPushResponse,
  createPushClient,
  deckForMeeting,
  mountPushStub,
  pushTarget,
  shouldOfferPush,
  tokenBody,
} from '../src/push.js';

function storage() {
  const bag = new Map();
  return {
    getItem: (k) => (bag.has(k) ? bag.get(k) : null),
    setItem: (k, v) => { bag.set(k, String(v)); },
    removeItem: (k) => { bag.delete(k); },
  };
}

function user(uid = 'user-1', extra = {}) {
  return { uid, isAnonymous: false, getIdToken: async () => `id.${uid}`, ...extra };
}

function bridge() {
  const listeners = {};
  const calls = [];
  return {
    platform: 'android',
    calls,
    listeners,
    requestPermissions: async () => { calls.push('request'); return 'granted'; },
    checkPermissions: async () => { calls.push('check'); return 'granted'; },
    register: async () => { calls.push('register'); },
    unregister: async () => { calls.push('unregister'); },
    createChannel: async (channel) => { calls.push(['channel', channel]); },
    addListener(event, cb) {
      (listeners[event] ||= []).push(cb);
      return { remove() {} };
    },
    emit(event, data) {
      for (const cb of listeners[event] || []) cb(data);
    },
  };
}

function http(status = 200) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: JSON.parse(init.body) });
    return { status };
  };
  return { calls, fetchImpl };
}

const settled = () => new Promise((resolve) => { setTimeout(resolve, 0); });

function client(extra = {}) {
  const store = extra.storage || storage();
  const native = extra.bridge === undefined ? bridge() : extra.bridge;
  const net = extra.net || http(200);
  const opened = [];
  const offers = [];
  const api = createPushClient({
    storage: store,
    fetchImpl: net.fetchImpl,
    now: extra.now || (() => 1_700_000_000_000),
    getUser: extra.getUser || (() => null),
    bridge: native,
    openRecap: (target) => {
      if (extra.ready === false) return false;
      opened.push(target);
      return true;
    },
    blocked: extra.blocked || (() => false),
    onOffer: () => { offers.push(1); },
  });
  return { api, store, native, net, opened, offers };
}

describe('push opt-in gate', () => {
  test('the sheet is due only when signed in, supported, and not snoozed or already on', () => {
    const base = { signedIn: true, anonymous: false, enabled: false, notNowUntil: 0, now: 100 };
    assert.equal(shouldOfferPush(base), true);
    assert.equal(shouldOfferPush({ ...base, signedIn: false }), false);
    assert.equal(shouldOfferPush({ ...base, anonymous: true }), false);
    assert.equal(shouldOfferPush({ ...base, enabled: true }), false);
    assert.equal(shouldOfferPush({ ...base, notNowUntil: 101 }), false);
    assert.equal(shouldOfferPush({ ...base, notNowUntil: 100 }), true);
  });

  test('Not now stores a timestamp 7 days out and hides the next offer', () => {
    const now = 1_700_000_000_000;
    const { api, store } = client({ now: () => now, getUser: () => user() });
    api.onAuth(user(), { restored: false });
    const until = api.snooze();
    assert.equal(until, now + SNOOZE_MS);
    assert.equal(store.getItem('vw-push-not-now-until:user-1'), String(until));
    api.onRecapEnd();
    assert.equal(api.maybeOffer(), false);
    assert.equal(api.shouldOffer(), false);
  });

  test('a fresh sign-in offers once, and a blocked offer waits', () => {
    let blocked = true;
    const { api, offers } = client({ blocked: () => blocked, getUser: () => user() });
    api.onAuth(user(), { restored: true });
    assert.equal(api.maybeOffer(), false);
    assert.equal(offers.length, 0);
    api.onAuth(user(), { restored: false });
    assert.equal(api.maybeOffer(), false);
    assert.equal(offers.length, 0);
    blocked = false;
    assert.equal(api.maybeOffer(), true);
    assert.equal(offers.length, 1);
    assert.equal(api.maybeOffer(), false);
  });

  test('the recap end card is an offer moment for a restored session', () => {
    const { api, offers } = client({ getUser: () => user() });
    api.onAuth(user(), { restored: true });
    assert.equal(api.onRecapEnd(), true);
    assert.equal(offers.length, 1);
  });
});

describe('push registration', () => {
  test('load and session restore never request permission', async () => {
    const { api, native, net } = client({ getUser: () => user() });
    api.onAuth(user(), { restored: true });
    await Promise.resolve();
    assert.deepEqual(native.calls, []);
    assert.equal(net.calls.length, 0);
    assert.equal(native.listeners.registration?.length, 1);
  });

  test('enablePush asks, registers, and posts the token with the Firebase ID token', async () => {
    const { api, native, net, store } = client({ getUser: () => user() });
    api.onAuth(user(), { restored: true });
    const result = await api.enablePush();
    assert.deepEqual(result, { ok: true, reason: 'granted' });
    assert.equal(native.calls[0], 'request');
    assert.equal(native.calls.includes('check'), false);
    assert.equal(native.calls.includes('register'), true);
    assert.deepEqual(native.calls.find((c) => Array.isArray(c)), ['channel', {
      id: CHANNEL_ID, name: 'Virtual World', description: 'Daily recap and meetings', importance: 3,
    }]);
    assert.equal(store.getItem('vw-push-enabled:user-1'), '1');
    assert.equal(net.calls.length, 0);
    native.emit('registration', { value: 'fcm-1' });
    await settled();
    assert.equal(net.calls.length, 1);
    assert.equal(net.calls[0].url, PUSH_URL);
    assert.equal(net.calls[0].method, 'POST');
    assert.equal(net.calls[0].headers.Authorization, 'Bearer id.user-1');
    assert.deepEqual(net.calls[0].body, { token: 'fcm-1', platform: 'android' });
    assert.equal(store.getItem('vw-push-token:user-1'), 'fcm-1');
  });

  test('a token before Turn on is not sent', async () => {
    const { api, native, net } = client({ getUser: () => user() });
    api.onAuth(user(), { restored: true });
    native.emit('registration', { value: 'fcm-early' });
    await settled();
    assert.equal(net.calls.length, 0);
  });

  test('the same token is not posted twice, and a refresh is', async () => {
    const { api, native, net } = client({ getUser: () => user() });
    api.onAuth(user(), { restored: false });
    await api.enablePush();
    native.emit('registration', { value: 'fcm-1' });
    native.emit('registration', { value: 'fcm-1' });
    native.emit('registration', { value: 'fcm-2' });
    await settled();
    assert.deepEqual(net.calls.map((c) => c.body.token), ['fcm-1', 'fcm-2']);
  });

  test('a missing route is ignored and the token is kept for a later try', async () => {
    const net = http(404);
    const { api, native, store } = client({ net, getUser: () => user() });
    api.onAuth(user(), { restored: false });
    await api.enablePush();
    native.emit('registration', { value: 'fcm-1' });
    await settled();
    assert.equal(net.calls.length, 1);
    assert.equal(store.getItem('vw-push-token:user-1'), 'fcm-1');
    assert.equal(store.getItem('vw-push-enabled:user-1'), '1');
  });

  test('a network failure does not throw or clear the opt-in', async () => {
    const { api, native, store } = client({
      getUser: () => user(),
      net: { fetchImpl: async () => { throw new Error('offline'); } },
    });
    api.onAuth(user(), { restored: false });
    assert.deepEqual(await api.enablePush(), { ok: true, reason: 'granted' });
    native.emit('registration', { value: 'fcm-1' });
    await settled();
    assert.equal(store.getItem('vw-push-enabled:user-1'), '1');
    assert.equal(store.getItem('vw-push-token:user-1'), null);
  });

  test('a restored session with opt-in refreshes the token without prompting', async () => {
    const store = storage();
    store.setItem('vw-push-enabled:user-1', '1');
    const { api, native } = client({ storage: store, getUser: () => user() });
    api.onAuth(user(), { restored: true });
    await settled();
    assert.equal(native.calls.includes('request'), false);
    assert.equal(native.calls.includes('check'), true);
    assert.equal(native.calls.includes('register'), true);
  });

  test('denied permission does not register', async () => {
    const native = bridge();
    native.requestPermissions = async () => { native.calls.push('request'); return 'denied'; };
    const { api, net, store } = client({ bridge: native, getUser: () => user() });
    api.onAuth(user(), { restored: false });
    assert.deepEqual(await api.enablePush(), { ok: false, reason: 'denied' });
    assert.equal(native.calls.includes('register'), false);
    assert.equal(net.calls.length, 0);
    assert.equal(store.getItem('vw-push-enabled:user-1'), null);
  });

  test('signed out and non-Android never request permission', async () => {
    const signedOut = client({ getUser: () => null });
    assert.deepEqual(await signedOut.api.enablePush(), { ok: false, reason: 'signed-out' });
    assert.equal(signedOut.native.calls.includes('request'), false);
    const web = client({ bridge: null, getUser: () => user() });
    web.api.onAuth(user(), { restored: false });
    assert.deepEqual(await web.api.enablePush(), { ok: false, reason: 'unsupported' });
    assert.equal(web.api.onRecapEnd(), false);
    assert.equal(web.api.supported(), false);
  });

  test('sign-out deletes the token and unregisters, even if the delete fails', async () => {
    const { api, native, net, store } = client({ getUser: () => user() });
    const u = user();
    api.onAuth(u, { restored: false });
    await api.enablePush();
    native.emit('registration', { value: 'fcm-1' });
    await settled();
    await api.forget(u);
    const del = net.calls.find((c) => c.method === 'DELETE');
    assert.equal(del.url, PUSH_URL);
    assert.equal(del.headers.Authorization, 'Bearer id.user-1');
    assert.deepEqual(del.body, { token: 'fcm-1', platform: 'android' });
    assert.equal(native.calls.includes('unregister'), true);
    assert.equal(store.getItem('vw-push-token:user-1'), null);
    assert.equal(store.getItem('vw-push-enabled:user-1'), '1');

    const failing = client({
      getUser: () => user('user-2'),
      net: { fetchImpl: async () => { throw new Error('offline'); } },
      storage: (() => {
        const s = storage();
        s.setItem('vw-push-token:user-2', 'fcm-2');
        s.setItem('vw-push-enabled:user-2', '1');
        return s;
      })(),
    });
    await failing.api.forget(user('user-2'));
    assert.equal(failing.store.getItem('vw-push-token:user-2'), null);
    assert.equal(failing.native.calls.includes('unregister'), true);
  });
});

describe('push tap', () => {
  test('recap and meeting payloads, and junk, are classified', () => {
    assert.deepEqual(pushTarget({ type: 'recap' }), { type: 'recap' });
    assert.deepEqual(pushTarget({ notification: { data: { type: 'meeting', meetingId: 'meet_1' } } }), {
      type: 'meeting', meetingId: 'meet_1',
    });
    assert.deepEqual(pushTarget({ type: 'meeting', momentId: 'moment_9' }), { type: 'meeting', meetingId: 'moment_9' });
    assert.deepEqual(pushTarget({ type: 'meeting' }), { type: 'recap' });
    assert.equal(pushTarget({ type: 'other' }), null);
    assert.equal(pushTarget('{"type":"recap"}').type, 'recap');
    assert.equal(tokenBody('  fcm  ', 'android').token, 'fcm');
    assert.equal(tokenBody('fcm', 'ios'), null);
    assert.equal(classifyPushResponse(204), 'ok');
    assert.equal(classifyPushResponse(405), 'pending');
    assert.equal(classifyPushResponse(401), 'auth');
    assert.equal(classifyPushResponse(500), 'error');
  });

  test('a meeting tap opens at that card and waits until the app can show it', () => {
    const moments = [
      { id: 'a', meetingId: 'm-a' },
      { id: 'b', meetingId: 'm-b' },
      { id: 'c', meetingId: 'm-c' },
    ];
    assert.deepEqual(deckForMeeting(moments, 'm-b').map((m) => m.id), ['b', 'c']);
    assert.equal(deckForMeeting(moments, 'missing').length, 3);
    assert.equal(deckForMeeting(moments, '../x').length, 3);

    const held = client({ ready: false, getUser: () => user() });
    held.api.onAuth(user(), { restored: true });
    held.native.emit('pushNotificationActionPerformed', { notification: { data: { type: 'meeting', meetingId: 'm-b' } } });
    assert.equal(held.opened.length, 0);
    held.api.flush();
    assert.equal(held.opened.length, 0);
    const ready = client({ getUser: () => user() });
    ready.api.onAuth(user(), { restored: true });
    ready.native.emit('pushNotificationActionPerformed', { type: 'recap' });
    assert.deepEqual(ready.opened, [{ type: 'recap' }]);
  });

  test('the stub Turn on registers and Not now only snoozes', async () => {
    const { api, native, store } = client({ getUser: () => user() });
    api.onAuth(user(), { restored: false });
    const buttons = [];
    const dialog = {
      id: '',
      dataset: {},
      open: false,
      children: [],
      setAttribute() {},
      append(...kids) { this.children.push(...kids); },
      close() { this.open = false; },
      showModal() { this.open = true; },
    };
    const doc = {
      body: { append() {} },
      createElement() {
        const node = {
          dataset: {},
          type: '',
          textContent: '',
          listeners: {},
          setAttribute() {},
          addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
        };
        buttons.push(node);
        return buttons.length === 1 ? dialog : node;
      },
    };
    const stub = mountPushStub(doc, api);
    stub.show();
    assert.equal(dialog.open, true);
    assert.equal(dialog.dataset.stub, 'push-opt-in');
    assert.equal(dialog.dataset.owner, 'diggy');
    const later = buttons.find((b) => b.dataset.act === 'later');
    const turnOn = buttons.find((b) => b.dataset.act === 'on');
    later.listeners.click[0]();
    assert.equal(dialog.open, false);
    assert.equal(native.calls.includes('request'), false);
    assert.ok(Number(store.getItem('vw-push-not-now-until:user-1')) > 0);
    store.removeItem('vw-push-not-now-until:user-1');
    turnOn.listeners.click[0]();
    await settled();
    assert.equal(native.calls.includes('request'), true);
    assert.equal(native.calls.includes('register'), true);
  });
});
