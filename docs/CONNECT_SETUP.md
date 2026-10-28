# Connect apps: one-time Google setup (Vishnu)

None of this needs billing, a card or the Google Cloud credits. Drive, Calendar and Gmail APIs are free at our size.
About 10 minutes. Use the Google account that owns project **virtual-world-8ac82**.

## 1. Turn on the three APIs
Open each link, check the project picker at the top says **virtual-world-8ac82**, and click **Enable**:
- Drive: https://console.cloud.google.com/apis/library/drive.googleapis.com?project=virtual-world-8ac82
- Calendar: https://console.cloud.google.com/apis/library/calendar-json.googleapis.com?project=virtual-world-8ac82
- Gmail: https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=virtual-world-8ac82

## 2. Consent screen (Testing mode)
1. Open https://console.cloud.google.com/auth/branding?project=virtual-world-8ac82
   (if it asks you to "Get started", do that: app name **Virtual World**, your email as support email, Audience **External**, your email as contact, agree, Create).
2. App name: **Virtual World**. Support email: yours. Save.
3. Open **Audience**: https://console.cloud.google.com/auth/audience?project=virtual-world-8ac82
   Leave Publishing status on **Testing**. Under **Test users** click **Add users**, add every Google account that will try it (yours, Srilatha's, any testers), Save. Max 100. Only these accounts can connect.
4. Open **Data access**: https://console.cloud.google.com/auth/scopes?project=virtual-world-8ac82
   Click **Add or remove scopes**, paste these three into "Manually add scopes", click **Add to table**, then **Update**, then **Save**:
   ```
   https://www.googleapis.com/auth/drive.readonly
   https://www.googleapis.com/auth/calendar.events
   https://www.googleapis.com/auth/gmail.compose
   ```
   In Testing mode Google shows an "unverified app" warning on the consent page; testers click **Continue**. Verification is only needed before going public.

## 3. Create the OAuth client
1. Open https://console.cloud.google.com/auth/clients?project=virtual-world-8ac82 and click **Create client**.
2. Application type: **Web application**. Name: **Virtual World proxy**.
3. Authorized redirect URIs → **Add URI**, paste exactly:
   ```
   https://virtual-world-ai.onrender.com/connect/google/callback
   ```
   (No JavaScript origins needed.) Click **Create**.
4. Copy the **Client ID** and **Client secret** from the popup (you can also download the JSON). Don't paste them in any chat.

## 4. Paste the keys on Render
1. Open https://dashboard.render.com → service **virtual-world-ai** → **Environment**.
2. **Add Environment Variable** three times:
   - `GOOGLE_OAUTH_CLIENT_ID` = the Client ID
   - `GOOGLE_OAUTH_CLIENT_SECRET` = the Client secret
   - `CONNECTOR_TOKEN_KEY` = a random 32-byte key. Make one at https://generate-random.org/encryption-key-generator (256-bit, Base64) or in a terminal: `openssl rand -base64 32`. Keep it forever; changing it disconnects everyone.
3. Click **Save, rebuild, and deploy**. `FIREBASE_SERVICE_ACCOUNT` is already set (the token store uses it).

## 5. Check
Open the app → Me → Apps. Drive, Calendar and Gmail show **Connect** (before step 4 they show **Coming soon**). Tap Gmail → Google consent → back in the app it says **Connected**.
