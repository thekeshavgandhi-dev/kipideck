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

Since v1.4 sign-in uses the **Authorization Code flow with PKCE** (the
implicit `response_type=token` flow v1.3 used is deprecated in OAuth 2.1 and
cannot issue a refresh token, which is why sync used to die every hour). Kipideck
asks Google for `access_type=offline` + `prompt=consent`, stores the refresh
token in your browser profile, and refreshes silently from then on.

## What Kipideck writes into that folder

| File | Contents |
|---|---|
| `kipideck-state.json` | The index: your decks, settings, deletion tombstones, item counts, and the content hash of every shard |
| `kipideck-meta-000.json` … `-063.json` | Item metadata (title, URL, tags, deck, timestamps), 64 buckets by item id |
| `kipideck-content-000.json` … `-255.json` | Saved page text, 256 buckets — kept separate so editing a title never re-uploads an article |

Only shards whose hash changed are uploaded, files above 4 MB use a resumable
upload, and a single pass is capped at 40 uploads/downloads so a huge first
sync is split across several alarm ticks instead of timing out. An old
single-blob `kipideck-sync.json` from v1.x is imported record-by-record on the
first sync and then deleted. All of it counts against your own Drive quota
(the app-data folder is not visible in Drive's UI, so use the Library's
**Settings → Diagnostics** panel for counts, or Google's connected-apps page to
revoke access entirely).

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
3. Paste your client ID into **Google OAuth client ID**.
4. Only if you created a **Web application** or **Desktop app** client: paste
   its **client secret** into the second field too. "Chrome App"/"Chrome
   Extension" clients have no secret — leave it blank. Secrets are stored in
   your browser profile (`chrome.storage.local`), never synced anywhere else,
   and the field is never re-displayed once saved.
5. Click **Save credentials**.
6. Click **Sign in with Google & enable sync**.
7. Approve the consent screen. You're syncing.

> **If sign-in says Google did not return a refresh token:** Google only hands
> out a refresh token on a *fresh* consent. Run sign-in once more — Kipideck
> requests `prompt=consent`, so the second attempt will show the consent sheet
> and return one. If you are the maintainer, check that the client is not in
> "Testing" mode with your account already removed from the test-user list.

Repeat step 7 on every other browser/device — same client ID, same Google
account — and they'll all merge into the same shard set. Merging is
record-level and last-writer-wins by `updatedAt`, deletions propagate as
tombstones, and each device's own settings always win over a synced copy
(capture preferences are per-device by design).

## If sync stops

The Library's sync pill turns into **⚠️ Sync paused — reconnect** after two
consecutive failures, and Settings shows the failure count and last error.
The usual causes, in order:

1. **`SESSION_EXPIRED`** — the refresh token was revoked (password change, or
   the app was de-authorised at <https://myaccount.google.com/permissions>).
   Sign in again.
2. **`invalid_client` / `unauthorized_client`** — the client ID and secret do
   not match, or the redirect URL
   `https://<extension-id>.chromiumapp.org/` is not authorised for a Web
   application client.
3. **Quota** — Drive's app-data folder counts against your storage. Free up
   space, or export and prune the library.

Nothing is lost while sync is broken: saves keep going into the local IndexedDB
library, and the next successful pass uploads whatever changed.

## Notes for maintainers publishing to the Chrome Web Store / AMO

- Ship a single client ID with the published extension (put it in
  `manifest.json`'s `oauth2.client_id` for Chrome, or keep using the
  `launchWebAuthFlow` approach for full cross-browser parity — Kipideck
  uses the latter everywhere so one code path covers every browser).
- Submit the OAuth consent screen for verification before removing the
  100-test-user cap, since `drive.appdata` is a "restricted" scope subject
  to Google's review process.
