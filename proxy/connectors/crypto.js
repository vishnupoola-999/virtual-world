// Connector crypto: signed OAuth state and at-rest encryption for refresh tokens.
// CONNECTOR_TOKEN_KEY is 32 bytes as base64 or 64 hex chars. It never leaves the proxy.
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

export function parseKey(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const s = raw.trim();
  const buf = /^[0-9a-f]{64}$/i.test(s) ? Buffer.from(s, 'hex') : Buffer.from(s, 'base64');
  return buf.length === 32 ? buf : null;
}
// Separate subkeys so the state MAC key is never the encryption key.
const sub = (key, label) => Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), `vw-connectors-${label}`, 32));

const STATE_TTL_MS = 10 * 60_000;
// state = base64url(json).base64url(hmac). Payload binds uid, provider, apps and a nonce.
export function signState(key, { uid, provider, apps, ret }, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ u: uid, p: provider, a: apps, r: ret || '', n: randomBytes(12).toString('base64url'), t: now })).toString('base64url');
  const mac = createHmac('sha256', sub(key, 'state')).update(body).digest('base64url');
  return `${body}.${mac}`;
}
export function verifyState(key, state, now = Date.now()) {
  if (typeof state !== 'string' || state.length > 2048) return null;
  const [body, mac, extra] = state.split('.');
  if (!body || !mac || extra !== undefined) return null;
  const want = createHmac('sha256', sub(key, 'state')).update(body).digest();
  let got;
  try { got = Buffer.from(mac, 'base64url'); } catch { return null; }
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (!p || typeof p.u !== 'string' || typeof p.p !== 'string' || !Array.isArray(p.a)) return null;
  if (!Number.isFinite(p.t) || now - p.t > STATE_TTL_MS || p.t - now > 60_000) return null;
  return { uid: p.u, provider: p.p, apps: p.a, ret: p.r || '' };
}

// AES-256-GCM, uid as associated data so a ciphertext copied to another user's doc will not decrypt.
export function encrypt(key, plain, aad) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', sub(key, 'enc'), iv);
  c.setAAD(Buffer.from(String(aad)));
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `v1.${iv.toString('base64url')}.${ct.toString('base64url')}.${c.getAuthTag().toString('base64url')}`;
}
export function decrypt(key, blob, aad) {
  const [v, iv, ct, tag] = String(blob || '').split('.');
  if (v !== 'v1' || !iv || !ct || !tag) throw new Error('bad ciphertext');
  const d = createDecipheriv('aes-256-gcm', sub(key, 'enc'), Buffer.from(iv, 'base64url'));
  d.setAAD(Buffer.from(String(aad)));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}
