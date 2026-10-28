// Google connector: OAuth 2.0 authorization-code flow (server side) plus Drive, Calendar and Gmail-draft tools.
// Tokens never reach the browser. Writes run only through POST /connections/execute after the owner taps Confirm.
import { calendarInsertBody, rawEmail } from '../../src/google-tools.js';
import { sanitizeZone } from '../../src/calendarWhen.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const SCOPES = {
  drive: ['https://www.googleapis.com/auth/drive.readonly'],
  calendar: ['https://www.googleapis.com/auth/calendar.events'],
  gmail: ['https://www.googleapis.com/auth/gmail.compose'],
};
export const APPS = Object.keys(SCOPES);
export const LABELS = { drive: 'Google Drive', calendar: 'Google Calendar', gmail: 'Gmail drafts' };

export class ConnectorError extends Error {
  constructor(code, message, status = 502) { super(message); this.code = code; this.status = status; }
}

export function config(env = process.env) {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID, clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI || 'https://virtual-world-ai.onrender.com/connect/google/callback' };
}

export function authUrl(cfg, apps, state) {
  const scope = apps.flatMap((a) => SCOPES[a] || []);
  const q = new URLSearchParams({
    client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: 'code', scope: scope.join(' '),
    access_type: 'offline', include_granted_scopes: 'true', prompt: 'consent', state,
  });
  return `${AUTH_URL}?${q}`;
}

async function form(fetchImpl, url, params) {
  let res;
  try {
    res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString(), signal: AbortSignal.timeout(8000) });
  } catch { throw new ConnectorError('busy', 'Google is busy right now. Try again in a minute.'); }
  let json = {};
  try { json = await res.json(); } catch { /* empty */ }
  return { ok: res.ok, status: res.status, json };
}

export async function exchangeCode(cfg, code, fetchImpl) {
  const r = await form(fetchImpl, TOKEN_URL, { code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, grant_type: 'authorization_code' });
  if (!r.ok || !r.json.access_token) throw new ConnectorError('exchange', 'Google sign-in did not finish.');
  return { refreshToken: r.json.refresh_token || '', accessToken: r.json.access_token, scopes: String(r.json.scope || '').split(' ').filter(Boolean) };
}

export async function refreshAccess(cfg, refreshToken, fetchImpl) {
  const r = await form(fetchImpl, TOKEN_URL, { refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'refresh_token' });
  if (r.json.error === 'invalid_grant') throw new ConnectorError('revoked', 'Google access was removed. Connect it again in Me.', 409);
  if (!r.ok || !r.json.access_token) throw new ConnectorError('busy', 'Google is busy right now. Try again in a minute.');
  return r.json.access_token;
}

export async function revoke(refreshToken, fetchImpl) {
  if (!refreshToken) return;
  await form(fetchImpl, REVOKE_URL, { token: refreshToken }).catch(() => {});
}

// Which apps a granted scope list covers.
export const appsFromScopes = (scopes) => APPS.filter((a) => SCOPES[a].every((s) => scopes.includes(s)));

// ---- tools -----------------------------------------------------------------------------------
const str = (description) => ({ type: 'STRING', description });
export const TOOLS = {
  drive_search: { app: 'drive', write: false, declaration: { name: 'drive_search', description: 'Search or list the owner\'s Google Drive files by name. Read only.', parameters: { type: 'OBJECT', properties: { query: str('Words in the file name; empty lists recent files'), limit: { type: 'INTEGER', description: '1-10' } } } } },
  calendar_upcoming: { app: 'calendar', write: false, declaration: { name: 'calendar_upcoming', description: 'List the owner\'s upcoming Google Calendar events.', parameters: { type: 'OBJECT', properties: { days: { type: 'INTEGER', description: 'How many days ahead, 1-14' } } } } },
  calendar_create_event: { app: 'calendar', write: true, declaration: { name: 'calendar_create_event', description: 'Create an event on the owner\'s Google Calendar. The owner confirms first.', parameters: { type: 'OBJECT', properties: { title: str('Event title'), start: str('ISO 8601 start, with offset'), end: str('ISO 8601 end, with offset'), description: str('Optional notes'), location: str('Optional place') }, required: ['title', 'start', 'end'] } } },
  gmail_create_draft: { app: 'gmail', write: true, declaration: { name: 'gmail_create_draft', description: 'Save a draft in the owner\'s Gmail. It is never sent. The owner confirms first.', parameters: { type: 'OBJECT', properties: { to: str('Recipient email address'), subject: str('Subject line'), body: str('Plain-text body') }, required: ['to', 'subject', 'body'] } } },
};

const EMAIL_RE = /^[^\s@<>,;"]{1,64}@[^\s@<>,;"]{1,190}\.[A-Za-z]{2,}$/;
// eslint-disable-next-line no-control-regex
const line = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
// eslint-disable-next-line no-control-regex
const text = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max);
const isoOk = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && !Number.isNaN(Date.parse(v));
const clamp = (v, lo, hi, d) => Math.min(hi, Math.max(lo, Math.round(Number(v) || d)));

// Validates model/client args. Returns clean args or null. Used both when proposing and again when executing.
export function cleanArgs(name, a = {}) {
  a = a && typeof a === 'object' ? a : {};
  if (name === 'drive_search') return { query: line(a.query, 100), limit: clamp(a.limit, 1, 10, 5) };
  if (name === 'calendar_upcoming') return { days: clamp(a.days, 1, 14, 7) };
  if (name === 'calendar_create_event') {
    if (!isoOk(a.start) || !isoOk(a.end) || Date.parse(a.end) <= Date.parse(a.start)) return null;
    return { title: line(a.title, 200) || 'Event', start: a.start.slice(0, 40), end: a.end.slice(0, 40), description: text(a.description, 2000), location: line(a.location, 200) };
  }
  if (name === 'gmail_create_draft') {
    const to = line(a.to, 254);
    if (!EMAIL_RE.test(to)) return null;
    return { to, subject: line(a.subject, 200), body: text(a.body, 5000) };
  }
  return null;
}

async function api(fetchImpl, token, url, init = {}) {
  let res;
  try {
    res = await fetchImpl(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10_000) });
  } catch { throw new ConnectorError('busy', 'Google is busy right now. Try again in a minute.'); }
  if (res.status === 401) throw new ConnectorError('expired', 'Google access expired. Connect it again in Me.', 409);
  if (res.status === 403) {
    let msg = '';
    try { msg = JSON.stringify(await res.json()); } catch { /* empty */ }
    if (/SERVICE_DISABLED|accessNotConfigured|has not been used|is disabled/i.test(msg)) throw new ConnectorError('disabled', 'That Google API is not turned on for this app yet.', 503);
    throw new ConnectorError('consent', 'I need your permission for that. Connect it in Me.', 409);
  }
  if (res.status === 429 || res.status >= 500) throw new ConnectorError('busy', 'Google is busy right now. Try again in a minute.');
  if (!res.ok) throw new ConnectorError('failed', 'That didn\'t work. Try again.');
  return res.json();
}

const fmtWhen = (s, zone) => {
  try {
    const d = s?.dateTime ? new Date(s.dateTime) : s?.date ? new Date(`${s.date}T00:00:00Z`) : null;
    if (!d) return '';
    return s.dateTime
      ? d.toLocaleString('en-GB', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
      : `${d.toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })} (all day)`;
  } catch { return ''; }
};

// handler(name, args, {token, fetchImpl, now, timeZone}) -> {text, data}
export async function runTool(name, args, { token, fetchImpl, now = Date.now(), timeZone = 'UTC' }) {
  const zone = sanitizeZone(timeZone);
  if (name === 'drive_search') {
    const q = ['trashed = false'];
    if (args.query) q.push(`name contains '${args.query.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`);
    const p = new URLSearchParams({ q: q.join(' and '), pageSize: String(args.limit), orderBy: 'modifiedTime desc', fields: 'files(id,name,mimeType,modifiedTime,webViewLink)' });
    const j = await api(fetchImpl, token, `https://www.googleapis.com/drive/v3/files?${p}`);
    const files = (j.files || []).map((f) => ({ id: f.id, name: line(f.name, 120), link: f.webViewLink || '', modified: f.modifiedTime || '' }));
    return { data: { files }, text: files.length ? `Drive files${args.query ? ` matching "${args.query}"` : ''}:\n${files.map((f) => `• ${f.name}`).join('\n')}` : `No Drive files${args.query ? ` matching "${args.query}"` : ''}.` };
  }
  if (name === 'calendar_upcoming') {
    const p = new URLSearchParams({ timeMin: new Date(now).toISOString(), timeMax: new Date(now + args.days * 86_400_000).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '10' });
    const j = await api(fetchImpl, token, `https://www.googleapis.com/calendar/v3/calendars/primary/events?${p}`);
    const events = (j.items || []).map((e) => ({ title: line(e.summary, 120) || '(no title)', when: fmtWhen(e.start, zone) }));
    return { data: { events }, text: events.length ? `Next ${args.days} days:\n${events.map((e) => `• ${e.when} · ${e.title}`).join('\n')}` : `Nothing on your calendar in the next ${args.days} days.` };
  }
  if (name === 'calendar_create_event') {
    const j = await api(fetchImpl, token, 'https://www.googleapis.com/calendar/v3/calendars/primary/events', { method: 'POST', body: JSON.stringify(calendarInsertBody(args, zone)) });
    return { data: { id: j.id, link: j.htmlLink || '' }, text: `Added "${args.title}" to your calendar.` };
  }
  if (name === 'gmail_create_draft') {
    const j = await api(fetchImpl, token, 'https://gmail.googleapis.com/gmail/v1/users/me/drafts', { method: 'POST', body: JSON.stringify({ message: { raw: rawEmail(args) } }) });
    return { data: { id: j.id }, text: `Saved a draft to ${args.to} in Gmail. It hasn't been sent.` };
  }
  throw new ConnectorError('invalid', 'That request looked wrong, so I skipped it.', 400);
}
