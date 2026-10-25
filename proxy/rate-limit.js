// Per-uid chat limits that survive a restart. Counters live in Firestore, one document
// per user per clock minute: rateLimits/{uid}/windows/m-{windowStartMs}, field `count`.
// Writes go through the proxy's existing Firebase admin client (the same service
// account and access-token cache as agent memory). That client bypasses security
// rules; firestore.rules denies the path to clients so they cannot reset a counter.
//
// If the admin client is missing, or Firestore cannot be reached, the in-process
// sliding window is used so a store outage does not turn into an open proxy.

const FIRESTORE_DB = encodeURIComponent(process.env.FIRESTORE_DATABASE_ID || 'default');
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const PROJECT_ID_RE = /^[a-z0-9-]{6,40}$/;

export function allowHit(map, key, limit, windowMs, now) {
  const hits = (map.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    map.set(key, hits);
    return false;
  }
  hits.push(now);
  map.set(key, hits);
  if (map.size > 5000) map.clear();
  return true;
}

export function rateWindowId(now, windowMs) {
  const start = now - (now % windowMs);
  return `m-${start}`;
}

export function rateLimitDocName(projectId, uid, windowId) {
  return `projects/${projectId}/databases/${FIRESTORE_DB}/documents/rateLimits/${uid}/windows/${windowId}`;
}

function integerField(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (!/^\d+$/.test(String(value))) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

function usableAdmin(admin) {
  return !!admin
    && typeof admin.accessToken === 'function'
    && typeof admin.fetchImpl === 'function'
    && typeof admin.projectId === 'string'
    && PROJECT_ID_RE.test(admin.projectId);
}

async function adminToken(admin) {
  const token = await admin.accessToken();
  if (typeof token !== 'string' || !token || /[\s]/.test(token)) throw new Error('admin token');
  return token;
}

async function firestoreFetch(admin, url, init = {}) {
  const token = await adminToken(admin);
  let response;
  try {
    response = await admin.fetchImpl(url, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers || {}),
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(2500),
    });
  } catch (error) {
    const reason = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'network';
    throw new Error(reason, { cause: error });
  }
  return response;
}

async function readCount(admin, docName) {
  const response = await firestoreFetch(admin, `https://firestore.googleapis.com/v1/${docName}`);
  if (response.status === 404) return 0;
  if (!response.ok) throw new Error(`firestore ${response.status}`);
  let json;
  try {
    json = await response.json();
  } catch {
    throw new Error('firestore bad json');
  }
  if (!json.fields?.count) return 0;
  const count = integerField(json.fields.count.integerValue);
  if (count == null) throw new Error('firestore bad count');
  return count;
}

async function increment(admin, docName) {
  const response = await firestoreFetch(
    admin,
    `https://firestore.googleapis.com/v1/projects/${admin.projectId}/databases/${FIRESTORE_DB}/documents:commit`,
    {
      method: 'POST',
      body: JSON.stringify({
        writes: [{
          transform: {
            document: docName,
            fieldTransforms: [{ fieldPath: 'count', increment: { integerValue: '1' } }],
          },
        }],
      }),
    },
  );
  if (!response.ok) throw new Error(`firestore ${response.status}`);
  let json;
  try {
    json = await response.json();
  } catch {
    throw new Error('firestore bad json');
  }
  const count = integerField(json.writeResults?.[0]?.transformResults?.[0]?.integerValue);
  if (count == null) throw new Error('firestore bad count');
  return count;
}

export function createUidRateLimiter(options = {}) {
  const uidHits = options.uidHits || new Map();
  const nowFn = options.now || Date.now;
  const admin = options.admin || null;
  const limit = options.limit ?? 6;
  const windowMs = options.windowMs ?? 60_000;

  return {
    async allow(uid) {
      const now = nowFn();
      if (!usableAdmin(admin) || !UID_RE.test(uid)) return allowHit(uidHits, uid, limit, windowMs, now);
      try {
        const docName = rateLimitDocName(admin.projectId, uid, rateWindowId(now, windowMs));
        const current = await readCount(admin, docName);
        if (current >= limit) return false;
        const next = await increment(admin, docName);
        return next <= limit;
      } catch (error) {
        console.error('rate limit store unavailable', String(error?.message || error).slice(0, 120));
        return allowHit(uidHits, uid, limit, windowMs, now);
      }
    },
  };
}
