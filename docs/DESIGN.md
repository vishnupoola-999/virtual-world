# Virtual World design log (Diggy)

Times are IST. Newest entries are at the bottom; keep appending.

## 2026-10-23: Chat tab (v1)
- The Chat tab is the default tab, with World as the second. The agent's character sits in a header at the top, and the header shrinks to 64 px on scroll.
- Night theme tokens: `--bg #070b18`, `--surface #101830`, `--surface-2 #18223f`, `--line #24304f`, `--text #eef2ff`, `--muted #9aa6c7`, `--accent #1e88e5` (kept from the existing app), `--accent-2 #5eb4ff`, `--glow #ffc861` (city lights), `--friend #ff7043`, `--ok/--err #3ddc97/#ff6b6b`.
- The agent speaks first, offering the chips "Find my friends" and "📍 Show me". Show me flies the World tab to the agent.
- No raw errors: chat shows "waking up your agent…" after about 3 s, and failures show a banner with Retry. This matches SWE's PR #7 behaviour.
- Checked the repo: the map runs on MapLibre GL, not CesiumJS.
- Files: `chat-tab-mockup.html`, `chat-tab-spec.md`, `chat-tab*.png`.

## 2026-10-23: Characters v1 + night map
- Replaced the robot with two human base characters, girl and boy, built procedurally in three.js (`src/character.js`). There are no third-party assets. Each is under 10k triangles with no textures, so every part can be recoloured instantly.
- I didn't use Quaternius or Kenney models. Their CC0 licences are fine, but per-part recolouring and Indian outfit options would need Blender work.
- Customisation: skin (6 tones), hairstyle, hair colour, outfit, outfit colour, and extras (glasses, headphones, cap, bindi).
- Animations: idle, wave, walk and talk, procedural and capped at 30 fps.
- Night map style `map-style-night.json` on OpenFreeMap tiles (keyless):
  - Navy ground and dark water.
  - Roads coloured by class: amber motorways and primaries, blue secondaries, muted minor streets.
  - An amber glow under major roads.
  - 3D buildings in navy to periwinkle. Buildings with no height data get 6–15 m based on their ID, which fixes the flat Hanamkonda blocks.
  - City lights on the globe.
- At this point the base was picked from the first name. That was superseded on Oct 24 (see below).

## 2026-10-24: Characters v2 (Vishnu's feedback)
- **No cheek blush circles.** They looked bad, especially on dark skin.
- **Boy and girl are clearly distinct:**
  - Boy: squarer, broader jaw (a deformed skull, so no seams), broader shoulders, thicker straight brows, no lashes. Defaults are short hair and a tee.
  - Girl: narrower shoulders, thin arched brows and one tiny lash flick. Defaults are long hair and a dress.
- **Softer style:** a cute, neutral toy/chibi look with matte materials (roughness of about .9) and nothing makeup-like.
- **Small mouth:** a dark smile arc at rest. When talking, a small dark oval opens and closes with eased, varied syllables. No red lips.
- **Base-aware options** via `sanitize()`:
  - Bindi and dress are for the girl only.
  - The boy gets a straight men's kurta with a band collar.
  - Long hair, ponytail, bun and bob are girl only.
- Fixed the Idle-highlight screenshot bug.

## 2026-10-24: PR #9 / #10 integration (Buildy), review notes
- PRs #9 (characters + night map) and #10 (Chat/World tabs, character header, Show me) are merged to main.
- Improvements to my code that are now on main, so the design copy was re-synced from main:
  - Geometries are disposed on rebuild.
  - The flared hems and kurta use a shared DoubleSide material (`M.top2`) instead of mutating materials per mesh.
- **MapLibre controls:** `src/style.css` restyles them dark. `.maplibregl-ctrl-group` uses `--surface` and `--line`, and the icons are inverted with `filter:invert(1) hue-rotate(180deg)`. The top-right controls sit below the top bar (`top: calc(48px + safe-area)`).
- **Open follow-up: the map credits box is still white.** The `.maplibregl-ctrl-attrib` compact box keeps MapLibre's default white background. Suggested CSS:
  ```css
  .maplibregl-ctrl-attrib,.maplibregl-ctrl-attrib.maplibregl-compact{background:#101830cc!important;color:var(--muted)}
  .maplibregl-ctrl-attrib a{color:var(--muted)}
  .maplibregl-ctrl-attrib-button{filter:invert(1) hue-rotate(180deg)}
  ```
  Keep the credits visible, since the OpenStreetMap/OpenMapTiles licence requires them.
- Note: I couldn't find written PR #10 review comments on GitHub or the box, so the points above come from reading the merged code. Add any review notes Vishnu or SWE gave here.

## 2026-10-24: Picker decision
- **Vishnu decided:** onboarding shows both base characters (Girl and Boy) side by side as two tappable cards. There's **no name-based guess and nothing preselected**, so the user must tap one.
- `guessBase()` is kept only to migrate old agents that have no `look.base`.
- This replaces the "pending" note in `docs/DECISIONS.md` and the open item in `docs/ROADMAP.md`. Buildy should update both.

## 2026-10-24: Onboarding (the first 60 seconds)
- `onboarding-mockup.html` has six steps:
  1. Night globe with "Your agent is waiting to be born."
  2. One-tap Google sign-in.
  3. "Where should your agent live?" with Use my location or Choose a spot instead, plus the approximate-area privacy line.
  4. Dive from space to the street, then an orb lands with a bounce and dust puff.
  5. Girl/Boy cards with no preselection, a name field, Continue enabled only when both are set, and "Customise look later".
  6. The agent greets you first in chat.
- Design choice: an **orb** lands in step 4, not a character, because the look is picked after landing. The orb hatches into the chosen character after step 5.
- The mockup includes Back and Skip buttons, 6 progress pills, reduced-motion support, and the error states (sign-in failed or cancelled, location denied, offline).
- The spec is in `onboarding-spec.md`: copy, timings, animations, states, analytics events, and performance notes.

## 2026-10-24: Onboarding v2 (Vishnu's feedback)
- **Character cards have no text labels.** The cards show only the characters. The tick and wave on selection stay, and the accessible names are the neutral "Character 1" and "Character 2".
- **Removed the "Where should your agent live?" step.** The agent is born at the user's current location automatically.
  - After Google sign-in, the app shows only the system location prompt (no explainer) and dives straight to the spot.
  - If location is denied, unavailable or times out after 8 s, the app never blocks. It falls back to a city-level spot (IP or account locale), then to a default (Warangal centre), and marks the agent `approx:true`. A small note at landing says "…in Hanamkonda for now. You can move it later." The greeting mentions it once.
- **The privacy line moved** to a small caption at the top of the dive: "🔒 Friends only see the approximate area".
- **New "📍 Move my agent" affordance:**
  - A button in the chat header (mocked) and in the agent's sheet on the World tab, plus long-press on your own agent on the map.
  - The agent is lifted, you drag it, then confirm with "My agent lives here". That clears `approx`.
- **The flow is now 5 steps:** globe → sign-in (plus the system location prompt) → dive and landing → pick and name → first chat. There are 5 progress pills.
- **Screenshots re-rendered.** The obsolete location screens were deleted. The denied state is kept as `onboarding-3b-denied-fallback.png`.

## 2026-10-25: Interests step, pinned Continue
- The interests sheet is a fixed column (max 100dvh). Only the chip list scrolls; the header, About you box and Continue stay put.
- Continue sits in a sticky footer on the solid sheet background, full width with 16px side padding and `calc(16px + env(safe-area-inset-bottom))` below. A 16px gradient fade on its top edge (no blur) hints that chips scroll under it.
- With the keyboard open the sheet follows the visual viewport: secondary copy (subtitle, helper line, hint) hides so the bio box and Continue both fit, and the footer never covers the bio.
- Screenshots: `continue-closed.png`, `continue-keyboard.png` (360x640, 5 picked).

## 2026-10-25: Grok-style chat
- Bot replies have no avatar, name or bubble: full-width plain text on the dark background, 15px, line-height 1.5, continuous like Grok Bot. Long words wrap with `overflow-wrap:anywhere`, never `break-all`.
- Copy, like and read-aloud sit small (14px icons) and grey under each reply.
- User messages are right-aligned bubbles with a 10% white fill (`rgba(255,255,255,0.10)`) and light text, rounded, max-width 80%.
- Spacing: 8px between messages from the same side, 20px when the side switches. Animations stay transform/opacity only, no blur, no emoji.
- Screenshots: `chat-before.png`, `chat-after.png` (360x740).

## 2026-10-25: Nav stack (v3 input and tab bar)
- Tab bar: centred floating pill, 56px, #111318, hairline border rgba(255,255,255,.06), safe-area padding below. Active tab #1E2129 with white text, inactive 60% white.
- Chat input: 52px, fully rounded, #111318, border rgba(255,255,255,.10), placeholder 40% white. Send is a 36px circle: solid white with a black arrow as soon as there is text (class `on`, no fade); #2a2d36 with a 40% white arrow when empty; #1E2129 while a reply is running. It sits 12px above the tab bar.
- The chat list pads its bottom by input + tabs + safe area, so the last message is never hidden.
- Screenshot: `polish-nav.png` (360x740).

## 2026-10-25: UI v3 (MUSE/Dots/Grok-inspired)
- Type: Inter 400/500/600 (one self-hosted Latin variable woff2, 400–600). Titles 24/600 at -0.02em, headings 17/600, body 15/400 at 1.5, labels 13/500, captions 12/400.
- Colour: bg #07080C, raised #111318, sheet/chip #16181F, hover/active #1E2129. Hairline 6% white, border 10% white. Text 95% / 60% / 40% white. The accent gradient #5B8CFF to #9B6BFF is only for selected states, progress and the live dot. Online #3DDC84, error #FF5A6A.
- Radii 8, 14, 20 and pill. 4px grid with 16px side padding: spacing tokens --sp-4/8/12/16/20/24 (old 6/10/18px spacings snapped to 8/12/20).
- Labels are sentence case ("Map style", "On the map"); only tiny date labels like "Today" stay all-caps.
- Kept by decision: existing icon stroke widths, and the accent gradient on initials, the switch-on state and the rail badge.
- Buttons are 48px: primary solid white pill with black 15/600 text, secondary #16181F with a 10% border, ghost 60% text, icon 40px circle with 20px icons at a 1.75 stroke. Pressed scale(.97) over 120ms; disabled 40%.
- Chips are 36px pills. Selected chips get a 14% accent tint, an accent border and a tick.
- Sheets: #111318, 20px top radius, 36x4 grab, translateY 240ms cubic-bezier(.2,.8,.2,1), 50% scrim (rgba(0,0,0,.5)). The away card and confirm sheet follow the same pattern.
- Motion 120–240ms, transform and opacity only, reduced-motion fallback. No blur or backdrop-filter. 3D characters are untouched.
- The chat input bar and tab bar from #37 are kept exactly as shipped.
- Screenshots: `shots/v3/*-before.png`, `*-after.png`, plus `contact-sheet-before.png` and `contact-sheet-after.png` (360x740).

## 2026-10-25: Crisp characters and rail polish
- Characters (map markers and the chat header) render at device pixels, capped at 2x, with antialias on, so they're never upscaled. A soft second rim light separates them from the dark map. Idle motion is a gentle breathing bob and occasional blinks, transform only, off under reduced motion. Cute and neutral, no blush.
- If frames average over ~20 ms, the pixel ratio drops to 1.5 to hold the frame rate on cheap phones.
- Map rail: the Friends' agents icon is never covered and stays 95% white. Its on state is a 6px accent dot centred below it.
- Right-hand column (account button, rail, zoom controls, recenter) shares one centre axis. Floating sheets on tablets are rounded on all corners.
- Screenshots: `shots/crisp/*-before.png` and `*-after.png` (deviceScaleFactor 2).
- Chat header avatar framing: head and shoulders sit inside the 44px circle with a margin above the hair, with the face centred.
## 2026-10-25: Living map + Feed (Diggy's spec)
- Other people's agents render at 85% scale (`scale:.85`, bottom-centre origin) with the name pill at 60% opacity, so your own agent always reads first. Status labels are 12px and capped at 40 characters with an ellipsis.
- Agents in the same spot fan out about 24px around it (marker offsets, no layout reflow).
- Feed is a rail button (three-line icon) opening the standard sheet. Sections are "Your agent" and "Around town" in 13/500 sentence-case labels. Rows are 52px #16181F cards with a 10% border and 14px radius; meets carry an accent dot, diary notes a 40% dot. Meet rows expand on tap (opacity + 4px translate, 180ms).
- Loading shows opacity-pulse skeleton rows (no shimmer gradients, no blur). Empty state: "Nothing yet. Bs is out exploring." Signed-out and error states use calm copy, never raw errors.
- Screenshots: `shots/feed/map-others.png`, `fan-out.png`, `feed-data.png`, `feed-empty.png`, `feed-skeleton.png` (360 wide at 2x).
- Review fixes: 40px fan-out; tap a group to zoom in and spread it (72px). Other people's characters stay 16px inside the screen edges and clear of the rail. Feed shared interests are 24px accent-tint chips instead of a sentence.
- Vishnu's direction: other people's agents on the map are characters only, with no name or status pill. Your own agent keeps its "You · name" pill.
- Chat > Activity (Vishnu): a 40px clock icon button in the chat header (accent tint when on) swaps the chat log for "What your agent did": meet rows with interest chips that expand to show what was said, and diary notes. Same row, chip, skeleton and empty-state ("Nothing yet. Bs is out exploring.") styles as the Feed. The Feed sheet keeps only "Around town".
- Agent chats (Vishnu): a rail button with two speech bubbles and an 8px accent unread dot opens the "Agent chats" sheet. "Worth meeting" cards are #16181F with an accent border: the note or one plain line ("Met Mira, you both like music and chess."), interest chips, and two ghost pills, "Say hi" (opens a local draft that is never sent) and "Maybe later". The "Log" below has one-line rows that expand to a one-sentence gist. Chat is left clean. Shots: `shots/feed/agent-chats-log-v3.png`, `agent-chats-highlight-v3.png`, `chat-clean-v3.png`.
- Agent chats v4 (Diggy): a 32px ghost × dismiss in the card's top-right, "Say hi" as the only button at full width, and the log ordered newest first. Shots: `shots/feed/agent-chats-highlight-v4.png`, `agent-chats-log-v4.png`.
- Say hi (Vishnu): the composer opens inline in the worth-meeting card. It has a 3-row textarea, a counter on the right and short error copy on the left in soft red, then Cancel (ghost) and Send (accent gradient, the only filled button). After sending, the card shows a check and "Request sent" in accent, and the log row shows a small outlined "Hi sent · pending" pill. Incoming requests sit above "Worth meeting" under "Wants to connect": the name in bold, the message in secondary text, a time, and a × only. Motion is opacity/translate fade-in only, with no blur. Shots: `shots/sayhi/composer.png`, `sent.png`, `incoming.png`, `error.png`.
- Town neighbours + polish (Vishnu, Diggy): when your agent meets a built-in town agent, a character for it walks in beside yours (or stands at the position /feed gives, when present), both turn to face each other, and it fades out when the meet ends. Same art, outfit colour picked from the name, no pill. "(town)" never shows: "Coder Arjun (town)" reads "Arjun", and the card says "Chatting with Arjun". The pill above your head is dropped while the bottom card says the same thing, and the meet bubble shows dots only. Pills and bubbles are clamped 16px inside the screen. The Feed lists only meets your agent was part of ("Met Dad" with inline chips), with no "Around town" section. Sheets slide up in 220ms (cubic-bezier(.2,.8,.2,1), transform + opacity), rows stagger in 30ms apart, the status card cross-fades on change, and buttons press to 0.97. Buildings have a lighter top and darker sides from the style light, with no textures. The map loop targets 60 fps and still drops pixel ratio on slow phones. Reduced motion turns all of it off. Shots: `shots/polish/` (before-*.png from main).
- Meet pose (Diggy, final): no connecting line between the two characters; both turn about 30 degrees toward each other with an eased turn (~250 ms) and turn back when the meet ends.
## 2026-10-25: Creatures v2 (Diggy, design/creatures-v2-notes.md)
- Six creatures replace the human characters: Blob #6E9BFF gumdrop, Puff #A98BFF ball with ears, Sprout #4FD69C bean with a leaf, Pebble #FF8A6B squat stone, Drip #FFC24A rounded drop, Mallow #45C8D8 soft cube. Baby-schema face (eyes 0.215 of head width, small mouth, no nose), no blush, no text on characters. Only your own agent has the "You · name" pill.
- Picker: a 3x2 grid of ~100px cards with a 12px gap (picker and Customise editor), no labels, selection shown by the violet border only and nothing preselected, then an optional accessory row (None, Glasses, Beanie, Tuft, Headphones, Bow) previewed on all six. Saved as look {creature, accessory}. The agent sheet uses the same six thumbnails and accessory chips. Old human looks map to a creature by outfit colour.
- Town neighbours: creature and accessory picked from /feed look.seed and colorIndex, the same on every device.
- Motion: idle breathing, staggered 0.16 s blinks, slight sway; walking is a small squash-and-stretch hop; a happy hop (happy ^ ^ eyes) when a meet starts, then the mouth moves while chatting; the 30 degree turn toward each other stays.
- Review fixes: Pebble's face lowered (eye line .40 -> .36); the beanie has a darker ribbed cuff band; map, portrait and picker cameras leave room above Sprout's leaf and Drip's tip.
- Phone budget: under 4k triangles per creature with any accessory, shared materials per creature type, pixel ratio min(dpr, 2), no blur. Shots: /workspace/shots/creatures/ (before-*.png from main, after-*.png).
## 2026-10-26: Ambient creatures worldwide (Vishnu)
- About 900 creatures live around 70 major cities and regions (India weighted up), the same on every device, so the map feels populated at any zoom. Characters only: no names, pills or status, and they can't be tapped.
- Zoomed out: small dots in each creature's colour with a thin dark ring. City zoom (11-16): tiny creature silhouettes with eyes. Street zoom (16+): the nearest four on screen become full animated creatures; their silhouettes hide.
- Shots: /workspace/shots/ambient/world.png, city.png, neighbourhood.png, street.png (360 wide at 2x).
## 2026-10-26: Crisp map and characters (Vishnu, Diggy)
- The map renders at device pixels up to 2x, and characters, the profile portrait, the chat header and the picker up to 3x, with antialiasing and no CSS upscaling. Resolution steps down only if frames drop below 30 fps. No blur effects; motion stays transform and opacity only.
- Each creature has a thin outline slightly darker than its body colour, so its shape reads against the dark map. Eyes and mouth are shader-drawn, so they stay sharp at the full canvas resolution.
- A failed save shows calm copy, for example "Couldn't save your look right now. Nothing was lost, so try again in a moment.", never a raw permission error.
- Shots: /workspace/shots/crisp/ (before-*.png from main, after-*.png; 360x780 at DPR 3).

## Ambient near you, meet layout, update prompt (2026-10-26)
Six local creatures 150-500 m around your agent. Meet partner offset MEET_DX=76px in screen space so pill and bubble stay clear; '•••' only while a reply is pending. New SW shows 'A new version is ready. Tap to refresh.' One Worth-meeting card per person (newest).
## Accept and chat (2026-10-26)
Agent chats: Chats (friends, creature avatar, last line or interests, unread) on top, then Requests (sender creature, their note, Decline/Accept), Worth meeting, Log. Accept opens the chat; decline is silent to the sender (stays Request sent). Chat: dark messenger, both creatures in the header, agents' intro centred small grey with the two creatures (not a bubble). Blocked text (400) keeps the draft and shows 'Links and contact details can't be shared here yet.'; 429 shows 'Slow down a little, try again in a minute' and fades Send for a minute. Friends get a small green ring under their creature. Null look falls back to a default creature.

## Chat API v4 (presence, read receipts, thread details)
All endpoints need a non-anonymous Firebase ID token; non-members get 404. Uids never leave the server.
- `GET /threads` → `{ myId, threads: [{ id, with: { id, name, interests, bio, look: {creature, accessory, color?} | null }, createdAt, metAt, sharedInterests: [..], last, unread }] }`. `metAt` = when the request was accepted (thread creation).
- `GET /threads/:id/messages?after=ms` → `{ threadId, typingUntil (ms, 0 if not typing; the other person), receipts (bool), seenUpTo (ms or null when receipts are off), messages: [{ id, from: 'me'|'them'|'system', fromId, text, at, status?: 'sent'|'seen' (own messages only) }], more }`. "Sending" is client-only (optimistic, before POST returns).
- `POST /threads/:id/messages {text}` → `201 { id, from:'me', fromId, text, at, status:'sent' }`. Clears your typing flag.
- `POST /threads/:id/typing` → `{ typingUntil }` (now+5 s). Max once per 2 s per thread (429). Call while the user types; hide the dots when `typingUntil` passes.
- `POST /threads/:id/read {upTo: ms}` → `{ readUpTo }`. Monotonic, clamped to now; also zeroes your unread. Max once per second per thread.
- `GET /me/chat-settings` → `{ readReceipts }` (default true). `POST /me/chat-settings {readReceipts: bool}` → same. Receipts are mutual: if either person turns them off, both get `receipts:false, seenUpTo:null` and own messages stay `sent`.
- `POST /threads/:id/messages/:mid/react {emoji:'heart', on: bool}` → `{ id, reactions: { heart, mine } }`. Members only (404 otherwise, also for unknown message), 400 for other emoji / non-boolean `on`, max 60 per minute per person (429). Idempotent: one heart per person per message. Every message in `GET /threads/:id/messages` (and the POST reply) carries `reactions: { heart: count, mine: bool }`. Stored as `threads/{id}/messages/{mid}.hearts.{h_}: true`, server-only under the existing threads rule, so no rules deploy.
Storage: `threads/{id}.typing.{h_}`, `threads/{id}.read.{h_}`, `chatPrefs/{uid}` — all server-only (existing threads rule + catch-all deny), so no rules deploy needed.

## Body colour (2026-10-28)
My agent > Colour, right under Extra: a Default swatch (the creature's own colour, shown as a six-colour wheel), eight hand-picked cute colours and a dashed More swatch (three dots) that opens the native colour picker for any colour. Selected swatch gets the accent ring used by the Extra chips. Only the body material changes, so shading, outline, eyes, mouth and accessories stay. Saved as look.color (#rrggbb); missing or invalid falls back to the creature colour. 36px swatches (44px tap targets) in one row that scrolls sideways with scroll-snap, no scrollbar and a 24px opacity fade on the right; the selected swatch is scrolled into view. Transform/opacity only.

## v4 redesign (2026-10-28)
One hero and one white primary button per screen. Navigation is a bottom tab pill (World · Chats · Me); the rail, top bar and other people's name pills are gone (only your own "You" pill stays). Chats lists Requests, Friends, Worth meeting, then "All caught up". The chat header shows both 3D creatures facing each other and a "Met X ago · Both like ..." line when `metAt`/shared interests are known (client-computed fallback for interests, hidden otherwise). Messages rise in over 180ms (transform/opacity only) and show Sending, Sent, and Seen only when the server returns read state; typing dots only when the server reports typing. Double-tap reacts with a heart (stored locally until the backend stores reactions). A first chat offers three opener chips. Accepting a request plays a connect moment under 1.5s with one "Say hi" button. The arrival plays once a day and any tap skips it; reduced motion jumps straight to the end. Character canvases cap devicePixelRatio at 2 for low-end phones. Bubbles are flat (#2B3A66 mine, #16181F theirs).

v4 presence uses Chat API v4: the typing dots hide when `typingUntil` passes; Seen comes from `seenUpTo` or a message `status:'seen'` and never shows when `receipts` is false. The app posts `/threads/:id/read {upTo}` (at most once per second) when new messages from the other person are on screen. Me has a Privacy & read receipts switch backed by `/me/chat-settings`, hidden if the endpoint is missing. Anyone with a thread appears under Friends, not Worth meeting.

Diggy review (2026-10-28): no "You" pill under your own character; the map tilt control sits under the locate button, and the scale bar and info icon hide while the say-hi card shows; anyone connected (a thread or an accepted hi) is listed under Friends; sheets pad the bottom by the tab pill height + 16px; the Me tools row ends 16px above the pill; typing shows only as "typing…" in the chat header.

## Server reactions (2026-10-28)
Double-tap a bubble to toggle your heart. The heart pops in (scale 0 to 1.2 to 1 over 250ms, transform only; no animation with reduced motion) and settles as an 18px badge on a #16181F chip over the bottom corner on the sender's side. Filled accent (#7B7CFF) when you hearted it, white when only the other person did; the count shows when more than one. The change is optimistic and rolls back if the server refuses (429 shows "Too many hearts"). Counts come from `reactions:{heart,mine}` on each message. If the react endpoint answers 404/405 before any server reaction is seen, hearts stay on this device (`vw-rx`); once the server answers, that old store is deleted. Hearts on older messages refresh when the chat is reopened, since polling only fetches newer messages.

## Connect apps API (Connect v1, as built)
Spec: design/connect-v1-spec.md (Diggy). App ids: gdrive, gcal, gmail, notion, spotify (Notion/Spotify are listed as `soon` until their providers exist).
- `GET /apps` -> `{configured, apps:[{id, name, state:'connect'|'connected'|'reauth'|'soon', account?, lastUsed?:{at, summary}, scopes:{read[], do[], never[]}}]}`. Client-only states: `connecting` (after the tap) and `error` (connect failed).
- `POST /apps/:id/connect` -> `{authUrl}` (Google consent, incremental scopes). Callback returns the browser to `/#/me?app=:id&result=ok|error`.
- `DELETE /apps/:id` -> `{state:'connect'}`.
- Chat reply (`POST /chat`, later the SSE `action` event) carries `actions[]`; a connected-app action is `{id:'act_…', app, kind:'write', title, summary, expiresAt, state:'pending'}`, and reads come as `toolResults:[{name, app, text, error?}]` (shown, not saved).
- `POST /actions/:id {decision:'approve'|'cancel'}` -> `{state:'done'|'cancelled'|'error'|'reauth'|'expired', app, result?:{summary, at, link?}, error?}`. Idempotent: approving a done action returns done again without re-running. Requests expire after 15 min. The card shows `working` locally while the call runs.
- UI: Me → Apps tiles (48px #16181F, 32px mark letter, state chip), inline disconnect confirm, and an in-chat confirm card (Cancel ghost / Approve white) with done, cancelled, error, reauth and expired lines. Minimal port; Diggy's full app sheet comes later.
