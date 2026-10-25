// Runs agent tool actions (email + calendar) from the browser.
// DEFAULT (all users, no OAuth): the confirm sheet shows the exact email/event with links the user taps:
//   mailto: + Gmail web compose, or a Google Calendar template link + a client-side .ics download.
// FLAGGED (allowlisted emails in src/tools-config.js only): send_email and add_event/list_events use the real
//   Gmail/Calendar APIs with gmail.send / calendar.events, requested on demand. The OAuth token lives only in
//   this module's memory: never localStorage, sessionStorage, IndexedDB or Firestore.
// Every write needs confirm() to resolve true. Nothing happens on its own.
import { ensureRfc3339, sanitizeZone } from './calendarWhen.js';

export const SCOPES = {
  gmail: ['https://www.googleapis.com/auth/gmail.send'],
  calendar: ['https://www.googleapis.com/auth/calendar.events'],
};
export const NEEDS_CONFIRM = new Set(['draft_email', 'send_email', 'add_event']);
const scopeFor = (name) => (name === 'draft_email' || name === 'send_email' ? SCOPES.gmail : SCOPES.calendar);

// Converts a proxy action to the confirm-sheet contract: {kind:'email'|'calendar', mode, email?|event?}.
export function sheetAction({ name, args }, mode) {
  if (name === 'add_event') return { kind: 'calendar', mode, event: { title: args.title, start: args.start, end: args.end, details: args.description || '', location: args.location || '' } };
  return { kind: 'email', mode, email: { to: [args.to], subject: args.subject, body: args.body } };
}

// Calendar reads are private and ephemeral: shown in the chat window only, never saved or sent back to the model.
export const EPHEMERAL_TOOLS = new Set(['list_events']);
// results: [{name, text}] -> {persist: text saved to history, ephemeral: text shown only}
export function composeReply(reply, results) {
  const keep = [reply], temp = [];
  for (const r of results) (EPHEMERAL_TOOLS.has(r.name) ? temp : keep).push(r.text);
  const j = (a) => a.filter(Boolean).join('\n');
  return { persist: j(keep), ephemeral: j(temp) };
}

export class ToolError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// Calendar events.insert requires an RFC3339 offset or start.timeZone. The model often sends a
// wall time with neither (`2025-05-13T21:30:00`), which Google rejects with 400 and the sheet
// used to hide. Always send both: the offset is the instant, timeZone is the owner's zone.
export function calendarInsertBody(args, timeZone) {
  const zone = sanitizeZone(timeZone);
  return {
    summary: args.title,
    description: args.description || '',
    location: args.location || '',
    start: { dateTime: ensureRfc3339(args.start, zone), timeZone: zone },
    end: { dateTime: ensureRfc3339(args.end, zone), timeZone: zone },
  };
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
export function createGoogleTools({ requestAccess, confirm, apiEnabled = () => false, fetchImpl = (...a) => fetch(...a), now = () => Date.now(), timeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'UTC'; } }, log = (...parts) => console.error(...parts) }) {
  const zone = () => sanitizeZone(typeof timeZone === 'function' ? timeZone() : timeZone);
  async function token(scopes, force = false) {
    const fresh = cache && cache.exp > now() + 30_000 && scopes.every((s) => cache.scopes.has(s));
    if (fresh && !force) return cache.token;
    let r;
    try { r = await requestAccess(scopes); } catch (err) {
      log('google access failed', err?.code || err?.name || 'consent');
      throw new ToolError('consent', TOOL_MESSAGES.consent);
    }
    if (!r?.accessToken) throw new ToolError('consent', TOOL_MESSAGES.consent);
    const keep = cache && cache.exp > now() ? cache.scopes : [];
    cache = { token: r.accessToken, scopes: new Set([...keep, ...scopes]), exp: now() + (Number(r.expiresIn) || 3000) * 1000 };
    return cache.token;
  }
  async function errorInfo(res) {
    if (typeof res?.json !== 'function') return { reason: '', message: '' };
    try {
      const data = await res.json();
      const message = String(data?.error?.message || data?.error_description || '').replace(/\s+/g, ' ').slice(0, 300);
      const reason = String(data?.error?.errors?.[0]?.reason || data?.error?.status || '').slice(0, 80);
      return { reason, message };
    } catch {
      return { reason: '', message: '' };
    }
  }
  function failApi(status, info, code, message) {
    // Status, reason, and Google's message only. Never the bearer token or the request headers.
    log('google api failed', status, info.reason, info.message);
    throw new ToolError(code, message);
  }
  async function call(scopes, url, init = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const t = await token(scopes, attempt > 0);
      let res;
      try {
        res = await fetchImpl(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } });
      } catch (err) {
        log('google api network', err?.name || 'error');
        throw new ToolError('busy', TOOL_MESSAGES.busy);
      }
      if (res.status === 401) {
        forgetToken();
        if (attempt === 0) continue;
        failApi(401, await errorInfo(res), 'expired', TOOL_MESSAGES.expired);
      }
      if (res.status === 403) {
        const info = await errorInfo(res);
        forgetToken();
        const disabled = /SERVICE_DISABLED|accessNotConfigured|has not been used|is disabled/i.test(`${info.reason} ${info.message}`);
        if (disabled) failApi(403, info, 'disabled', url.includes('calendar') ? 'Google Calendar is not enabled for this app.' : 'That Google API is not enabled for this app.');
        failApi(403, info, 'consent', TOOL_MESSAGES.consent);
      }
      if (res.status === 429 || res.status >= 500) failApi(res.status, await errorInfo(res), 'busy', TOOL_MESSAGES.busy);
      if (!res.ok) failApi(res.status, await errorInfo(res), 'failed', TOOL_MESSAGES.failed);
      return res.json();
    }
    throw new ToolError('failed', TOOL_MESSAGES.failed);
  }
  async function run(action) {
    if (!action || typeof action.name !== 'string' || !action.args) throw new ToolError('invalid', TOOL_MESSAGES.invalid);
    const { name, args } = action;
    const api = apiEnabled() === true && name !== 'draft_email';
    if (!api) return runLinks(action);
    // Gate: never trust action.confirm from the server; the client decides which actions need a tap.
    const scopes = scopeFor(name);
    if (NEEDS_CONFIRM.has(name)) {
      const sheet = sheetAction(action, 'api');
      const ok = (await confirm(sheet))?.confirmed;
      if (ok !== true) throw new ToolError('cancelled', TOOL_MESSAGES.cancelled);
      // Tell the sheet how the API write ended (design shows Sent/Added or an error). Callback errors are ignored.
      const notify = (r) => { try { sheet.onResult?.(r); } catch { /* sheet callback must not break the tool */ } };
      try {
        const msg = await runApi(name, args, scopes);
        notify({ ok: true });
        return msg;
      } catch (err) {
        // Real insert failed: the sheet offers the template link and a .ics file (same as the non-API path).
        notify({ ok: false, error: err?.message || TOOL_MESSAGES.failed, fallback: name === 'add_event' });
        throw err;
      }
    }
    return runApi(name, args, scopes);
  }
  async function runApi(name, args, scopes) {
    if (name === 'draft_email') {
      await call(scopes, 'https://gmail.googleapis.com/gmail/v1/users/me/drafts', { method: 'POST', body: JSON.stringify({ message: { raw: rawEmail(args) } }) });
      return `Draft saved in Gmail for ${args.to}.`;
    }
    if (name === 'send_email') {
      await call(scopes, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', body: JSON.stringify({ raw: rawEmail(args) }) });
      return `Sent to ${args.to}.`;
    }
    if (name === 'add_event') {
      const body = calendarInsertBody(args, zone());
      await call(scopes, 'https://www.googleapis.com/calendar/v3/calendars/primary/events', { method: 'POST', body: JSON.stringify(body) });
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
    const { name } = action;
    if (name === 'list_events') return 'I can\'t read your calendar yet. Open Google Calendar to check your schedule.';
    if (!NEEDS_CONFIRM.has(name)) throw new ToolError('invalid', TOOL_MESSAGES.invalid);
    const ok = (await confirm(sheetAction(action, 'links')))?.confirmed;
    if (ok !== true) throw new ToolError('cancelled', TOOL_MESSAGES.cancelled);
    return name === 'add_event' ? 'Opened Google Calendar. Save it there.' : 'Opened in Gmail. Tap Send there to finish.';
  }
  return { run };
}

// Header-safe single line: every control char (\x00-\x1F, \x7F) becomes a space.
// eslint-disable-next-line no-control-regex
export function hdr(v) { return String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' '); }
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
