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

## Girl/boy picker: pending
- For now the base is guessed from the first name, and you can switch it with one tap.
- A side-by-side picker with no preselection was proposed and then put on hold. The owner hasn't decided yet.

## Testing
- Check on the live site and the Android APK at the end of a batch of work, not after every PR.
- CI (lint, smoke, proxy and rules tests, debug APK) covers each PR.
