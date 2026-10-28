// Chat with the user's agent through the Gemini proxy. History stays on this device for now.
// The proxy builds the system prompt. This client sends only the agent name, personality, and transcript.
import {toast} from './ui.js';
import {loadMessages, addMessage, trimMessages, MAX_MESSAGES, requestGoogleAccess, currentUser} from './firebase.js';
import {createGoogleTools, composeReply, TOOL_MESSAGES} from './google-tools.js';
import {reviewCalendarTurn} from './calendarWhen.js';
import {confirmAction} from './ui/confirmAction.js';

import {toolsApiEnabled} from './tools-config.js';
import {chat as chatApi, continueChat, stopChat, normAction} from './connect-api.js';
import {streamBubble} from './stream-ui.js';

const googleTools = createGoogleTools({ requestAccess: requestGoogleAccess, confirm: confirmAction, apiEnabled: () => toolsApiEnabled(currentUser()) });

// The proxy endpoint lives in connect-api.js (POST /chat, SSE when the server supports it).
const REPLY_TIMEOUT_MS = 60_000;
const SEND_LAST = 20; // messages sent to the proxy as context
const LOAD_TIMEOUT_MS = 5_000;
const WAKE_AFTER_MS = 3_000;
const $ = (id) => document.getElementById(id);


export function setupChat({getAgent, getUser, hero, onShowMe, onNeedAgent, connect = null}) {
  const key = () => 'vw-chat-' + (getUser()?.uid || 'guest');
  let hist = [];
  let openedFor = null;
  let busy = false;
  let greetTimer = 0;
  const log = $('chatLog');
  const input = $('chatIn');
  const send = $('chatF').querySelector('button.send');
  const name = () => getAgent()?.name || 'your agent';
  const scrollEnd = () => { log.scrollTop = 1e9; };
  const ICON = {
    copy: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
    good: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M7 11v9H4v-9zM7 11l4-7c1.5 0 2.5 1 2.2 2.6L12.6 10H19a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 17.8 20H7"/></svg>',
    pin: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    bolt: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><path d="M13 3 5 13h6l-1 8 8-10h-6z"/></svg>',
    read: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
  };
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
  // Agent replies: full-width plain text on the dark background, no avatar, name or bubble (Grok-style).
  // Class is `msg bot`, never `ag`: `.ag` is the map-marker class and its 64px width collapsed replies.
  const agentShell = () => {
    const d = document.createElement('div');
    d.className = 'msg bot';
    const body = document.createElement('div');
    body.className = 'mbody';
    d.append(body);
    return { d, body };
  };
  const actions = (body, text) => {
    const row = document.createElement('div');
    row.className = 'actions';
    const mk = (label, svg, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', label);
      b.innerHTML = svg;
      b.onclick = () => fn(b);
      row.append(b);
    };
    mk('Copy', ICON.copy, () => navigator.clipboard?.writeText(text).then(() => toast('Copied'), () => {}));
    mk('Good reply', ICON.good, (b) => b.classList.toggle('on'));
    if ('speechSynthesis' in globalThis) mk('Read aloud', ICON.read, () => { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(text)); });
    body.append(row);
  };
  const add = (role, text, cls = '') => {
    let d;
    if (role === 'user') {
      d = document.createElement('div');
      d.className = `msg user ${cls}`.trim();
      d.textContent = text;
    } else if (cls === 'sys') {
      d = document.createElement('div');
      d.className = 'msg sys';
      d.textContent = text;
    } else {
      const m = agentShell();
      d = m.d;
      const t = document.createElement('div');
      t.className = 'agent-text';
      t.textContent = text;
      m.body.append(t);
      actions(m.body, text);
    }
    log.append(d);
    scrollEnd();
    return d;
  };
  // Streams a reply in word by word: tokens are appended as text nodes (never re-rendering the message),
  // batched once per animation frame, each fading in over 180 ms, with a soft dot caret while it runs.
  const stream = (text) => new Promise((done) => {
    const m = agentShell();
    const t = document.createElement('div');
    t.className = 'agent-text';
    m.body.append(t);
    log.append(m.d);
    const words = text.match(/\S+\s*|\s+/g) || [text];
    if (REDUCED.matches || document.hidden) {
      t.textContent = text;
      actions(m.body, text);
      scrollEnd();
      done(m.d);
      return;
    }
    const caret = document.createElement('span');
    caret.className = 'caret';
    caret.setAttribute('aria-hidden', 'true');
    t.append(caret);
    let i = 0;
    let last = 0;
    let acc = 0;
    const perFrameMs = 45; // about 22 words a second, a typical model stream rate
    const step = (now) => {
      if (!m.d.isConnected) { done(m.d); return; }
      acc = Math.min(4, acc + (last ? (now - last) / perFrameMs : 1)); // at most 4 words per frame, so a long task can't dump the reply at once
      last = now;
      const n = Math.floor(acc);
      acc -= n;
      last = now;
      const frag = document.createDocumentFragment();
      for (let k = 0; k < n && i < words.length; k++, i++) {
        const span = document.createElement('span');
        span.className = 'tok';
        span.textContent = words[i];
        frag.append(span);
      }
      t.insertBefore(frag, caret);
      scrollEnd();
      if (i < words.length) { requestAnimationFrame(step); return; }
      caret.remove();
      t.textContent = text; // collapse the token spans into one text node
      actions(m.body, text);
      scrollEnd();
      done(m.d);
    };
    requestAnimationFrame(step);
  });
  const typing = (label = 'Thinking it through…') => {
    const m = agentShell();
    m.d.classList.add('thinking');
    m.d.setAttribute('aria-label', `${name()} is thinking`);
    const th = document.createElement('div');
    th.className = 'think';
    const orbit = document.createElement('span');
    orbit.className = 'orbit';
    const lab = document.createElement('span');
    lab.textContent = label;
    th.append(orbit, lab);
    const sks = document.createElement('div');
    sks.className = 'sks';
    for (const w of ['92%', '74%', '48%']) {
      const l = document.createElement('div');
      l.className = 'sk';
      l.style.width = w;
      sks.append(l);
    }
    m.body.append(th, sks);
    log.append(m.d);
    scrollEnd();
    m.d.label = (v) => { lab.textContent = v; };
    return m.d;
  };
  const chips = (list) => {
    for (const old of log.querySelectorAll('.chips')) old.remove();
    const c = document.createElement('div');
    c.className = 'chips';
    for (const [label, fn, solid, icon] of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (solid ? ' on' : '');
      if (icon) b.innerHTML = ICON[icon];
      b.append(label);
      b.onclick = fn;
      c.append(b);
    }
    log.append(c);
    scrollEnd();
  };
  const showMe = () => chips([['Show me', () => onShowMe(getAgent()), true, 'pin']]);
  const save = () => localStorage.setItem(key(), JSON.stringify(hist.slice(-40)));
  let writes = 0;
  // Adds a message to the transcript, this device's cache and (when signed in) Firestore, so it follows you to other devices.
  const remember = (role, content) => {
    hist.push({ role, content });
    hist = hist.slice(-MAX_MESSAGES);
    save();
    const uid = getUser()?.uid;
    if (!uid) return;
    addMessage(uid, { role, content })
      .then(() => { if (++writes % 20 === 0) return trimMessages(uid); })
      .catch((err) => console.warn('chat history not saved:', err?.code || err?.message));
  };
  const render = () => {
    log.innerHTML = '<div class="msg sys">Today</div>';
    for (const message of hist) add(message.role, message.content);
    if (hist.length) showMe();
  };
  const signInPrompt = () => toast('Sign in to chat with your agent');

  // Header status line and the banner under it: ok | waking | error.
  function status(kind, detail = '') {
    const dot = $('chatDot');
    dot.className = 'dot' + (kind === 'waking' ? ' warn' : kind === 'error' ? ' bad' : '');
    $('chatSub').textContent = kind === 'waking' ? 'Waking up…' : kind === 'error' ? `Can't reach ${name()}` : 'Online';
    const b = $('chatBanner');
    b.innerHTML = '';
    b.hidden = kind === 'ok';
    b.className = 'banner glass' + (kind === 'error' ? ' err' : '');
    const lead = (icon, bold, rest) => {
      const ic = document.createElement('span');
      ic.className = 'ic';
      if (ICON[icon]) ic.innerHTML = ICON[icon]; else ic.textContent = icon;
      const t = document.createElement('span');
      const strong = document.createElement('b');
      strong.textContent = bold;
      t.append(strong, ' ' + rest);
      b.append(ic, t);
    };
    if (kind === 'waking') lead('bolt', `Waking up ${name()}.`, 'The first reply can take up to a minute.');
    if (kind === 'error') {
      lead('!', `${name()} couldn't answer.`, detail);
      const r = document.createElement('button');
      r.type = 'button';
      r.textContent = 'Retry';
      r.onclick = () => ask();
      b.append(r);
    }
  }

  // Returns true when the Chat tab can open (signed in with an agent, or a preview agent).
  function open() {
    const agent = getAgent();
    const user = getUser();
    if (!agent) {
      if (!user) signInPrompt(); else { toast('Create your agent first'); onNeedAgent?.(); }
      return false;
    }
    hero.set(agent);
    $('chatTitle').textContent = agent.name;
    input.placeholder = `Ask ${agent.name} anything`;
    const who = key() + '|' + agent.name;
    if (openedFor === who) return true;
    openedFor = who;
    status('ok');
    try { hist = JSON.parse(localStorage.getItem(key()) || '[]'); } catch { hist = []; }
    if (!Array.isArray(hist)) hist = [];
    render();
    const uid = user?.uid;
    if (!uid) { if (!hist.length) greet(agent, user); return true; }
    // Then the saved history from Firestore (other devices); greet only if there is none anywhere.
    const t = hist.length ? null : typing('Remembering our chats…');
    Promise.race([loadMessages(uid), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), LOAD_TIMEOUT_MS))])
      .then((remote) => {
        if (openedFor !== who || busy) return;
        if (remote.length) { hist = remote; save(); render(); }
      })
      .catch((err) => console.warn('chat history not loaded:', err?.code || err?.message))
      .finally(() => {
        t?.remove();
        if (openedFor === who && !hist.length) greet(agent, user);
        else if (openedFor === who && writes === 0) trimMessages(uid).catch(() => {});
      });
    return true;
  }

  // The agent speaks first.
  function greet(agent, user) {
    const who = openedFor;
    const first = (user?.displayName || agent.ownerName || '').split(' ')[0] || 'there';
    const t = typing('Getting ready…');
    hero.state('thinking');
    clearTimeout(greetTimer);
    greetTimer = setTimeout(() => {
      t.remove();
      const hi = `Hi ${first}, I'm ${agent.name}. Want me to find your friends?`;
      if (openedFor !== who) return;
      remember('assistant', hi);
      hero.state('wave');
      stream(hi).then(() => { if (openedFor === who) chips([
        ['Find my friends', () => { input.value = 'Find my friends'; sync(); $('chatF').requestSubmit(); }, true],
        ['Show me', () => onShowMe(getAgent()), false, 'pin'],
      ]); });
    }, 900);
  }

  // Send is a solid white circle whenever there is text (class `on`), even while a reply is still running (`busy`).
  // While a reply streams the send button is swapped for Stop (connect-v1 §5); the field stays typable.
  let streaming = null;
  const stopBtn = document.createElement('button');
  stopBtn.type = 'button'; stopBtn.className = 'cxStop'; stopBtn.hidden = true; stopBtn.setAttribute('aria-label', 'Stop');
  stopBtn.innerHTML = '<i aria-hidden="true"></i>';
  send.after(stopBtn);
  stopBtn.onclick = () => streaming?.stop();
  const sync = () => {
    const hasText = !!input.value.trim();
    send.classList.toggle('on', hasText);
    send.classList.toggle('busy', busy);
    send.disabled = busy || !hasText;
    stopBtn.hidden = !streaming; send.hidden = !!streaming;
  };
  input.addEventListener('input', sync);
  sync();
  
  $('chatF').onsubmit = (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;
    const user = getUser();
    if (!user || typeof user.getIdToken !== 'function') { signInPrompt(); return; }
    if (!getAgent()) { toast('Create your agent first'); return; }
    input.value = '';
    for (const old of log.querySelectorAll('.chips')) old.remove();
    remember('user', text.slice(0, 1000));
    add('user', text);
    ask();
  };

  // Pending connect actions (SSE `action` event or actions[] in a JSON reply) all go through one handler:
  // a confirm card that only runs after Approve. Without the apps API the card is not shown and nothing runs.
  const onAction = (raw, after) => {
    const a = normAction(raw);
    if (!a || !connect) return false;
    const el = connect.card(a);
    if (!el) return true; // a connect action, but the API is not there: drop it, never run it
    (after?.isConnected ? after : log.lastElementChild)?.after(el);
    requestAnimationFrame(() => el.classList.add('in')); // fade in (opacity + transform only)
    scrollEnd();
    return true;
  };

  // Sends the transcript to the proxy (also used by Retry, which resends without adding a message).
  // opts.bubble: reuse a stopped/cut-off bubble; opts.contId: continue a stopped / cut-off reply the server kept (POST /agent/chat/:id/continue).
  async function ask(opts = {}) {
    if (busy) return;
    const user = getUser();
    if (!user || typeof user.getIdToken !== 'function') { signInPrompt(); return; }
    const agent = getAgent();
    if (!agent) { toast('Create your agent first'); return; }
    busy = true;
    sync();
    status('ok');
    hero.state('thinking');
    const lastUser = [...hist].reverse().find((m) => m.role === 'user')?.content;
    for (const old of log.querySelectorAll('.msg.retry')) old.remove();
    if (opts.replace) opts.replace.remove();
    const sb = opts.bubble || streamBubble({ log, view: $('chatView') });
    if (opts.bubble) sb.reopen();
    const ctrl = new AbortController();
    let stopped = false, gotToken = false;
    const sub = (v) => { $('chatSub').textContent = v; };
    const think = setTimeout(() => { if (!gotToken) sub('thinking…'); }, 600);
    const noToken = setTimeout(() => { if (!gotToken) ctrl.abort(); }, 20_000);
    const kill = setTimeout(() => ctrl.abort(), REPLY_TIMEOUT_MS);
    const wake = setTimeout(() => { if (!gotToken) { status('waking'); hero.state('sleeping'); } }, WAKE_AFTER_MS);
    const retry = () => ask({ replace: sb.el });
    let messageId = opts.contId || null;
    // One line per outcome (connect-v1 §6). Stopped and cut-off replies the server kept can be continued.
    const fail = (reason = 'failed') => {
      hero.state('error');
      sub('Online');
      status('ok');
      if (reason === 'cut_off' && messageId && sb.started) sb.fail('cut_off_continue', () => ask({ bubble: sb, contId: messageId }));
      else sb.fail(reason, retry);
    };
    try {
      let token;
      try {
        token = await new Promise((resolve, reject) => {
          const onAbort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          if (ctrl.signal.aborted) { onAbort(); return; }
          ctrl.signal.addEventListener('abort', onAbort, { once: true });
          user.getIdToken().then(resolve, reject);
        });
      } catch (err) {
        fail('failed');
        return;
      }
      const messages = hist.slice(-SEND_LAST)
        .filter((message) => message && (message.role === 'user' || message.role === 'assistant'))
        .map((message) => ({ role: message.role, content: String(message.content || '').slice(0, 1000) }));
      let timeZone = 'UTC';
      try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { /* UTC */ }
      const body = {
        agent: { name: String(agent.name || '').slice(0, 40), personality: String(agent.personality || '').slice(0, 300) },
        messages, tools: true, timeZone,
      };
      const tokenUser = { getIdToken: async () => token };
      // Stop closes the stream (abort) and tells the server, which saves the partial reply.
      streaming = { stop: () => { stopped = true; ctrl.abort(); if (messageId) stopChat(tokenUser, messageId); } };
      sync();
      const handlers = {
        signal: ctrl.signal,
        onStart: (id) => { messageId = id; },
        onToken: (t) => { if (!gotToken) { gotToken = true; status('ok'); sub('replying…'); hero.state('talking'); } sb.push(t); },
        onAction: (a) => onAction(a, sb.el),
        onDone: (e) => { messageId = e.messageId || messageId; if (!sb.started && e.text) sb.push(e.text); },
      };
      const res = opts.contId ? await continueChat(tokenUser, opts.contId, handlers) : await chatApi(tokenUser, body, handlers);
      if (res.stream) {
        streaming = null; sync();
        sub('Online');
        if (stopped || res.stopped) {
          // Stop closes the stream; the server keeps the partial. On screen only here, never in hist/memory.
          if (!sb.started) { sb.remove(); hero.state('idle'); return; }
          sb.stop(() => (messageId ? ask({ bubble: sb, contId: messageId }) : ask({ replace: sb.el })));
          hero.state('idle');
          return;
        }
        if (res.error) { fail(res.error); return; }
        const full = sb.finish();
        if (!full.trim()) { fail('failed'); return; }
        const whole = full;
        remember('assistant', whole.slice(0, 2000));
        actions(sb.el.querySelector('.mbody'), whole);
        hero.state('talking');
        showMe();
        save();
        return;
      }
      // No SSE yet: the current JSON reply path.
      streaming = null; sync();
      sub('Online');
      if (!res.ok || !res.json) { fail(res.status === 429 ? 'rate_limited' : 'failed'); return; }
      const payload = res.json;
      let acts = Array.isArray(payload.actions) ? payload.actions : [];
      // Connect actions ({id, app, kind, summary, expiresAt}) use the same handler as the SSE action event.
      const connectActs = acts.filter((x) => normAction(x));
      acts = acts.filter((x) => !normAction(x));
      let reply = payload.choices?.[0]?.message?.content?.trim() || '';
      const reviewed = reviewCalendarTurn({ userText: lastUser || '', actions: acts, reply, now: Date.now(), timeZone });
      acts = reviewed.actions;
      reply = reviewed.reply;
      let ephemeral = '';
      if (acts.length) {
        // Agent tools: each action goes through google-tools.js, which asks confirmAction() before any write.
        const results = [];
        for (const action of acts) {
          try { results.push({ name: action?.name, text: await googleTools.run(action) }); }
          catch (err) { results.push({ name: 'error', text: err?.message || TOOL_MESSAGES.failed }); }
        }
        ({ persist: reply, ephemeral } = composeReply(reply, results));
      }
      if (!reply && !ephemeral && !connectActs.length) { fail('failed'); return; }
      sb.remove();
      status('ok');
      hero.state('talking');
      let last = null;
      if (reply) {
        remember('assistant', reply.slice(0, 2000));
        last = await stream(reply);
      }
      for (const a of connectActs) onAction(a, last);
      // Calendar listings: on screen only, never in hist, localStorage, Firestore or later prompts.
      if (ephemeral) add('assistant', ephemeral, 'ephemeral');
      showMe();
      save();
    } catch (err) {
      streaming = null; sync();
      if (stopped) { if (sb.started) sb.stop(() => (messageId ? ask({ bubble: sb, contId: messageId }) : ask({ replace: sb.el }))); else sb.remove(); sub('Online'); hero.state('idle'); return; }
      fail(sb.started ? 'cut_off' : 'failed');
    } finally {
      clearTimeout(kill);
      clearTimeout(wake);
      clearTimeout(think);
      clearTimeout(noToken);
      streaming = null;
      busy = false;
      sync();
    }
  }

  return { open, reset() { clearTimeout(greetTimer); greetTimer = 0; openedFor = null; } };
}
