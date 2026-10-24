# Backend notes

Linked from [PROJECT_NOTES.md](PROJECT_NOTES.md). That file, plus `ROADMAP.md` and `DECISIONS.md`, holds the changelog, roadmap, and product decisions. This file is only backend and infrastructure as of `main` (`68961ce`). Secret values are not listed.

## Architecture

The site is static files at the repo root. GitHub Pages serves them at `https://vishnupoola-999.github.io/virtual-world/`. There is no Pages workflow in `.github/workflows/`. The Pages source setting (branch versus Actions) is not in the repo.

| Piece | Where | What it does |
| --- | --- | --- |
| Map | `src/map.js` | MapLibre GL JS 5.24.0 (unpkg). Style URL `https://tiles.openfreemap.org/styles/liberty` (OpenFreeMap Liberty, keyless). Globe projection, AWS/Mapzen Terrarium terrain, hillshade. |
| 3D agent on `main` | `src/avatar3d.js`, `assets/robot.glb` | three.js 0.170.0 (jsDelivr) MapLibre custom layer. Model is RobotExpressive (CC0, Tomás Laulhé). `src/character.js` is not on `main`. |
| Auth and agent docs | `src/firebase.js` | Firebase JS 10.14.1 from the CDN. Project `virtual-world-8ac82`. |
| Chat | `src/chat.js` | `POST https://virtual-world-ai.onrender.com/chat` with a Firebase ID token. |
| Flights | `src/flights.js` via the proxy | Optional. Proxy `GET /flights`. |
| Family presence | `src/family.js` | Not Firestore. ntfy.sh topic `vw1-<room>` (HTTPS, no API key in the repo). |

The Capacitor app does not load the GitHub Pages URL. `capacitor.config.json` sets `webDir` to `www` and `server.androidScheme` to `https`, so the WebView origin is `https://localhost`. `scripts/copy-web.mjs` fills `www/` from `index.html`, `join.html`, `favicon.svg`, and `src/` only.

## Gemini proxy

`proxy/server.js` is a Node 18+ script with no npm dependencies (`proxy/package.json` only has a start script). Render service **virtual-world-ai** (`https://virtual-world-ai.onrender.com`). The file comment says the start command is `node proxy/server.js` and the build command is `echo no build`. It listens on `0.0.0.0` and `PORT` (local default `8787`).

Merged PR #7 says auto-deploy from `main` is on and that the free instance sleeps when idle. That was not re-checked against the Render dashboard for this note.

`POST /chat`:

- Requires `Authorization: Bearer <Firebase ID token>`. Verification uses Google's securetoken certificates (`securetoken@system.gserviceaccount.com`), RS256, and the same claims as `firebase-admin` `verifyIdToken` with `checkRevoked` false: `aud`, `iss` (`https://securetoken.google.com/<project>`), `exp`, `iat`, `auth_time`, `sub`. No service account and no revocation check. Project id is `FIREBASE_PROJECT_ID` or, if unset, `virtual-world-8ac82`.
- Builds the system prompt on the server from a fixed template plus `agent.name` (40) and `agent.personality` (300). Client `system`, `systemPrompt`, and `role: "system"` messages are ignored.
- Calls `generativelanguage.googleapis.com` `v1beta` `generateContent`. Default model `gemini-flash-lite-latest` (`MODEL` overrides it when the name matches `^[A-Za-z0-9._-]{1,80}$`). The API key is sent only as the `x-goog-api-key` header. `maxOutputTokens` 200, temperature 0.9. Upstream timeout 50s.
- Limits, in order: 6 requests/min per IP (before auth), then token check, 6 chats/min per uid, body parse, then 60 chats/hour and 600/day globally. Body max 16 KB, 8 messages, 1000 characters each. Counters are in-process `Map`s. They reset on restart, are not shared across instances, and a map larger than 5000 keys is cleared entirely.
- CORS allowlist: `https://vishnupoola-999.github.io`, and `http`/`https` origins whose host is `localhost` (any port). `127.0.0.1` is not allowed. Preflight allows `Content-Type` and `Authorization`. A disallowed origin gets 403 on `POST /chat` and on `OPTIONS`. `ALLOWED_ORIGIN` is not read.

`GET /` returns `ok`. `GET /flights` needs no auth and no allowlist check (CORS headers are still omitted for other origins). It queries adsb.lol, then adsb.fi, caches about 8 seconds, and clamps radius to 5–250 (default 80).

The chat client sends `user.getIdToken()`, times out at 60s, and after 3s shows "waking up your agent…". Transcript storage is described under known issues.

## Firestore data model and rules

Rules file: `firestore.rules` (`rules_version = '2'`). The only allowed path is `agents/{uid}`, and only when `request.auth.uid == uid`. Reads, creates, updates, and deletes are owner-only. Listing `agents` is denied. Every other path, including subcollections such as `agents/{uid}/notes/{id}`, is denied. There is no users collection and no invites collection.

`updatedAt` must equal `request.time`. The client sends `serverTimestamp()`.

| Field | Required | Constraint on `main` |
| --- | --- | --- |
| `name` | yes | string, 1–40 |
| `look` | yes | map, keys exactly `color` and `emoji`. `color` string ≤ 9 (no hex pattern). `emoji` string ≤ 16. |
| `lat`, `lon` | yes | numbers, lat −90…90, lon −180…180 |
| `preciseVisibility` | yes | must be the string `private` |
| `updatedAt` | yes | `request.time` |
| `personality` | no | string ≤ 300 |
| `ownerName` | no | string ≤ 80 |
| `approx` | no | if present, a map with numeric `lat` and `lon`. No range check and no key allowlist. |

`saveAgent` in `src/firebase.js` always writes `approx` as the exact coordinates rounded to 0.01° (~1 km). Nothing in the repo reads another user's `approx`. The comment in that file calls it storage for a future friends phase.

There is no `look.v` field on `main`. A look map with any extra key is rejected (rules test: `hat`).

**Not merged.** Open PR #9 (`feat/characters-night-map`, stacked under open PR #10) would keep the same document path and owner-only rules, and would accept either the legacy `{color, emoji}` look or a v1 character look: keys `v`, `base`, `skin`, `hair`, `hairColour`, `outfit`, `outfitColour`, `bottomColour`, `acc`; `v == 1`; `base` `boy` or `girl` with per-base hair, outfit, and accessory allowlists; colours `^#[0-9a-f]{6}$`; `acc` length ≤ 4. That PR also adds `src/character.js` and `assets/map-style-night.json`. Neither is on `main`. Product choices for that look belong in `DECISIONS.md`.

Rules tests use the emulator project id `demo-virtual-world`, not `virtual-world-8ac82`.

## Android build, signing, and auth

App id `com.vishnupoola.virtualworld`. Capacitor Android, core, and CLI are 6.2.2. `@capacitor-firebase/authentication` is 6.3.1. Capacitor 7+ compiles as Java 21; the Android workflow uses JDK 17, so 6.2.2 is pinned. `minSdk` 22, `compileSdk` / `targetSdk` 34, AGP 8.2.1, Google Services Gradle plugin 4.4.0. `android/variables.gradle` sets `rgcfaIncludeGoogle = true` so Play Services Auth is packaged (otherwise Google Sign-In is `compileOnly`).

`.npmrc` sets `legacy-peer-deps=true`. The auth plugin optionally peers Firebase 10 or 11; rules tests depend on Firebase 13. The site does not use that peer: the browser loads the CDN, and Android uses the native bridge.

Google OAuth inside the WebView fails (`403 disallowed_useragent`). When `Capacitor.isNativePlatform()` is true, `src/firebase.js` calls `FirebaseAuthentication.signInWithGoogle` with `skipNativeAuth: true` (also set in `capacitor.config.json`), then `signInWithCredential(GoogleAuthProvider.credential(idToken))`. Firestore rules see that Firebase JS user. `skipNativeAuth` does not sign in the native FirebaseAuth user. Sign-out calls native `signOut`, then JS `signOut`. Browsers never take this path. Browser sign-in is `signInWithPopup`, then `signInWithRedirect` only if the popup is blocked. Persistence is IndexedDB, then localStorage. `getRedirectResult` runs on load.

The debug APK is signed only with the committed keystore `android/app/debug.keystore`, alias `androiddebugkey`. Store and key passwords are in `android/app/build.gradle` and are not copied here. The release `buildType` has no `signingConfig` and `minifyEnabled` is false. No release or Play signing keystore is in the repo. The Android workflow fails if the debug certificate fingerprints change; the expected fingerprints are in that workflow and in the README, and are not copied here.

`android/app/google-services.json` is committed (not gitignored) for this package name. It includes an Android OAuth client (`client_type` 1) and a web client (`client_type` 3). The native plugin reads the type 3 client as the request id token's web client id. `strings.xml` does not set `default_web_client_id`. The Google Services plugin is applied only when that JSON file exists and is non-empty, so a missing file still lets `assembleDebug` finish and leaves native sign-in broken.

A Play release needs a different keystore, plus that certificate's SHA-1 (and the Play App Signing SHA-1) registered in Firebase, then a new `google-services.json`. Whether those console fingerprints exist is not recorded in the repo.

If the web API key is restricted by HTTP referrer, the WebView also needs `https://localhost/*` allowed. Whether the live key is restricted is not recorded in the repo. The device needs Google Play services.

`copy:web` does not copy `assets/`. The Pages site loads `assets/robot.glb`. The debug APK's `www/` bundle does not include it. Open PR #9 says it copies `assets/`; that change is not on `main`.

## CI and local tests

No GitHub Actions secret is referenced. Workflows use `contents: read` and `actions: write`.

**CI** (`.github/workflows/ci.yml`), on push and pull_request, Node 22, concurrency cancels in progress:

| Job | Command | Notes |
| --- | --- | --- |
| Lint | `npm run lint` | ESLint flat config |
| Proxy unit tests | `npm run test:proxy` | `node --test tests/proxy.test.mjs` |
| Playwright smoke | `npm run test:smoke` | Chromium, `scripts/static-server.mjs` port 4173, mobile 390×844 and desktop 1280×800. CI retries twice. |
| Firestore rules | `npm run test:rules` | Temurin 21. `firebase emulators:exec --only firestore --project demo-virtual-world`. |

**Android** (`.github/workflows/android.yml`), on push only (not pull_request): JDK 17, `platforms;android-34`, `build-tools;34.0.0`, `npm run check:auth`, `npm run copy:web`, `npx cap sync android`, fingerprint check, `./gradlew assembleDebug`. Artifact `virtual-world-debug`, kept 14 days.

Local, from a clean install (`npm ci`):

```bash
npm run lint
npm run test:proxy
npx playwright install --with-deps chromium   # once
npm run test:smoke
npm run test:rules          # needs a JDK; firebase-tools starts the emulator
npm run check:auth          # popup path vs native id-token path
npm run copy:web && npx cap sync android
cd android && ./gradlew assembleDebug
```

`npm run test:rules:run` alone fails unless `FIRESTORE_EMULATOR_HOST` is set. `node proxy/server.js` runs the proxy locally.

## Setup and secret names

Names only. Do not commit values. No `.env` is in the repo.

**Render service `virtual-world-ai`**

| Name | Role |
| --- | --- |
| `GEMINI_API_KEY` | Required for `POST /chat`. Missing key returns 502 after the token is accepted. Stays on the server. |
| `FIREBASE_PROJECT_ID` | Optional. Unset or empty uses the built-in default project id `virtual-world-8ac82`. Any other value must match `^[a-z0-9-]{6,40}$`. |
| `MODEL` | Optional. Invalid or unset uses `gemini-flash-lite-latest`. |
| `PORT` | Set by Render. Local default `8787`. |
| `ALLOWED_ORIGIN` | Not read. Safe to delete on the service so it is not mistaken for the allowlist. |

Do not add a service account, `GOOGLE_APPLICATION_CREDENTIALS`, or a Firebase JSON key for this proxy.

**Firebase client config (not server secrets, still not recopied here)**

- Web: the config object in `src/firebase.js` (fields `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`, `measurementId`). Auth domain is `virtual-world-8ac82.firebaseapp.com`.
- Android: `android/app/google-services.json`.
- Debug signing material: `android/app/debug.keystore`, alias `androiddebugkey`, passwords in `android/app/build.gradle`.

**Not secrets, set by tooling**

- `FIRESTORE_EMULATOR_HOST` — set by `firebase emulators:exec` (emulator host `127.0.0.1`, port `8080` in `firebase.json`).
- `CHECK_MODE` — used only inside `scripts/check-firebase-auth.mjs`.

GitHub Actions has no repository secrets in these workflows.

## Known engineering issues

- **Look v1 and the night map are not on `main`.** Current writes and rules are the legacy `{color, emoji}` look and the Liberty style. PR #9 / #10 are open.
- **No server-side agent memory.** The prompt is name and personality only. Chat history is `localStorage` key `vw-chat-<uid>` (last 40 kept, last 8 sent). The first greeting is inserted in memory when that log is empty and is written only when a later `save()` runs (after the user sends, or after a model reply). Closing chat before that drops the greeting. Rules deny any memory subcollection.
- **Location is owner-only in Firestore and public-to-the-room on ntfy.** `preciseVisibility` cannot be anything but `private`. Cross-user reads are denied. Family sharing publishes precise `{id, name, lat, lon, ts}` to `https://ntfy.sh/vw1-<room>` about every 5 seconds while sharing is on. Anyone with the room code can subscribe. There is no invite document and no expiry on the room id (16-character code stored in `localStorage` key `vw-room`).
- **Proxy limits are per process.** A restart or a second instance does not share them. Revoked ID tokens are accepted until they expire.
- **`GET /flights` and `GET /` are unauthenticated.** `/flights` is served even when the browser origin is not on the allowlist.
- **Debug APK omits `assets/robot.glb`.** See the copy list above.
- **Release signing is not set up.** Debug keystore only.
- **The Android workflow trigger is `push` only.** It does not show up as a `pull_request` check. A push of the head branch still builds the debug APK.
- **Pages deploy path is not defined in the repo.** Uncertain which setting publishes `main`.

## Updating this file

Update `docs/BACKEND_NOTES.md` in any PR that changes the proxy, Firestore rules or client writes, Android signing or auth, CI, or the names of environment variables. Put changelog lines, roadmap items, and product decisions in `PROJECT_NOTES.md`, `ROADMAP.md`, and `DECISIONS.md`. Do not paste secret values, certificate fingerprints, or keystore passwords into this file.
