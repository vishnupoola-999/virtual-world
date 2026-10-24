// Confirm sheet (V1), design: Diggy, /workspace/design/living-spec.md "Confirm sheet (V1)".
// Contract (PR #25): confirmAction(action) -> Promise<{confirmed:boolean}>.
//   action = {kind:'email', email:{to, cc?, subject, body}} | {kind:'calendar', event:{title, start, end, details?, location?, allDay?, guests?}}
//   action.mode: 'links' (default) opens Gmail / Google Calendar / .ics via src/agentTools.js;
//                'api' just resolves {confirmed:true} so google-tools.js performs the write.
// Resolves confirmed:true ONLY after an explicit tap; false on Cancel/scrim/Escape. Text is set with textContent only.
import { buildGmailComposeUrl, buildMailtoUrl, buildCalendarUrl, downloadIcs } from '../agentTools.js';
const ICON = {
  email: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 6.5 12 13l8.5-6.5"/></svg>',
  calendar: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  err: '<svg viewBox="0 0 24 24"><path d="M12 8v5M12 16.5v.01"/><circle cx="12" cy="12" r="9"/></svg>',
  ok: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
};
const TOAST_MS = 2400;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
}
function icon(name) { const t = el('div', 'tile'); t.innerHTML = ICON[name]; return t; } // static SVG only
const list = (v) => (Array.isArray(v) ? v : String(v ?? '').split(',')).map((s) => String(s).trim()).filter(Boolean);

// "Sat, 31 Oct" and "6:30 – 11:00 am" in the owner's zone.
export function formatWhen(start, end) {
  const s = new Date(start), e = new Date(end);
  if (Number.isNaN(+s)) return { date: String(start ?? ''), time: '' };
  const date = `${s.toLocaleDateString('en-GB', { weekday: 'short' })}, ${s.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
  const t = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  if (Number.isNaN(+e)) return { date, time: t(s) };
  const [a, ap] = t(s).split(' '), [b, bp] = t(e).split(' ');
  return { date, time: ap === bp ? `${a} – ${b} ${bp}` : `${a} ${ap} – ${b} ${bp}` };
}

const kindOf = (action) => (action.kind === 'calendar' ? 'calendar' : 'email');
const argsOf = (action) => (action.kind === 'calendar' ? action.event : action.email) || {};

let toastTimer;
function showToast(kind, api) {
  let t = document.querySelector('.cs-toast');
  if (!t) {
    t = el('div', 'cs-toast');
    t.setAttribute('role', 'status');
    const dot = el('span', 'cs-ok'); dot.innerHTML = ICON.ok;
    const txt = el('div');
    txt.append(el('b', 'cs-toast-title'), el('div', 'cs-toast-sub'));
    t.append(dot, txt);
    document.body.append(t);
  }
  t.querySelector('.cs-toast-title').textContent = api ? (kind === 'email' ? 'Sending' : 'Adding to Calendar') : (kind === 'email' ? 'Opened in Gmail' : 'Opened Google Calendar');
  const sub = t.querySelector('.cs-toast-sub');
  sub.textContent = 'Tap Send there to finish';
  sub.hidden = api || kind !== 'email';
  t.dataset.show = 'false';
  void t.offsetWidth; // restart the transition
  t.dataset.show = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.dataset.show = 'false'; }, TOAST_MS);
}

function openUrl(href) {
  if (!/^(https:|mailto:)/.test(String(href || ''))) throw new Error('bad link');
  const a = document.createElement('a');
  a.href = href;
  if (href.startsWith('https:')) { a.target = '_blank'; a.rel = 'noopener'; }
  a.click(); // still inside the tap, so no popup blocker
}
const OPEN = {
  gmail: (a) => openUrl(buildGmailComposeUrl(a)),
  mailto: (a) => openUrl(buildMailtoUrl(a)),
  calendar: (a) => openUrl(buildCalendarUrl(a)),
  ics: (a) => downloadIcs(a),
};

export function confirmAction(action = {}) {
  return new Promise((resolve) => {
    const kind = kindOf(action);
    const isEmail = kind === 'email';
    const a = argsOf(action);
    const api = action.mode === 'api';
    const primaryLink = isEmail ? 'gmail' : 'calendar';
    const altLink = api ? null : (isEmail ? 'mailto' : 'ics');
    const primaryLabel = api ? (isEmail ? 'Send email' : 'Add to Calendar') : (isEmail ? 'Open in Gmail' : 'Add to Calendar');

    const scrim = el('div', 'cs-scrim');
    const sheet = el('section', 'cs-sheet');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', 'csTitle');
    sheet.dataset.open = 'false';
    sheet.append(el('div', 'grab'));

    const head = el('div', 'cs-head');
    const titles = el('div');
    const title = el('div', 'cs-title', isEmail ? 'Open this email?' : 'Add to your calendar?');
    title.id = 'csTitle';
    titles.append(title, el('div', 'cs-sub', isEmail ? 'From your Gmail' : 'Google Calendar'));
    head.append(icon(kind), titles);
    sheet.append(head);

    const errBox = el('div', 'cs-error');
    errBox.setAttribute('role', 'alert');
    errBox.hidden = true;
    const errP = el('p');
    errP.append(el('b', null, 'Something went wrong.'), document.createTextNode(` Nothing was ${isEmail ? 'sent' : 'added'}, so it's safe to try again.`));
    const errTile = icon('err');
    errBox.append(errTile, errP);
    sheet.append(errBox);

    const card = el('div', 'cs-card');
    const row = (k, v) => { const r = el('div', 'row'); const vv = el('div', 'v'); if (v instanceof Node) vv.append(v); else vv.textContent = String(v ?? ''); r.append(el('div', 'k', k), vv); card.append(r); return vv; };
    if (isEmail) {
      row('To', [...list(a.to), ...list(a.cc)].join(', '));
      row('Subject', a.subject || '(no subject)');
      const wrap = el('div');
      const body = el('div', 'cs-body', a.body || '');
      body.dataset.expanded = 'false';
      wrap.append(body);
      if (String(a.body || '').length > 140 || /\n.*\n/.test(a.body || '')) {
        const more = el('button', 'more', 'Show all');
        more.type = 'button';
        more.onclick = () => { const x = body.dataset.expanded !== 'true'; body.dataset.expanded = String(x); more.textContent = x ? 'Show less' : 'Show all'; };
        wrap.append(more);
      }
      row('Message', wrap);
    } else {
      row('Event', el('b', 'cs-strong', a.title || 'Event'));
      const w = formatWhen(a.start, a.end);
      const when = el('div'); when.append(document.createTextNode(w.date));
      if (w.time) { when.append(document.createElement('br'), el('span', 'cs-dim', w.time)); }
      row('When', when);
      if (a.location) row('Where', a.location);
      const guests = Array.isArray(a.guests) ? a.guests : list(a.guests || a.attendees);
      if (guests.length) {
        const g = el('div');
        for (const x of guests) {
          const name = typeof x === 'string' ? x : (x.name || x.email || '');
          const chip = el('span', 'guest');
          chip.append(el('i', null, name.charAt(0).toUpperCase()), document.createTextNode(typeof x === 'object' && x.email && x.name ? `${x.name} (${x.email})` : name));
          g.append(chip);
        }
        g.append(el('div', 'cs-hint', 'Invited when you save'));
        row('Guests', g);
      }
    }
    sheet.append(card);
    sheet.append(el('p', 'cs-note', api ? (isEmail ? 'Sends from your Gmail when you tap Send email.' : 'Saves to your Google Calendar when you tap Add.')
      : (isEmail ? 'Opens Gmail. Nothing sends until you tap Send there.' : 'Opens Google Calendar. Guests are invited only when you save it there.')));

    const actions = el('div', 'cs-actions');
    const primary = el('button', 'cs-primary', primaryLabel);
    primary.type = 'button';
    actions.append(primary);
    let alt = null;
    if (altLink) {
      alt = el('a', isEmail ? 'cs-ics cs-alt' : 'cs-ics', isEmail ? 'Use another mail app' : 'Download .ics');
      alt.href = '#';
      actions.append(alt);
    }
    const cancel = el('button', 'cs-cancel', 'Cancel');
    cancel.type = 'button';
    actions.append(cancel);
    sheet.append(actions);

    let done = false;
    const close = (val) => {
      if (done) return;
      done = true;
      sheet.dataset.open = 'false';
      scrim.dataset.open = 'false';
      document.removeEventListener('keydown', onKey);
      setTimeout(() => { scrim.remove(); sheet.remove(); }, 260);
      resolve({ confirmed: val === true });
    };
    const fail = () => {
      errBox.hidden = false;
      primary.textContent = 'Try again';
      primary.dataset.busy = 'false';
    };
    const go = (link) => {
      if (done) return;
      if (api) { showToast(kind, true); close(true); return; } // google-tools.js performs the write after this resolves
      primary.dataset.busy = 'true';
      try { OPEN[link](a); } catch { fail(); return; }
      showToast(kind, false);
      close(true);
    };
    primary.onclick = () => go(primaryLink);
    if (alt) alt.onclick = (e) => { e.preventDefault(); go(altLink); };
    cancel.onclick = () => close(false);
    scrim.onclick = () => close(false);
    const onKey = (e) => { if (e.key === 'Escape') close(false); };
    document.addEventListener('keydown', onKey);

    document.body.append(scrim, sheet);
    void sheet.offsetWidth;
    sheet.dataset.open = 'true';
    scrim.dataset.open = 'true';
    primary.focus({ preventScroll: true });
  });
}
