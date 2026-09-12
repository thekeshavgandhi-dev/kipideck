# Edge Add-ons — form fill sheet

**Extension:** Kipideck v1.5.0 · **Store:** Microsoft Edge Add-ons (Partner Center) · **Last updated:** 12 September 2026

This is the field-by-field "what do I type in this box" companion to
[`STORE_SUBMISSION.md`](./STORE_SUBMISSION.md). Where that document explains *why*, this one gives the
literal value to paste. Sections follow the left-nav order in Partner Center
(**Packages → Availability → Properties → Privacy → Store listings → Submit**), which is Microsoft's
own 8-step flow:
[Publish a Microsoft Edge extension](https://learn.microsoft.com/microsoft-edge/extensions/publish/publish-extension).

**This is a resubmission.** The 12 September upload was rejected at package validation on two errors
(a 316-character `description`, and `background.scripts` under MV3). Both are fixed and both are now
enforced by `npm run package`, so they cannot recur.

---

## 0 · Pre-flight — already done, verified this session

| Check | Result |
|---|---|
| `npm test` | ✅ 336 / 336 pass |
| `npm run package` | ✅ 3 zips rebuilt from v1.5.0 |
| `npm run verify:package` | ✅ all 3 pass the store rules |
| `description` length | 127 / 132 chars |
| `background` key | `service_worker` only — no `scripts` |
| Privacy policy URL live | ✅ `https://kipideck.vercel.app/privacy` renders |
| Fee | Free (Edge has no registration fee) |

If you rebuilt anything since, re-run `npm run check` before uploading.

---

## 1 · Step 3 — Packages

Upload **`website/public/downloads/kipideck-extension-chromium.zip`** (145 KB).

| Zip | Use it? | Why |
|---|---|---|
| `kipideck-extension-chromium.zip` | ✅ **this one** | Chromium manifest, `manifest.json` at the zip root — what Edge's validator wants |
| `kipideck-extension-firefox.zip` | ❌ | Firefox manifest (`background.scripts`) — **this is what got the last upload rejected** |
| `kipideck-extension.zip` | ❌ | Website download only; `manifest.json` is nested under `kipideck/` |

---

## 2 · Step 4 — Availability

| Field | Value |
|---|---|
| **Visibility** | `Public` (default). Choose `Hidden` only if you want to eyeball the listing before it is searchable — you can switch `Public → Hidden` later, but not the reverse. |
| **Markets** | Leave the default — **all current and future markets**. No reason to restrict. |

---

## 3 · Step 5 — Properties

| Field | Required | Value |
|---|---|---|
| **Category** | Required | **Productivity** |
| **Website** | Optional | `https://kipideck.vercel.app` |
| **Support contact detail** | Optional | `https://github.com/thekeshavgandhi-dev/kipideck/issues` — ⚠️ if you'd rather show an email, put it here; there is no support address in the repo, so don't leave it blank while a public issues page exists. |
| **Mature content** | Optional | **Leave unchecked.** |

---

## 4 · Step 6 — Privacy

⚠️ Everything in this section must agree with `https://kipideck.vercel.app/privacy`. Reviewers do
compare them, and a mismatch is a rejection.

### 4a · Single Purpose Description

> Kipideck lets you save anything you find on the web — a page, a link, an image, or a piece of
> selected text — and find it again later. That is its only job: capture, organise into decks, and
> search. It has no social features, no feed, no analytics, no advertising and no user accounts.

### 4b · Permission justification

Partner Center shows **one text box per permission declared in the manifest**, including host
permissions. All 13 of ours are used; none should be removed. Paste the matching line.

| Permission in the form | Justification to paste |
|---|---|
| `contextMenus` | Adds the "Save to Kipi" entry to the right-click menu — the main way you save a page, link, image, or selection. Registered on install; nothing else uses it. |
| `activeTab` | Together with `scripting`, reads the title, URL, preview image and visible text of the tab the user just acted on, so the saved item is searchable. Runs only on that tab, only at that moment. |
| `scripting` | Executes the capture function in the tab the user just saved from (`getPageMeta` and `getFullPageText` in `background/background.js`). Cannot fire without a user gesture, so it cannot power anything that must already be listening on the page. |
| `tabs` | Needs the URL and title of the tab being saved, and lets the "Open" button on a save-toast focus the right tab. Kipideck does not read the tab list, browsing history, or other tabs. |
| `storage` | Holds the library, decks, tags, notes, preferences and search index on this device, in `storage.local` and IndexedDB. |
| `unlimitedStorage` | Exists so a large library of saved article text (up to 20,000 characters per item) is not truncated by the browser's storage quota. |
| `notifications` | The small "Saved to Kipideck" toast, and a warning if syncing to the user's own Drive has stopped working. Both can be turned off in Settings. |
| `identity` | Only used if the user turns on Google Drive sync: it runs Google's own sign-in sheet and holds the token that lets Kipideck read and write that user's private Drive app-data folder. Dormant otherwise. |
| `alarms` | Only used if sync is on: wakes the background script every 10 minutes to push and pull changed shards. No alarm exists for anything else. |
| `<all_urls>` | You can save from any website, so the content script has to be able to run anywhere. Capture itself would work on `activeTab` alone, but four shipping features need a script already present on the page, because `executeScript` only fires on a user gesture: (1) auto-save of selected text, which fires when the mouse is released; (2) `Space`+`K` quick-save, which fires on a keypress; (3) the "already in your Kipideck" duplicate-detection toast, a reply to a save that already happened; (4) per-site mute and policy enforcement. The script is inert until needed: it reads nothing on load, sends nothing anywhere, and is gated by `lib/policy.js` — nothing is captured automatically until the first-run disclosure is accepted, and per-site mute is honoured. |
| `https://www.googleapis.com/*` | Google Drive API endpoint. Used only if the user turns on sync, and only to read and write that user's own app-data folder. |
| `https://oauth2.googleapis.com/*` | Google's OAuth token endpoint. Used only during Google sign-in, only if the user turns on sync. |
| `https://accounts.google.com/*` | Google's own sign-in consent screen, opened by `chrome.identity` only if the user turns on sync. |

**If a reviewer questions `<all_urls>`,** answer with the `<all_urls>` row above, not with a
one-liner. The full reasoning is §1 of [`STORE_SUBMISSION.md`](./STORE_SUBMISSION.md), including the
optional-host-permission fallback if review insists.

### 4c · Are you using remote code?

> **No, I am not using remote code.**

Select the **"No, I am not using remote code"** option. It is true: the extension executes only the
JavaScript bundled in its own package. The only network requests it makes are a one-time favicon
fetch per saved domain (cached locally) and, only if the user enables sync, Google Drive API calls.
Neither is executed as code.

### 4d · Data usage

**"What user data do you plan to collect from users now or in the future?"**

Tick **only** the box covering **web/page content the user explicitly saves** (the label reads
something like *Website content* / *Web content* / *User activity* — it is the only category that
applies). Leave every other box unticked:

- personal identifiers (name, email, phone, address) — **no**
- location — **no**
- browsing history — **no** (only the page the user acts on is ever seen)
- financial or payment information — **no**
- health information — **no**
- contacts — **no**

Kipideck stores what the user saves **locally, in their own browser profile**. Nothing is sent to the
developer, because there is no Kipideck server.

**"I certify that the following disclosures are true"** — tick the boxes that match these facts:

| Certification | Tick? |
|---|---|
| Data is not sold or rented to third parties | ✅ true |
| Data is not used for purposes unrelated to the extension's single purpose | ✅ true |
| Data is not transferred to third parties except as disclosed (the user's own Google Drive, only if the user opts in) | ✅ true |
| Data is encrypted in transit (HTTPS/TLS for the Drive API and favicon fetches) | ✅ true |
| Users can request deletion / delete their data (Library → Settings → delete everything; uninstalling removes all local data) | ✅ true |
| Data is encrypted **at rest** | ❌ **do not tick** — the library sits in the browser's own storage, which is not encrypted at rest. The privacy policy makes no such claim; ticking it would contradict it. |

The exact wording in Partner Center shifts; match each box to the fact in the table, not to the
label. If a box does not correspond to a row above, leave it unticked and say so in the certification
notes.

### 4e · Privacy policy

**Privacy Policy URL:** `https://kipideck.vercel.app/privacy`

---

## 5 · Step 7 — Store listings

The manifest has no `_locales` and no `__MSG_*__` placeholders, so **only one language row will
appear (`en-US`)** — that is expected, not a bug. Fill that row.

| Field | Value |
|---|---|
| **Extension name** | Read-only — pre-filled from the manifest as **`Kipideck — Save & Organize Anything`** (36 chars). ⚠️ Note this is *not* the 28-char `Kipideck — Save & Organize` written in `STORE_SUBMISSION.md` §4; the manifest is what Partner Center shows, and it is read-only here. To change it you must edit `manifest.json` and re-upload the zip. |
| **Short description** | Read-only — pre-filled from the manifest `description` (127 chars): *"Save pages, links, images and text in one click. Auto-organized, searchable, stored on your own device — no account, no server."* |
| **Description** | Paste the full description below — 1,995 chars, comfortably inside the 250–10,000 range. |
| **Extension logo** | Upload `icons/icon128.png`. It meets the 128×128 minimum; the recommendation is 300×300 and we do not have one — see §7. |
| **Screenshots** | Optional, max **6**, at **1280×800** (or 640×480). Use shots 1, 2, 4, 5, 6, 7 from §5 of `STORE_SUBMISSION.md` — skip shot 3 (import progress), it duplicates shot 2. |
| **Small / large promotional tile** | Optional — skip. Sizes are 440×280 and 1400×560 and we have no assets at those sizes. |
| **YouTube video URL** | Optional — skip. |
| **Search terms** | Max 7 terms, ≤30 chars each, ≤21 words total. Use: `read later` · `bookmarks` · `pocket alternative` · `omnivore alternative` · `save pages` · `offline library` · `local first` (7 terms, 13 words). |

### Full description — paste this

```
Save anything you find on the web — and keep it, no matter what happens to anyone's servers.

Kipideck is a local-first save tool. Your library lives in your own browser, on your own device.
There is no Kipideck account, no Kipideck server, and nothing you save is ever sent to us. If this
project disappeared tomorrow, the extension you installed would keep working and your library would
still be yours.

ARRIVING FROM POCKET OR OMNIVORE?
Both shut down and deleted their users' libraries. If you still have your export, Kipideck reads it:
Pocket CSV and ril_export.html, Omnivore metadata_*.json and its contents/ article text, Raindrop
backups, Instapaper, Pinboard, Wallabag, Readwise Reader, browser bookmarks and plain URL lists —
13 formats. Your tags, save dates, read state, highlights and annotations come with you.

WHAT IT DOES
• One right-click saves a page, a link, an image, a video, or exactly the text you selected.
• Everything is auto-filed into decks — Reading, Videos, Shopping, Dev & Docs, Research and more.
• Full-text search across everything you have ever saved, not just titles. Works offline.
• Highlighted text can save itself, so a quote becomes an item with a reference to where you found it.
• Duplicate detection: save something you already have and Kipideck offers to open the original.
• Export the whole library any time as JSON, bookmark HTML or Markdown. The schema is published.

OPTIONAL SYNC, ON YOUR TERMS
Turn on sync and Kipideck mirrors your library to a hidden app-data folder in your own Google
Drive. Not ours — yours. Skip it entirely and everything still works, fully offline.

PRIVACY
No account. No analytics. No ads. No tracking. No third-party requests. Favicons are cached locally
rather than fetched from a Google endpoint. Every permission the extension asks for is explained in
the privacy policy, including the ones that stay dormant until you turn on sync.

Works on Chrome, Edge, Brave, Opera and Firefox. Free, with no premium tier.
```

---

## 6 · Step 8 — Notes for certification

Paste this into **Notes for certification**:

```
Kipideck v1.5.0 — resubmission. The 12 September upload was rejected at package validation for two
errors, both now fixed and both enforced by the build: the manifest description was 316 characters
(now 127) and the manifest declared background.scripts under MV3 (the package is now
background.service_worker only).

NO ACCOUNT, NO LOGIN, NO TEST CREDENTIALS NEEDED. Everything below works on a fresh Edge profile.

How to test the core flow:
1. Install the extension (sideload or from the store listing).
2. The first-run page (onboarding/onboarding.html) opens automatically. It is the disclosure:
   nothing is captured automatically until the user presses a button on it. Reviewers should see
   this page before anything else happens.
3. Right-click any page and choose "Save to Kipi" — or press Space+K, or use the toolbar popup.
4. Click the toolbar icon, then "Open My Deck" to open the Library (library.html). The saved item
   appears there, filed into a deck automatically.
5. Search for a word from the page you saved — the match is found in the stored page text, not just
   the title.
6. Library → Import accepts a Pocket CSV (ril_export.html or part_*.csv), Omnivore
   metadata_*.json + contents/, Raindrop JSON, browser bookmark HTML, or a plain URL list. Nothing
   is written until the preview step is confirmed.

Permissions: <all_urls> is covered in the Permission justification section. The short version —
capture alone would work on activeTab, but auto-save of selected text, Space+K, the duplicate
detection toast and per-site muting all need a content script already present on the page, because
chrome.scripting.executeScript only runs as the result of a user gesture. The content script is
inert until needed and is gated by lib/policy.js.

SYNC CANNOT BE TESTED WITHOUT SETUP, BY DESIGN. Sync is off by default. Turning it on requires the
user to create their own Google OAuth client and paste its client ID into Settings (see
docs/GOOGLE_SYNC_SETUP.md). The identity, alarms and Drive host permissions stay dormant unless the
user does this. Please do not treat sync as untestable-by-default: it is opt-in by design so that no
Kipideck-operated server is ever involved.

Network behaviour with sync off: the only outbound requests are to the site an item was saved from —
one favicon fetch per saved domain, cached locally, and loading that site's own og:image when an item
is viewed. No analytics, no telemetry, no requests to any Kipideck domain (none exists).

Source: https://github.com/thekeshavgandhi-dev/kipideck
```

Then click **Publish**. Certification can take **up to 7 business days**.

---

## 7 · After it is submitted

1. **Record it in the submission log** — `STORE_SUBMISSION.md` §8. Note the date, and the reviewer's
   exact wording if they come back with a question. Edge is faster than Chrome, so an Edge objection
   is a free early warning for the Chrome submission.
2. **Screenshots are the one thing left to make.** The harness (`tools/screenshots/`) needs a real
   browser at 1280×800; it seeds a 42-item library so the shots look real.
3. **A 300×300 logo would be an improvement.** We only ship 128×128 (Edge's minimum). Optional — it
   is not a rejection risk, just a slightly soft listing tile.
4. **Then Firefox (free), then Chrome ($5).** Same answers mostly carry over; the Firefox deltas and
   the gecko id blocker are in `STORE_SUBMISSION.md` §6.

### Still not done from a repository

- Uploading the zip and clicking Publish — needs your Partner Center login.
- Taking the screenshots — needs a real browser.
- Choosing a support email, if you want one instead of the GitHub issues link.
