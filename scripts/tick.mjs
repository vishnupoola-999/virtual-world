// Calls POST /tick once (used by the optional Render cron in render.yaml). Never prints the secret.
//   TICK_SECRET=... [PROXY_URL=https://virtual-world-ai.onrender.com] [TICK_SHARDS=1] node scripts/tick.mjs
const url = (process.env.PROXY_URL || 'https://virtual-world-ai.onrender.com').replace(/\/$/, '');
const secret = process.env.TICK_SECRET;
if (!secret) { console.error('TICK_SECRET is not set'); process.exit(1); }
const shards = Math.min(16, Math.max(1, Number(process.env.TICK_SHARDS) || 1));
// Wake the free-plan web service first (cold start can take ~60 s).
for (let i = 0; i < 5; i++) { try { await fetch(`${url}/`, { signal: AbortSignal.timeout(90_000) }); break; } catch { await new Promise((r) => setTimeout(r, 10_000)); } }
let failed = false;
for (let shard = 0; shard < shards; shard++) {
  const r = await fetch(`${url}/tick?shard=${shard}&of=${shards}`, { method: 'POST', headers: { 'x-tick-secret': secret }, signal: AbortSignal.timeout(240_000) });
  console.log(`shard ${shard}/${shards}`, r.status, (await r.text()).slice(0, 400));
  if (!r.ok) failed = true;
}
process.exit(failed ? 1 : 0);
