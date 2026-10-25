/* global window, document */
import { test, expect } from '@playwright/test';

// Interests step (onboarding 5 of 6): Continue stays pinned and tappable on a 360x640 phone.
test.use({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });

async function openInterests(page) {
  await page.goto('/?onb=0', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__vw?.onb);
  await page.evaluate(() => window.__vw.onb.open(5));
  await expect(page.locator('#intGrid')).toBeVisible();
}

test('Continue is visible and tappable after picking 6+ interests', async ({ page }) => {
  await openInterests(page);
  const chips = page.locator('#intGrid .chip');
  for (let i = 0; i < 6; i++) await chips.nth(i).tap();
  await expect(page.locator('#intGrid .chip[aria-pressed=true]')).toHaveCount(5); // max 5; the 6th tap is ignored
  const go = page.locator('#intNext');
  await expect(go).toBeEnabled();
  await expect(go).toBeInViewport({ ratio: 1 });
  const box = await go.boundingBox();
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id, [box.x + box.width / 2, box.y + box.height / 2]);
  expect(hit).toBe('intNext');
  if (process.env.SHOTS) await page.screenshot({ path: '/workspace/shots/continue-closed.png' });
  await go.tap();
  await expect(page.locator('#onb')).toHaveAttribute('data-step', '6');
});

// Signed-in accounts. Firebase Auth and Firestore are stubbed so the real app decides
// from the agent document. The life-loop fallback (exploring / meeting people) is not stored.
const E2E_UID = 'e2e-user';

const AUTH_MOCK = `
const user = {
  uid: ${JSON.stringify(E2E_UID)},
  displayName: 'Test User',
  email: 'test@example.com',
  photoURL: '',
  providerData: [{ providerId: 'google.com' }],
  getIdToken: async () => 'e2e-token',
};
const auth = { currentUser: user };
export function initializeAuth() { return auth; }
export const indexedDBLocalPersistence = {};
export const browserLocalPersistence = {};
export const browserPopupRedirectResolver = {};
export class GoogleAuthProvider {
  setCustomParameters() {}
  addScope() {}
  static credential() { return {}; }
  static credentialFromResult() { return { accessToken: 'e2e' }; }
}
export function signInWithPopup() { return Promise.resolve({ user }); }
export function signInWithRedirect() { return Promise.resolve(); }
export function reauthenticateWithPopup() { return Promise.resolve({ user }); }
export function linkWithPopup() { return Promise.resolve({ user }); }
export function signInWithCredential() { return Promise.resolve({ user }); }
export function getRedirectResult() { return Promise.resolve(null); }
export function onAuthStateChanged(_auth, cb) {
  queueMicrotask(() => cb(auth.currentUser));
  return () => {};
}
export function signOut() { auth.currentUser = null; return Promise.resolve(); }
`;

const FIRESTORE_MOCK = `
export function getFirestore() { return {}; }
export function doc(_db, _col, id) { return { id }; }
export function collection() { return {}; }
export function query() { return {}; }
export function orderBy() { return {}; }
export function limit() { return {}; }
export function serverTimestamp() { return 'e2e-time'; }
export async function updateDoc(_ref, data) {
  const res = await fetch('/__e2e/interests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ interests: data.interests, bio: data.bio || '' }),
  });
  if (!res.ok) throw Object.assign(new Error('save failed'), { code: 'unavailable' });
}
export async function setDoc() {}
export async function getDoc() { return { exists: () => false, data: () => ({}) }; }
export async function getDocs() { return { docs: [] }; }
export async function addDoc() { return { id: 'e2e' }; }
export async function deleteDoc() {}
`;

function restVal(v) {
  if (v == null) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(restVal) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, val]) => [k, restVal(val)])) } };
}

function agentDocument(state) {
  const fields = {
    name: 'Buddy',
    lat: 17.45,
    lon: 78.39,
    preciseVisibility: 'private',
    personality: '',
    ownerName: 'Test User',
    spotApprox: false,
    look: {
      v: 1, base: 'boy', skin: '#d9a07a', hair: 'short', hairColour: '#1b1512',
      outfit: 'tee', outfitColour: '#1e88e5', bottomColour: '#26324f', acc: [],
    },
  };
  if (state.bio) fields.bio = state.bio;
  if (state.interests != null) fields.interests = state.interests;
  return { fields: Object.fromEntries(Object.entries(fields).map(([k, val]) => [k, restVal(val)])) };
}

async function installAccount(context, state) {
  await context.route('**/firebasejs/10.14.1/firebase-auth.js', (route) => route.fulfill({
    status: 200, contentType: 'text/javascript', body: AUTH_MOCK,
  }));
  await context.route('**/firebasejs/10.14.1/firebase-firestore.js', (route) => route.fulfill({
    status: 200, contentType: 'text/javascript', body: FIRESTORE_MOCK,
  }));
  await context.route('**/firestore.googleapis.com/**/documents/agents/**', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(agentDocument(state)) });
  });
  await context.route('**/__e2e/interests', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    state.interests = body.interests;
    state.bio = body.bio || '';
    state.saves.push({ interests: body.interests, bio: state.bio });
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

function accountState(over = {}) {
  return { interests: over.interests, bio: over.bio || '', saves: [] };
}

async function waitForBuddy(page) {
  await page.waitForFunction(() => globalThis.__vw?.agent?.agent?.name === 'Buddy', null, { timeout: 30_000 });
}

test.describe('saved interests prompt', () => {
  test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });

  test('an account with no saved interests sees the sheet', async ({ page, context }) => {
    const state = accountState();
    await installAccount(context, state);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#intGrid')).toBeVisible();
    await expect(page.locator('#onb')).toHaveAttribute('data-step', '5');
    await expect(page.locator('#onbSkip')).toHaveText('Skip');
    await expect(page.locator('#intGrid .chip[aria-pressed=true]')).toHaveCount(0);
    expect(state.saves).toEqual([]);
  });

  test('Skip hides the sheet for this session and a new session shows it again', async ({ page, context }) => {
    const state = accountState();
    await installAccount(context, state);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#intGrid')).toBeVisible();
    await expect(page.locator('#toast')).toBeHidden();
    await page.locator('#onbSkip').tap();
    await expect(page.locator('#onb')).toBeHidden();
    const stored = await page.evaluate((uid) => ({
      session: sessionStorage.getItem('vw-int-skip:' + uid),
      local: Object.keys(localStorage).filter((k) => /int-skip|interest/i.test(k)),
    }), E2E_UID);
    expect(stored).toEqual({ session: '1', local: [] });
    expect(state.saves).toEqual([]);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForBuddy(page);
    await expect(page.locator('#onb')).toBeHidden();

    const fresh = await context.newPage();
    await fresh.setViewportSize({ width: 360, height: 740 });
    await fresh.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(fresh.locator('#intGrid')).toBeVisible();
    await fresh.close();
  });

  test('saving 3 or more interests keeps the sheet closed, and Continue is clickable at 360x740', async ({ page, context }) => {
    expect(page.viewportSize()).toEqual({ width: 360, height: 740 });
    const state = accountState();
    await installAccount(context, state);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#intGrid')).toBeVisible();
    for (const key of ['tech', 'science', 'cricket']) await page.locator(`#intGrid .chip[data-k="${key}"]`).tap();
    const go = page.locator('#intNext');
    await expect(go).toBeEnabled();
    await expect(go).toBeInViewport({ ratio: 1 });
    const box = await go.boundingBox();
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id, [box.x + box.width / 2, box.y + box.height / 2]);
    expect(hit).toBe('intNext');
    await go.tap();
    await expect.poll(() => state.interests).toEqual(['tech', 'science', 'cricket']);
    expect(state.interests).not.toContain('exploring');
    expect(state.interests).not.toContain('meeting people');
    await expect(page.locator('#onb')).toBeHidden();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForBuddy(page);
    await expect(page.locator('#onb')).toBeHidden();
    await expect(page.locator('#intGrid')).toBeHidden();
  });

  test('Edit interests opens the same sheet prefilled from profile and settings', async ({ page, context }) => {
    const state = accountState({ interests: ['music', 'art', 'books'], bio: 'CSE 2nd year' });
    await installAccount(context, state);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForBuddy(page);
    await expect(page.locator('#onb')).toBeHidden();

    await page.waitForFunction(() => globalThis.__vw?.agents?.get('me'));
    await page.evaluate(() => globalThis.__vw.agents.openProfile(globalThis.__vw.agents.get('me')));
    await page.locator('#pInterests').click();
    await expect(page.locator('#intGrid')).toBeVisible();
    await expect(page.locator('#intGrid .chip[data-k="music"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#intGrid .chip[data-k="art"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#intGrid .chip[data-k="books"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#intGrid .chip[data-k="tech"]')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#intBio')).toHaveValue('CSE 2nd year');
    await expect(page.locator('#onbSkip')).toHaveText('Cancel');
    await page.locator('#onbSkip').tap();
    await expect(page.locator('#onb')).toBeHidden();
    expect(state.saves).toEqual([]);

    await page.locator('#chatMore').click();
    await page.locator('#chatInterests').click();
    await expect(page.locator('#intGrid')).toBeVisible();
    await expect(page.locator('#intGrid .chip[data-k="music"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#intBio')).toHaveValue('CSE 2nd year');
  });

  test('brain-side default interests do not count and are not saved', async ({ page, context }) => {
    const state = accountState({ interests: ['exploring', 'meeting people'] });
    await installAccount(context, state);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#intGrid')).toBeVisible();
    await expect(page.locator('#intGrid .chip[aria-pressed=true]')).toHaveCount(0);
    for (const key of ['food', 'travel', 'fitness']) await page.locator(`#intGrid .chip[data-k="${key}"]`).tap();
    await page.locator('#intNext').tap();
    await expect.poll(() => state.interests).toEqual(['food', 'travel', 'fitness']);
    expect(JSON.stringify(state.saves)).not.toContain('exploring');
  });
});

test('keyboard open: Continue sits above it and does not cover the bio', async ({ page }) => {
  await openInterests(page);
  const chips = page.locator('#intGrid .chip');
  for (let i = 0; i < 6; i++) await chips.nth(i).tap();
  await page.locator('#intBio').tap();
  await page.locator('#intBio').fill('CSE 2nd year at NIT Warangal');
  await page.setViewportSize({ width: 360, height: 340 }); // simulated keyboard
  await page.waitForTimeout(450);
  const go = page.locator('#intNext'), bio = page.locator('#intBio');
  await expect(go).toBeInViewport({ ratio: 1 });
  await expect(bio).toBeInViewport({ ratio: 1 });
  const g = await go.boundingBox(), b = await bio.boundingBox();
  expect(b.y + b.height).toBeLessThanOrEqual(g.y);
  if (process.env.SHOTS) await page.screenshot({ path: '/workspace/shots/continue-keyboard.png' });
});
