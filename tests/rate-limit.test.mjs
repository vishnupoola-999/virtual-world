import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { once } from 'node:events';
import { describe, test } from 'node:test';
import { createUidRateLimiter, rateWindowId } from '../proxy/rate-limit.js';
import { LIMITS, createServer, firebaseAdmin } from '../proxy/server.js';

const PROJECT_ID = 'virtual-world-8ac82';
const ORIGIN = 'https://vishnupoola-999.github.io';

function countingStore() {
  const docs = new Map();
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.includes(':commit')) {
      const body = JSON.parse(init.body);
      const name = body.writes[0].transform.document;
      const next = (docs.get(name) || 0) + 1;
      docs.set(name, next);
      return Response.json({ writeResults: [{ transformResults: [{ integerValue: String(next) }] }] });
    }
    const name = url.slice('https://firestore.googleapis.com/v1/'.length);
    if (!docs.has(name)) return new Response('{}', { status: 404 });
    return Response.json({ fields: { count: { integerValue: String(docs.get(name)) } } });
  };
  return { docs, calls, fetchImpl };
}

function adminOver(store, projectId = PROJECT_ID) {
  return {
    projectId,
    fetchImpl: store.fetchImpl,
    async accessToken() { return 'shared-admin-token'; },
  };
}

async function withServer(options, fn) {
  const { useAdminMemory, ...rest } = options;
  const server = createServer({
    apiKey: 'test-key',
    ...(useAdminMemory ? {} : { memory: null }),
    ...rest,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.closeIdleConnections();
    server.closeAllConnections();
    if (server.listening) {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  }
}

function chat(url, token) {
  return fetch(`${url}/chat`, {
    method: 'POST',
    headers: {
      Origin: ORIGIN,
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      agent: { name: 'Nova', personality: 'kind' },
      messages: [{ role: 'user', content: 'hi' }],
    }),
  });
}

describe('uid rate limiter', () => {
  test('counts a fixed window in Firestore and stops at the limit without another write', async () => {
    const store = countingStore();
    let now = 1_700_000_060_000;
    const limiter = createUidRateLimiter({
      admin: adminOver(store),
      now: () => now,
      limit: 6,
    });
    for (let i = 0; i < 6; i += 1) assert.equal(await limiter.allow('user_1'), true, `hit ${i}`);
    const commitsAtLimit = store.calls.filter((call) => call.url.includes(':commit'));
    assert.equal(commitsAtLimit.length, 6);
    assert.equal(await limiter.allow('user_1'), false);
    assert.equal(store.calls.filter((call) => call.url.includes(':commit')).length, 6);
    assert.equal(await limiter.allow('user_2'), true);
    const commits = store.calls.filter((call) => call.url.includes(':commit'));
    const windowId = rateWindowId(now, 60_000);
    assert.match(commits[0].init.body, new RegExp(`rateLimits/user_1/windows/${windowId}`));
    assert.equal(commits[0].init.headers.Authorization, 'Bearer shared-admin-token');
    now += 60_000;
    assert.equal(await limiter.allow('user_1'), true);
  });

  test('falls back to the in-memory window when Firestore cannot be reached', async () => {
    let hits = 0;
    const limiter = createUidRateLimiter({
      admin: {
        projectId: PROJECT_ID,
        async accessToken() { return 'tok'; },
        fetchImpl: async () => { hits += 1; throw new Error('down'); },
      },
      limit: 2,
      now: () => 1_700_000_000_000,
    });
    assert.equal(await limiter.allow('user_1'), true);
    assert.equal(await limiter.allow('user_1'), true);
    assert.equal(await limiter.allow('user_1'), false);
    assert.ok(hits >= 1);
  });

  test('does not call Firestore for an unsafe uid', async () => {
    let hits = 0;
    const limiter = createUidRateLimiter({
      admin: {
        projectId: PROJECT_ID,
        async accessToken() { hits += 1; return 'tok'; },
        fetchImpl: async () => { throw new Error('should not be called'); },
      },
    });
    assert.equal(await limiter.allow('../evil'), true);
    assert.equal(hits, 0);
  });
});

describe('durable limits across processes', () => {
  test('a new server still enforces the Firestore counter', async () => {
    const store = countingStore();
    const admin = adminOver(store);
    const verifyIdToken = async (token) => ({ uid: token.split('.')[0] });
    const fetchImpl = async () => Response.json({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
    const send = (url, uid) => chat(url, `${uid}.bbb.ccc`);
    await withServer({ admin, verifyIdToken, fetchImpl }, async (url) => {
      for (let i = 0; i < LIMITS.perUidPerMin; i += 1) {
        assert.equal((await send(url, 'userA')).status, 200, `request ${i}`);
      }
    });
    await withServer({ admin, verifyIdToken, fetchImpl }, async (url) => {
      const blocked = await send(url, 'userA');
      assert.equal(blocked.status, 429);
      assert.equal((await blocked.json()).error, 'rate limited');
      assert.equal((await send(url, 'userB')).status, 200);
    });
  });

  test('Firestore errors fall back to memory and still return 200 or 429', async () => {
    const admin = {
      projectId: PROJECT_ID,
      async accessToken() { return 'tok'; },
      fetchImpl: async () => { throw new Error('unavailable'); },
    };
    await withServer({
      admin,
      verifyIdToken: async () => ({ uid: 'user_1' }),
      fetchImpl: async () => Response.json({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
    }, async (url) => {
      for (let i = 0; i < LIMITS.perUidPerMin; i += 1) {
        assert.equal((await chat(url, 'aaa.bbb.ccc')).status, 200);
      }
      assert.equal((await chat(url, 'aaa.bbb.ccc')).status, 429);
    });
  });

  test('memory and the rate limiter share one admin access-token cache', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const sa = JSON.stringify({
      client_email: 'bot@p.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    });
    let oauth = 0;
    const fetchImpl = async (url, init = {}) => {
      if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
        oauth += 1;
        return Response.json({ access_token: 'at', expires_in: 3600 });
      }
      if (String(url).includes(':commit')) {
        return Response.json({ writeResults: [{ transformResults: [{ integerValue: '1' }] }] });
      }
      if (init.method === 'PATCH') return Response.json({});
      if (String(url).includes('/documents/rateLimits/')) return new Response('{}', { status: 404 });
      return Response.json({ fields: {} });
    };
    const admin = firebaseAdmin(
      { FIREBASE_SERVICE_ACCOUNT: sa, FIREBASE_PROJECT_ID: PROJECT_ID },
      fetchImpl,
    );
    assert.ok(admin);
    const pending = [];
    const gemini = [];
    await withServer({
      admin,
      useAdminMemory: true,
      pending,
      verifyIdToken: async () => ({ uid: 'user_1' }),
      fetchImpl: async (url, init) => {
        gemini.push(url);
        return Response.json({ candidates: [{ content: { parts: [{ text: 'Hello from Nova' }] } }] });
      },
    }, async (url) => {
      const response = await chat(url, 'aaa.bbb.ccc');
      assert.equal(response.status, 200);
      await Promise.all(pending);
    });
    assert.equal(oauth, 1);
    assert.equal(gemini.length, 2);
    assert.equal(gemini.some((url) => String(url).includes('oauth2')), false);
  });
});
