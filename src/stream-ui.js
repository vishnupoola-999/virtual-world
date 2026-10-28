// Streaming agent reply (connect-v1 spec §5/§6): 3-dot bubble, word-by-word flush, soft caret, follow-bottom with a
// "Jump to latest" chip, and the stopped / cut off / failed lines. DOM only; the network lives in connect-api.js.
export const FOLLOW_PX = 48;
// Split a buffer into whole words ready to show and the unfinished tail.
export function takeWords(buf, final = false) {
  if (final) return { words: buf ? buf.match(/\S+\s*|\s+/g) || [buf] : [], rest: '' };
  const i = Math.max(buf.lastIndexOf(' '), buf.lastIndexOf('\n'));
  if (i < 0) return { words: [], rest: buf };
  const ready = buf.slice(0, i + 1);
  return { words: ready.match(/\S+\s*|\s+/g) || [], rest: buf.slice(i + 1) };
}
export const RETRY_LINES = {
  stopped: { lead: 'Stopped', act: 'Continue', cls: '' },
  cut_off: { lead: 'Reply cut off', act: 'Tap to retry', cls: 'e' },
  cut_off_continue: { lead: 'Reply cut off', act: 'Continue', cls: 'e' }, // the server kept the partial (Buildy #62)
  failed: { lead: 'Something went wrong', act: 'Tap to retry', cls: 'e' },
  rate_limited: { lead: 'Too many messages. Wait a minute', act: 'Try again', cls: 'e' },
};
export const FAIL_TEXT = "Couldn't reach your agent. Check your connection.";

export function streamBubble({ log, view = log.closest('section') || document.body, reduced = matchMedia('(prefers-reduced-motion: reduce)').matches }) {
  const d = document.createElement('div'); d.className = 'msg bot cxStream';
  const body = document.createElement('div'); body.className = 'mbody';
  const t = document.createElement('div'); t.className = 'agent-text';
  const dots = document.createElement('span'); dots.className = 'cxDots'; dots.setAttribute('aria-label', 'Thinking'); dots.innerHTML = '<i></i><i></i><i></i>';
  t.append(dots); body.append(t); d.append(body); log.append(d);
  let buf = '', text = '', caret = null, raf = 0, last = 0, every = 30, slow = 0, follow = true, ended = false;
  const near = () => log.scrollHeight - log.scrollTop - log.clientHeight <= FOLLOW_PX;
  let chip = view.querySelector('.cxJump');
  if (!chip) { chip = document.createElement('button'); chip.type = 'button'; chip.className = 'cxJump'; chip.hidden = true; chip.innerHTML = '<span aria-hidden="true">↓</span> Jump to latest'; view.append(chip); }
  // 12px above the input bar, wherever the bar sits on this phone.
  let fade = view.querySelector('.cxFade');
  if (!fade) { fade = document.createElement('div'); fade.className = 'cxFade'; fade.setAttribute('aria-hidden', 'true'); view.append(fade); }
  const place = () => { const bar = view.querySelector('form, .composer'); if (!bar) return; const vb = view.getBoundingClientRect().bottom, off = Math.round(vb - bar.getBoundingClientRect().top);
    chip.style.bottom = off + 12 + 'px'; fade.style.setProperty('--cxBar', off + 'px'); };
  let hideT = 0;
  // Shown only while scrolled up; fades out (opacity) once back at the bottom.
  const showChip = (on) => {
    clearTimeout(hideT);
    if (on) { if (chip.classList.contains('on')) return; place(); chip.hidden = false; requestAnimationFrame(() => { chip.classList.add('on'); fade.classList.add('on'); }); return; }
    if (chip.hidden) return; chip.classList.remove('on'); fade.classList.remove('on'); hideT = setTimeout(() => { chip.hidden = true; }, 200);
  };
  chip.onclick = () => { follow = true; log.scrollTop = log.scrollHeight; showChip(false); };
  const onScroll = () => { if (ended && !chip.hidden && near()) { showChip(false); return; } if (near()) { follow = true; showChip(false); } else { follow = false; if (!ended) showChip(true); } };
  log.addEventListener('scroll', onScroll, { passive: true });
  const pin = () => { if (follow) log.scrollTop = log.scrollHeight; };
  pin();
  function flush(final = false) {
    const { words, rest } = takeWords(buf, final); buf = rest;
    if (!words.length) return;
    if (dots.isConnected) { dots.remove(); d.classList.add('has'); }
    if (!caret && !final && !reduced) { caret = document.createElement('span'); caret.className = 'caret'; caret.setAttribute('aria-hidden', 'true'); t.append(caret); }
    const frag = document.createDocumentFragment();
    for (const w of words) { const s = document.createElement('span'); s.className = reduced ? '' : 'tok'; s.textContent = w; frag.append(s); text += w; }
    caret ? t.insertBefore(frag, caret) : t.append(frag);
    pin();
  }
  const tick = (now) => {
    raf = 0; if (ended) return;
    if (last && now - last > 32 && ++slow >= 2) every = 50; // slow phone: flush less often
    if (!last || now - last >= every) { flush(); last = now; }
    if (buf) raf = requestAnimationFrame(tick);
  };
  const stopCaret = () => { caret?.remove(); caret = null; if (raf) cancelAnimationFrame(raf); raf = 0; };
  const line = (kind, onAct) => {
    for (const old of d.querySelectorAll('.cxLine')) old.remove();
    const L = RETRY_LINES[kind] || RETRY_LINES.failed;
    const p = document.createElement('p'); p.className = 'cxLine ' + L.cls;
    const b = document.createElement('button'); b.type = 'button'; b.textContent = L.act; b.onclick = () => { p.remove(); onAct?.(); };
    if (text || kind !== 'failed') p.append(L.lead + ' · ');
    p.append(b); body.append(p); pin();
  };
  return {
    el: d,
    get text() { return text + buf; },
    get started() { return !!(text || buf); },
    push(tok) { if (ended) return; buf += tok; if (!raf) raf = requestAnimationFrame(tick); },
    reopen() { ended = false; d.classList.remove('cut', 'fail'); for (const old of d.querySelectorAll('.cxLine')) old.remove(); },
    finish() { flush(true); stopCaret(); ended = true; showChip(false); log.removeEventListener('scroll', onScroll); const all = text; t.textContent = all; return all; },
    stop(onContinue) { flush(true); stopCaret(); ended = true; t.textContent = text; line('stopped', onContinue); showChip(false); },
    fail(reason, onRetry) {
      flush(true); stopCaret(); ended = true; showChip(false);
      if (!text) { dots.remove(); t.textContent = FAIL_TEXT; d.classList.add('fail'); }
      else { t.textContent = text; d.classList.add('cut'); }
      line(reason, onRetry);
    },
    remove() { stopCaret(); ended = true; log.removeEventListener('scroll', onScroll); showChip(false); d.remove(); },
  };
}
