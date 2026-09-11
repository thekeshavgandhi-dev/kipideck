# Setting up Google Drive sync (one-time, ~5 minutes)

Kipideck's cross-device sync works by storing your decks in a private,
hidden **"app data" folder** in your own Google Drive — a folder Google
reserves specifically for apps, that:

- never appears in your normal Google Drive file list
- can only be read/written by the exact app (OAuth client) that created it
- costs Google Drive quota, but is invisible clutter-wise

Because it's *your* Drive, **there is no Kipideck server involved at all** —
nothing for anyone to host, pay for, or that could leak your data in a
breach. The trade-off is that whoever distributes/builds the extension
needs to register a free Google OAuth "client ID" once, the same way any
app that talks to a Google API does.

If you just installed a pre-built Kipideck from a store listing, the
developer has likely already set this up — you can skip straight to
**Settings → Sync → Sign in with Google** in the Library. The steps below
are only needed if you're building/self-hosting the extension yourself.

## 1. Create a Google Cloud project

1. Go to <https://console.cloud.google.com/projectcreate>.
2. Name it anything, e.g. "Kipideck Sync".

## 2. Configure the OAuth consent screen

1. In the left sidebar: **APIs & Services → OAuth consent screen**.
2. User type: **External** (unless you have a Google Workspace org).
3. Fill in app name ("Kipideck"), your support email, and developer email.
4. Under **Scopes**, add:
   - `https://www.googleapis.com/auth/drive.appdata`
   - `https://www.googleapis.com/auth/userinfo.email`
5. Under **Test users** (while the app is "Testing"), add every Google
   account you'll sign in with. (Google caps unverified apps at 100 test
   users, which is plenty for personal/team use. You can later submit for
   verification if you want it open to the public without this limit.)

## 3. Create an OAuth client ID

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Chrome App** (this also works for the Firefox flow,
   since Kipideck uses the browser-agnostic `identity.launchWebAuthFlow`,
   not Chrome's proprietary `getAuthToken`).
   - If "Chrome App" isn't available for your project type, choose
     **Web application** instead — either works with the flow Kipideck uses.
3. For "Chrome App", enter your unpacked extension's ID (visible on
   `chrome://extensions` once loaded, under Kipideck's card) as the
   **Application ID**.
   For "Web application", add this **Authorized redirect URI**:
   ```
   https://<your-extension-id>.chromiumapp.org/
   ```
   (Kipideck computes and can show you this exact URL — see below.)
4. Click **Create**. Copy the generated **Client ID**
   (looks like `1234567890-abc123.apps.googleusercontent.com`).

> **Finding your redirect URL:** open the extension's background service
> worker console (`chrome://extensions` → Kipideck → "service worker" →
> Console) and run `browser.identity.getRedirectURL()`. Firefox users can do
> the same from `about:debugging` → This Firefox → Kipideck → Inspect.

## 4. Enable the Google Drive API

1. **APIs & Services → Library**, search "Google Drive API", click **Enable**.

## 5. Paste the client ID into Kipideck

1. Open the Kipideck Library (toolbar icon → ⤢, or `Ctrl+Shift+L`).
2. **Settings → Sync across devices & browsers**.
3. Paste your client ID into **Google OAuth client ID** → **Save client ID**.
4. Click **Sign in with Google & enable sync**.
5. Approve the consent screen. You're syncing.

Repeat step 5 on every other browser/device — same client ID, same Google
account — and they'll all merge into the same Drive app-data file.

## Notes for maintainers publishing to the Chrome Web Store / AMO

- Ship a single client ID with the published extension (put it in
  `manifest.json`'s `oauth2.client_id` for Chrome, or keep using the
  `launchWebAuthFlow` approach for full cross-browser parity — Kipideck
  uses the latter everywhere so one code path covers every browser).
- Submit the OAuth consent screen for verification before removing the
  100-test-user cap, since `drive.appdata` is a "restricted" scope subject
  to Google's review process.
