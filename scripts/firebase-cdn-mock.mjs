// Test-only hook: src/firebase.js imports the Firebase CDN. The auth branching
// check stubs those modules so it can run without network.
const source = `
export const initializeApp = () => ({ name: 'mock' });
export const initializeAuth = () => ({ name: 'auth' });
export const indexedDBLocalPersistence = {};
export const browserLocalPersistence = {};
export const browserPopupRedirectResolver = {};
export class GoogleAuthProvider {
  static credential(idToken) { return { providerId: 'google.com', idToken }; }
  setCustomParameters() {}
}
export const signInWithPopup = async () => {
  globalThis.__calls.push('popup');
  if (process.env.CHECK_MODE === 'web-blocked') {
    const err = new Error('blocked');
    err.code = 'auth/popup-blocked';
    throw err;
  }
  return { providerId: 'google.com' };
};
export const signInWithRedirect = async () => {
  globalThis.__calls.push('redirect');
};
export const signInWithCredential = async (_auth, credential) => {
  globalThis.__calls.push(['credential', credential]);
  return { user: { uid: 'from-credential' } };
};
export const getRedirectResult = () => Promise.resolve(null);
export const onAuthStateChanged = () => () => {};
export const signOut = async () => {
  globalThis.__calls.push('web-sign-out');
  return 'web-signed-out';
};
export const getFirestore = () => ({});
export const doc = () => ({});
export const getDoc = async () => ({ exists: () => false });
export const setDoc = async () => {};
export const serverTimestamp = () => ({});
`;

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('https://www.gstatic.com/firebasejs/')) {
    return { url: specifier, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith('https://www.gstatic.com/firebasejs/')) {
    return { format: 'module', source, shortCircuit: true };
  }
  return nextLoad(url, context);
}
