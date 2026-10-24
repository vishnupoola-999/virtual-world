// Life loop v1: POST /tick wakes each active agent and lets it take one small action.
// Privacy rule: only an agent's name, interests and bio ever leave its own document. Owner names,
// chats, memory, emails and exact coordinates are never put in another agent's prompt, diary or friends.
import { timingSafeEqual, createHash } from 'node:crypto';

export const LIFE = {
  dailyCap: 12,          // actions per agent per UTC day
  minGapMs: 25 * 60_000, // skip an agent that acted in the last 25 min
  activeDays: 14,        // owner must have opened the app in this window (updatedAt)
  meetCooldownMs: 3 * 86_400_000, // do not re-meet the same agent within 3 days
  maxAgentsPerTick: 50,
  maxConversationLines: 6,
};

export const INTEREST_RE = /^[a-z0-9][a-z0-9 &+-]{0,23}$/;

export function cleanInterests(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const t of list) {
    if (typeof t !== 'string') continue;
    const tag = t.trim().toLowerCase().replace(/\s+/g, ' ');
    if (INTEREST_RE.test(tag) && !out.includes(tag)) out.push(tag);
  }
  return out.slice(0, 5);
}

// Jaccard similarity of two tag sets, 0..1. Swap for embeddings later behind the same signature.
export function similarity(a, b) {
  const A = new Set(cleanInterests(a)), B = new Set(cleanInterests(b));
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const t of A) if (B.has(t)) both++;
  return both / (A.size + B.size - both);
}

export const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

// Cap state lives on agents/{uid}.life: { day, actions, lastActionAt, ... }.
export function capAllows(life = {}, now, cap = LIFE.dailyCap) {
  if (life.day !== dayKey(now)) return true;
  return (Number(life.actions) || 0) < cap;
}

export function countAction(life = {}, now) {
  const same = life.day === dayKey(now);
  return { ...life, day: dayKey(now), actions: (same ? Number(life.actions) || 0 : 0) + 1, lastActionAt: now };
}

// Idle turns are skipped without spending a model call or the cap.
export function shouldAct(agent, now) {
  if (!cleanInterests(agent.interests).length) return false;
  if (!agent.isTest && !(agent.updatedAt && now - agent.updatedAt < LIFE.activeDays * 86_400_000)) return false;
  const life = agent.life || {};
  if (life.lastActionAt && now - life.lastActionAt < LIFE.minGapMs) return false;
  return capAllows(life, now);
}

export function publicProfile(agent) {
  return { name: String(agent.name || 'Agent').slice(0, 40), interests: cleanInterests(agent.interests), bio: String(agent.bio || '').slice(0, 120) };
}

// Most similar agent with at least one shared interest, not met within the cooldown.
export function pickMatch(me, others, now) {
  const met = me.life?.met || {};
  let best = null, bestScore = 0;
  for (const o of others) {
    if (o.uid === me.uid) continue;
    if (met[o.uid] && now - met[o.uid] < LIFE.meetCooldownMs) continue;
    const s = similarity(me.interests, o.interests);
    if (s > bestScore || (s === bestScore && best && s > 0 && o.uid < best.uid)) { best = o; bestScore = s; }
  }
  return best && bestScore > 0 ? { agent: best, score: bestScore } : null;
}

// Interest-matching spot within ~0.5–2 km of the owner's approximate home (never the precise spot).
export function placeNear(agent, interest, now) {
  const home = agent.approx && Number.isFinite(agent.approx.lat) ? agent.approx : { lat: agent.lat, lon: agent.lon };
  const h = createHash('sha256').update(`${agent.uid}|${interest}|${dayKey(now)}`).digest();
  const angle = (h[0] / 255) * 2 * Math.PI, km = 0.5 + (h[1] / 255) * 1.5;
  const lat = home.lat + (km / 111) * Math.cos(angle);
  const lng = home.lon + (km / (111 * Math.cos(home.lat * Math.PI / 180))) * Math.sin(angle);
  return { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 };
}

export function checkTickSecret(header, secret) {
  if (typeof secret !== 'string' || secret.length < 16 || typeof header !== 'string') return false;
  const a = Buffer.from(header), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function decidePrompt(me, match) {
  return [
    `You are ${me.name}, an AI agent living in a virtual city. Your interests: ${me.interests.join(', ')}. About you: ${me.bio || 'n/a'}.`,
    match ? `Nearby is ${match.name}, interests: ${match.interests.join(', ')}.` : 'Nobody you have not met recently is around.',
    'Pick ONE action. Reply with JSON only: {"action":"move","interest":"<one of your interests>","status":"<max 40 chars>"}',
    match ? 'or {"action":"meet"}' : '',
    'or {"action":"diary","text":"<one line, max 140 chars>"} or {"action":"rest"}.',
  ].filter(Boolean).join('\n');
}

export function parseDecision(text, me, hasMatch) {
  let d;
  try { d = JSON.parse(String(text).replace(/^```(json)?|```$/gm, '').trim()); } catch { return { action: 'rest' }; }
  if (!d || typeof d !== 'object') return { action: 'rest' };
  if (d.action === 'meet' && hasMatch) return { action: 'meet' };
  if (d.action === 'move') {
    const interest = me.interests.includes(d.interest) ? d.interest : me.interests[0];
    return { action: 'move', interest, status: oneLine(d.status, 40) || `Exploring ${interest}` };
  }
  if (d.action === 'diary' && oneLine(d.text, 140)) return { action: 'diary', text: oneLine(d.text, 140) };
  return { action: 'rest' };
}

function oneLine(v, max) {
  // eslint-disable-next-line no-control-regex
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

export function conversationPrompt(a, b) {
  return `Write a short friendly first conversation between two AI agents who just met in a virtual city.
Agent A: ${a.name}. Interests: ${a.interests.join(', ')}. Bio: ${a.bio || 'n/a'}.
Agent B: ${b.name}. Interests: ${b.interests.join(', ')}. Bio: ${b.bio || 'n/a'}.
They talk about what they share. 4 to 6 lines, alternating, each line "A: ..." or "B: ...", max 120 chars each. No other text.`;
}

export function parseConversation(text, a, b) {
  const lines = [];
  for (const raw of String(text).split('\n')) {
    const m = raw.match(/^\s*\**([AB])\**\s*:\s*(.+)$/);
    if (m) lines.push({ speaker: m[1] === 'A' ? a.name : b.name, text: oneLine(m[2], 120) });
    if (lines.length === LIFE.maxConversationLines) break;
  }
  return lines.length >= 4 ? lines : null;
}

// One tick. store: listAgents(), saveLife(uid, life, extra), addDiary(uid, entry), addFriend(uid, otherUid, fact).
// llm(prompt, maxTokens) -> text.
export async function runTick({ store, llm, now = Date.now() }) {
  const agents = (await store.listAgents()).map((a) => ({ ...a, interests: cleanInterests(a.interests) }));
  const summary = { agents: agents.length, acted: 0, skipped: 0, moves: 0, meets: 0, diary: 0, rests: 0, errors: 0 };
  const touched = new Set();
  for (const me of agents) {
    if (summary.acted >= LIFE.maxAgentsPerTick) break;
    if (touched.has(me.uid) || !shouldAct(me, now)) { summary.skipped++; continue; }
    try {
      const candidates = agents.filter((o) => o.interests.length && !touched.has(o.uid) && capAllows(o.life, now));
      const match = pickMatch(me, candidates, now);
      const mine = publicProfile(me);
      const decision = parseDecision(await llm(decidePrompt(mine, match && publicProfile(match.agent)), 80), mine, !!match);
      if (decision.action === 'rest') { summary.rests++; summary.skipped++; continue; }
      summary.acted++;
      let life = countAction(me.life, now);
      if (decision.action === 'move') {
        const target = placeNear(me, decision.interest, now);
        life = { ...life, status: decision.status, target, activity: 'move' };
        await store.saveLife(me.uid, life);
        summary.moves++;
      } else if (decision.action === 'diary') {
        await store.saveLife(me.uid, { ...life, activity: 'diary' });
        await store.addDiary(me.uid, { kind: 'diary', text: decision.text, at: now });
        summary.diary++;
      } else {
        const other = match.agent, theirs = publicProfile(other);
        const lines = parseConversation(await llm(conversationPrompt(mine, theirs), 400), mine, theirs);
        if (!lines) { await store.saveLife(me.uid, life); continue; }
        const shared = mine.interests.filter((t) => theirs.interests.includes(t));
        const otherLife = countAction(other.life, now);
        await store.saveLife(me.uid, { ...life, activity: 'meet', status: `Chatting with ${theirs.name}`, met: { ...(me.life?.met || {}), [other.uid]: now } });
        await store.saveLife(other.uid, { ...otherLife, activity: 'meet', status: `Chatting with ${mine.name}`, met: { ...(other.life?.met || {}), [me.uid]: now } });
        await store.addDiary(me.uid, { kind: 'meet', withUid: other.uid, withName: theirs.name, shared, lines, at: now });
        await store.addDiary(other.uid, { kind: 'meet', withUid: me.uid, withName: mine.name, shared, lines, at: now });
        await store.addFriend(me.uid, other.uid, { name: theirs.name, interests: theirs.interests, bio: theirs.bio, note: `Met ${theirs.name}; we both like ${shared.join(', ') || 'chatting'}.`, at: now });
        await store.addFriend(other.uid, me.uid, { name: mine.name, interests: mine.interests, bio: mine.bio, note: `Met ${mine.name}; we both like ${shared.join(', ') || 'chatting'}.`, at: now });
        touched.add(other.uid);
        summary.meets++;
      }
      touched.add(me.uid);
    } catch (error) {
      summary.errors++;
      console.error('tick agent failed', String(error.message || error).slice(0, 120));
    }
  }
  return summary;
}

// ---- Firestore REST store (admin credentials) ----
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toValue(x)])) } };
}

export function fromValue(v = {}) {
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return Date.parse(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, fromValue(x)]));
  return null;
}

// Only fields the loop needs are read; memory, ownerName and messages are never fetched.
const READ_FIELDS = ['name', 'interests', 'bio', 'approx', 'lat', 'lon', 'updatedAt', 'life', 'isTest'];

export function lifeStore(admin) {
  if (!admin) return null;
  const { projectId, fetchImpl, accessToken } = admin;
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  const call = async (url, init = {}) => {
    const r = await fetchImpl(url, { ...init, headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`firestore ${r.status}`);
    return r.json();
  };
  const patch = (path, fields, mask) => call(`${base}/${path}?${mask.map((m) => `updateMask.fieldPaths=${encodeURIComponent(m)}`).join('&')}&currentDocument.exists=true`,
    { method: 'PATCH', body: JSON.stringify({ fields }) });
  return {
    async listAgents() {
      const out = [];
      let token = '';
      do {
        const q = `${base}/agents?pageSize=300${READ_FIELDS.map((f) => `&mask.fieldPaths=${f}`).join('')}${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`;
        const json = await call(q);
        for (const d of json.documents || []) {
          const uid = d.name.split('/').pop();
          out.push({ uid, ...Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, fromValue(v)])) });
        }
        token = json.nextPageToken || '';
      } while (token && out.length < 5000);
      return out;
    },
    async saveLife(uid, life) {
      if (!UID_RE.test(uid)) return;
      await patch(`agents/${uid}`, { life: toValue(life) }, ['life']);
    },
    async addDiary(uid, entry) {
      if (!UID_RE.test(uid)) return;
      const { at, ...rest } = entry;
      const fields = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, toValue(v)]));
      fields.at = { timestampValue: new Date(at).toISOString() };
      await call(`${base}/agents/${uid}/diary`, { method: 'POST', body: JSON.stringify({ fields }) });
    },
    async addFriend(uid, otherUid, fact) {
      if (!UID_RE.test(uid) || !UID_RE.test(otherUid)) return;
      await patch(`agents/${uid}`, { friends: { mapValue: { fields: { [otherUid]: toValue(fact) } } } }, [`friends.\`${otherUid}\``]);
    },
  };
}

export function geminiLlm({ fetchImpl, apiKey, model }) {
  return async (prompt, maxTokens) => {
    const r = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens, temperature: 0.8 } }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) throw new Error(`gemini ${r.status}`);
    const p = await r.json();
    return p.candidates?.[0]?.content?.parts?.map((x) => x.text || '').join('') || '';
  };
}
