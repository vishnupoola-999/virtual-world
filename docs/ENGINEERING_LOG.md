# Engineering log

This is the engineering record for Virtual World, as of `main` (`bfe2408`, PRs #9–#11 merged). Product roadmap and product decisions belong in [ROADMAP.md](ROADMAP.md) and [DECISIONS.md](DECISIONS.md). Secret values are not listed.

## Architecture

The site is static files at the repo root. GitHub Pages serves them at `https://vishnupoola-999.github.io/virtual-world/`. There is no Pages workflow in `.github/workflows/`. The Pages source setting (branch versus Actions) is not in the repo.

| Piece | Where | What it does |
| --- | --- | --- |
| Map | `src/map.js`, `assets/map-style-night.json` | MapLibre GL JS 5.24.0 (unpkg). Night style bundled from `assets/map-style-night.json` (OpenFreeMap planet tiles at `tiles.openfreemap.org`, keyless). The style sets the globe projection, sky, and default heights for buildings that have no height data. `pixelRatio` is capped at 2. `maxPitch` is 70 when `hardwareConcurrency` is 4 or less, otherwise 85. Terrain is AWS/Mapzen Terrarium. A dark hillshade layer is inserted below `water`. |
| 3D agent | `src/character.js`, `src/avatar3d.js` | Procedural three.js 0.170.0 girl/boy bodies (no GLB, no textures, about 7–8.5k triangles). MapLibre custom layer. The character waves once when it appears, then idles, turns to face the camera, and has a `#5eb4ff` rim light. The label is the name only. A stored legacy `{color, emoji}` look is drawn with `guessBase(name)` and that colour as `outfitColour` when it matches `#rrggbb`. |
| Auth and agent docs | `src/firebase.js` | Firebase JS 10.14.1 from the CDN. Project `virtual-world-8ac82`. |
| Chat and World tabs | `src/tabs.js`, `src/chat.js`, `src/chat-hero.js` | Two bottom tabs. The app opens on Chat when an agent exists; otherwise World. Signed-out Chat stays on World and shows the sign-in toast. `chat-hero.js` draws the same character on a small header canvas (DPR ≤ 1.5, ~30 fps while animating, ~15 fps idle) and releases the WebGL context on the World tab. The map character's animation loop does not run while `document.body.dataset.tab` is `chat`. Flights and family markers pause on Chat. "Show me" switches to World and flies to the agent. Chat still `POST`s `https://virtual-world-ai.onrender.com/chat` with a Firebase ID token. |
| Flights | `src/flights.js` via the proxy | Optional. Proxy `GET /flights` with the signed-in user's Firebase ID token. |
| Family presence | `src/family.js` | Not Firestore. ntfy.sh topic `vw1-<room>` (HTTPS, no API key in the repo). |

The service worker cache is `vw-shell-v5` and includes `src/character.js`, `src/chat-hero.js`, `src/tabs.js`, and `assets/map-style-night.json`.

The Capacitor app does not load the GitHub Pages URL. `capacitor.config.json` sets `webDir` to `www` and `server.androidScheme` to `https`, so the WebView origin is `https://localhost`. `scripts/copy-web.mjs` copies `index.html`, `join.html`, `favicon.svg`, `src/`, and `assets/` into `www/`. That bundle includes `src/character.js` and the night style. It does not copy `sw.js`, `manifest.json`, or `icons/`. `assets/robot.glb` is no longer in the repo.

## Gemini proxy

`proxy/server.js` is a Node 18+ script with no npm dependencies (`proxy/package.json` only has a start script). Render service **virtual-world-ai** (`https://virtual-world-ai.onrender.com`). The file comment says the start command is `node proxy/server.js` and the build command is `echo no build`. It listens on `0.0.0.0` and `PORT` (local default `8787`).

Merged PR #7 says auto-deploy from `main` is on and that the free instance sleeps when idle. That was not re-checked against the Render dashboard for this note.

`POST /chat`:

- Requires `Authorization: Bearer <Firebase ID token>`. Verification uses Google's securetoken certificates (`securetoken@system.gserviceaccount.com`), RS256, and the same claims as `firebase-admin` `verifyIdToken` with `checkRevoked` false: `aud`, `iss` (`https://securetoken.google.com/<project>`), `exp`, `iat`, `auth_time`, `sub`. No service account and no revocation check. Project id is `FIREBASE_PROJECT_ID` or, if unset, `virtual-world-8ac82`.
- Builds the system prompt on the server from a fixed template plus `agent.name` (40) and `agent.personality` (300). Client `system`, `systemPrompt`, and `role: "system"` messages are ignored.
- Calls `generativelanguage.googleapis.com` `v1beta` `generateContent`. Default model `gemini-flash-lite-latest` (`MODEL` overrides it when the name matches `^[A-Za-z0-9._-]{1,80}$`). The API key is sent only as the `x-goog-api-key` header. `maxOutputTokens` 200, temperature 0.9. Upstream timeout 50s.
- Limits, in order: 6 requests/min per IP (before auth, in-process), then token check, 6 chats/min per uid, body parse, then 60 chats/hour and 600/day globally (in-process). Body max 64 KB, 20 messages, 1000 characters each. The per-uid cap is a Firestore counter at `rateLimits/{uid}/windows/m-<minuteStart>` (field `count`), written with the same Firebase admin client as agent memory: one `FIREBASE_SERVICE_ACCOUNT` and one access-token cache in `firebaseAdmin()`. A missing admin client or a Firestore error falls back to the in-process sliding window for that uid (the map is cleared entirely above 5000 keys). IP and global caps stay in-process and reset on restart. Agent memory (optional `FIREBASE_SERVICE_ACCOUNT`): the proxy reads `agents/{uid}.memory.facts` into the prompt as data and rewrites it on turn 1 and every 4th turn per uid (one extra Gemini call, counted toward the daily cap). Chat history lives in owner-only `agents/{uid}/messages` (app keeps the newest 200); clients can read but never write `memory`.
- CORS allowlist: `https://vishnupoola-999.github.io`, and `http`/`https` origins whose host is `localhost` (any port). `127.0.0.1` is not allowed. Preflight allows `Content-Type` and `Authorization`. A disallowed origin gets 403 on `POST /chat` and on `OPTIONS`. `ALLOWED_ORIGIN` is not read.

`GET /` returns `ok`. `GET /flights` requires the same `Authorization: Bearer` Firebase ID token as `POST /chat`. A missing or invalid token is 401. A failure talking to Google's securetoken certificates is 503. `/flights` still does not check the allowlist (CORS headers are omitted for other origins). It queries adsb.lol, then adsb.fi, caches about 8 seconds, and clamps radius to 5–250 (default 80). `src/flights.js` sends `user.getIdToken()` and does not call the proxy when nobody is signed in.

The chat client sends `user.getIdToken()`, times out at 60s, and after 3s shows "waking up your agent…". Transcript storage is described under known issues.

## Firestore data model and rules

Rules file: `firestore.rules` (`rules_version = '2'`). The only client-allowed path is `agents/{uid}`, and only when `request.auth.uid == uid`. Reads, creates, updates, and deletes are owner-only. Listing `agents` is denied. Every other path, including subcollections such as `agents/{uid}/notes/{id}`, is denied. There is no users collection and no invites collection.

`rateLimits/{uid}/windows/{windowId}` holds the per-uid chat counter. The proxy writes it with the Firebase admin client, which bypasses security rules. The rules deny every client read and write on that path, so a signed-in user cannot read or reset the counter. `windowId` is `m-` plus the window start in epoch milliseconds, aligned to 60 seconds. The only field the proxy writes is `count`.

`updatedAt` must equal `request.time`. The client sends `serverTimestamp()`.

| Field | Required | Constraint on `main` |
| --- | --- | --- |
| `name` | yes | string, 1–40 |
| `look` | yes | legacy `{color, emoji}` or v1 character look (below) |
| `lat`, `lon` | yes | numbers, lat −90…90, lon −180…180 |
| `preciseVisibility` | yes | must be the string `private` |
| `updatedAt` | yes | `request.time` |
| `personality` | no | string ≤ 300 |
| `ownerName` | no | string ≤ 80 |
| `approx` | no | if present, a map with numeric `lat` and `lon`. No range check and no key allowlist. |

`saveAgent` in `src/firebase.js` always writes `approx` as the exact coordinates rounded to 0.01° (~1 km). Nothing in the repo reads another user's `approx`. The comment in that file calls it storage for a future friends phase.

`look` must match `legacyLook` or `characterLook` in `firestore.rules`.

Legacy (agents saved before PR #9): keys exactly `color` and `emoji`. `color` is a string of length ≤ 9 (no hex pattern). `emoji` is a string of length ≤ 16.

v1, written by `sanitize()` in `src/character.js` before save: keys exactly `v`, `base`, `skin`, `hair`, `hairColour`, `outfit`, `outfitColour`, `bottomColour`, `acc`. `v == 1`. The four colour fields match `^#[0-9a-f]{6}$`. `acc` is a list of length ≤ 4.

| `base` | `hair` | `outfit` | `acc` |
| --- | --- | --- | --- |
| `boy` | `short`, `spiky`, `curly`, `buzz` | `tee`, `hoodie`, `kurta` | `glasses`, `headphones`, `cap` |
| `girl` | `long`, `ponytail`, `bun`, `bob`, `curly`, `short` | `tee`, `hoodie`, `kurta`, `dress` | `glasses`, `headphones`, `cap`, `bindi` |

The editor stores one in-progress look per base and saves `v: 1`. `guessBase` picks the starting base from the first name; the product choice (name guess versus an unselected picker) is in `DECISIONS.md`. Rules tests cover both shapes (`GIRL_LOOK`, `BOY_LOOK`, and the legacy emoji look).

Rules tests use the emulator project id `demo-virtual-world`, not `virtual-world-8ac82`.

## Android build, signing, and auth

App id `com.vishnupoola.virtualworld`. Capacitor Android, core, and CLI are 6.2.2. `@capacitor-firebase/authentication` is 6.3.1. Capacitor 7+ compiles as Java 21; the Android workflow uses JDK 17, so 6.2.2 is pinned. `minSdk` 22, `compileSdk` / `targetSdk` 34, AGP 8.2.1, Google Services Gradle plugin 4.4.0. `android/variables.gradle` sets `rgcfaIncludeGoogle = true` so Play Services Auth is packaged (otherwise Google Sign-In is `compileOnly`).

`.npmrc` sets `legacy-peer-deps=true`. The auth plugin optionally peers Firebase 10 or 11; rules tests depend on Firebase 13. The site does not use that peer: the browser loads the CDN, and Android uses the native bridge.

Google OAuth inside the WebView fails (`403 disallowed_useragent`). When `Capacitor.isNativePlatform()` is true, `src/firebase.js` calls `FirebaseAuthentication.signInWithGoogle` with `skipNativeAuth: true` (also set in `capacitor.config.json`), then `signInWithCredential(GoogleAuthProvider.credential(idToken))`. Firestore rules see that Firebase JS user. `skipNativeAuth` does not sign in the native FirebaseAuth user. Sign-out calls native `signOut`, then JS `signOut`. Browsers never take this path. Browser sign-in is `signInWithPopup`, then `signInWithRedirect` only if the popup is blocked. Persistence is IndexedDB, then localStorage. `getRedirectResult` runs on load.

The debug APK is signed with the committed keystore `android/app/debug.keystore`, alias `androiddebugkey`. Store and key passwords are in `android/app/build.gradle` and are not copied here. The Android workflow fails if the debug certificate fingerprints change; the expected fingerprints are in that workflow and in the README, and are not copied here.

Release `minifyEnabled` is false. `signingConfigs.release` is applied only when the upload key is available from the environment. `android/app/build.gradle` reads `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`, and the keystore from `ANDROID_KEYSTORE_FILE` or, when that is unset, from `ANDROID_KEYSTORE_BASE64` (whitespace stripped, then decoded to `android/app/build/release.keystore`). Leading and trailing whitespace on the password, alias, and key password is stripped. `ANDROID_KEYSTORE_FILE` wins when both keystore variables are set. `assembleRelease` and `bundleRelease` fail while any of those values are missing or the base64 is invalid, so a release APK or AAB is signed with the upload key. `assembleDebug` does not require them. The upload keystore, its base64, the alias, and the passwords stay out of git. `*.jks` and `*.keystore` are gitignored, with an exception for the tracked debug keystore.

`android/app/google-services.json` is committed (not gitignored) for this package name. It includes an Android OAuth client (`client_type` 1) and a web client (`client_type` 3). The native plugin reads the type 3 client as the request id token's web client id. `strings.xml` does not set `default_web_client_id`. The Google Services plugin is applied only when that JSON file exists and is non-empty, so a missing file still lets `assembleDebug` finish and leaves native sign-in broken.

A Play release uses the upload keystore from those environment variables, not the debug keystore. The Android workflow prints the release certificate SHA-1 and SHA-256 when the signing secrets are set. Add both fingerprints on the Firebase Android app (`com.vishnupoola.virtualworld`, Project settings → Your apps → SHA certificate fingerprints) or Google sign-in fails on that release build. Download `google-services.json` again after adding them. Installs from Play also need the Play App Signing certificate SHA-1 and SHA-256 on that same app. The fingerprint values are not copied here. Whether the console entries exist is not recorded in the repo. How to create the keystore and which GitHub Actions secrets to add is under Setup and secret names.

If the web API key is restricted by HTTP referrer, the WebView also needs `https://localhost/*` allowed. Whether the live key is restricted is not recorded in the repo. The device needs Google Play services.

`copy:web` copies `src/` and `assets/`, so the debug APK includes `src/character.js` and `assets/map-style-night.json`. It still omits `sw.js`, `manifest.json`, and `icons/`.

## CI and local tests

The CI workflow does not read a GitHub Actions secret. The Android workflow reads `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD` when they are set. Workflows use `contents: read` and `actions: write`.

**CI** (`.github/workflows/ci.yml`), on push and pull_request, Node 22, concurrency cancels in progress:

| Job | Command | Notes |
| --- | --- | --- |
| Lint | `npm run lint` | ESLint flat config |
| Proxy unit tests | `npm run test:proxy` | `node --test tests/proxy.test.mjs tests/rate-limit.test.mjs` |
| Playwright smoke | `npm run test:smoke` | Chromium, `scripts/static-server.mjs` port 4173, mobile 390×844 and desktop 1280×800. CI retries twice. |
| Firestore rules | `npm run test:rules` | Temurin 21. `firebase emulators:exec --only firestore --project demo-virtual-world`. |

**Android** (`.github/workflows/android.yml`), on push only (not pull_request): JDK 17, `platforms;android-34`, `build-tools;34.0.0`, `npm run check:auth`, `npm run copy:web`, `npx cap sync android`, debug fingerprint check, `./gradlew assembleDebug`. Artifact `virtual-world-debug`, kept 14 days. When all four release signing secrets are non-empty, the job decodes `ANDROID_KEYSTORE_BASE64` with `base64 --decode`, prints the release SHA-1 and SHA-256, rejects the debug certificate, runs `./gradlew assembleRelease bundleRelease` with those secrets in the environment, checks the APK with `apksigner` and the AAB with `jarsigner`, and uploads `virtual-world-release-apk` and `virtual-world-release-aab` (14 days). When all four are empty, those steps are skipped and the debug APK job still passes. When only some are set, the job fails after the debug APK upload.

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
# Signed release. Export ANDROID_KEYSTORE_BASE64 (or ANDROID_KEYSTORE_FILE)
# plus ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, and ANDROID_KEY_PASSWORD.
cd android && ./gradlew assembleRelease bundleRelease
```

`npm run test:rules:run` alone fails unless `FIRESTORE_EMULATOR_HOST` is set. `node proxy/server.js` runs the proxy locally.

## Setup and secret names

Names only. Do not commit values. No `.env` is in the repo.

**Render service `virtual-world-ai`**

| Name | Role |
| --- | --- |
| `GEMINI_API_KEY` | Required for `POST /chat`. Missing key returns 502 after the token is accepted. Stays on the server. |
| `FIREBASE_PROJECT_ID` | Optional. Unset or empty uses the built-in default project id `virtual-world-8ac82`. Any other value must match `^[a-z0-9-]{6,40}$`. |
| `FIREBASE_SERVICE_ACCOUNT` | Optional JSON for one Firebase admin client. Shared by agent memory and the per-uid rate-limit counters. Missing or invalid JSON leaves memory off and keeps per-uid limits in process memory. |
| `MODEL` | Optional. Invalid or unset uses `gemini-flash-lite-latest`. |
| `PORT` | Set by Render. Local default `8787`. |
| `ALLOWED_ORIGIN` | Not read. Safe to delete on the service so it is not mistaken for the allowlist. |

That service account is the only admin credential. Do not add a second service account, `GOOGLE_APPLICATION_CREDENTIALS`, or another Firebase JSON key. ID token checks still use Google's public certificates and do not use this account.

**Firebase client config (not server secrets, still not recopied here)**

- Web: the config object in `src/firebase.js` (fields `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`, `measurementId`). Auth domain is `virtual-world-8ac82.firebaseapp.com`.
- Android: `android/app/google-services.json`.
- Debug signing material: `android/app/debug.keystore`, alias `androiddebugkey`, passwords in `android/app/build.gradle`.

**Not secrets, set by tooling**

- `FIRESTORE_EMULATOR_HOST` — set by `firebase emulators:exec` (emulator host `127.0.0.1`, port `8080` in `firebase.json`).
- `CHECK_MODE` — used only inside `scripts/check-firebase-auth.mjs`.

**GitHub Actions repository secrets for release signing**

Names only. Settings → Secrets and variables → Actions. Leave them unset until the upload key exists; the Android workflow then builds the debug APK only.

Create the keystore on a trusted machine. `keytool` prompts for the store password, the key password, and the certificate name. Keep those passwords in the secrets below and out of the repo, shell history, and this file:

```bash
keytool -genkeypair -v \
  -keystore release.keystore \
  -storetype PKCS12 \
  -alias YOUR_ALIAS \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

`YOUR_ALIAS` is whatever alias you choose. That same text is the value of `ANDROID_KEY_ALIAS`. `-storetype PKCS12` matches current `keytool` defaults. A PKCS12 keystore has one password, so `ANDROID_KEY_PASSWORD` is the same value as `ANDROID_KEYSTORE_PASSWORD`. A JKS file (`-storetype JKS`) can use a different key password. `*.keystore` and `*.jks` are gitignored.

Base64 for `ANDROID_KEYSTORE_BASE64` is one line (standard base64, not base64url):

```bash
base64 -w 0 release.keystore                 # GNU coreutils
base64 -i release.keystore | tr -d '\n'      # macOS
```

| Secret | Role |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Single-line base64 of the upload keystore. CI decodes it with `base64 --decode` after stripping whitespace. Gradle decodes the same variable when `ANDROID_KEYSTORE_FILE` is unset. |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore store password. |
| `ANDROID_KEY_ALIAS` | Alias of the key entry inside the keystore. |
| `ANDROID_KEY_PASSWORD` | Password for that key entry. For a PKCS12 keystore, the same value as `ANDROID_KEYSTORE_PASSWORD`. |

`ANDROID_KEYSTORE_FILE` is not a repository secret. It is an optional absolute path to a decoded keystore for a local release build. When it is set, Gradle uses that file and does not read `ANDROID_KEYSTORE_BASE64`.

The first signed release build prints the upload certificate SHA-1 and SHA-256 in the workflow log. Add both to the Firebase Android app before Google sign-in will work on the release APK or on a build signed with this upload key. For installs from Play, also add the Play App Signing certificate SHA-1 and SHA-256, then download a fresh `google-services.json`.

**Not a GitHub Actions secret**

The CI workflow (lint, smoke, proxy, rules) does not read repository secrets.

## Known engineering issues

- **No server-side agent memory.** The prompt is name and personality only. Chat history is `localStorage` key `vw-chat-<uid>` (last 40 kept, last 8 sent). The first greeting is inserted in memory when that log is empty and is written only when a later `save()` runs (after the user sends, or after a model reply). Closing chat before that drops the greeting. Rules deny any memory subcollection.
- **Location is owner-only in Firestore and public-to-the-room on ntfy.** `preciseVisibility` cannot be anything but `private`. Cross-user reads are denied. Family sharing publishes precise `{id, name, lat, lon, ts}` to `https://ntfy.sh/vw1-<room>` about every 5 seconds while sharing is on. Anyone with the room code can subscribe. There is no invite document and no expiry on the room id (16-character code stored in `localStorage` key `vw-room`).
- **IP and global proxy caps are per process.** They reset on restart and are not shared across instances. Per-uid chat limits are Firestore counters when `FIREBASE_SERVICE_ACCOUNT` is set; a Firestore outage falls back to the in-process window. Revoked ID tokens are accepted until they expire.
- **`GET /` is unauthenticated.** `GET /flights` requires a Firebase ID token. It is still served when the browser origin is not on the allowlist (those browsers do not receive CORS headers).
- **Debug APK omits the PWA shell files.** `www/` has `src/` and `assets/` but not `sw.js`, `manifest.json`, or `icons/`. The procedural character does not need `robot.glb` (removed in #9).
- **Release signing secrets are optional.** Until `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD` are all set, CI publishes the debug APK only. Google sign-in on the release build also needs that upload certificate's SHA-1 and SHA-256 (and, for Play installs, the Play App Signing fingerprints) on the Firebase Android app.
- **The Android workflow trigger is `push` only.** It does not show up as a `pull_request` check. A push of the head branch still builds the debug APK.
- **Pages deploy path is not defined in the repo.** Uncertain which setting publishes `main`.

## Changelog

One line per pull request. Status is `merged` or `open` as of 2026-10-24. #15 is this PR.

| PR | Title | Status | Summary |
| --- | --- | --- | --- |
| #1 | Add Capacitor Android wrapper and debug APK workflow | merged | Capacitor 6 Android app `com.vishnupoola.virtualworld` and a JDK 17 debug APK workflow. |
| #2 | Add CI for lint, Playwright smoke, and Firestore rules | merged | GitHub Actions jobs for ESLint, Playwright smoke, and Firestore rules in the emulator. |
| #3 | feat: native Google sign-in on Android | merged | Native Google sign-in via `@capacitor-firebase/authentication` with `skipNativeAuth`, then Firebase JS `signInWithCredential`. |
| #4 | chore: add Android google-services.json | merged | Commit `google-services.json` for the debug Android OAuth client and the web client. |
| #5 | fix: steady 3D agent, in-app family sharing, chat with agent | merged | Steady 3D agent, in-app family location sharing, and chat with the agent. |
| #6 | perf: 30fps avatar, pause in background, reuse matrices; identify self by account uid | merged | Cap the avatar at 30fps, pause it in the background, reuse matrices, and identify self by account uid. |
| #7 | feat: require Firebase ID tokens on the Gemini chat proxy | merged | `POST /chat` requires a Firebase ID token; the proxy builds the system prompt and rate-limits per uid. |
| #8 | fix: PR #6 review follow-ups (own dot on auth, clear all keys, on-screen check, rAF frame pacing) | merged | Own map dot follows auth, chat storage keys are cleared, on-screen check, and rAF frame pacing. |
| #9 | Characters + night map (PR A) | merged | Procedural `src/character.js`, v1 `agents/{uid}.look` (legacy look still accepted), night map style, and `assets/` copied into the Android bundle. |
| #10 | Chat and World tabs (night theme, agent character header, Show me) | merged | Chat and World tabs, night-theme chat, and the agent character in the header. |
| #11 | Docs: v1 roadmap and product decisions | merged | Adds `docs/ROADMAP.md` and `docs/DECISIONS.md`. |
| #12 | docs: add the engineering log | merged | This file: the engineering record, this changelog, and pointers to the product docs. |
| #13 | Agent memory: synced chat history + server-side owner notes | merged | `agents/{uid}/messages` (owner-only rules + tests, newest 200) synced across devices; proxy sends the last 20 messages and a server-written `agents/{uid}.memory` summary. Needs `FIREBASE_SERVICE_ACCOUNT` on Render. |
| #14 | feat: first-60-seconds onboarding + character picker + Move my agent | merged | New `src/onboarding.js` (5 steps per Diggy's spec, error/offline states, analytics on `window.__vwEvents`); pickers with no preselection or name guess, one shared WebGL renderer for both cards; location: fast fix, one high-accuracy retry if >200 m, else `spotApprox`; denied → IP city (get.geojs.io, disclosed in the landing note) → Warangal; `spotApprox` added to rules alongside #13's memory rules, saves use `{merge:true}`; Move my agent (button, long-press), cancelled on sign-out/user change; `?onb=0` skips onboarding; SW cache `vw-shell-v7`. |
| #15 | feat: authenticate flights and persist per-user rate limits | merged | `GET /flights` requires the chat Firebase ID token. Per-uid chat limits are Firestore minute counters on the existing admin client, with an in-memory fallback. |
| #16 | perf: mobile speed fixes from Diggy's audit (based on #14) | merged | New `src/device.js` low-end check (deviceMemory ≤ 4, cores ≤ 4, or weak/software GPU); terrain + hillshade opt-in ("High quality 3D" in Layers, off by default on phones/low-end, saved in `vw-terrain`; storage access is wrapped in try/catch with an in-memory fallback, so blocked storage never stops the map); map DPR ≤ 1.5 (1 on low-end), maxPitch 60 on low-end, fadeDuration 0. three.js lazy-loaded: `avatar3d.js` via a proxy in `agent.js` (only once there is an agent and zoom ≥ 10), chat hero split into `chat-hero.js` wrapper + `chat-hero-3d.js` (pixelRatio 1), picker renderers moved to `src/cards3d.js` (warmed during onboarding step 3); look data split into `src/character-data.js` (no three.js). Firestore dynamic-imported in `firebase.js` (first use or idle). Preconnect + modulepreload in `index.html`, family SSE opened on idle, map character not drawn while Chat is open. No bundler (static Pages). SW `vw-shell-v8`. |
| #17 | feat: sign Android release builds from CI keystore secrets | open | Release APK and AAB are signed from `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD` when those secrets are set. The debug APK build still runs, and it is the only Android artifact when the secrets are unset. |
| #18 | fix: own character follows live location while sharing | merged | Live sharing and 📍 only moved a plain blue dot (`.me` marker); the 3D character stayed at its saved spot (often an approximate one from onboarding), so at street level it looked like the character vanished and a dot replaced it. `agent.js` gets `setLive(pos)`: while sharing (watchPosition) or after 📍, the character is drawn at the live position (saved spot unchanged in Firestore), the dot is only used when there is no agent, and the first live fix eases the map to it if off screen; Stop sharing returns the character to its saved spot. Smoke test `own character follows live location while sharing`. SW `vw-shell-v9`. |
| #19 | feat: UI v2 visual language (Diggy's ui-v2-spec) | open | New `src/ui-v2.css` layered over `style.css`: near-black tokens, self-hosted Inter variable (`fonts/inter-latin-wght-normal.woff2`, 48 KB, OFL-1.1, byte-identical to Fontsource 5.3.0, licence in `fonts/OFL.txt`), white pill primary / gradient brand (Invite family, Find friends only) buttons, fake glass with no backdrop-filter, 150–250 ms spring motion and a 0.97 press scale. Chat: 44 px avatar header with Show on map and More (agent sheet with Move my agent, Customise look, live-share switch), agent replies with no bubble streamed word by word (rAF-batched text nodes, dot caret), thinking shimmer naming the action plus skeletons, floating pill composer and tab bar with a sliding indicator, glass toast and banners. Onboarding restyled with the spec copy and "I already have an agent". The proxy still returns one JSON reply, so streaming is client-side. SW `vw-shell-v10` adds the CSS and font; `copy-web` now copies `fonts/`. |
| #20 | feat: World tab v2 (Diggy's world-v2-spec, stacked on #19) | open | `src/world-agents.js` replaces the full-screen three.js custom layer (`avatar3d.js`, deleted): every agent (yours and family who share live) is a MapLibre HTML marker with a 56×64 live character, a glass name pill with a status dot and idle/walk/talk/busy states, and a glow plus a "You · Name" gradient pill on your own. One shared offscreen WebGLRenderer (`src/agent-renderer.js`, lazy-loaded) blits into the marker canvases at 30 fps, with at most 8 live characters and a static frame for the rest. It pauses off-screen, on Chat and in the background. Below zoom 14 a GeoJSON cluster source draws GPU circles (purple when the cluster contains you); tap to expand. The agent profile sheet gives friends Visit and Chat (Chat is a coming-soon toast) and gives you Move home (starts Move my agent) and Customize. Layers is a style picker (Night; Day and Satellite marked Later) plus line-icon switches for High quality 3D (PR #16 pref, `#swTerrain`), Flights and Friends' agents. Map chrome: glass search pill, gradient account button, an icon rail replacing the emoji FABs, a recenter button, and dark credits collapsed to ⓘ. Live share (#18) is kept: your marker walks with your live position. Long-press on your marker still starts Move my agent. `maxPitch` is 70. The smoke test now checks `#topbar .search` instead of the removed brand chip. SW `vw-shell-v11`. |
| #23 | fix: fast agent load (backend/integration) | open | The agent took about a minute to appear: `loadAgent` used the Firestore SDK `getDoc`, whose streaming WebChannel can stall on some networks and only fails with `unavailable` after ~30–35 s, and `agent.js` retried it 3 times with 1.5 s/3 s pauses. `loadAgent` now tries the Firestore REST API first (one HTTPS GET with the user's ID token, same rules, 8 s limit) and falls back to the SDK with a 12 s limit. The last known agent is cached per uid in localStorage (`vw-agent:<uid>`, refreshed on load and save) and drawn immediately on auth restore. Retry pauses are 0.4 s/0.8 s. `main.js` pings the Render proxy on app open (no-cors, fire-and-forget) so it is warm before the first chat; the proxy is not on the agent's path. SW `vw-shell-v15`. |
| #24 | feat: life loop backend v1 (agents that live) | open | `proxy/life.js` + `POST /tick` (header `x-tick-secret` vs env `TICK_SECRET`; 401 otherwise, 503 if Firestore admin or Gemini missing): per agent one Flash-Lite call picks move/meet/diary/rest, daily cap 12 on `agents/{uid}.life`, Jaccard matching, meet writes `agents/{uid}/diary` and `friends.{hashedId}` on both. Rules: owner may set `interests` (3-5 tags) and `bio` (≤80), cannot write `life`/`friends`/`isTest`/diary. `.github/workflows/life-tick.yml` (every 30 min + manual, secrets `TICK_SECRET`, optional `PROXY_URL`). `scripts/seed-test-agents.mjs seed|remove` (refuses prod without `--allow-prod`). `saveInterests()` helper in `src/firebase.js`, no UI. Tests `tests/life.test.mjs`. SW `vw-shell-v16`. |
| #24 (review fixes) | fix: life loop hardening from SWE review | open | Max 50 Gemini calls/tick counted before calling (meet = 2), every call incl. rest/failure spends the 12/day cap, tick stops starting agents after 170 s (under the workflow's 240 s curl limit). Other users' profiles go in `<untrusted_profile>` blocks; bios and generated lines scrubbed of URLs/emails/phones; lines with links or instruction-like text are dropped (unsafe meet saves nothing). `placeNear` uses ~1 km-rounded home (never exact), salted hash, ~1 km-rounded output. Diaries/friends/met store `h_` salted hashed ids (`withId`), not uids. Salt env `LIFE_SALT` is required (no fallback to `TICK_SECRET`; `/tick` returns 503 without it, so rotating the tick secret never changes hashed ids). `saveLife` uses `currentDocument.updateTime` precondition. Inactive (14 d) agents excluded from matches. Workflow fails with ::error when `TICK_SECRET` missing. Meet writes the partner's life doc first, then the actor's, so a 412 conflict leaves no half-saved meet. Gemini `safetySettings` block medium+ harassment/hate/sexual/dangerous as a second check; blocked or empty replies save nothing (rest). Tick also writes `agents/{uid}.status` per design/living-spec.md in the same patch as `life`: `{kind: walking|meeting|working|idle, label ≤40 (sanitised), since (timestamp), destination{name,lngLat} (walking, ~1 km-rounded place), withAgentId (hashed) + withName (meeting), progress{done,total} (working)}`; rules make `status` server-write-only. |
| #25 | feat: Agent tools: Gmail drafts/send and Calendar with confirm | open | `/chat` accepts `tools:true` and declares Gemini functions `draft_email`, `send_email`, `list_events`, `add_event` (`proxy/tools.js`). The proxy only validates and returns proposed `actions` (email regex, header CR/LF stripped, ISO times, max 3); it never executes them or holds a Google token. **Default (all users, no OAuth, no extra scopes):** `src/google-tools.js` shows the exact email/event in `src/ui/confirmAction.js` (contract `confirmAction({kind:'email'|'calendar', mode, email?|event?}) -> Promise<{confirmed}>`), whose buttons use `src/agentTools.js` (`buildMailtoUrl`, `buildGmailComposeUrl`, `buildCalendarUrl`, `buildIcs`, `downloadIcs`, formats per living-spec "Confirm sheet (V1)") to open a Gmail web compose URL or `mailto:`, or a Google Calendar template link plus a client-generated `.ics` (Blob, UTC, RFC 5545 escaping); `list_events` says it can't read the calendar yet. **Flagged path** (`src/tools-config.js` allowlist, only srilathapoola6@gmail.com): `send_email` via Gmail API with `gmail.send` only (no `gmail.compose`; drafts always use links), `add_event`/`list_events` via `calendar.events`, scopes requested on demand through `requestGoogleAccess` in `src/firebase.js`, token in memory only. Every write needs an explicit tap (client-side gate; server flag ignored). Friendly errors for expired token (one re-prompt), consent, busy; chat shows 'server is busy' on 502/503. Plain sign-in unchanged. `confirmAction.js` is a minimal placeholder for design. Flagged-path setup: `docs/SETUP_GOOGLE_OAUTH.md`. SW `vw-shell-v18`. SWE review fixes: calendar listings are shown on screen only (never saved to history/Firestore or sent to later prompts), real Calendar add includes location, header fields strip all control chars, `npm test` runs the proxy tests; api-mode sends/adds call optional `action.onResult({ok, error?})` for the sheet. |
| #26 | design: Living agents V1 (interests step + While-you-were-away list) | open | Onboarding interests step (3-5 tags, 80-char About you, `saveInterests`) and a plain away list of diary lines and who the agent met. Map walking/meeting/working states sit behind `LIVING_MAP=false` until after V1; `world-agents.js` keeps #22's birth pulse in `blit`. SW cache `vw-shell-v23`. |
| #27 | design: Confirm sheet (V1) for agent tools (stacked on #25) | open | Replaces the placeholder `src/ui/confirmAction.js` with Diggy's sheet (`.cs-sheet`, scrim, details card, "Open in Gmail" / "Add to Calendar" pill, quiet "Download .ics" and "Use another mail app" links, Cancel, generic error with Try again, `.cs-toast` "Opened in Gmail · Tap Send there to finish" / "Opened Google Calendar"). Contract `Promise<{confirmed}>`, true only on a tap; `mode:"links"` opens via `src/agentTools.js` builders, `mode:"api"` just confirms. CSS in `src/ui-v2.css`; no blur, transform/opacity only. SW `vw-shell-v19`. |

## How to update

Every pull request adds one row to the changelog (number, title, `merged` or `open`, one-line summary) and updates every section that the change affects, including architecture, the proxy, Firestore rules, Android signing and auth, CI, secret names, and known issues. Put product roadmap items in `docs/ROADMAP.md` and product decisions in `docs/DECISIONS.md`. Do not paste secret values, certificate fingerprints, or keystore passwords into this file.
- 2026-10-24 design/head-framing-birth-pulse: fix head clipping (map camera + chat avatar), birth pulse while the character loads, preload the 3D code on map load; SW cache v13.
- 2026-10-25 fix/firestore-db-id: Firestore DB is named `default` (Enterprise, asia-south1), not `(default)`; proxy reads FIRESTORE_DATABASE_ID (default `default`), web uses getFirestore(app,'default'), firebase.json targets it; SW cache v22.
- 2026-10-25 fix/live-chat-agents: chat Send button never enabled — chat.js used `#chatF querySelector('button')`, which matched the new "+" button instead of Send; now selects `button.send`; Playwright regression test; SW cache v25.
- 2026-10-24 design/living-agents (#26, merged): V1 scope for the friends test. Onboarding interests step (step 5 of 6, 3-5 tags, 80-char About you, saveInterests) and a plain "While you were away" list (owner diary lines + who the agent met, gradient initial and stored withName only, no profile lookups). Map walking/meeting/working states, status pill, hint card, stats and intro suggestion are off behind `LIVING_MAP=false` / removed until after V1; agent.status (feat/life-loop 9ac4a32) is still read defensively via readStatus. SW cache v26. Rebased onto main after #24/#25/#27/#29/#30 merged (keeps button.send fix).
- 2026-10-25 design/cache-3d-assets: service worker caches pinned CDN files (three.js, MapLibre) cache-first in a separate `vw-cdn-v1` cache, fetched as CORS (MapLibre tags carry crossorigin="anonymous"), storing only ok non-opaque responses and pruning other versions of a package; warms three.js on install. Character appears in about 3.3 s instead of 6.2 s with the browser cache cleared. SW cache vw-shell-v27; rebased after #26 (v26).
- 2026-10-25 fix/life-loop-dedupe: life tick no longer skips agents born before the interests step (default interests `exploring, meeting people`); if nobody shares an interest an agent meets the nearest active agent (score 0) so small worlds actually meet. Chat system prompt now includes the agent's own status + last 5 friends met (lifeSummary) so the brain knows what it did. Family dots dedupe by uid (or name for anon senders) and a device retires its pre-sign-in key on first signed-in publish (fixes duplicate "vishnu Poola"). SW cache v28.
- 2026-10-25 fix/calendar-add: "Met rajesh" no longer opens Add to calendar (past tense: met / had a meeting / went). Days and times resolve in the owner's zone from today and are never in the past; a missing day or time asks instead of inventing one (the sheet's Tue 13 May was 13 May 2025). Real `events.insert` sends an RFC3339 offset plus `timeZone`, logs Google's status/reason/message (not the token), and on failure offers the same Calendar template link and .ics file everyone outside the allowlist already gets. Calendar API on project 38479190061 is already enabled. Rebased onto main after #31 (v28); SW cache vw-shell-v31 (#33 holds v30).
- 2026-10-25 design/interests-continue-fix: interests step Continue was pushed below the fold on small phones (#onbBody had no min-height:0, so the whole step grew past the fixed #onb and clipped the button). Step 5 is now a 100dvh column: only the chip list scrolls, Continue sits in a sticky solid footer with a 16px opacity fade, and the sheet follows visualViewport so the footer stays above the keyboard without covering the bio. Playwright test at 360x640 (6 taps, Continue in view and tappable, keyboard case); PW_PORT env for per-worktree test ports. SW cache vw-shell-v32 (was v30; bumped past #32 v31).
- 2026-10-25 fix/chat-reply: agent replies were invisible since #20. `body[data-tab=chat] .ag{display:none}` (hide map markers on the Chat tab) also matched chat reply rows (`.msg.ag`) and out-ranked `.msg.ag{display:flex}`, so the proxy answered (Render: `chat ok 200`) but only the Show me chip appeared. Scoped to `.ag:not(.msg)`; Playwright regression test. Gemini was healthy, no xAI fallback needed. SW cache v33.
- 2026-10-25 design/chat-redesign: bot replies rendered as a ~64px column (one or two words per line, overlapping the avatar and name). Root cause: chat reply rows used class `msg ag`, and `.ag` is also the map-marker class (`world-v2.css .ag{width:64px;height:116px}`), so every reply was squeezed to marker width. Chat rows are now `.msg.bot` / `.msg.user`, so map `.ag` rules can't reach chat (the Chat-tab hide rule stays on map markers only). Grok-style redesign: no avatar/name, full-width 15px/1.5 replies, overflow-wrap:anywhere (no break-all), user bubble rgba(255,255,255,.10) right-aligned max 80%, 8px/20px same/switch-side spacing. Playwright test at 360px (reply wider than 250px and 60% of viewport, no avatar). SW cache vw-shell-v34.
