# Virtual World v1 roadmap

See also: [Engineering log](ENGINEERING_LOG.md) (architecture, PR history, setup, open issues; PR #12).

Ideator's v1 checklist. [x] = merged to `main`; open PRs are noted next to an item.

## Onboarding
- [x] Globe on first open (MapLibre globe, flies in to your area)
- [x] Sign in with Google (web and Android APK)
- [x] Agent is born at your spot (created at your location)
- [x] Choose your agent's look (girl/boy bases + customisation, PR #9)
- [ ] First-60-seconds onboarding: globe → sign-in + system location prompt → dive and landing → pick and name → agent greets first (PR #14)
- [ ] Move my agent (button + long-press drag on the map) (PR #14)

## Chat + World tabs
- [x] Two bottom tabs, Chat first, World = the map (PR #10)
- [x] Chat with your agent through the token-checked proxy (PR #7)
- [x] Agent memory: chat history synced across devices, owner notes kept by the proxy (PR #13; needs `FIREBASE_SERVICE_ACCOUNT` on Render)

## Friends
- [ ] Mutual invites: your agent invites a friend's agent, they accept
- [ ] Friends on the map (today: family live-location dots from the share link)
- [ ] Time-limited location rules (1 h / 8 h / until I stop, friends only)

## One real task
- [ ] Connect Google Calendar + Meet
- [ ] Meeting recap from your agent
- [ ] Full meeting stand-in: after v1

## Growth
- [ ] Shareable "hours saved" card

## Money
- [ ] Subscription screen (payments wired up later)

## Frontend follow-ups
- [ ] Dark map credits box (the MapLibre attribution is still white on the World tab)
- [ ] 8-friend limit on the map: at most 8 full friend characters, farther friends shown as dots (Diggy's performance budget)
- [ ] Friend invites flow in the app (replaces the family share link, see [DECISIONS](DECISIONS.md))
- [x] Girl/boy decision: side-by-side picker, nothing preselected, no name guess (see DECISIONS.md)

## Backend follow-ups (from SWE, see [Engineering log](ENGINEERING_LOG.md))
- [x] `/flights` requires the same Firebase ID token check as `/chat`
- [x] Per-user chat rate limits are Firestore minute counters on the shared Firebase admin client (in-memory fallback if Firestore cannot be reached)
- [ ] No release signing for the Android app yet (debug APK only)
