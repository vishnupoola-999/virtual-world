// Link-out builders for agent email/calendar handoff (design contract, see living-spec.md "Confirm sheet (V1)").
// Pure functions, no OAuth, no network. The confirm sheet (src/ui/confirmAction.js) uses these.
const enc = encodeURIComponent;
const one = (v) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim();
const list = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(one).filter(Boolean);
export const MAILTO_MAX = 2000;
const TRUNC_NOTE = '\n\n[Message shortened. Paste the rest before sending.]';

// mailto:{to}?cc=&subject=&body= ; body truncated so the URL stays under ~2,000 chars.
export function buildMailtoUrl({ to, cc, subject, body }) {
  const head = `mailto:${list(to).map(enc).join(',')}?${list(cc).length ? `cc=${list(cc).map(enc).join(',')}&` : ''}subject=${enc(one(subject))}&body=`;
  let b = String(body ?? '');
  if ((head + enc(b)).length > MAILTO_MAX) {
    while (b && (head + enc(b + TRUNC_NOTE)).length > MAILTO_MAX) b = b.slice(0, Math.floor(b.length * 0.9));
    b += TRUNC_NOTE;
  }
  return head + enc(b);
}
export function buildGmailComposeUrl({ to, cc, subject, body }) {
  const q = [`view=cm`, `fs=1`, `to=${list(to).map(enc).join(',')}`, ...(list(cc).length ? [`cc=${list(cc).map(enc).join(',')}`] : []), `su=${enc(one(subject))}`, `body=${enc(String(body ?? ''))}`];
  return `https://mail.google.com/mail/?${q.join('&')}`;
}
const toDate = (v) => (v instanceof Date ? v : new Date(v));
// 20261025T043000Z (UTC)
export const utcStamp = (v) => toDate(v).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const dayStamp = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.replace(/-/g, '') : utcStamp(v).slice(0, 8));
const guestEmails = (g) => (Array.isArray(g) ? g : []).map((x) => one(typeof x === 'string' ? x : x?.email)).filter(Boolean);

export function buildCalendarUrl({ title, start, end, details, location, allDay, guests }) {
  const dates = allDay ? `${dayStamp(start)}/${dayStamp(end)}` : `${utcStamp(start)}/${utcStamp(end)}`;
  let q = `action=TEMPLATE&text=${enc(one(title))}&dates=${dates}`;
  if (location) q += `&location=${enc(one(location))}`;
  if (details) q += `&details=${enc(String(details))}`;
  const add = guestEmails(guests);
  if (add.length) q += `&add=${add.map(enc).join(',')}`;
  return `https://calendar.google.com/calendar/render?${q}`;
}

const icsText = (v) => String(v ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const te = new TextEncoder();
function fold(line) {
  const out = [];
  let rest = line;
  while (te.encode(rest).length > 75) {
    let n = 74;
    while (te.encode(rest.slice(0, n)).length > 74) n--;
    out.push(rest.slice(0, n));
    rest = ' ' + rest.slice(n);
  }
  out.push(rest);
  return out.join('\r\n');
}
// RFC 5545 VCALENDAR/VEVENT: UTC times, escaped text, CRLF, 75-octet folding.
export function buildIcs({ title, start, end, details, location, allDay, guests }, now = Date.now()) {
  const stamp = utcStamp(new Date(now));
  const uid = `${stamp}-${Math.random().toString(36).slice(2, 10)}@virtual-world`;
  const when = allDay ? [`DTSTART;VALUE=DATE:${dayStamp(start)}`, `DTEND;VALUE=DATE:${dayStamp(end)}`] : [`DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(end)}`];
  const people = (Array.isArray(guests) ? guests : []).map((g) => (typeof g === 'string' ? { email: g } : g)).filter((g) => g?.email)
    .map((g) => `ATTENDEE${g.name ? `;CN="${one(g.name).replace(/["\\;,:]/g, '')}"` : ''}:mailto:${one(g.email)}`);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Virtual World//Agent//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${uid}`, `DTSTAMP:${stamp}`, ...when, `SUMMARY:${icsText(title)}`,
    ...(location ? [`LOCATION:${icsText(location)}`] : []), ...(details ? [`DESCRIPTION:${icsText(details)}`] : []), ...people,
    'END:VEVENT', 'END:VCALENDAR'];
  return lines.map(fold).join('\r\n') + '\r\n';
}
export function downloadIcs(event) {
  const url = URL.createObjectURL(new Blob([buildIcs(event)], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${one(event?.title).replace(/[^\w.-]+/g, '-').slice(0, 40) || 'event'}.ics`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
