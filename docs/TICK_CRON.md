# Reliable life tick

GitHub's scheduled `life-tick.yml` (every 30 min) is a backup only: GitHub drops many scheduled runs
(on 2026-10-25 only 1 of the last 40 runs was a scheduled one). Use one primary timer below.

## Option A (free, recommended): cron-job.org
1. Create a job at https://cron-job.org: URL `https://virtual-world-ai.onrender.com/tick`, method **POST**, every **15 minutes**.
2. Advanced → Headers: add `x-tick-secret` with the same value as Render's `TICK_SECRET` env var.
3. Request timeout: the maximum allowed. The proxy may be asleep, and a timeout after it has started does not stop the tick.
4. Save and enable. The response body is the tick summary JSON (`agents`, `due`, `acted`, `meets`, `townMeets`, `published`, ...).

## Option B (paid): Render cron job
Apply `render.yaml` as a Blueprint in Render. It creates only the `virtual-world-tick` cron (Starter plan) that runs
`node scripts/tick.mjs` every 15 minutes. Set `TICK_SECRET` on that cron job in the dashboard (same value as the web service).

## Proxy env vars (Render web service virtual-world-ai)
- `TICK_SECRET` (existing, ≥16 chars) and `LIFE_SALT` (existing). Unchanged.
- `LIFE_MAX_CALLS` (optional, new): Gemini calls per tick, 1..500, default 50. A meet costs 2 calls.

## Scaling
Each tick visits only due agents (active in 14 days, ≥25 min since last action, under the daily cap of 12),
longest-waiting first, until the call budget or ~170 s runs out. For large worlds, split with
`POST /tick?shard=i&of=n` (n ≤ 16; `TICK_SHARDS=n` in `scripts/tick.mjs` runs all shards in sequence).
