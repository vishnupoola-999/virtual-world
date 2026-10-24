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
| Flights | `src/flights.js` via the proxy | Optional. Proxy `GET /flights`. |
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
- Limits, in order: 6 requests/min per IP (before auth), then token check, 6 chats/min per uid, body parse, then 60 chats/hour and 600/day globally. Body max 64 KB, 20 messages, 1000 characters each. Agent memory (optional `FIREBASE_SERVICE_ACCOUNT`): the proxy reads `agents/{uid}.memory.facts` into the prompt as data and rewrites it on turn 1 and every 4th turn per uid (one extra Gemini call, counted toward the daily cap). Chat history lives in owner-only `agents/{uid}/messages` (app keeps the newest 200); clients can read but never write `memory`. Counters are in-process `Map`s. They reset on restart, are not shared across instances, and a map larger than 5000 keys is cleared entirely.
- CORS allowlist: `https://vishnupoola-999.github.io`, and `http`/`https` origins whose host is `localhost` (any port). `127.0.0.1` is not allowed. Preflight allows `Content-Type` and `Authorization`. A disallowed origin gets 403 on `POST /chat` and on `OPTIONS`. `ALLOWED_ORIGIN` is not read.

`GET /` returns `ok`. `GET /flights` needs no auth and no allowlist check (CORS headers are still omitted for other origins). It queries adsb.lol, then adsb.fi, caches about 8 seconds, and clamps radius to 5–250 (default 80).

The chat client sends `user.getIdToken()`, times out at 60s, and after 3s shows "waking up your agent…". Transcript storage is described under known issues.

## Firestore data model and rules

Rules file: `firestore.rules` (`rules_version = '2'`). The only allowed path is `agents/{uid}`, and only when `request.auth.uid == uid`. Reads, creates, updates, and deletes are owner-only. Listing `agents` is denied. Every other path, including subcollections such as `agents/{uid}/notes/{id}`, is denied. There is no users collection and no invites collection.

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
| Proxy unit tests | `npm run test:proxy` | `node --test tests/proxy.test.mjs` |
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

`YOUR_ALIAS` is whatever alias you choose. That same text is the value of `ANDROID_KEY_ALIAS`. `-storetype PKCS12` matches current `keytool` defaults; a `.jks` file is also accepted. `*.keystore` and `*.jks` are gitignored.

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
| `ANDROID_KEY_PASSWORD` | Password for that key entry. |

`ANDROID_KEYSTORE_FILE` is not a repository secret. It is an optional absolute path to a decoded keystore for a local release build. When it is set, Gradle uses that file and does not read `ANDROID_KEYSTORE_BASE64`.

The first signed release build prints the upload certificate SHA-1 and SHA-256 in the workflow log. Add both to the Firebase Android app before Google sign-in will work on the release APK or on a build signed with this upload key. For installs from Play, also add the Play App Signing certificate SHA-1 and SHA-256, then download a fresh `google-services.json`.

**Not a GitHub Actions secret**

The CI workflow (lint, smoke, proxy, rules) does not read repository secrets.

## Known engineering issues

- **No server-side agent memory.** The prompt is name and personality only. Chat history is `localStorage` key `vw-chat-<uid>` (last 40 kept, last 8 sent). The first greeting is inserted in memory when that log is empty and is written only when a later `save()` runs (after the user sends, or after a model reply). Closing chat before that drops the greeting. Rules deny any memory subcollection.
- **Location is owner-only in Firestore and public-to-the-room on ntfy.** `preciseVisibility` cannot be anything but `private`. Cross-user reads are denied. Family sharing publishes precise `{id, name, lat, lon, ts}` to `https://ntfy.sh/vw1-<room>` about every 5 seconds while sharing is on. Anyone with the room code can subscribe. There is no invite document and no expiry on the room id (16-character code stored in `localStorage` key `vw-room`).
- **Proxy limits are per process.** A restart or a second instance does not share them. Revoked ID tokens are accepted until they expire.
- **`GET /flights` and `GET /` are unauthenticated.** `/flights` is served even when the browser origin is not on the allowlist.
- **Debug APK omits the PWA shell files.** `www/` has `src/` and `assets/` but not `sw.js`, `manifest.json`, or `icons/`. The procedural character does not need `robot.glb` (removed in #9).
- **Release signing secrets are optional.** Until `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD` are all set, CI publishes the debug APK only. Google sign-in on the release build also needs that upload certificate's SHA-1 and SHA-256 (and, for Play installs, the Play App Signing fingerprints) on the Firebase Android app.
- **The Android workflow trigger is `push` only.** It does not show up as a `pull_request` check. A push of the head branch still builds the debug APK.
- **Pages deploy path is not defined in the repo.** Uncertain which setting publishes `main`.

## Changelog

One line per pull request. Status is `merged` or `open` as of 2026-10-24, after rebase onto `bfe2408`. #12 is this PR.

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
| #13 | Agent memory: synced chat history + server-side owner notes | open | `agents/{uid}/messages` (owner-only rules + tests, newest 200) synced across devices; proxy sends the last 20 messages and a server-written `agents/{uid}.memory` summary. Needs `FIREBASE_SERVICE_ACCOUNT` on Render. |
| TBD | feat: sign Android release builds from CI keystore secrets | open | Release APK and AAB are signed from `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD` when those secrets are set. The debug APK build still runs, and it is the only Android artifact when the secrets are unset. |

## How to update

Every pull request adds one row to the changelog (number, title, `merged` or `open`, one-line summary) and updates every section that the change affects, including architecture, the proxy, Firestore rules, Android signing and auth, CI, secret names, and known issues. Put product roadmap items in `docs/ROADMAP.md` and product decisions in `docs/DECISIONS.md`. Do not paste secret values, certificate fingerprints, or keystore passwords into this file.
