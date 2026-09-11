# Kipideck 📌

**Save anything. It organizes itself.**

Kipideck is a browser extension for **Chrome, Edge, Brave, Opera, and
Firefox**. While you're browsing, whenever you see something worth keeping —
right-click it and choose **Save to Kipi**. Kipideck grabs the item *and*
where it came from, figures out which "deck" it belongs in, tags it, indexes
its full text so you can search it later, and files it away. Optionally turn
on sync and the same library follows you to every browser and device you
use, through your own Google Drive — no account with us, no server of ours, ever.

> **Local storage is the default and first priority.** Everything is saved
> to your browser's local storage the instant you install Kipideck — no
> sign-up, no internet connection needed, nothing to configure. Google
> Drive sync (below) is a completely optional extra you can turn on later
> from Settings; leaving it off changes nothing about how saving works.

A live marketing/docs site for this project lives in [`website/`](website/)
(a Next.js app) and is meant to be deployed on **Vercel** (see [Hosting](#hosting--deployment) below).


---

## Table of contents

- [What you can save](#what-you-can-save)
- [How the auto-organizing works](#how-the-auto-organizing-works)
- [Full-text search](#full-text-search)
- [Cross-device sync (Google Drive)](#cross-device-sync-google-drive)
- [Cross-browser support](#cross-browser-support)
- [The Library dashboard](#the-library-dashboard)
- [Project structure](#project-structure)
- [Run it locally](#run-it-locally)
- [Hosting & deployment](#hosting--deployment)
- [Data & privacy](#data--privacy)
- [Roadmap ideas](#roadmap-ideas)

---

## What you can save

Right-click on anything and click **Save to Kipi** — that's the whole
interaction, no sub-menus. Kipideck figures out what you pointed at:

| You right-click on... | What gets saved |
|---|---|
| Empty page area | The whole page — title, URL, preview image, and its full readable text (for search) |
| Selected text | The exact text you highlighted, plus the page it came from |
| A link | The link URL, plus a reference back to the page you found it on |
| An image | The image, plus a reference back to the page you found it on |
| A video element | The video URL, plus a reference back to the page |

There's also:
- **Selection auto-save** — highlight any text on a page and it's saved
  automatically, with the page it came from as its reference. No clicking,
  no confirming (toggle it in Library → Settings). Picking the same text
  again within a short window is ignored, so it never spams your library.
- A **toolbar popup** with a "Save this page" button and a one-line quick
  note field (press Enter to save) for jotting a thought without leaving the page.
- Keyboard shortcuts: **`Space` then `K`** quick-saves the current page from
  any website (a two-key combo that can't collide with browser shortcuts),
  plus `Ctrl+Shift+K` (`Cmd+Shift+K` on Mac) to quick-save the current page
  and `Ctrl+Shift+L` / `Cmd+Shift+L` to open the full library.

## How the auto-organizing works

Every saved item is run through a small local classifier
(`lib/classify.js`) that looks at the content type, the domain, and the
text to decide:

1. **Which deck it belongs in** — built-in decks include Reading, Videos,
   Images, Quotes & Notes, Shopping, Dev & Docs, Research, Links, and Inbox
   (the catch-all). You can also create your own custom decks.
2. **What tags to attach** — e.g. `tutorial`, `recipe`, `programming`,
   `design`, `deal`, plus the site's domain — so items are searchable even
   across decks.

Nothing here calls out to the internet — classification is instant,
offline, and private. You can turn auto-organizing off in Settings if you'd
rather file everything into Inbox and sort manually.

## Full-text search

Saving a whole page (`lib/extract.js`) captures its full readable text, not
just a meta-description snippet. That text is indexed by an offline
ranking search engine (`lib/search.js`) so the Library's search bar finds
things by what a page actually *said*, not just its title:

- Free-text queries are ranked by field (title & tags weigh more than raw
  page text) and support prefix matching (`prog` matches `programming`).
- Structured filters: `tag:recipe`, `site:github.com` — combine them with
  free text, e.g. `carbonara site:foodblog.com`.
- Search snippets in the Library grid show the matched sentence, not just
  the start of the item.

Everything runs in-memory against your local data — no external search
service, no network calls, works offline.

## Cross-device sync (Google Drive)

Turn on sync in **Library → Settings → Sync**, sign in with Google once per
browser, and your decks follow you everywhere:

- Kipideck stores a single JSON snapshot in a hidden **"app data" folder**
  that Google Drive reserves per-app — it never shows up in your normal
  Drive file list, and only Kipideck's own OAuth client can read or write it.
- **No server of ours is involved at all.** Google's infrastructure *is*
  the sync backend. There's nothing for us to host, nothing for us to see.
- Sign-in uses the standard `identity.launchWebAuthFlow()` OAuth2 flow —
  not Chrome's proprietary `getAuthToken` — so the exact same sign-in code
  works on Chrome, Edge, Brave, Opera, *and* Firefox.
- Merging is safe: each item/deck carries an `updatedAt` timestamp, and the
  newest edit wins across devices. Deletions are tracked with tombstones so
  deleting something on your phone won't get silently un-done by an older
  cached copy syncing in from your laptop.
- A background alarm re-syncs every 10 minutes, plus immediately after
  every save.

**Setup:** cross-device sync uses your own Google OAuth client ID (a free,
one-time Google Cloud Console step — think of it like registering *any*
app that talks to Gmail/Drive/Calendar). Full walkthrough:
[`docs/GOOGLE_SYNC_SETUP.md`](docs/GOOGLE_SYNC_SETUP.md).

## Cross-browser support

Kipideck is built on the standard `browser.*` WebExtensions API via
Mozilla's official `webextension-polyfill` (vendored in
`lib/browser-polyfill.js`), instead of Chrome-only APIs — so **one
codebase** runs unmodified on:

| Browser | Status |
|---|---|
| Chrome | ✅ Fully supported |
| Edge | ✅ Fully supported |
| Brave | ✅ Fully supported |
| Opera | ✅ Fully supported |
| Firefox | ✅ Fully supported (Manifest V3 with an event-page background, per Firefox's MV3 implementation) |
| Safari | ⚠️ Needs Apple's `xcrun safari-web-extension-converter` to wrap it into an Xcode project (Mac + Xcode required — not something we can build in a Linux/CI sandbox); the extension code itself needs no changes since it already only uses standard WebExtension APIs. |

How this is achieved:
- `lib/compat.js` is the single seam every other module imports `ext`
  from — nothing else touches `chrome.*` directly.
- `manifest.json`'s `background` block declares **both** `service_worker`
  (what Chromium browsers use) and `scripts` (what Firefox's Manifest V3
  event-page implementation requires) pointing at the same file — each
  browser picks the key it understands and ignores the other.
- `manifest.json` includes `browser_specific_settings.gecko` so Firefox
  accepts and can sign the extension.
- All messaging uses Promise-based `browser.runtime.sendMessage(...)`
  (never the Chrome-only callback form), since Firefox's native `browser`
  API is Promise-only.

## The Library dashboard

Click the extension icon → **⤢** (or `Ctrl+Shift+L`) to open the full
Library — a dashboard with:

- A sidebar of decks (with live counts), a tag cloud, and a sync status pill
- Full-text search across titles, saved page text, notes, tags, and domains
- Grid or list view, sort by newest/oldest/A–Z
- Click any card to open its detail view: edit the title, move decks,
  add/remove tags, write a personal note, re-open the original source,
  copy its reference, pin it, or delete it
- Multi-select + bulk move/delete
- One-click **Export** (JSON backup) and **Import** (restore/migrate)
- **Settings**: toggle auto-organize, selection auto-save, and the save
  toast, review the keyboard shortcuts, and manage Google Drive sync

## Project structure

```
kipideck/
├── manifest.json          Manifest V3 config — dual background keys for Chromium + Firefox
├── background/
│   └── background.js      Context menus, capture/classify/store pipeline, sync alarm
├── content/
│   ├── content.js         Selection auto-save + Space→K quick-save + save toasts + website bridge
│   └── content.css
├── lib/
│   ├── compat.js          Cross-browser `ext` shim (Proxy over globalThis.browser)
│   ├── browser-polyfill.js  Vendored Mozilla webextension-polyfill
│   ├── storage.js         browser.storage.local data layer (items, decks, settings, tombstones)
│   ├── classify.js        Offline heuristic classifier (deck + tag suggestions)
│   ├── extract.js         In-page full-text extraction for search
│   ├── search.js          Offline full-text search & ranking engine
│   └── drive-sync.js      Google Drive app-data sync client (OAuth + merge logic)
├── popup/
│   └── popup.html/.css/.js  Toolbar popup: quick save, quick note, recent items, search
├── library/
│   └── library.html/.css/.js  Full dashboard: decks, tags, search, item editor, sync UI
├── icons/                 Extension icons (16/32/48/128)
├── docs/
│   └── GOOGLE_SYNC_SETUP.md  Step-by-step Google Cloud Console setup for sync
├── website/               Next.js marketing/docs site (deploy target: Vercel)
└── dist/                  Packaged .zip of the extension (generated, git-ignored-friendly)
```

## Run it locally

**The extension:**
1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`,
   `about:debugging#/runtime/this-firefox` for Firefox).
2. Chrome/Edge/Brave/Opera: enable **Developer mode** → **Load unpacked** →
   select the `kipideck` folder.
   Firefox: **Load Temporary Add-on…** → select `kipideck/manifest.json`.
3. Pin the Kipideck icon to your toolbar. Right-click anywhere to start saving.

**The landing website (optional, for local preview):**
```bash
cd website
npm install
npm run dev
# open http://localhost:3000
```

## Hosting & deployment

- **Website → Vercel.** The `website/` folder is a Next.js app (App Router,
  fully static-prerendered — no backend calls) — import this repo into
  Vercel, set the project's **Root Directory** to `website`, and deploy.
  Vercel auto-detects Next.js and needs no extra configuration or
  environment variables. Full instructions in
  [`website/README.md`](website/README.md).
  - The site serves the extension as a **direct `.zip` download**
    (`/downloads/kipideck-extension.zip`, auto-packaged from this repo at
    build time by `website/scripts/build-extension-zip.mjs`), so visitors
    install straight from the website — no repo links anywhere on the site.
  - Its **Open My Deck** buttons use a tiny website → extension bridge
    (`content/content.js` sets a page marker and answers `postMessage`
    pings; `background.js` handles `KIPI_OPEN_LIBRARY`) to open the
    visitor's *own* library (their local items + their Drive-synced items).
    See `website/app/components/kipideck-bridge.js`.
- **Sync backend → none needed.** Because sync rides on each user's own
  Google Drive app-data folder, there is nothing of ours to deploy, scale,
  or pay for to support multi-device sync — see
  [Cross-device sync](#cross-device-sync-google-drive) above.
- **The extension itself** isn't "hosted" in the web-server sense — it's
  distributed by loading it unpacked (for now) or, eventually, by
  publishing to the Chrome Web Store / Firefox Add-ons (AMO) / Edge
  Add-ons, each a one-time developer submission outside this repo's scope.

## Data & privacy

By default, all data lives in `browser.storage.local` on your device only —
nothing is sent anywhere. If you opt into sync, the only place your data
goes is your own Google Drive's private app-data folder, authenticated
directly between your browser and Google — Kipideck's code never sees or
relays your credentials or data through any third-party server. Use
**Export** in the Library any time for a JSON backup, and **Import** to
restore it.

## Roadmap ideas

- Publish to the Chrome Web Store, Firefox Add-ons (AMO), and Edge Add-ons
- Package a Safari build via `xcrun safari-web-extension-converter`
- Smart deck suggestions that learn from your manual corrections
- Field-level (not just record-level) conflict merging for sync
- Optional end-to-end encryption of the synced Drive file
