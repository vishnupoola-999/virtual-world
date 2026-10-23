// Chat with the user's agent through the Gemini proxy. History stays on this device for now.
// The proxy builds the system prompt. This client sends only the agent name, personality, and transcript.
import {toast} from './ui.js';

const API = 'https://virtual-world-ai.onrender.com/chat';
const REPLY_TIMEOUT_MS = 60_000;
const WAKE_AFTER_MS = 3_000;
const $ = (id) => document.getElementById(id);

function friendlyError(status) {
  if (status === 401) return 'Sign in again.';
  if (status === 429) return 'Slow down.';
  return 'Try again.';
}

export function setupChat(getAgent, getUser) {
  const key = () => 'vw-chat-' + (getUser()?.uid || 'guest');
  let hist = [];
  const add = (role, text, cls = '') => {
    const d = document.createElement('div');
    d.className = `msg ${role === 'user' ? 'me' : 'ag'} ${cls}`.trim();
    d.textContent = text;
    $('chatLog').append(d);
    $('chatLog').scrollTop = 1e9;
    return d;
  };
  const save = () => localStorage.setItem(key(), JSON.stringify(hist.slice(-40)));
  const signInPrompt = () => toast('Sign in to chat with your agent');

  function open() {
    const agent = getAgent();
    const user = getUser();
    if (!user) { signInPrompt(); return; }
    if (!agent) { toast('Create your agent first (🤖 button)'); return; }
    $('chatTitle').textContent = `${agent.look?.emoji || '🤖'} ${agent.name}`;
    $('chatSub').textContent = '';
    try { hist = JSON.parse(localStorage.getItem(key()) || '[]'); } catch { hist = []; }
    if (!Array.isArray(hist)) hist = [];
    $('chatLog').innerHTML = '';
    if (!hist.length) {
      const first = (user.displayName || '').split(' ')[0] || 'there';
      hist.push({ role: 'assistant', content: `Hi ${first}! I'm ${agent.name}. What can I help you with today?` });
    }
    for (const message of hist) add(message.role, message.content);
    $('chat').hidden = false;
    setTimeout(() => $('chatIn').focus(), 50);
  }

  $('chatBtn').onclick = open;
  $('chatBack').onclick = () => { $('chat').hidden = true; };

  $('chatF').onsubmit = async (event) => {
    event.preventDefault();
    const text = $('chatIn').value.trim();
    if (!text) return;
    const user = getUser();
    if (!user || typeof user.getIdToken !== 'function') { signInPrompt(); return; }
    const agent = getAgent();
    if (!agent) { toast('Create your agent first (🤖 button)'); return; }
    $('chatIn').value = '';
    hist.push({ role: 'user', content: text.slice(0, 1000) });
    add('user', text);
    save();
    const pending = add('assistant', '…', 'typing');
    const input = $('chatIn');
    const send = $('chatF').querySelector('button');
    input.disabled = true;
    if (send) send.disabled = true;
    const ctrl = new AbortController();
    const kill = setTimeout(() => ctrl.abort(), REPLY_TIMEOUT_MS);
    const wake = setTimeout(() => {
      pending.textContent = 'waking up your agent…';
      pending.classList.remove('typing');
    }, WAKE_AFTER_MS);
    const fail = (status) => {
      pending.remove();
      add('assistant', `⚠️ ${friendlyError(status)}`);
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
      const messages = hist.slice(-8)
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
      hist.push({ role: 'assistant', content: reply });
      add('assistant', reply);
      save();
    } catch (err) {
      fail(err?.name === 'AbortError' ? 0 : err?.status);
    } finally {
      clearTimeout(kill);
      clearTimeout(wake);
      input.disabled = false;
      if (send) send.disabled = false;
    }
  };
}
