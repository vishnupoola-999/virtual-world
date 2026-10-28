# Google OAuth verification

Project `virtual-world-8ac82`. Scopes: `openid`, `email`, `drive.file` (non-sensitive) and `calendar.events` (sensitive, needs review).

1. **Branding**: [Google Auth Platform → Branding](https://console.cloud.google.com/auth/branding?project=virtual-world-8ac82)
   - App home page: https://vishnupoola-999.github.io/virtual-world/
   - Privacy policy: https://vishnupoola-999.github.io/virtual-world/privacy.html
   - Terms of service: https://vishnupoola-999.github.io/virtual-world/terms.html
   - Authorized domain: `vishnupoola-999.github.io` (and `onrender.com` for the callback). Verify domain ownership in Search Console if asked.
   - Support and developer email: srilathapoola6@gmail.com. Save.
2. **Publish app**: [Audience](https://console.cloud.google.com/auth/audience?project=virtual-world-8ac82) → Publish app → In production. Until verified, users see an "unverified app" screen (Advanced → Continue) and there is a 100-user cap.
3. **Verification Center**: [Verification Center](https://console.cloud.google.com/auth/verification?project=virtual-world-8ac82) → Prepare for verification. For `calendar.events` justify: "Creates or updates a Calendar event only after the user asks the agent and taps Approve on the action card." Add the demo video link.
4. **Demo video** (unlisted YouTube, English, 2–4 min):
   - Show the browser address bar with the app URL and OAuth client ID visible in the consent URL.
   - Open the app, go to Me → Apps, tap Connect on Google Calendar.
   - Show the full Google consent screen with the app name and scopes.
   - Return to the app; tile shows Connected with the email.
   - Ask the agent to add an event, show the approval card, tap Approve, then open Google Calendar to show the event.
   - Show Drive saving a file the same way, and Disconnect at the end.
5. Reply promptly to emails from Google's review team (sent to the developer email). Review takes days to a few weeks.
