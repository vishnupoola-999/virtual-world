// Runs agent tool actions (email + calendar) from the browser.
// DEFAULT (all users, no OAuth): the confirm sheet shows the exact email/event with links the user taps:
//   mailto: + Gmail web compose, or a Google Calendar template link + a client-side .ics download.
// FLAGGED (allowlisted emails in src/tools-config.js only): send_email and add_event/list_events use the real
//   Gmail/Calendar APIs with gmail.send / calendar.events, requested on demand. The OAuth token lives only in
//   this module's memory: never localStorage, sessionStorage, IndexedDB or Firestore.
// Every write needs confirm() to resolve true. Nothing happens on its own.
export const SCOPES = {
  gmail: ['https://www.googleapis.com/auth/gmail.send'],
  calendar: ['https://www.googleapis.com/auth/calendar.events'],
};
export const NEEDS_CONFIRM = new Set(['draft_email', 'send_email', 'add_event']);
const scopeFor = (name) => (name === 'draft_email' || name === 'send_email' ? SCOPES.gmail : SCOPES.calendar);

export class ToolError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export const TOOL_MESSAGES = {
  cancelled: 'Okay, I didn\'t do it.',
  consent: 'I need your Google permission for that. Tap the request again and allow access.',
  expired: 'Your Google access expired. Tap again to reconnect.',
  busy: 'Google is busy right now. Try again in a minute.',
  failed: 'That didn\'t work. Try again.',
  invalid: 'That request looked wrong, so I skipped it.',
};

// In-memory token cache: { token, scopes:Set, exp }.
let cache = null;
export const _tokenState = () => (cache ? { scopes: [...cache.scopes], exp: cache.exp } : null);
export function forgetToken() { cache = null; }

// requestAccess(scopes) -> {accessToken, expiresIn?}; provided by src/firebase.js (Google popup with extra scopes).
export function createGoogleTools({ requestAccess, confirm, apiEnabled = () => false, fetchImpl = (...a) => fetch(...a), now = () => Date.now() }) {
  async function token(scopes, force = false) {
    const fresh = cache && cache.exp > now() + 30_000 && scopes.every((s) => cache.scopes.has(s));
    if (fresh && !force) return cache.token;
    let r;
    try { r = await requestAccess(scopes); } catch { throw new ToolError('consent', TOOL_MESSAGES.consent); }
    if (!r?.accessToken) throw new ToolError('consent', TOOL_MESSAGES.consent);
    const keep = cache && cache.exp > now() ? cache.scopes : [];
    cache = { token: r.accessToken, scopes: new Set([...keep, ...scopes]), exp: now() + (Number(r.expiresIn) || 3000) * 1000 };
    return cache.token;
  }
  async function call(scopes, url, init = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const t = await token(scopes, attempt > 0);
      let res;
      try {
        res = await fetchImpl(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } });
      } catch { throw new ToolError('busy', TOOL_MESSAGES.busy); }
      if (res.status === 401) { forgetToken(); if (attempt === 0) continue; throw new ToolError('expired', TOOL_MESSAGES.expired); }
      if (res.status === 403) { forgetToken(); throw new ToolError('consent', TOOL_MESSAGES.consent); }
      if (res.status === 429 || res.status >= 500) throw new ToolError('busy', TOOL_MESSAGES.busy);
      if (!res.ok) throw new ToolError('failed', TOOL_MESSAGES.failed);
      return res.json();
    }
  }
  async function run(action) {
    if (!action || typeof action.name !== 'string' || !action.args) throw new ToolError('invalid', TOOL_MESSAGES.invalid);
    const { name, args } = action;
    const api = apiEnabled() === true && name !== 'draft_email';
    if (!api) return runLinks(action);
    // Gate: never trust action.confirm from the server; the client decides which actions need a tap.
    if (NEEDS_CONFIRM.has(name)) {
      const ok = await confirm(action);
      if (ok !== true) throw new ToolError('cancelled', TOOL_MESSAGES.cancelled);
    }
    const scopes = scopeFor(name);
    if (name === 'draft_email') {
      await call(scopes, 'https://gmail.googleapis.com/gmail/v1/users/me/drafts', { method: 'POST', body: JSON.stringify({ message: { raw: rawEmail(args) } }) });
      return `Draft saved in Gmail for ${args.to}.`;
    }
    if (name === 'send_email') {
      await call(scopes, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', body: JSON.stringify({ raw: rawEmail(args) }) });
      return `Sent to ${args.to}.`;
    }
    if (name === 'add_event') {
      await call(scopes, 'https://www.googleapis.com/calendar/v3/calendars/primary/events', { method: 'POST',
        body: JSON.stringify({ summary: args.title, description: args.description || '', start: { dateTime: args.start }, end: { dateTime: args.end } }) });
      return `Added "${args.title}" to your calendar.`;
    }
    if (name === 'list_events') {
      const days = Math.min(14, Math.max(1, Number(args.days) || 7));
      const from = new Date(now()), to = new Date(now() + days * 86_400_000);
      const q = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '10' });
      const data = await call(scopes, `https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`);
      const items = Array.isArray(data?.items) ? data.items : [];
      if (!items.length) return `No events in the next ${days} day${days > 1 ? 's' : ''}.`;
      return items.map((e) => `• ${String(e.summary || '(no title)').slice(0, 80)} (${e.start?.dateTime || e.start?.date || ''})`).join('\n');
    }
    throw new ToolError('invalid', TOOL_MESSAGES.invalid);
  }
  // No-OAuth path: the user finishes the action in Gmail / Google Calendar (or with the .ics file).
  async function runLinks(action) {
    const { name, args } = action;
    if (name === 'list_events') return 'I can\'t read your calendar yet. Open Google Calendar to check your schedule.';
    if (name === 'draft_email' || name === 'send_email') {
      const ok = await confirm({ ...action, mode: 'links', links: [
        { label: 'Open in Gmail', href: gmailComposeUrl(args) },
        { label: 'Open in mail app', href: mailtoUrl(args) },
      ] });
      if (ok !== true) throw new ToolError('cancelled', TOOL_MESSAGES.cancelled);
      return `Opened your email to ${args.to}. Review it and press Send there.`;
    }
    if (name === 'add_event') {
      const ok = await confirm({ ...action, mode: 'links', links: [
        { label: 'Add to Google Calendar', href: gcalTemplateUrl(args) },
        { label: 'Download .ics', ics: icsEvent(args, now), filename: 'event.ics' },
      ] });
      if (ok !== true) throw new ToolError('cancelled', TOOL_MESSAGES.cancelled);
      return `Opened "${args.title}" for your calendar. Save it there.`;
    }
    throw new ToolError('invalid', TOOL_MESSAGES.invalid);
  }
  return { run };
}

const enc = encodeURIComponent;
export function mailtoUrl({ to, subject, body }) {
  return `mailto:${enc(hdr(to))}?subject=${enc(hdr(subject))}&body=${enc(String(body ?? ''))}`;
}
export function gmailComposeUrl({ to, subject, body }) {
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(hdr(to))}&su=${enc(hdr(subject))}&body=${enc(String(body ?? ''))}`;
}
// 20261025T043000Z
export const utcStamp = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
export function gcalTemplateUrl({ title, start, end, description, location }) {
  const q = `action=TEMPLATE&text=${enc(hdr(title))}&dates=${utcStamp(start)}/${utcStamp(end)}&details=${enc(String(description || ''))}`;
  return `https://calendar.google.com/calendar/render?${q}${location ? `&location=${enc(hdr(location))}` : ''}`;
}
const icsText = (v) => String(v ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
// RFC 5545 VEVENT with UTC times and escaped text, CRLF line endings, lines folded at 75 octets.
export function icsEvent({ title, start, end, description, location }, now = () => Date.now()) {
  const fold = (l) => { const out = []; let rest = l; while (new TextEncoder().encode(rest).length > 75) { let n = 74; while (new TextEncoder().encode(rest.slice(0, n)).length > 74) n--; out.push(rest.slice(0, n)); rest = ' ' + rest.slice(n); } out.push(rest); return out.join('\r\n'); };
  const uid = `${utcStamp(new Date(now()).toISOString())}-${Math.random().toString(36).slice(2, 10)}@virtual-world`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Virtual World//Agent//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${uid}`, `DTSTAMP:${utcStamp(new Date(now()).toISOString())}`, `DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(end)}`,
    `SUMMARY:${icsText(title)}`, ...(description ? [`DESCRIPTION:${icsText(description)}`] : []), ...(location ? [`LOCATION:${icsText(location)}`] : []),
    'END:VEVENT', 'END:VCALENDAR'];
  return lines.map(fold).join('\r\n') + '\r\n';
}

function hdr(v) { return String(v ?? '').replace(/[\r\n]+/g, ' '); }
const b64url = (s) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
// RFC 2822 message, base64url. Subject is RFC 2047 encoded so non-ASCII works.
export function rawEmail({ to, subject, body }) {
  const subj = `=?UTF-8?B?${b64url(hdr(subject)).replace(/-/g, '+').replace(/_/g, '/')}?=`;
  return b64url([`To: ${hdr(to)}`, `Subject: ${subj}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', '', String(body ?? '')].join('\r\n'));
}
