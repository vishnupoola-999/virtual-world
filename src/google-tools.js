// Runs agent tool actions (Gmail + Calendar) from the browser with the owner's Google OAuth access token.
// The token lives only in this module's memory: never localStorage, sessionStorage, IndexedDB or Firestore.
// draft_email, send_email and add_event run ONLY after confirm() resolves true. list_events is read-only.
export const SCOPES = {
  gmail: ['https://www.googleapis.com/auth/gmail.compose', 'https://www.googleapis.com/auth/gmail.send'],
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
export function createGoogleTools({ requestAccess, confirm, fetchImpl = (...a) => fetch(...a), now = () => Date.now() }) {
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
  return { run };
}

const hdr = (v) => String(v ?? '').replace(/[\r\n]+/g, ' ');
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
