// MINIMAL PLACEHOLDER UI, owned by the design team (Diggy / Buildy Design) to restyle or replace.
// Contract: confirmAction(action) -> Promise<boolean>. Resolve true ONLY on an explicit tap.
// action.mode === 'links': show action.links ({label, href} or {label, ics, filename}) as buttons instead of Confirm;
// tapping one opens it (user gesture, so no popup blocker) and resolves true.
// Tool logic lives in src/google-tools.js and does not depend on anything in this file.
const LABEL = { draft_email: 'Email draft', send_email: 'Send this email?', add_event: 'Add this calendar event?' };
function rows(action) {
  const a = action.args || {};
  if (action.name === 'add_event') return [['Title', a.title], ['Start', a.start], ['End', a.end], ['Where', a.location], ['Notes', a.description]];
  return [['To', a.to], ['Subject', a.subject], ['Body', a.body]];
}
export function confirmAction(action) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center';
    const box = document.createElement('div');
    box.style.cssText = 'background:#14161f;color:#fff;width:100%;max-width:480px;max-height:80vh;overflow:auto;padding:16px;border-radius:16px 16px 0 0;font:14px/1.4 system-ui,sans-serif';
    const h = document.createElement('h3');
    h.textContent = LABEL[action.name] || 'Confirm?';
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
    bar.style.cssText = 'display:flex;gap:8px;margin-top:12px';
    const mk = (t, val) => { const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = t; btn.style.cssText = 'flex:1;padding:12px;border-radius:10px;border:0;font:inherit'; btn.onclick = () => { wrap.remove(); resolve(val); }; return btn; };
    const cancel = mk('Cancel', false);
    bar.append(cancel);
    if (action.mode === 'links') {
      bar.style.flexWrap = 'wrap';
      for (const l of action.links || []) {
        const el = document.createElement('a');
        el.textContent = l.label;
        el.style.cssText = 'flex:1;padding:12px;border-radius:10px;background:#fff;color:#000;text-align:center;text-decoration:none';
        if (l.ics) {
          const url = URL.createObjectURL(new Blob([l.ics], { type: 'text/calendar;charset=utf-8' }));
          el.href = url; el.download = l.filename || 'event.ics';
          setTimeout(() => URL.revokeObjectURL(url), 120_000);
        } else {
          el.href = l.href;
          if (/^https:/.test(l.href)) { el.target = '_blank'; el.rel = 'noopener'; }
        }
        el.onclick = () => { setTimeout(() => wrap.remove(), 0); resolve(true); };
        bar.append(el);
      }
    } else {
      const ok = mk('Confirm', true);
      ok.dataset.confirm = '1';
      bar.append(ok);
    }
    box.append(bar);
    wrap.append(box);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) { wrap.remove(); resolve(false); } });
    document.body.append(wrap);
    cancel.focus();
  });
}
