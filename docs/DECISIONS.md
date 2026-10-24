# Product decisions

See also: [Engineering log](ENGINEERING_LOG.md) (architecture, PR history, setup, open issues; PR #12).

## Privacy and location
- Your agent's home spot is fixed. Friends see only the approximate area.
- Live location sharing is a separate opt-in that times out after 1 hour, 8 hours or "until I stop".
- Sharing pauses in the background unless you turn that on.
- Everything shared is visible only to accepted friends, never on a public relay. The current ntfy relay is temporary and will be replaced.

## Chat-first tabs
- The app has two bottom tabs, Chat and World, and opens on Chat once you have an agent.
- The agent's character sits at the top of the chat. "Show me" flies to it on the World tab.

## Invites
- Opening someone's invite adds them as a friend. It never replaces your own world or saved room.
- All your connections are in one list, where you can remove them.
- The friend invite replaces the old separate family share link.

## Character picker (Vishnu, 2026-10-24)
- New agents pick from two unlabelled character cards (accessible names "Character 1" / "Character 2"), side by side. Nothing is preselected and there is no name-based guess; Continue/Save stays disabled until one is tapped.
- Existing agents keep their saved look. `guessBase()` is used only to migrate pre-v1 agents that have no `look.base`.

## Born where you are (Vishnu, 2026-10-24)
- No "Where should your agent live?" screen and no permission explainer. After Google sign-in the app shows only the system location prompt and dives straight to the spot.
- Location denied, unavailable or no fix within 8 s never blocks: city-level spot from IP, then Warangal centre. The agent is marked `spotApprox:true`, the landing shows "…for now. You can move it later." and the first greeting mentions it once. No re-prompt in the same session.
- "📍 Move my agent" (chat header, agent sheet, long-press on your agent on the map) lets you drag the map and confirm "My agent lives here", which clears `spotApprox`.
- Exact spot stays private to the owner; friends only ever get the ~1 km `approx` grid.

## Testing
- Check on the live site and the Android APK at the end of a batch of work, not after every PR.
- CI (lint, smoke, proxy and rules tests, debug APK) covers each PR.

## Agents that live (2026-10-24)
- Every agent belongs to a real signed-in person. Test agents exist only to have someone to meet while users are few; they are flagged `isTest: true`, use `test-` uids, and are removed with `node scripts/seed-test-agents.mjs remove`.
- Life loop: every 30 minutes `POST /tick` wakes each agent that has interests, whose owner opened the app in the last 14 days, that has not acted in 25 minutes and is under its daily cap (12 actions per UTC day, stored on `agents/{uid}.life`). One Gemini Flash-Lite call picks one action: move to an interest spot within ~2 km of the owner's approximate home, meet the most similar agent not met in 3 days (4-6 line conversation, a second call), write a diary line, or rest. Rest costs nothing against the cap.
- Matching is Jaccard overlap of interest tags for now; `similarity()` in `proxy/life.js` is the single place to swap in embeddings.
- Why GitHub Actions instead of a Render cron: the Render proxy is on the free plan and sleeps, so an in-process timer never fires, and Render cron jobs are paid. A scheduled workflow is free, wakes the server with its own request, and authenticates with a shared `TICK_SECRET` kept in GitHub secrets and Render env (never in the repo). A separate required `LIFE_SALT` (Render env only) salts hashed ids and places, so rotating `TICK_SECRET` doesn't reshuffle them; `/tick` returns 503 without it. GitHub may delay scheduled runs by several minutes; that is fine for this loop.
- Privacy rule: another agent (and its prompts, diary and friend notes) only ever sees an agent's name, interests and bio. Owner names, chats, memory, emails and exact or historical location are never read by the loop for sharing; movement targets are computed from the approximate home. The owner can read and delete their diary but cannot write `life`, `friends`, `isTest` or diary entries (rules).
