# 🌍 Virtual World

A real, worldwide 3D map where people (and soon their personal AI agents) appear at their real locations.

**Live:** https://vishnupoola-999.github.io/virtual-world/ · family join page: `join.html`

## What works now (Milestone 1: World map)
- Whole-Earth **globe → street level** 3D map (MapLibre GL JS v5 globe projection).
- **OpenFreeMap** vector tiles (OpenStreetMap data, keyless) with extruded **3D buildings**.
- **Terrain + hillshade** from AWS/Mapzen Terrarium elevation tiles (keyless).
- Default view: 100 Feet Road, Hanamkonda (18.00577, 79.53190), tilted 3D. URL hash keeps your view.
- **Search** any place (Nominatim) and opt-in **📍 My location** (stays in your browser).
- **Family layer:** opt-in live location sharing via `join.html` (private random room over ntfy.sh) → avatar markers at real coordinates with 🎯 Go to.
- **✈️ Flights** optional toggle (off by default) via the Render proxy `/flights`.

## Code layout
```
index.html            app shell
join.html             consent page for sharing your location with family
src/main.js           wires UI together
src/map.js            MapLibre map, globe, terrain, 3D buildings, search
src/family.js         ntfy.sh presence relay + private rooms
src/family-layer.js   family avatar markers
src/flights.js        optional live flights layer
src/style.css
proxy/server.js       Render service: /flights + rate-limited Gemini /chat (will power user agents)
```

## Roadmap
1. ✅ **World map**: accurate worldwide 3D map.
2. **Accounts + personal agent**: sign in (Google/phone); your agent spawns at your exact location.
3. **Talk to your agent**: chat with it on the map (Gemini via `proxy/`).
4. **Tasks + integrations**: meeting stand-in, Gmail/Calendar/WhatsApp etc. Free to create and experiment, subscription for real work.
5. **Growth hooks**: agent-to-agent invites ("Vishnu's agent is waiting for you") and an hours-saved card to share.

## Privacy
Location is only ever shared from `join.html` after explicit consent, only while that page is open, and only to the room link holders. "My location" is never sent anywhere.

Map data © OpenStreetMap contributors, OpenFreeMap, OpenMapTiles; terrain © Mapzen/AWS Terrain Tiles.

## Phase 2b (mobile-first app shell, 3D agent, sign-in fix)
- **Sign-in:** Google sign-in now always uses a popup (Firebase "redirect best practices", option 1). Redirect sign-in silently failed in browsers that partition third-party storage (Chrome 115+, Safari/iOS, Firefox) because the site (github.io) and `authDomain` (firebaseapp.com) differ. Redirect is only a fallback when the popup is blocked; `getRedirectResult` is always checked; auth errors show in a toast with their code. Persistence: IndexedDB → localStorage.
- **3D agent:** animated RobotExpressive character (CC0, Tomás Laulhé, via three.js examples, `assets/robot.glb`) rendered in a MapLibre custom layer with three.js, tinted with the agent colour; never smaller than ~56 px on screen.
- **UI:** full-screen map, floating buttons, dismissible bottom sheet (side panel ≥768 px), toasts. Installable PWA (`manifest.json`, `sw.js`, `icons/`).
