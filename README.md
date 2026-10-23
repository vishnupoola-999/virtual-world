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

## Family layer (consent first)
Someone opens `join.html`, ticks the consent box and presses **Start sharing**. Their position goes through `localStorage` and `BroadcastChannel`, so for now it only works **in the same browser on the same device**. **Stop sharing**, or closing the page, removes the marker. There's no hidden or background tracking.

**Backend needed for real use across phones (later):** Firebase Realtime Database or Firestore, plus Firebase Auth for family accounts.
- Each user writes only to `family/{uid}` with lat, lon, name and ts. Security rules let only family-group members read.
- Delete the entry on Stop, and treat entries older than about 2 minutes as offline.
- Serve the site over HTTPS (GitHub Pages does this), because phone browsers require it for geolocation.
- Supabase Realtime or a small WebSocket server would also work.

## Known limits
- The location is approximate (see the note above).
- It has about 8k buildings and runs fine on a normal GPU but is slow under software rendering.
- The agents are scripted, not LLM-driven. Agents that "live" 24/7 would need a server.
