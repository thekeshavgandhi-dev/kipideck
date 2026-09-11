# Kipideck 📌

**Save anything. It organizes itself.**

Kipideck is a browser extension (Chrome / Edge / Brave / any Chromium browser,
Manifest V3). While browsing, whenever you see something worth keeping —
right-click it and choose **Save to Kipi**. Kipideck grabs the item *and*
where it came from, figures out which "deck" it belongs in, tags it, and
files it away so you can find it again in seconds. Everything is stored
locally on your device — no account, no server, no tracking.

## What you can save

Right-click on any of these and pick **Save to Kipi**:

| You right-click on... | What gets saved |
|---|---|
| Empty page area | The whole page — title, URL, description, preview image |
| Selected text | The exact text you highlighted, plus the page it came from |
| A link | The link URL, plus a reference back to the page you found it on |
| An image | The image, plus a reference back to the page you found it on |
| A video element | The video URL, plus a reference back to the page |

There's also:
- A **floating "Save to Kipi" bubble** that pops up automatically whenever
  you select text on a page (no right-click needed).
- A **toolbar popup** with a "Save this page" button and a "Note" button
  for jotting a quick thought without leaving the page.
- Keyboard shortcuts: `Ctrl+Shift+K` (`Cmd+Shift+K` on Mac) to quick-save the
  current page, `Ctrl+Shift+L` / `Cmd+Shift+L` to open the full library.

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

## The Library

Click the extension icon → **⤢** (or `Ctrl+Shift+L`) to open the full
Library — a dashboard with:

- A sidebar of decks (with live counts) and a tag cloud
- Search across titles, saved text, notes, tags, and domains
- Grid or list view, sort by newest/oldest/A–Z
- Click any card to open its detail view: edit the title, move decks,
  add/remove tags, write a personal note, re-open the original source,
  copy its reference, pin it, or delete it
- Multi-select + bulk move/delete
- One-click **Export** (JSON backup) and **Import** (restore/migrate)

## Project structure

```
kipideck/
├── manifest.json          Manifest V3 config, permissions, context menus, shortcuts
├── background/
│   └── background.js      Context menus + capture/classify/save pipeline (service worker)
├── content/
│   ├── content.js         Floating "Save to Kipi" bubble on text selection + toasts
│   └── content.css
├── lib/
│   ├── storage.js         chrome.storage.local data layer (items, decks, settings)
│   └── classify.js        Offline heuristic classifier (deck + tag suggestions)
├── popup/
│   ├── popup.html/.css/.js  Toolbar popup: quick save, quick note, recent items
├── library/
│   ├── library.html/.css/.js  Full dashboard: decks, tags, search, item editor
└── icons/                 Extension icons (16/32/48/128)
```

## Load it locally (unpacked)

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `kipideck` folder.
4. Pin the Kipideck icon to your toolbar. That's it — right-click anywhere
   to start saving.

## Data & privacy

All data lives in `chrome.storage.local` on your machine only. Nothing is
sent to a server. Use **Export** in the Library's sidebar any time you want
a JSON backup, and **Import** to restore it (e.g. after reinstalling, or to
move to another machine/browser profile).

## Roadmap ideas

- Sync via `chrome.storage.sync` or a self-hosted backend (opt-in)
- Full-text search over saved page content (not just excerpts)
- Smart deck suggestions that learn from your manual corrections
- Firefox (Manifest V2/V3 hybrid) build
