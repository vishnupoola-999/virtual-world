// Calendar intent + when. The model was inventing dates (a past "Tue, 13 May") and the
// insert then failed. This module is pure: same code on the proxy and in the browser.
// Dates resolve in the owner's IANA zone. A missing day/time is a question, never a guess.
// Past-tense updates ("met", "had a meeting", "went") are not events.

const ASK_BOTH = 'When should I add that? Tell me the day and the time.';
const ASK_TIME = 'What time should I use?';
const ASK_MERIDIEM = 'Is that in the morning or the evening?';
const ASK_PASSED = 'That time today has already passed. What time should I use?';
const ASK_WEEK = 'Which day next week, and what time?';

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function sanitizeZone(zone) {
  const z = String(zone || '').trim();
  if (!/^[A-Za-z0-9_+-]{1,32}(?:\/[A-Za-z0-9_+-]{1,32}){0,2}$/.test(z)) return 'UTC';
  try {
    Intl.DateTimeFormat('en-US', { timeZone: z }).format(0);
    return z;
  } catch {
    return 'UTC';
  }
}

export function zonedParts(date, timeZone) {
  const zone = sanitizeZone(timeZone);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const bag = {};
  for (const part of fmt.formatToParts(date)) if (part.type !== 'literal') bag[part.type] = part.value;
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(bag.year), month: Number(bag.month), day: Number(bag.day),
    hour, minute: Number(bag.minute), second: Number(bag.second || 0), weekday: bag.weekday,
  };
}

export function offsetMinutes(date, timeZone) {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

// Wall-clock y-m-d h:m in `timeZone` → UTC instant. Two passes so a DST boundary settles.
export function zonedTimeToUtc(y, m, d, h, min, timeZone) {
  const zone = sanitizeZone(timeZone);
  let utc = Date.UTC(y, m - 1, d, h, min, 0);
  const first = offsetMinutes(new Date(utc), zone);
  utc -= first * 60_000;
  const second = offsetMinutes(new Date(utc), zone);
  if (second !== first) utc = Date.UTC(y, m - 1, d, h, min, 0) - second * 60_000;
  return new Date(utc);
}

export function formatRfc3339(date, timeZone) {
  const zone = sanitizeZone(timeZone);
  const p = zonedParts(date, zone);
  const pad = (n) => String(n).padStart(2, '0');
  const off = offsetMinutes(date, zone);
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${sign}${hh}:${mm}`;
}

// Google Calendar rejects a dateTime with no offset unless timeZone is set, and rejects +0530.
// A string with no offset is a wall clock in `timeZone`, not UTC and not the server's zone.
export function ensureRfc3339(value, timeZone) {
  const s = String(value ?? '').trim();
  const colon = s.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/);
  if (colon) return `${colon[1]}:${colon[2] || '00'}${colon[3]}`;
  const compact = s.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2}))?(?:\.\d+)?([+-])(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}:${compact[2] || '00'}${compact[3]}${compact[4]}:${compact[5]}`;
  const wall = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!wall) return s;
  const zone = sanitizeZone(timeZone);
  return formatRfc3339(zonedTimeToUtc(+wall[1], +wall[2], +wall[3], +wall[4], +wall[5], zone), zone);
}

export function calendarToolContext(timeZone, now = Date.now()) {
  const zone = sanitizeZone(timeZone);
  let clock;
  try {
    clock = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone, weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date(now));
  } catch {
    clock = new Date(now).toISOString();
  }
  clock = clock.replace(/\s+/g, ' ').trim();
  return ` Right now for the owner it is ${clock} in ${zone}. Only use add_event when they ask to schedule something in the future. Do not use it when they are telling you something that already happened (for example met, had a meeting, went). If they did not give a day and a time, ask for the missing part and do not invent one. start and end must be ISO 8601 with a numeric offset, in ${zone}, and must not be in the past.`;
}

// "met" / "had a meeting" / "went" are news about the past, not a request to schedule.
// An explicit "schedule" / "add to my calendar" in the same message still counts.
export function isPastCalendarMention(text) {
  const s = String(text || '');
  const past = /\b(met|went|had a meeting|had meeting)\b/i.test(s);
  if (!past) return false;
  const explicit = /\b(add (?:it |this |that )?(?:to|on) (?:my |the )?calendar|schedule|book|put (?:it |this |that )?on (?:my |the )?calendar)\b/i.test(s);
  return !explicit;
}

function addDays(y, m, d, n) {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function weekdayIndex(word) {
  const w = String(word || '').toLowerCase();
  if (w.startsWith('su')) return 0;
  if (w.startsWith('mo')) return 1;
  if (w.startsWith('tu')) return 2;
  if (w.startsWith('we')) return 3;
  if (w.startsWith('th')) return 4;
  if (w.startsWith('fr')) return 5;
  if (w.startsWith('sa')) return 6;
  return null;
}

function to24(hour, minute, mer) {
  let h = Number(hour);
  const m = Number(minute || 0);
  if (!Number.isInteger(h) || !Number.isInteger(m) || m > 59 || h > 24 || h < 0) return null;
  if (mer) {
    const pm = mer.toLowerCase() === 'pm';
    if (h > 12) return null;
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  } else if (h > 23) return null;
  return { h, m };
}

function clockHint(text) {
  if (/\b(tonight|evening|night)\b/.test(text)) return 'pm';
  if (/\bafternoon\b/.test(text)) return 'pm';
  if (/\bmorning\b/.test(text)) return 'am';
  return null;
}

// {h, m, endH?, endM?} or {ambiguous:true} or null.
function parseClock(text) {
  const range = text.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/i);
  if (range) {
    const mer = range[3] || range[6];
    const start = to24(range[1], range[2], mer);
    const end = to24(range[4], range[5], range[6]);
    if (!start || !end) return { ambiguous: true };
    return { ...start, endH: end.h, endM: end.m };
  }
  const spoken = text.match(/\b(midnight|noon|midday)\b/);
  if (spoken) return spoken[1] === 'midnight' ? { h: 0, m: 0 } : { h: 12, m: 0 };
  const ampm = text.match(/\b(?:at\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/i);
  if (ampm) {
    const t = to24(ampm[1], ampm[2], ampm[3]);
    return t || { ambiguous: true };
  }
  const h24 = text.match(/\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (h24) {
    const h = Number(h24[1]);
    if (h >= 13) return { h, m: Number(h24[2]) };
    const hinted = clockHint(text);
    if (hinted) {
      const t = to24(h, h24[2], hinted);
      return t || { ambiguous: true };
    }
    return { ambiguous: true };
  }
  const at = text.match(/\bat\s+(\d{1,2})(?:[:.](\d{2}))?\b/);
  if (at) {
    const hinted = clockHint(text);
    if (!hinted) return { ambiguous: true };
    const t = to24(at[1], at[2], hinted);
    return t || { ambiguous: true };
  }
  return null;
}

function explicitPast(text) {
  return /\b(yesterday|last night|last week|last month|ago)\b/.test(text)
    || /\blast\s+(?:sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.test(text);
}

function longWeekday(text) {
  return text.match(/\b(?:(next|this)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|tues|thurs)\b/);
}

function shortWeekday(text) {
  return text.match(/\b(next|this|on)\s+(sun|mon|tue|wed|thu|fri|sat)\b/);
}

// Civil date the user actually said, or null. `explicitToday` means they said today/tonight.
function parseCivil(text, today) {
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const y = +iso[1]; const m = +iso[2]; const d = +iso[3];
    if (y > 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31) return { y, m, d, explicitYear: true };
  }
  if (/\bday after tomorrow\b/.test(text)) return { ...addDays(today.y, today.m, today.d, 2) };
  if (/\btomorrow\b/.test(text)) return { ...addDays(today.y, today.m, today.d, 1) };
  if (/\b(today|tonight)\b/.test(text)) return { ...today, explicitToday: true };
  const inDays = text.match(/\bin\s+(\d+)\s+days?\b/);
  if (inDays && +inDays[1] >= 1 && +inDays[1] <= 366) return { ...addDays(today.y, today.m, today.d, +inDays[1]) };
  const md1 = text.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_ALT})(?:\\s+(\\d{4}))?\\b`));
  if (md1 && MONTHS[md1[2]]) return { y: md1[3] ? +md1[3] : today.y, m: MONTHS[md1[2]], d: +md1[1], explicitYear: !!md1[3], monthDay: true };
  const md2 = text.match(new RegExp(`\\b(${MONTH_ALT})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?\\b`));
  if (md2 && MONTHS[md2[1]]) return { y: md2[3] ? +md2[3] : today.y, m: MONTHS[md2[1]], d: +md2[2], explicitYear: !!md2[3], monthDay: true };
  const slash = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slash) {
    let d = +slash[1]; let m = +slash[2];
    if (m > 12 && d <= 12) { const swap = d; d = m; m = swap; }
    let y = today.y;
    if (slash[3]) y = slash[3].length === 2 ? 2000 + +slash[3] : +slash[3];
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return { y, m, d, explicitYear: !!slash[3], monthDay: true };
  }
  const long = longWeekday(text);
  const short = long ? null : shortWeekday(text);
  const hit = long || short;
  if (hit) {
    const qualifier = hit[1] || '';
    const index = weekdayIndex(hit[2]);
    if (index != null) return { weekday: index, qualifier, nextWeek: /\bnext week\b/.test(text) };
  }
  if (/\bnext week\b/.test(text)) return { nextWeekOnly: true };
  return null;
}

function validYmd(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function at(ymd, h, min, zone) {
  return zonedTimeToUtc(ymd.y, ymd.m, ymd.d, h, min, zone);
}

function ask(askText) {
  return { kind: 'ask', ask: askText };
}

// What the user said, resolved against `now` in `timeZone`. Never returns a past instant.
export function parseWhen(text, { now = Date.now(), timeZone = 'UTC' } = {}) {
  const zone = sanitizeZone(timeZone);
  const s = String(text || '').toLowerCase();
  if (explicitPast(s)) return { kind: 'past' };
  const todayParts = zonedParts(new Date(now), zone);
  const today = { y: todayParts.year, m: todayParts.month, d: todayParts.day };
  const todayIndex = WD[todayParts.weekday];
  const clock = parseClock(s);
  if (clock?.ambiguous) return ask(ASK_MERIDIEM);
  const civil = parseCivil(s, today);
  if (civil?.nextWeekOnly && !clock) return ask(ASK_WEEK);
  if (civil?.nextWeekOnly && clock) return ask(ASK_WEEK);
  if (!civil && !clock) return ask(ASK_BOTH);
  if (civil && !clock) return ask(ASK_TIME);

  let ymd;
  if (!civil) {
    ymd = { ...today };
    if (at(ymd, clock.h, clock.m, zone).getTime() < now) ymd = addDays(today.y, today.m, today.d, 1);
  } else if (civil.weekday != null) {
    let delta = (civil.weekday - todayIndex + 7) % 7;
    const probe = delta === 0 ? at(today, clock.h, clock.m, zone).getTime() < now : false;
    if (delta === 0 && (civil.qualifier === 'next' || civil.nextWeek || probe)) delta = 7;
    if (civil.nextWeek && delta < 7) delta += 7;
    ymd = addDays(today.y, today.m, today.d, delta);
  } else {
    ymd = { y: civil.y, m: civil.m, d: civil.d };
    if (!validYmd(ymd.y, ymd.m, ymd.d)) return ask(ASK_BOTH);
    let startProbe = at(ymd, clock.h, clock.m, zone);
    if (civil.monthDay && !civil.explicitYear && startProbe.getTime() < now) {
      ymd = { ...ymd, y: ymd.y + 1 };
      startProbe = at(ymd, clock.h, clock.m, zone);
    }
    if (startProbe.getTime() < now) {
      if (civil.explicitToday) return ask(ASK_PASSED);
      if (civil.explicitYear) return { kind: 'past' };
      return ask(ASK_PASSED);
    }
  }

  if (!validYmd(ymd.y, ymd.m, ymd.d)) return ask(ASK_BOTH);
  const start = at(ymd, clock.h, clock.m, zone);
  if (start.getTime() < now) {
    if (civil?.explicitToday) return ask(ASK_PASSED);
    return ask(ASK_PASSED);
  }
  let end;
  if (clock.endH != null) {
    end = at(ymd, clock.endH, clock.endM, zone);
    if (end.getTime() <= start.getTime()) end = at(addDays(ymd.y, ymd.m, ymd.d, 1), clock.endH, clock.endM, zone);
  } else {
    end = new Date(start.getTime() + 60 * 60 * 1000);
  }
  return { kind: 'event', start: formatRfc3339(start, zone), end: formatRfc3339(end, zone) };
}

function calm(reply) {
  const text = String(reply || '').trim();
  if (!text || /\b(calendar|add|adding|added)\b/i.test(text)) return 'Got it.';
  return text;
}

function dropEvents(list, reply, askText) {
  return { actions: list.filter((a) => a?.name !== 'add_event'), reply: askText || calm(reply), ask: askText || null };
}

// Drop or rewrite add_event using the owner's words. Other actions are left alone.
export function reviewCalendarTurn({ userText = '', actions = [], reply = '', now = Date.now(), timeZone = 'UTC' } = {}) {
  const zone = sanitizeZone(timeZone);
  const list = (Array.isArray(actions) ? actions : []).map((a) => (
    a && typeof a === 'object' ? { ...a, args: { ...(a.args && typeof a.args === 'object' ? a.args : {}) } } : a
  ));
  if (!list.some((a) => a?.name === 'add_event')) return { actions: list, reply: String(reply || ''), ask: null };
  if (isPastCalendarMention(userText)) return dropEvents(list, reply, null);
  const when = parseWhen(userText, { now, timeZone: zone });
  switch (when.kind) {
    case 'ask':
      return dropEvents(list, reply, when.ask);
    case 'past':
      return dropEvents(list, reply, null);
    case 'event': {
      const text = String(reply || '').trim();
      const spoken = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b|\d{4}-\d{2}-\d{2}/i.test(text) ? '' : text;
      return {
        actions: list.map((a) => (a?.name === 'add_event' ? { ...a, args: { ...a.args, start: when.start, end: when.end } } : a)),
        reply: spoken,
        ask: null,
      };
    }
    default: {
      const unexpected = when.kind;
      throw new Error(`unexpected calendar when: ${unexpected}`);
    }
  }
}
