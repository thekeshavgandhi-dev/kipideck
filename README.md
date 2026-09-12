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
- [Testing & CI](#testing--ci)
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

- Kipideck writes **sharded JSON** into a hidden **"app data" folder** that
  Google Drive reserves per-app — it never shows up in your normal Drive file
  list, and only Kipideck's own OAuth client can read or write it. One small
  state file indexes the shards; item metadata lives in 64 buckets and page
  text in 256 separate ones, so a 50,000-item library stays far below Drive's
  5 MB per-file upload limit. (v1.3 uploaded the *entire* library as one blob
  on every save: 4 MB at 500 items, 20 MB at 1,000, ~219 MB at 50,000.)
- Only shards whose contents actually changed are uploaded, tracked by a
  content hash, and anything over 4 MB uses a resumable upload. Editing one
  title re-uploads two shards instead of the whole library.
- **No server of ours is involved at all.** Google's infrastructure *is*
  the sync backend. There's nothing for us to host, nothing for us to see.
- Sign-in is **Authorization Code + PKCE** through the standard
  `identity.launchWebAuthFlow()` — not Chrome's proprietary `getAuthToken`,
  and not the deprecated implicit flow — so the exact same sign-in code works
  on Chrome, Edge, Brave, Opera, *and* Firefox, and a refresh token keeps the
  session alive instead of expiring every hour.
- Merging is safe: each item/deck carries an `updatedAt` timestamp, and the
  newest edit wins across devices. Deletions are tracked with tombstones so
  deleting something on your phone won't get silently un-done by an older
  cached copy syncing in from your laptop.
- Sync failures are counted and surfaced (a warning pill in the Library, and
  a notification if your Google session expires) instead of failing silently.
- A background alarm re-syncs every 10 minutes, plus immediately after every
  save. A very large first sync is split across several capped passes and
  continues on its own until it has caught up.

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
| Firefox | ✅ Fully supported (Manifest V3 with an event-page background — see the Firefox package note below) |
| Safari | ⚠️ Needs Apple's `xcrun safari-web-extension-converter` to wrap it into an Xcode project (Mac + Xcode required — not something we can build in a Linux/CI sandbox); the extension code itself needs no changes since it already only uses standard WebExtension APIs. |

How this is achieved:
- `lib/compat.js` is the single seam every other module imports `ext`
  from — nothing else touches `chrome.*` directly.
- `manifest.json` is the **Chromium** manifest: `background.service_worker`,
  no `background.scripts`, no `browser_specific_settings`.
- The two keys Firefox needs instead — `background.scripts` and
  `browser_specific_settings.gecko` — live in
  [`tools/firefox-manifest-overlay.json`](tools/firefox-manifest-overlay.json)
  and are merged in when the Firefox package is built. One manifest cannot
  serve both: Chromium's store validators reject a Manifest V3 package that
  carries `background.scripts` (Edge Add-ons refused the first upload with
  exactly that error), while Firefox ignores `service_worker` and runs an
  event page declared with `scripts` instead.
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
- **Settings**: toggle auto-organize, selection auto-save, the save toast and
  `Space`+`K`, review the keyboard shortcuts, manage muted sites, and manage
  Google Drive sync
- **Diagnostics**: live index statistics and a "rebuild search index" button
  with progress, for the rare case a result looks wrong

## Project structure

```
kipideck/
├── manifest.json          Manifest V3 config (Chromium; Firefox keys are merged in at build time)
├── background/
│   └── background.js      Context menus, capture/classify/store pipeline, sync alarm
├── content/
│   ├── content.js         Selection auto-save + Space→K quick-save + save toasts + website bridge
│   └── content.css
├── lib/
│   ├── compat.js          Cross-browser `ext` shim (Proxy over globalThis.browser)
│   ├── browser-polyfill.js  Vendored Mozilla webextension-polyfill
│   ├── db.js              IndexedDB core: records, search index, dirty queue, favicons
│   ├── storage.js         Async facade over db.js (items, decks, settings, tombstones, import/export)
│   ├── search.js          Ranked full-text search over the persistent index
│   ├── text.js            Tokenizer, accent folding, field weighting, snippets
│   ├── canon.js           URL canonicalization + duplicate fingerprints
│   ├── favicons.js        Local favicon cache (no third-party icon service)
│   ├── classify.js        Offline heuristic classifier (deck + tag suggestions)
│   ├── extract.js         In-page full-text extraction for search
│   └── drive-sync.js      Sharded Google Drive sync: PKCE auth, delta uploads, merge
├── popup/
│   └── popup.html/.css/.js  Toolbar popup: quick save, quick note, recent items, search
├── library/
│   └── library.html/.css/.js  Full dashboard: paginated grid, item editor, import preview, diagnostics, sync UI
├── onboarding/
│   └── onboarding.html/.css/.js  First-run disclosure: what is captured, and the toggles that gate it
├── icons/                 Extension icons (16/32/48/128)
├── docs/
│   └── GOOGLE_SYNC_SETUP.md  Step-by-step Google Cloud Console setup for sync
├── test/                  `node --test` suite: data layer, search, canonicalization, sync, wiring
├── .github/workflows/ci.yml  Tests on Node 20 + 22, weekly 50k-item benchmark, website build
├── website/               Next.js marketing/docs site (deploy target: Vercel), incl. /privacy
└── website/public/downloads/  Generated install packages:
    ├── kipideck-extension.zip           Website download (Chromium, nested in kipideck/)
    ├── kipideck-extension-chromium.zip  Edge Add-ons + Chrome Web Store upload (flat)
    └── kipideck-extension-firefox.zip   Firefox AMO upload (flat)
```

## Run it locally

**The extension:**
1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`,
   `about:debugging#/runtime/this-firefox` for Firefox).
2. Chrome/Edge/Brave/Opera: enable **Developer mode** → **Load unpacked** →
   select the `kipideck` folder (unzip `kipideck-extension.zip` first).
   Firefox: **Load Temporary Add-on…** → select `manifest.json` from the
   unzipped `kipideck-extension-firefox.zip` — the Firefox package, because
   `manifest.json` in the repo is the Chromium one and would give Firefox an
   extension with no background context at all.
3. Pin the Kipideck icon to your toolbar. Right-click anywhere to start saving.

**Building the packages** (writes all three zips + `version.json`):

```bash
npm run package          # at the repo root
npm run verify:package   # re-checks the built zips against the store rules
npm run check            # tests + package + verify
```

**The landing website (optional, for local preview):**
```bash
cd website
npm install
npm run dev
# open http://localhost:3000
```

## Testing & CI

The extension ships with zero runtime dependencies, and the tests use Node's
built-in runner plus [`fake-indexeddb`](https://github.com/dumbmatter/fakeIndexedDB)
— no browser, no emulator, no network:

```bash
npm install          # dev dependencies only (the test harness)
npm test             # 180 tests: data layer, search, canonicalization, capture policy, sync, wiring
npm run test:scale   # the 50,000-item benchmark (slow; nightly in CI)
npm run check        # tests + rebuild the installable extension package
```

What is covered, and why each group exists:

| Suite | What it pins down |
|---|---|
| `test/db.test.js` | The IndexedDB schema, the chunked search index, bulk writes, duplicate fingerprints, reindexing |
| `test/storage.test.js` | Import **merges** instead of replacing, export stays valid JSON at any size, the v1→v2 migration moves everything |
| `test/canon.test.js` | URL canonicalization and the dedupe fingerprint rules (same page from different sources = duplicate; same quote from different articles = not) |
| `test/policy.test.js` | That the code does what the first-run disclosure *says*: nothing silent before it is accepted, `Space`+`K` off on the sites the page names, muting a site silencing both behaviours |
| `test/sync.test.js` | PKCE sign-in, sharding, delta uploads, cross-device merge, delete propagation, legacy-blob migration, capped-pass convergence, expired sessions — run against an in-memory Drive + OAuth mock (`test/drive-mock.js`) |
| `test/wiring.test.js` | "Would this extension actually load?" — every element id, import, `getURL()` target, manifest entry and packaged file resolves |
| `test/scale.bench.js` | Query latency and import throughput at 20k/50k items, so a regression that only appears at scale cannot sneak in |

`.github/workflows/ci.yml` runs the tests on Node 20 and 22 for every push and
pull request, builds the website (which also packages the extension zip and
fails if the package is incomplete), and runs the 50k-item benchmark weekly.

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

By default, all data lives in **IndexedDB in your own browser profile** —
nothing is sent anywhere, and there is no Kipideck server to send it to. If
you opt into sync, the only place your data goes is your own Google Drive's
private app-data folder, authenticated directly between your browser and
Google — Kipideck's code never sees or relays your credentials or data
through any third-party server. Use **Export** in the Library any time for a
JSON backup, and **Import** to merge one back in (it shows you what will be
added, updated and skipped *before* writing anything).

Two things are worth calling out because they changed in v1.4:

- **Nothing is captured silently until you have been told.** The first time
  Kipideck runs it opens [`onboarding/onboarding.html`](onboarding/onboarding.html),
  which lists exactly what it can save and what it never touches, and asks you
  to choose the automatic behaviours (auto-saving selected text, `Space`+`K`).
  Until you press a button there, only explicit saves work. Every automatic
  save also shows a toast with an *Open* and a *Never here* button, and
  individual sites can be muted from **Library → Settings**.
- **No third-party requests for favicons.** v1.3 loaded site icons from
  `google.com/s2/favicons`, which told Google every domain in your library.
  Icons are now fetched from the site itself and cached locally
  ([`lib/favicons.js`](lib/favicons.js)), with a locally drawn letter avatar as
  the fallback.

The full policy — every permission and why it is needed — lives at
[`website/app/privacy/page.js`](website/app/privacy/page.js), published at
<https://kipideck.vercel.app/privacy>.

## Roadmap ideas

The full analysis lives in [`ideas.md`](ideas.md). Done in v1.4 (the
"Phase 0" foundation work): the persistent search index, windowed rendering,
sharded delta sync, merge-not-overwrite import, the local favicon cache, the
first-run disclosure page, the published privacy policy, the test suite and CI,
and the `Space`+`K` conflict fix.

Still open:

- Publish to the Chrome Web Store, Firefox Add-ons (AMO), and Edge Add-ons —
  timed before **12 November 2026**, the anniversary of Pocket deleting all
  user data, which is when its refugees will be looking again
- Importers for Pocket, Instapaper, Raindrop, Chrome bookmarks and browser
  history exports (the merge-not-overwrite import path is ready for them)
- "Refugee" landing pages for each of those audiences
- Package a Safari build via `xcrun safari-web-extension-converter`
- Smart deck suggestions that learn from your manual corrections
- Field-level (not just record-level) conflict merging for sync
- Optional end-to-end encryption of the synced Drive shards
- Chrome-only progressive enhancement via the Summarizer/Prompt APIs (desktop
  Chrome 138+; must degrade silently everywhere else)
