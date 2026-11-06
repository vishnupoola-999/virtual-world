// Permission before the life loop may read chats to choose who to meet.
// Default is unanswered. Nothing is read until the owner taps Allow. Not now stores a no.
const API = 'https://virtual-world-ai.onrender.com';
const $ = (id) => document.getElementById(id);

async function call(user, method, body) {
  const t = await user.getIdToken();
  const r = await fetch(API + '/me/match-consent', {
    method,
    headers: { Authorization: 'Bearer ' + t, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try { j = await r.json(); } catch { /* empty */ }
  if (!r.ok) {
    const e = new Error(j?.error || ('http ' + r.status));
    e.status = r.status;
    throw e;
  }
  return j || {};
}

export const getMatchConsent = (u) => call(u, 'GET');
export const setMatchConsent = (u, chats) => call(u, 'POST', { chats: chats === true });

export function setupConsent({ getUser }) {
  const sheet = $('consentSheet');
  const scrim = $('consentScrim');
  let busy = false;
  function show(on) {
    if (!sheet) return;
    sheet.classList.toggle('on', on);
    sheet.hidden = !on;
    sheet.setAttribute('aria-hidden', String(!on));
    if (scrim) scrim.hidden = !on;
  }
  async function choose(chats) {
    const u = getUser();
    if (!u || u.isAnonymous || busy) return;
    busy = true;
    try {
      await setMatchConsent(u, chats);
      show(false);
    } catch (e) {
      console.warn('match consent', e?.message || e);
    } finally { busy = false; }
  }
  $('consentYes')?.addEventListener('click', () => choose(true));
  $('consentNo')?.addEventListener('click', () => choose(false));
  scrim?.addEventListener('click', () => show(false));
  async function ask(u = getUser()) {
    if (!u || u.isAnonymous || !sheet) return;
    try {
      const j = await getMatchConsent(u);
      if (j && j.chats === null) show(true);
    } catch (e) {
      if (e?.status !== 404 && e?.status !== 503) console.warn('match consent', e?.message || e);
    }
  }
  return { ask, show };
}
