# Reliable life tick

GitHub's scheduled `life-tick.yml` (every 30 min) is a backup only: GitHub drops many scheduled runs
(on 2026-10-25 only 1 of the last 40 runs was a scheduled one). Use one primary timer below.

## Option A (free, recommended): cron-job.org
1. Create a job at https://cron-job.org: URL `https://virtual-world-ai.onrender.com/tick?async=1`, method **POST**, every **15 minutes**.
   `async=1` makes the proxy answer 202 at once and run the tick in the background (cron-job.org's free timeout is 30 s).
   Live job: 8719040. A second free job ("vw warm") GETs `/` at :13/:28/:43/:58 so the free Render instance is awake when the tick fires (cold starts were returning Bad Gateway).
2. Advanced → Headers: add `x-tick-secret` with the same value as Render's `TICK_SECRET` env var.
3. Request timeout: the maximum allowed. The proxy may be asleep, and a timeout after it has started does not stop the tick.
4. Save and enable. With `async=1` the body is `{"started":true}` and the summary goes to the Render log (`tick {...}`); without it the body is the summary JSON (`agents`, `due`, `acted`, `meets`, `townMeets`, `published`, ...).

## Option B (paid): Render cron job
Apply `render.yaml` as a Blueprint in Render. It creates only the `virtual-world-tick` cron (Starter plan) that runs
`node scripts/tick.mjs` every 15 minutes. Set `TICK_SECRET` on that cron job in the dashboard (same value as the web service).

## Proxy env vars (Render web service virtual-world-ai)
- `TICK_SECRET` (existing, ≥16 chars) and `LIFE_SALT` (existing). Unchanged.
- `LIFE_MAX_CALLS` (optional, new): Gemini calls per tick, 1..500, default 50. A meet costs 2 calls.

## Check the timer is really firing
Ticks were observed only every 4-7 h on 2026-10-29, so the cron-job.org job is probably disabled, failing (wrong or missing
`x-tick-secret`, Bad Gateway on cold start) or was never saved. In cron-job.org → job → History, the last runs should be
every 15 min with status 202. If not: re-enable it, re-paste the header from Render's `TICK_SECRET`, and make sure the
"vw warm" job is on. This needs the account owner's sign-in; nothing in the repo can fix it.

## Pacing
An agent may act only while its actions today (UTC) are below `min(12, ceil(12 × elapsed fraction of the UTC day) + 1)`
(`paceBudget` in `proxy/life.js`). So about one action every 2 h, never all 12 by the morning. Meet partners still only
need the hard daily cap.

## Scaling
Each tick visits only due agents (active in 14 days, ≥25 min since last action, under the daily cap of 12),
longest-waiting first, until the call budget or ~170 s runs out. For large worlds, split with
`POST /tick?shard=i&of=n` (n ≤ 16; `TICK_SHARDS=n` in `scripts/tick.mjs` runs all shards in sequence).
