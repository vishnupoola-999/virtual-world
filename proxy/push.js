// Opt-in push. The proxy sends with the existing service account (FCM HTTP v1). It does not
// mint device tokens: web needs the Firebase web-push public key in the client, Android uses
// Capacitor. No activity is invented. A tick sends at most one note per opted-in user.
import { createHash } from 'node:crypto';
import { sanitizeZone, zonedParts } from '../src/calendarWhen.js';

export const PUSH = {
  maxPerDay: 3,
  liveGapMs: 60 * 60 * 1000,
  quietFrom: 22, // inclusive, local hour
  quietUntil: 8, // exclusive, local hour
  dailyHour: 19, // 19:00–19:59 local. Ticks are every 15 minutes, so one of them lands here.
  defaultZone: 'Asia/Kolkata',
  maxTokens: 5,
  recapUrl: 'https://vishnupoola-999.github.io/virtual-world/?recap=1',
};

const TOKEN_RE = /^[A-Za-z0-9_:.-]{20,4096}$/;

export function pushZone(zone) {
  const raw = String(zone || '').trim();
  if (!raw) return PUSH.defaultZone;
  const clean = sanitizeZone(raw);
  if (clean === 'UTC' && raw !== 'UTC') return PUSH.defaultZone;
  return clean;
}

export function localClock(now, zone) {
  const parts = zonedParts(new Date(now), pushZone(zone));
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return { day: `${parts.year}-${month}-${day}`, hour: parts.hour };
}

export function quietHour(hour) {
  return hour >= PUSH.quietFrom || hour < PUSH.quietUntil;
}

export function tokenId(token) {
  return createHash('sha256').update(String(token)).digest('hex').slice(0, 32);
}

export function validToken(token) {
  return typeof token === 'string' && TOKEN_RE.test(token);
}

export function validPlatform(platform) {
  switch (platform) {
    case 'web':
    case 'android':
      return platform;
    default:
      return '';
  }
}

function clip(value, max) {
  let text = '';
  for (const char of String(value || '')) text += char.charCodeAt(0) < 32 ? ' ' : char;
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

// Topic only when the stored meeting already named shared interests. Otherwise say nothing about a topic.
export function topicFromText(text) {
  const found = String(text || '').match(/We both like ([^.]+)\./);
  return found ? clip(found[1], 40) : '';
}

export function liveNote({ agentName, otherName, shared }) {
  const agent = clip(agentName, 40);
  const other = clip(otherName, 40);
  if (!agent || !other) return null;
  const topic = (Array.isArray(shared) ? shared : []).map((t) => clip(t, 24)).filter(Boolean).slice(0, 2).join(' and ');
  return {
    kind: 'live',
    title: `${agent} just met ${other}`,
    body: topic ? `They're talking about ${topic}. Tap to see.` : 'Tap to see.',
  };
}

export function dailyNote({ agentName, moment }) {
  const agent = clip(agentName, 40);
  const name = clip(moment?.refs?.otherAgentName, 40);
  if (!agent || !name) return null;
  const topic = topicFromText(moment.text);
  return {
    kind: 'daily',
    title: `${agent} had a day`,
    body: topic ? `Met ${name} and talked about ${topic}. Tap to see.` : `Met ${name}. Tap to see.`,
    momentId: String(moment.id || ''),
    meetingId: typeof moment?.refs?.meetingId === 'string' ? moment.refs.meetingId : '',
  };
}

export function momentsOnDay(moments, now, zone) {
  const day = localClock(now, zone).day;
  return (Array.isArray(moments) ? moments : []).filter((m) => {
    if (!m || (m.kind !== 'meeting' && m.kind !== 'friend')) return false;
    const at = Number(m.createdAt);
    return Number.isFinite(at) && localClock(at, zone).day === day;
  });
}

export function pickDigestMoment(moments) {
  return [...moments].sort((a, b) => (Number(b.weight) || 0) - (Number(a.weight) || 0) || (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))[0] || null;
}

// One note or nothing. Live wins over the daily digest in the same tick; the digest can go on a later tick in the 7pm hour.
export function planPush({ now, device, live, moments, agentName }) {
  if (!device?.enabled || !Array.isArray(device.tokens) || !device.tokens.length) return null;
  const zone = pushZone(device.timeZone);
  const clock = localClock(now, zone);
  if (quietHour(clock.hour)) return null;
  const sent = device.day === clock.day ? (Number(device.sent) || 0) : 0;
  if (sent >= PUSH.maxPerDay) return null;
  const lastLive = Number(device.lastLiveAt) || 0;
  if (live && (lastLive <= 0 || now - lastLive >= PUSH.liveGapMs)) {
    const note = liveNote(live);
    if (!note) return null;
    return {
      ...note,
      data: {
        type: 'live',
        momentId: String(live.momentId || ''),
        meetingId: String(live.meetingId || ''),
        url: live.momentId ? `${PUSH.recapUrl}&moment=${encodeURIComponent(live.momentId)}` : PUSH.recapUrl,
      },
    };
  }
  if (clock.hour !== PUSH.dailyHour || device.dailySentOn === clock.day) return null;
  const today = momentsOnDay(moments, now, zone);
  const moment = pickDigestMoment(today);
  if (!moment) return null;
  const note = dailyNote({ agentName, moment });
  if (!note) return null;
  return {
    kind: 'daily',
    title: note.title,
    body: note.body,
    data: {
      type: 'daily',
      momentId: note.momentId,
      meetingId: note.meetingId,
      url: note.momentId ? `${PUSH.recapUrl}&moment=${encodeURIComponent(note.momentId)}` : PUSH.recapUrl,
    },
  };
}

export function applySent(device, kind, now) {
  const clock = localClock(now, device?.timeZone);
  const sent = device?.day === clock.day ? (Number(device.sent) || 0) : 0;
  switch (kind) {
    case 'live':
      return { ...device, day: clock.day, sent: sent + 1, lastLiveAt: now };
    case 'daily':
      return { ...device, day: clock.day, sent: sent + 1, dailySentOn: clock.day };
    default: {
      const unexpected = kind;
      throw new Error(`bad push kind ${unexpected}`);
    }
  }
}

// One live ping per person per tick. The later meeting wins.
export function groupLive(events) {
  const byUid = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    if (!event?.uid) continue;
    const prev = byUid.get(event.uid);
    if (!prev || Number(event.at) >= Number(prev.at)) byUid.set(event.uid, event);
  }
  return [...byUid.values()];
}

export function upsertToken(device, { token, platform, enabled, timeZone, now }) {
  const id = tokenId(token);
  const tokens = (Array.isArray(device?.tokens) ? device.tokens : []).filter((t) => t && t.id !== id);
  tokens.push({ id, token, platform, updatedAt: now });
  tokens.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
  return {
    enabled: enabled === true,
    timeZone: pushZone(timeZone || device?.timeZone),
    tokens: tokens.slice(0, PUSH.maxTokens),
    day: device?.day || '',
    sent: Number(device?.sent) || 0,
    lastLiveAt: Number(device?.lastLiveAt) || 0,
    dailySentOn: device?.dailySentOn || '',
  };
}

export function pushDeviceFromDoc(uid, doc) {
  if (!doc || typeof doc !== 'object') return null;
  const tokens = (Array.isArray(doc.tokens) ? doc.tokens : []).filter((t) => t && validToken(t.token) && validPlatform(t.platform)).map((t) => ({
    id: tokenId(t.token), token: t.token, platform: validPlatform(t.platform), updatedAt: Number(t.updatedAt) || 0,
  }));
  return {
    uid,
    enabled: doc.enabled === true,
    timeZone: pushZone(doc.timeZone),
    tokens,
    day: typeof doc.day === 'string' ? doc.day : '',
    sent: Number(doc.sent) || 0,
    lastLiveAt: Number(doc.lastLiveAt) || 0,
    dailySentOn: typeof doc.dailySentOn === 'string' ? doc.dailySentOn : '',
  };
}

export function removeToken(device, token) {
  const id = tokenId(token);
  return { ...device, tokens: (device?.tokens || []).filter((t) => t.id !== id) };
}

// FCM HTTP v1: an unregistered or invalid registration token is dropped. Other errors stay.
export function fcmDropToken(status, body) {
  const code = typeof body?.error?.status === 'string' ? body.error.status : '';
  const message = typeof body?.error?.message === 'string' ? body.error.message : '';
  const details = JSON.stringify(body?.error?.details || []);
  if (code === 'UNREGISTERED' || code === 'NOT_FOUND' || status === 404) return true;
  if (/UNREGISTERED/.test(details)) return true;
  if (status === 400 && (code === 'INVALID_ARGUMENT' || /registration token/i.test(message))) return true;
  return false;
}

export async function sendFcm({ fetchImpl, projectId, accessToken, token, title, body, data }) {
  const response = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { token, notification: { title, body }, data } }),
    signal: AbortSignal.timeout(8000),
  });
  const json = typeof response.json === 'function' ? await response.json().catch(() => null) : null;
  if (!response.ok) {
    const error = new Error(`fcm ${response.status}`);
    error.drop = fcmDropToken(response.status, json);
    throw error;
  }
  return true;
}

async function deliver(device, decision, send) {
  let tokens = device.tokens.slice();
  let ok = 0;
  for (const item of device.tokens) {
    try {
      await send(item.token, decision);
      ok += 1;
    } catch (error) {
      if (error?.drop) tokens = tokens.filter((t) => t.id !== item.id);
      else console.error('push send', decision.kind, String(error?.message || error).slice(0, 40));
    }
  }
  const cleaned = { ...device, tokens };
  if (!ok) return tokens.length === device.tokens.length ? null : cleaned;
  return applySent(cleaned, decision.kind, decision.now);
}

// Live events first, one per uid. Anyone not already sent this tick may still get the 7pm digest.
export async function dispatchPushes({ now, live = [], getDevice, listDevices, momentsFor, agentName, send, save }) {
  const sent = new Set();
  for (const event of groupLive(live)) {
    const device = await getDevice(event.uid);
    if (!device) continue;
    const decision = planPush({ now, device, live: event, moments: [], agentName: event.agentName });
    if (!decision || decision.kind !== 'live') continue;
    const next = await deliver(device, { ...decision, now }, send);
    if (!next) continue;
    await save(event.uid, next);
    if (next.sent !== device.sent || next.lastLiveAt !== device.lastLiveAt) sent.add(event.uid);
  }
  const devices = typeof listDevices === 'function' ? await listDevices() : [];
  for (const device of devices) {
    if (!device?.uid || sent.has(device.uid)) continue;
    const moments = typeof momentsFor === 'function' ? await momentsFor(device.uid) : [];
    const name = typeof agentName === 'function' ? await agentName(device.uid) : '';
    const decision = planPush({ now, device, live: null, moments, agentName: name });
    if (!decision) continue;
    const next = await deliver(device, { ...decision, now }, send);
    if (next) await save(device.uid, next);
  }
}
