// Locks the browser popup/redirect path and the native id-token path apart.
import { spawnSync } from 'node:child_process';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';

const modes = ['web', 'web-blocked', 'web-capacitor-present', 'native', 'native-missing', 'native-down', 'native-status-10'];

if (!process.env.CHECK_MODE) {
  const self = fileURLToPath(import.meta.url);
  let failed = 0;
  for (const mode of modes) {
    const result = spawnSync(process.execPath, [self], {
      env: { ...process.env, CHECK_MODE: mode, NODE_NO_WARNINGS: '1' },
      encoding: 'utf8',
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.status !== 0) {
      console.error(`mode ${mode} failed`);
      failed += 1;
    }
  }
  if (failed) process.exit(1);
  console.log('firebase auth branching ok');
  process.exit(0);
}

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${process.env.CHECK_MODE}: ${message}`);
    process.exit(1);
  }
}

globalThis.sessionStorage = {
  removeItem() {},
  setItem() {},
  getItem() { return null; },
};
globalThis.__calls = [];

const mode = process.env.CHECK_MODE;
if (mode === 'web-capacitor-present') {
  globalThis.Capacitor = {
    isNativePlatform: () => false,
    nativePromise: async () => { throw new Error('native bridge should not be called'); },
  };
}
if (mode.startsWith('native')) {
  globalThis.Capacitor = {
    isNativePlatform: () => true,
    nativePromise: async (plugin, method, options) => {
      globalThis.__calls.push({ plugin, method, options });
      if (mode === 'native-down') {
        const err = new Error('Default FirebaseApp is not initialized');
        err.code = 'UNIMPLEMENTED';
        throw err;
      }
      if (mode === 'native-status-10') {
        const err = new Error('10: ');
        throw err;
      }
      if (method === 'signOut') return {};
      if (mode === 'native-missing') return { credential: { providerId: 'google.com' } };
      return { credential: { idToken: 'header.payload.sig', providerId: 'google.com' } };
    },
  };
}

register(new URL('./firebase-cdn-mock.mjs', import.meta.url));
const { signIn, logOut, authMsg } = await import(new URL('../src/firebase.js', import.meta.url));
const calls = globalThis.__calls;

if (mode === 'web' || mode === 'web-capacitor-present') {
  const result = await signIn();
  assert(result?.providerId === 'google.com', 'popup result');
  assert(calls.includes('popup') && !calls.includes('redirect'), 'popup only');
  assert(!calls.some(call => Array.isArray(call) && call[0] === 'credential'), 'no credential exchange');
  assert(await logOut() === 'web-signed-out', 'web sign-out');
  assert(calls.includes('web-sign-out'), 'web sign-out recorded');
  assert(!calls.some(call => call?.method === 'signOut'), 'no native sign-out');
}

if (mode === 'web-blocked') {
  await signIn();
  assert(calls[0] === 'popup' && calls[1] === 'redirect', 'popup then redirect');
  assert(!calls.some(call => Array.isArray(call)), 'blocked popup does not use the id token');
}

if (mode === 'native') {
  const result = await signIn();
  assert(result?.user?.uid === 'from-credential', 'web SDK credential sign-in');
  assert(calls[0]?.plugin === 'FirebaseAuthentication', 'plugin name');
  assert(calls[0]?.method === 'signInWithGoogle', 'google method');
  assert(calls[0]?.options?.skipNativeAuth === true, 'skipNativeAuth');
  assert(calls[1]?.[0] === 'credential' && calls[1][1].idToken === 'header.payload.sig', 'id token forwarded');
  assert(!calls.includes('popup') && !calls.includes('redirect'), 'native skips the web OAuth path');
  assert(await logOut() === 'web-signed-out', 'web sign-out after native');
  assert(calls.some(call => call?.method === 'signOut' && call.plugin === 'FirebaseAuthentication'), 'native sign-out');
  assert(calls.at(-1) === 'web-sign-out', 'web sign-out is last');
}

if (mode === 'native-missing') {
  try {
    await signIn();
    assert(false, 'missing id token should throw');
  } catch (error) {
    assert(error.code === 'auth/missing-id-token', error.code);
    assert(authMsg(error).includes('id token'), authMsg(error));
  }
}

if (mode === 'native-down') {
  try {
    await signIn();
    assert(false, 'missing Firebase app should throw');
  } catch (error) {
    assert(error.code === 'auth/native-not-configured', `${error.code} ${error.message}`);
    assert(authMsg(error).includes('google-services.json'), authMsg(error));
  }
  assert(await logOut() === 'web-signed-out', 'sign-out still clears the web user');
  assert(calls.at(-1) === 'web-sign-out', 'web sign-out after native failure');
}

if (mode === 'native-status-10') {
  try {
    await signIn();
    assert(false, 'status 10 should throw');
  } catch (error) {
    assert(error.code === 'auth/native-developer-error', error.code);
    assert(authMsg(error).includes('SHA-1'), authMsg(error));
  }
}

console.log(`ok ${mode}`);
