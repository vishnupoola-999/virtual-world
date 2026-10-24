// Chat with the user's agent through the Gemini proxy. History stays on this device for now.
// The proxy builds the system prompt. This client sends only the agent name, personality, and transcript.
import {toast} from './ui.js';
import {loadMessages, addMessage, trimMessages, MAX_MESSAGES} from './firebase.js';

const API = 'https://virtual-world-ai.onrender.com/chat';
const REPLY_TIMEOUT_MS = 60_000;
const SEND_LAST = 20; // messages sent to the proxy as context
const LOAD_TIMEOUT_MS = 5_000;
const WAKE_AFTER_MS = 3_000;
const $ = (id) => document.getElementById(id);

function friendlyError(status) {
  if (status === 401) return 'Sign in again.';
  if (status === 429) return 'Slow down.';
  return 'Check your internet and try again.';
}

export function setupChat({getAgent, getUser, hero, onShowMe, onNeedAgent}) {
  const key = () => 'vw-chat-' + (getUser()?.uid || 'guest');
  let hist = [];
  let openedFor = null;
  let busy = false;
  let greetTimer = 0;
  const log = $('chatLog');
  const input = $('chatIn');
  const send = $('chatF').querySelector('button');
  const name = () => getAgent()?.name || 'your agent';
  const scrollEnd = () => { log.scrollTop = 1e9; };
  const add = (role, text, cls = '') => {
    const d = document.createElement('div');
    d.className = `msg ${role === 'user' ? 'me' : 'ag'} ${cls}`.trim();
    d.textContent = text;
    log.append(d);
    scrollEnd();
    return d;
  };
  const typing = () => {
    const d = add('assistant', '', 'typing');
    d.setAttribute('aria-label', `${name()} is thinking`);
    for (let i = 0; i < 3; i++) d.append(document.createElement('span'));
    return d;
  };
  const chips = (list) => {
    for (const old of log.querySelectorAll('.chips')) old.remove();
    const c = document.createElement('div');
    c.className = 'chips';
    for (const [label, fn, solid] of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (solid ? ' solid' : '');
      b.textContent = label;
      b.onclick = fn;
      c.append(b);
    }
    log.append(c);
    scrollEnd();
  };
  const showMe = () => chips([['📍 Show me', () => onShowMe(getAgent()), true]]);
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
    b.className = 'banner' + (kind === 'error' ? ' err' : '');
    if (kind === 'waking') b.textContent = '☕ Waking up your agent… this can take up to a minute the first time.';
    if (kind === 'error') {
      const t = document.createElement('span');
      t.textContent = `${name()} couldn't answer. ${detail}`;
      const r = document.createElement('button');
      r.type = 'button';
      r.textContent = 'Retry';
      r.onclick = () => ask();
      b.append(t, r);
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
    input.placeholder = `Message ${agent.name}…`;
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
    const t = hist.length ? null : typing();
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
    const t = typing();
    hero.state('thinking');
    clearTimeout(greetTimer);
    greetTimer = setTimeout(() => {
      t.remove();
      const hi = `Hi ${first} 👋 I'm ${agent.name}. Want me to find your friends?`;
      if (openedFor !== who) return;
      remember('assistant', hi);
      add('assistant', hi);
      hero.state('wave');
      chips([
        ['Find my friends', () => { input.value = 'Find my friends'; sync(); $('chatF').requestSubmit(); }, true],
        ['📍 Show me', () => onShowMe(getAgent())],
      ]);
    }, 900);
  }

  const sync = () => { send.disabled = busy || !input.value.trim(); };
  input.addEventListener('input', sync);
  sync();
  log.addEventListener('scroll', () => $('hero').classList.toggle('compact', log.scrollTop > 24), { passive: true });

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

  // Sends the transcript to the proxy (also used by Retry, which resends without adding a message).
  async function ask() {
    if (busy) return;
    const user = getUser();
    if (!user || typeof user.getIdToken !== 'function') { signInPrompt(); return; }
    const agent = getAgent();
    if (!agent) { toast('Create your agent first'); return; }
    busy = true;
    sync();
    status('ok');
    hero.state('thinking');
    const pending = typing();
    const ctrl = new AbortController();
    const kill = setTimeout(() => ctrl.abort(), REPLY_TIMEOUT_MS);
    const wake = setTimeout(() => { status('waking'); hero.state('sleeping'); }, WAKE_AFTER_MS);
    const fail = (status_) => {
      pending.remove();
      status('error', friendlyError(status_));
      hero.state('error');
    };
    try {
      let token;
      try {
        // auth.currentUser.getIdToken() — getUser() is that Firebase user.
        token = await new Promise((resolve, reject) => {
          const onAbort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          if (ctrl.signal.aborted) { onAbort(); return; }
          ctrl.signal.addEventListener('abort', onAbort, { once: true });
          user.getIdToken().then(resolve, reject);
        });
      } catch (err) {
        fail(err?.name === 'AbortError' ? 0 : 401);
        return;
      }
      const messages = hist.slice(-SEND_LAST)
        .filter((message) => message && (message.role === 'user' || message.role === 'assistant'))
        .map((message) => ({ role: message.role, content: String(message.content || '').slice(0, 1000) }));
      const response = await fetch(API, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          agent: {
            name: String(agent.name || '').slice(0, 40),
            personality: String(agent.personality || '').slice(0, 300),
          },
          messages,
        }),
      });
      const type = response.headers.get('content-type') || '';
      if (!response.ok || !type.includes('application/json')) {
        fail(response.status);
        return;
      }
      const payload = await response.json();
      const reply = payload.choices?.[0]?.message?.content?.trim();
      if (!reply) { fail(0); return; }
      pending.remove();
      status('ok');
      remember('assistant', reply.slice(0, 2000));
      add('assistant', reply);
      hero.state('talking');
      showMe();
      save();
    } catch (err) {
      fail(err?.name === 'AbortError' ? 0 : err?.status);
    } finally {
      clearTimeout(kill);
      clearTimeout(wake);
      busy = false;
      sync();
    }
  }

  return { open, reset() { clearTimeout(greetTimer); greetTimer = 0; openedFor = null; } };
}
