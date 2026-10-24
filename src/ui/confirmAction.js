// MINIMAL PLACEHOLDER UI. The design team replaces this file with the real sheet (living-spec.md "Confirm sheet (V1)").
// Contract: confirmAction(action) -> Promise<{confirmed:boolean}>
//   action = {kind:'email', email:{to:string[], cc?, subject, body}} | {kind:'calendar', event:{title, start, end, details?, location?}}
//   action.mode: 'links' (default, no OAuth: buttons open Gmail/mailto or Google Calendar/.ics) | 'api' (flagged accounts: plain Confirm).
// Resolve {confirmed:true} ONLY on an explicit tap. Tool logic (src/google-tools.js) does not depend on anything else here.
import { buildMailtoUrl, buildGmailComposeUrl, buildCalendarUrl, downloadIcs } from '../agentTools.js';

function rows(action) {
  if (action.kind === 'calendar') { const e = action.event || {}; return [['Title', e.title], ['Start', e.start], ['End', e.end], ['Where', e.location], ['Notes', e.details]]; }
  const m = action.email || {};
  return [['To', (m.to || []).join(', ')], ['Cc', (m.cc || []).join(', ')], ['Subject', m.subject], ['Body', m.body]];
}
export function confirmAction(action) {
  return new Promise((resolve) => {
    const done = (confirmed) => { wrap.remove(); resolve({ confirmed }); };
    const wrap = document.createElement('div');
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center';
    const box = document.createElement('div');
    box.style.cssText = 'background:#14161f;color:#fff;width:100%;max-width:480px;max-height:80vh;overflow:auto;padding:16px;border-radius:16px 16px 0 0;font:14px/1.4 system-ui,sans-serif';
    const h = document.createElement('h3');
    h.textContent = action.kind === 'calendar' ? 'Add to your calendar?' : 'Open this email?';
    box.append(h);
    for (const [k, v] of rows(action)) {
      if (!v) continue;
      const p = document.createElement('div');
      p.style.cssText = 'margin:8px 0;white-space:pre-wrap;word-break:break-word';
      const b = document.createElement('b');
      b.textContent = `${k}: `;
      p.append(b, document.createTextNode(String(v))); // textContent only, never innerHTML
      box.append(p);
    }
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:12px';
    const btn = (t, fn) => { const el = document.createElement('button'); el.type = 'button'; el.textContent = t; el.style.cssText = 'flex:1;padding:12px;border-radius:10px;border:0;font:inherit'; el.onclick = fn; bar.append(el); return el; };
    const link = (t, href) => { const a = document.createElement('a'); a.textContent = t; a.href = href; if (href.startsWith('https:')) { a.target = '_blank'; a.rel = 'noopener'; }
      a.style.cssText = 'flex:1;padding:12px;border-radius:10px;background:#fff;color:#000;text-align:center;text-decoration:none'; a.onclick = () => setTimeout(() => done(true), 0); bar.append(a); };
    btn('Cancel', () => done(false)).dataset.cancel = '1';
    if (action.mode === 'api') btn('Confirm', () => done(true)).dataset.confirm = '1';
    else if (action.kind === 'calendar') { link('Add to Calendar', buildCalendarUrl(action.event)); btn('Download .ics', () => { downloadIcs(action.event); done(true); }); }
    else { link('Open in Gmail', buildGmailComposeUrl(action.email)); link('Mail app', buildMailtoUrl(action.email)); }
    box.append(bar);
    wrap.append(box);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) done(false); });
    document.body.append(wrap);
    bar.querySelector('button').focus();
  });
}
