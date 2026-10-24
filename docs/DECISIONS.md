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
