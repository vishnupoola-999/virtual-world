# Virtual World – prototype

A browser-based 3D model of the neighbourhood around **100 Feet Road, Ayyappa Society / Madhapur, Hyderabad** (17.44729, 78.39499), with 8 simulated AI agents and an opt-in family layer.

> "Manikanta Colony" isn't in OpenStreetMap yet, so the centre is the most plausible geocoded match for "100 Feet Road" in Hyderabad. To move it, change `LAT/LON` in `tools_convert.py`, re-fetch with Overpass, and run the script again.

## Run
```bash
cd virtual-world
python3 -m http.server 8000
# open http://localhost:8000/            (world)
# open http://localhost:8000/join.html   (family opt-in)
# optional: ?t=8&speed=300  -> start at 08:00, 300x speed
```
No build step and no API keys. It loads Three.js from unpkg and OSM tiles from tile.openstreetmap.org, so it can go on GitHub Pages as it is.

## Files
- `index.html` – the scene: extruded buildings (uses `height`, then `building:levels`×3.2 m, otherwise 6–12 m), roads, parks, OSM ground tiles, agents, clock, HUD, and orbit/fly camera
- `join.html` – family opt-in page with a consent checkbox, Start/Stop buttons, and live `navigator.geolocation`
- `data/raw.json` – raw Overpass response (OSM data ©OpenStreetMap contributors, ODbL); `data/world.json` – the same data converted to local metres
- `tools_convert.py` – converts raw.json into world.json

## Agents
They walk along a graph built from the OSM roads (BFS shortest path).
- **Ravi (shopkeeper)**: walks to his shop, opens it at 08:00, greets passers-by and closes at 21:00.
- **Meera (teacher)**: teaches at school 08:00–13:00 and tutors at the park 16:30–19:00.
- **Arjun (reporter)**: wanders from 07:00 to 21:00 looking for other agents, collects gossip, and writes the "📰 Arjun's News" log shown in the HUD.
- Priya, Kiran, Lakshmi, Sai and Anil follow generic home → shop → home → park routines.

## Camera
Orbit: drag, right-drag and scroll. Fly: press the Mode button, then WASD, Q/E for down/up, Shift to go faster, and drag to look.

## Family layer (opt-in only)
- `join.html?room=<code>`: name + consent checkbox → shares position **every 5 s while the page is open**; **Stop** removes the avatar immediately; viewers drop anyone silent for **>2 min**.
- Relay: **ntfy.sh** (free, keyless, HTTPS, CORS). Joiners POST JSON to topic `vw1-<room>`; the world page subscribes via Server-Sent Events with `since=150s`, so it sees everyone already live. Code: `family.js`. Each viewer gets a **random private room code** on first visit (saved in localStorage); press **🔗 Share join link** to copy `join.html?room=<code>` and send it to family.
- Avatars: tall glowing figure + light beam + name label. If they're outside the 1.5 km map, they're clamped to the pink edge ring with an arrow and “Dad, 4.2 km away”. HUD: **🎯 Go to** (camera flies there) and **🗺️ Build world here** (fetches OSM live from Overpass in the browser for 1.5 km around them and rebuilds the world + agents). URL shortcut: `index.html?lat=..&lon=..&name=..`.
- Privacy: no background/covert tracking; anyone who knows the room code can read positions on the public relay, so share the link only with family. For real privacy later: Firebase Realtime Database + Auth with per-family rules.

## AI characters (`brain.js`)
- Rule-based by default: needs (hunger/social/energy) change plans, per-agent memory, relationships, gossip that spreads between agents, Arjun's news log + 20:00 headline.
- Pluggable LLM hook (OpenAI-style `{messages}` → `{choices[0].message.content}`), rate-limited, always falls back to rules. **No key in the site.** Live proxy: `proxy/server.js` on Render (`https://virtual-world-ai.onrender.com`, Gemini `gemini-flash-lite-latest`, key only in Render env `GEMINI_API_KEY`). Limits: Origin allow-list, 6 req/min/IP, 60/hour, 600/day, 300 output tokens. The site batches up to 4 encounters per call, ≤1 call/30 s, ≤1 AI line per agent per 3 min; AI lines are marked ✨. `?llm=off` disables.

## Known limits
- The location is approximate (see the note above).
- It has about 8k buildings and runs fine on a normal GPU but is slow under software rendering.
- The agents are scripted, not LLM-driven. Agents that "live" 24/7 would need a server.
