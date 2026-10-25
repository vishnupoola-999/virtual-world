# Google OAuth setup for the FLAGGED agent-tools path only

Normal users need none of this: by default the agent opens Gmail / Google Calendar links and an .ics file, with no extra scopes. This is only for the allowlisted test account(s) in `src/tools-config.js` that use the real Gmail send and Calendar APIs.

Do this in Google Cloud Console for project **virtual-world-8ac82** (the Firebase project).

1. **Enable APIs:** APIs & Services → Library → enable **Gmail API** and **Google Calendar API**.
2. **OAuth consent screen** (APIs & Services → OAuth consent screen / Google Auth Platform):
   - User type: **External**. Publishing status: **Testing** (no Google verification needed, max 100 test users).
   - App name, support email, developer contact email.
   - Authorized domains: add **`firebaseapp.com`**-hosted auth domain `virtual-world-8ac82.firebaseapp.com` (shown as `firebaseapp.com`) and **`github.io`** if the console accepts it. Home page URL: `https://vishnupoola-999.github.io/` (adjust to the live Pages path).
3. **Scopes** (Data access → Add or remove scopes):
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/calendar.events`
   These are sensitive/restricted scopes; that is fine in Testing mode.
4. **Test users** (Audience → Test users → Add users): add `srilathapoola6@gmail.com` and any other allowlisted account (max 100). Also add the same email to `TOOLS_API_ALLOWLIST` in `src/tools-config.js`.
5. **Firebase Authentication → Settings → Authorized domains:** make sure `vishnupoola-999.github.io` is listed (it already is if sign-in works).
6. Testing-mode tokens: users may need to re-consent after 7 days. That is expected.

Notes
- Nothing to set on Render: the proxy never handles Google tokens.
- The Android app's WebView can't open the consent popup yet; testers should use the website for Gmail/Calendar.
