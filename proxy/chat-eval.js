// Before/after eval for the owner's chat. Hits the real Gemini API with GEMINI_API_KEY from the environment
// (sent only as a header, never printed) and rewrites docs/chat-eval.md. Run: GEMINI_API_KEY=... node proxy/chat-eval.js
import { writeFileSync } from 'node:fs';
import { buildSystemPrompt, chatGenerationConfig, ownerContext, CHAT_MODEL, CHAT_FALLBACKS } from './server.js';

const key = process.env.GEMINI_API_KEY;
if (!key) { console.error('GEMINI_API_KEY is not set'); process.exit(1); }
const now = Date.now();
const agent = { name: 'Nova', personality: 'warm, curious, a little playful' };
const memory = '- Owner is Vishnu, studies CS in Hyderabad\n- Building a 3D social app called Virtual World';
const owner = ownerContext({ bio: 'CS student and app builder in Hyderabad', interests: ['tech', 'space', 'music'] },
  [{ kind: 'meet', withName: 'Arjun', shared: ['music'], at: now - 3_600_000 }, { kind: 'diary', text: 'Wandered past Hussain Sagar at sunset', at: now - 7_200_000 }], now);
export const CASES = [
  { title: 'Long explanation (used to get cut off)', msgs: ['Explain how black holes form, step by step, and what happens at the event horizon.'] },
  { title: 'Plan with several parts', msgs: ['Give me a 5-day study plan for learning React Native, with one goal per day.'] },
  { title: 'Uses what it knows about me', msgs: ['What should I do this weekend?'] },
  { title: 'Today in Virtual World', msgs: ['Who did you meet today and what did you do?'] },
  { title: 'Multi-turn follow-up', msgs: ['I have an exam on operating systems next week.', 'Okay, quiz me with 3 questions on deadlocks.'] },
];
const OLD = { model: 'gemini-flash-lite-latest', system: buildSystemPrompt(agent, memory, ''), cfg: { maxOutputTokens: 1024, temperature: 0.9 } };

async function call(model, system, cfg, contents) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: cfg }), signal: AbortSignal.timeout(60_000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, status: r.status, error: String(j?.error?.message || '').slice(0, 160) };
  const c = j.candidates?.[0] || {};
  return { ok: true, finish: c.finishReason, text: (c.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('').trim(),
    out: j.usageMetadata?.candidatesTokenCount, think: j.usageMetadata?.thoughtsTokenCount };
}
async function pickModel() {
  for (const m of [CHAT_MODEL, ...CHAT_FALLBACKS]) {
    const r = await call(m, 'Reply with ok.', chatGenerationConfig(m), [{ role: 'user', parts: [{ text: 'ping' }] }]);
    console.log('probe', m, r.ok ? 'ok' : r.status);
    if (r.ok) return m;
  }
  throw new Error('no chat model usable with this key');
}
async function convo(model, system, cfg, msgs) {
  const contents = [], turns = [];
  for (const m of msgs) {
    contents.push({ role: 'user', parts: [{ text: m }] });
    const r = await call(model, system, cfg, contents);
    turns.push({ user: m, ...r });
    contents.push({ role: 'model', parts: [{ text: r.text || '(no reply)' }] });
  }
  return turns;
}
const fmt = (t) => t.ok ? `finish=${t.finish}, output=${t.out ?? '?'} tok, thinking=${t.think ?? 0} tok\n\n> ${(t.text || '(empty)').replace(/\n/g, '\n> ')}` : `error ${t.status}: ${t.error}`;

const model = await pickModel();
const NEW = { model, system: buildSystemPrompt(agent, memory, '', owner), cfg: chatGenerationConfig(model) };
let md = `# Owner chat eval: before vs after\n\nRun ${new Date(now).toISOString()} against the live Gemini API.\n\n- **Before:** \`${OLD.model}\`, maxOutputTokens 1024, temperature 0.9, no thinking limit, memory only.\n- **After:** \`${NEW.model}\`, ${JSON.stringify(NEW.cfg)}, plus owner profile, interests and today's diary.\n\n`;
for (const [i, c] of CASES.entries()) {
  const [b, a] = [await convo(OLD.model, OLD.system, OLD.cfg, c.msgs), await convo(NEW.model, NEW.system, NEW.cfg, c.msgs)];
  md += `## ${i + 1}. ${c.title}\n\n`;
  b.forEach((t, k) => { md += `**Owner:** ${t.user}\n\n**Before** (${fmt(t)})\n\n**After** (${fmt(a[k])})\n\n`; });
  console.log(c.title, 'before', b.map((t) => t.finish || t.status).join(','), 'after', a.map((t) => t.finish || t.status).join(','));
}
writeFileSync(new URL('../docs/chat-eval.md', import.meta.url), md);
