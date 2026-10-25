// Seed or remove clearly marked test agents (isTest: true, uid prefix "test-") near Hyderabad.
//   Emulator: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seed-test-agents.mjs seed|remove
//   Real project (only with intent): FIREBASE_SERVICE_ACCOUNT='<json>' node scripts/seed-test-agents.mjs seed --allow-prod
// remove deletes every test-* agent and its diary entries. It never touches real users' agents.
import { firebaseAdmin } from '../proxy/server.js';
import { toValue } from '../proxy/life.js';

export const TEST_AGENTS = [
  { uid: 'test-hitech', name: 'Byte (test)', interests: ['tech', 'ai', 'startups'], bio: 'Test agent: loves hackathons in Hitech City', approx: { lat: 17.4474, lon: 78.3762 } },
  { uid: 'test-science', name: 'Nova (test)', interests: ['science', 'space', 'ai'], bio: 'Test agent: reads about rockets', approx: { lat: 17.4126, lon: 78.4482 } },
  { uid: 'test-cricket', name: 'Sixer (test)', interests: ['cricket', 'music', 'food'], bio: 'Test agent: never misses a match', approx: { lat: 17.4065, lon: 78.5505 } },
  { uid: 'test-art', name: 'Hue (test)', interests: ['art', 'music', 'photography'], bio: 'Test agent: sketches at Charminar', approx: { lat: 17.3616, lon: 78.4747 } },
  { uid: 'test-books', name: 'Page (test)', interests: ['books', 'science', 'tech'], bio: 'Test agent: library regular', approx: { lat: 17.4399, lon: 78.4983 } },
];

const LOOK = { color: '#4fd1ff', emoji: '🧪' };

async function main() {
  const [cmd] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  if (!emulator && !process.argv.includes('--allow-prod')) {
    console.error('Refusing to run without FIRESTORE_EMULATOR_HOST. Pass --allow-prod only if you really mean the live project.');
    process.exit(2);
  }
  const projectId = process.env.GCLOUD_PROJECT || (emulator ? 'demo-virtual-world' : 'virtual-world-8ac82');
  let base, headers;
  if (emulator) {
    base = `http://${emulator}/v1/projects/${projectId}/databases/(default)/documents`;
    headers = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
  } else {
    const admin = firebaseAdmin(process.env);
    if (!admin) { console.error('FIREBASE_SERVICE_ACCOUNT is missing'); process.exit(2); }
    base = `https://firestore.googleapis.com/v1/projects/${admin.projectId}/databases/(default)/documents`;
    headers = { Authorization: `Bearer ${await admin.accessToken()}`, 'Content-Type': 'application/json' };
  }
  const req = async (url, init = {}) => {
    const r = await fetch(url, { ...init, headers });
    if (!r.ok && r.status !== 404) throw new Error(`${init.method || 'GET'} ${url} -> ${r.status}`);
    return r.status === 204 || r.status === 404 ? {} : r.json();
  };
  if (cmd === 'seed') {
    for (const a of TEST_AGENTS) {
      const { uid, ...rest } = a;
      const data = { ...rest, look: LOOK, lat: a.approx.lat, lon: a.approx.lon, preciseVisibility: 'private', isTest: true };
      const fields = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, toValue(v)]));
      fields.updatedAt = { timestampValue: new Date().toISOString() };
      await req(`${base}/agents/${uid}`, { method: 'PATCH', body: JSON.stringify({ fields }) });
      console.log('seeded', uid);
    }
  } else if (cmd === 'remove') {
    for (const { uid } of TEST_AGENTS) {
      const diary = await req(`${base}/agents/${uid}/diary?pageSize=300&mask.fieldPaths=kind`);
      const root = emulator ? `http://${emulator}/v1/` : 'https://firestore.googleapis.com/v1/';
      for (const d of diary.documents || []) await req(root + d.name, { method: 'DELETE' });
      await req(`${base}/agents/${uid}`, { method: 'DELETE' });
      console.log('removed', uid);
    }
  } else {
    console.error('usage: node scripts/seed-test-agents.mjs seed|remove [--allow-prod]');
    process.exit(2);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
