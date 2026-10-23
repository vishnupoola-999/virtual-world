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
- **Sign-in (browsers):** Google sign-in uses a popup (Firebase "redirect best practices", option 1). Redirect sign-in silently failed in browsers that partition third-party storage (Chrome 115+, Safari/iOS, Firefox) because the site (github.io) and `authDomain` (firebaseapp.com) differ. Redirect is only a fallback when the popup is blocked; `getRedirectResult` is always checked; auth errors show in a toast with their code. Persistence: IndexedDB → localStorage.
- **Sign-in (Android app):** the WebView cannot complete Google OAuth (`403 disallowed_useragent`). When `Capacitor.isNativePlatform()` is true, `@capacitor-firebase/authentication` 6.3.1 (Capacitor 6 / Java 17) runs Google Sign-In with `skipNativeAuth` and the page calls `signInWithCredential(GoogleAuthProvider.credential(idToken))`. Firestore still uses the Firebase JS user. Sign-out clears the native Google account and the JS user.

## Android Google sign-in — console steps

The debug APK builds without these. Sign-in on a device does not work until they are done. Package name is `com.vishnupoola.virtualworld`. Project: `virtual-world-8ac82`.

The debug keystore is committed at `android/app/debug.keystore` (alias `androiddebugkey`, store and key password `android`) so every CI debug APK has the same certificate:

- SHA-1: `DA:FA:69:87:D1:51:B0:89:95:23:99:1C:AB:80:24:2B:16:47:DA:5B`
- SHA-256: `04:63:58:67:E3:0B:0F:51:0C:E8:06:8B:F2:EA:3E:BA:85:64:2E:4D:9C:3A:92:38:5B:62:9A:77:C3:2F:15:2A`

1. Firebase console → Project settings → Your apps → **Add app** → Android.
2. Android package name: `com.vishnupoola.virtualworld`.
3. Debug signing certificate SHA-1: the SHA-1 above. Add the SHA-256 on the same app as well.
4. Register the app, then download **google-services.json**.
5. Put that file at `android/app/google-services.json` and commit it. It is not gitignored. If the SHA-1 was added after the first download, add the fingerprints under the Android app's **SHA certificate fingerprints**, then download and replace `google-services.json` again.
6. Open the json and check the client for this package name contains both:
   - an `oauth_client` with `"client_type": 1` and `android_info.certificate_hash` equal to `dafa6987d151b0899523991cab80242b1647da5b` (SHA-1, no colons, lowercase)
   - an `oauth_client` with `"client_type": 3`. That `client_id` is the **Web client ID** (the same value as Authentication → Sign-in method → Google → Web SDK configuration → Web client ID). The native plugin sends it as `requestIdToken`. An Android client ID in that field will not work with `signInWithCredential`.
7. Authentication → Sign-in method → Google stays **Enabled** (the website already uses it).
8. Rebuild the debug APK after the file is in the repo. The Google Services Gradle plugin applies only when `android/app/google-services.json` is non-empty, which is what keeps CI green before this file exists.

If `client_type` 3 is missing from the json, add the Web client ID in `android/app/src/main/res/values/strings.xml`:

```xml
<string name="default_web_client_id">YOUR_WEB_CLIENT_ID.apps.googleusercontent.com</string>
```

That overrides the plugin placeholder `WILL_BE_OVERRIDDEN`. If the build then reports a duplicate `default_web_client_id`, delete the manual string — `google-services.json` already generated it.

If the web API key is restricted by HTTP referrer, also allow `https://localhost/*`. The Capacitor WebView origin is `https://localhost` (`androidScheme` is `https`), and `signInWithCredential` runs there. The device or emulator needs Google Play services.

A Play release must use a different keystore that is not committed. Add that app's SHA-1 (and, for installs from Play, the Play App Signing certificate SHA-1) in Firebase, then download `google-services.json` again.
- **3D agent:** animated RobotExpressive character (CC0, Tomás Laulhé, via three.js examples, `assets/robot.glb`) rendered in a MapLibre custom layer with three.js, tinted with the agent colour; never smaller than ~56 px on screen.
- **UI:** full-screen map, floating buttons, dismissible bottom sheet (side panel ≥768 px), toasts. Installable PWA (`manifest.json`, `sw.js`, `icons/`).
