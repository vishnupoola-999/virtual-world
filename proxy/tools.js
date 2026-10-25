// Agent tools (Gmail + Calendar) for Gemini function calling.
// The proxy only PROPOSES actions. It never holds a Google OAuth token and never calls Gmail/Calendar.
// The client shows a confirm sheet; by default it hands off via mailto/Gmail/Calendar links (no OAuth).
// Every action except list_events needs an explicit confirm tap (see src/google-tools.js).
export const TOOL_NAMES = ['draft_email', 'send_email', 'list_events', 'add_event'];
export const CONFIRM_REQUIRED = new Set(['draft_email', 'send_email', 'add_event']);
const str = (description) => ({ type: 'STRING', description });
const email = { type: 'OBJECT', properties: { to: str('Recipient email address'), subject: str('Subject line'), body: str('Plain-text body') }, required: ['to', 'subject', 'body'] };
export const TOOL_DECLARATIONS = [{
  functionDeclarations: [
    { name: 'draft_email', description: 'Save a Gmail draft for the owner. The owner confirms first.', parameters: email },
    { name: 'send_email', description: 'Send an email from the owner\'s Gmail. The owner confirms first.', parameters: email },
    { name: 'list_events', description: 'List the owner\'s upcoming Google Calendar events.', parameters: { type: 'OBJECT', properties: { days: { type: 'INTEGER', description: 'How many days ahead, 1-14' } } } },
    { name: 'add_event', description: 'Add an event to the owner\'s Google Calendar. The owner confirms first.', parameters: { type: 'OBJECT', properties: { title: str('Event title'), start: str('ISO 8601 start, with offset'), end: str('ISO 8601 end, with offset'), description: str('Optional notes'), location: str('Optional place') }, required: ['title', 'start', 'end'] } },
  ],
}];
export const TOOLS_PROMPT = ' You can help with the owner\'s Gmail and Google Calendar using your tools. Only use a tool when the owner clearly asks. Never invent recipient addresses; ask if unsure. The owner always reviews and confirms drafts, sends and new events before anything happens.';
const EMAIL_RE = /^[^\s@<>,;"]{1,64}@[^\s@<>,;"]{1,190}\.[A-Za-z]{2,}$/;
// Strip CR/LF and control chars from header-like fields (prevents header injection).
// eslint-disable-next-line no-control-regex
const line = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
// eslint-disable-next-line no-control-regex
const text = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max);
const isoOk = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && !Number.isNaN(Date.parse(v));

// Validates one Gemini functionCall. Returns a clean action or null.
export function cleanAction(call) {
  if (!call || typeof call !== 'object' || !TOOL_NAMES.includes(call.name)) return null;
  const a = call.args && typeof call.args === 'object' ? call.args : {};
  let args;
  if (call.name === 'draft_email' || call.name === 'send_email') {
    const to = line(a.to, 254);
    if (!EMAIL_RE.test(to)) return null;
    args = { to, subject: line(a.subject, 200), body: text(a.body, 5000) };
  } else if (call.name === 'list_events') {
    const days = Math.min(14, Math.max(1, Math.round(Number(a.days) || 7)));
    args = { days };
  } else {
    if (!isoOk(a.start) || !isoOk(a.end) || Date.parse(a.end) <= Date.parse(a.start)) return null;
    args = { title: line(a.title, 200) || 'Event', start: a.start.slice(0, 40), end: a.end.slice(0, 40), description: text(a.description, 2000), location: line(a.location, 200) };
  }
  return { name: call.name, args, confirm: CONFIRM_REQUIRED.has(call.name) };
}

// Reads text and proposed actions (max 3) out of a Gemini generateContent payload.
export function parseModelReply(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  const list = Array.isArray(parts) ? parts : [];
  const reply = list.map((p) => (!p?.thought && typeof p?.text === 'string' ? p.text : '')).join('').trim();
  const actions = list.map((p) => cleanAction(p?.functionCall)).filter(Boolean).slice(0, 3);
  return { text: reply, actions };
}
