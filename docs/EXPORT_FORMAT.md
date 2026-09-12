# Kipideck export format

**Version:** schema `version: 2` · **Applies to:** extension v1.4+ · **Last updated:** 12 September 2026

The [shutdown-proof pledge](https://kipideck.vercel.app/shutdown-proof) promises a *documented* export
schema. This is that document. Without it the promise is marketing, so every field below is what the
code actually writes — `lib/storage.js` (`exportChunks`), `lib/exporters.js` and `lib/db.js` — not
what we intend to write one day.

If Kipideck disappeared, this file is enough to read or convert an export yourself.

> Two rules govern everything below:
>
> 1. **`content` is absent when it is empty.** It is not written as `""`. A missing `content` key
>    means "no stored page text", which is how an export stays small when page text is switched off.
> 2. **Internal index fields are stripped on the way out.** `idx` and `n` exist on the stored record
>    for search-index ordering and are deliberately removed by `exportChunks`.

---

## 1 · JSON (lossless)

`Storage.exportChunks({ withContent })` returns an **array of string chunks**, not one string, so a
50,000-item library is written to a `Blob` without ever building a 400 MB string in memory. Join them
(or parse the concatenation) to get one valid JSON document:

```js
const parts = await Storage.exportChunks({ withContent: true });
const text = JSON.parse(parts.join(""));   // or: new Blob(parts, { type: "application/json" })
```

### 1.1 The envelope

```json
{
  "version": 2,
  "app": "kipideck",
  "exportedAt": "2026-09-12T02:16:52.894Z",
  "counts": { "items": 2, "decks": 9 },
  "decks": [ /* … */ ],
  "settings": { /* … */ },
  "tombstones": [ /* … */ ],
  "items": [ /* … */ ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `version` | number | Schema version. Currently `2`. A reader should refuse a higher major version rather than guess. |
| `app` | string | Always `"kipideck"`. Lets a tool recognise the file before parsing it. |
| `exportedAt` | string | ISO-8601 UTC timestamp of the moment the export ran. |
| `counts` | object | `{ items, decks }` — convenience totals, so a reader can show progress without walking `items`. |
| `decks` | Deck[] | Every deck, in sidebar order. See §1.3. |
| `settings` | object | The user's settings blob. See §1.4. |
| `tombstones` | Tombstone[] | Deletion records. See §1.5. |
| `items` | Item[] | The library, sorted by `createdAt` ascending. See §1.2. |

### 1.2 Item fields

Every item carries these. **Required** means present on every item written by `saveItem`;
**optional** means absent when empty.

| Field | Type | Req. | Meaning |
|---|---|---|---|
| `id` | string | ✅ | Stable unique id (`k_<base36>`). The key for merge, sync and tombstones. |
| `type` | string | ✅ | `page` · `link` · `image` · `video` · `quote` · `document` · `session` … Defaults to `"page"`. |
| `title` | string | ✅ | Item title. May be `""` if the page had none; the URL stands in for display. |
| `url` | string | ✅ | The canonical address of the item itself. |
| `sourceUrl` | string | optional | The page this item was saved *from*, when different — e.g. the article you found a link on. |
| `domain` | string | optional | Host of `url`, set by the capture path (`hostOf()`), not by `saveItem`. |
| `favicon` | string | optional | Cached favicon as a data URL. Local cache only — no third-party request is ever made. |
| `image` | string | optional | Preview/cover image URL. |
| `excerpt` | string | optional | Short summary or meta description, up to ~400 chars. |
| `note` | string | optional | The user's note. Imported highlights and annotations are appended here too. |
| `tags` | string[] | ✅ | Lower-cased, de-duplicated. `[]` when there are none — never absent. |
| `deckId` | string | ✅ | Which deck the item is in. Defaults to `"inbox"`. |
| `reference` | string | optional | Provenance line, e.g. `Found on: <title> (<url>)`. Set for selections, links and images. |
| `createdAt` | number | ✅ | **Milliseconds** since the Unix epoch — when the item was saved. |
| `updatedAt` | number | ✅ | **Milliseconds** since the epoch — last edit. Merge uses "newer `updatedAt` wins". |
| `pinned` | boolean | ✅ | Whether the item is pinned. |
| `status` | string | ✅ | The save-state: `unread` · `reading` · `done` · `archived` (v1.6.0+). Defaults to `"unread"`; pre-v1.6 records are backfilled on upgrade, foreign read-states map onto it at import. |
| `tabs` | {url,title}[] | sessions | The saved window: one `{url, title}` entry per tab. Only on `type: "session"` items, which have no `url` of their own. |
| `tabCount` | number | sessions | `tabs.length` at save time. A display hint — `tabs` is the source of truth. |
| `content` | string | **optional** | Full stored page text, capped at 20,000 chars. **Absent entirely when empty** — this is the single most important rule in the format. |
| `canon` | string | internal | Canonicalised URL used for de-duplication and tombstone matching across imports. |
| `fp` | string | internal | Duplicate fingerprint (`u:<canon>` for URLs, `t:…` for text selections). |
| `pf` | number | internal | Numeric pinned flag (`1`/`0`) maintained for the search index. `pinned` is the field to read. |

`idx` and `n` exist on stored records for index ordering and are **stripped on export**.

### 1.3 Deck

```json
{ "id": "reading", "name": "Reading", "icon": "📖", "color": "#7C5CFC", "smart": true, "builtin": true }
```

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Stable key. `items[].deckId` points here. Built-ins: `reading`, `images`, `videos`, `quotes`, `shopping`, `dev`, `research`, `links`, `inbox`. |
| `name` | string | Display name. |
| `icon` | string | Emoji shown in the sidebar. **Deliberately omitted** from bookmark-HTML folder names — see §2. |
| `color` | string | Hex colour for the deck chip. |
| `smart` | boolean | Whether the classifier may file items here automatically. |
| `builtin` | boolean | Ships with the extension. User decks are `false`. |

### 1.4 Settings

```json
{
  "autoOrganize": true,
  "showToast": true,
  "autoSaveSelection": true,
  "showFloatingButton": true,
  "spaceKQuickSave": true,
  "theme": "system",
  "onboardingDone": false
}
```

| Field | Type | Meaning |
|---|---|---|
| `autoOrganize` | boolean | Run the local classifier on save and file items into decks. |
| `showToast` | boolean | Show the "saved" confirmation toast. |
| `autoSaveSelection` | boolean | Auto-save highlighted text. **Only ever honoured after the first-run disclosure is accepted.** |
| `showFloatingButton` | boolean | Legacy pre-1.3 key for the same behaviour; kept for older installs. |
| `spaceKQuickSave` | boolean | `Space`+`K` quick-save. Auto-disabled on sites where those keys already mean something (YouTube, Gmail, video players). |
| `theme` | string | `"system"` · `"light"` · `"dark"`. |
| `onboardingDone` | boolean | Whether the first-run disclosure has been accepted. Nothing is captured silently until this is `true`. |

### 1.5 Tombstones

```json
{ "id": "k_mtxr86fo_7ihqq8u", "canon": "example.com/2024/03/garden-path", "deletedAt": 1789179412884 }
```

| Field | Type | Meaning |
|---|---|---|
| `id` | string | The id of the deleted item. |
| `canon` | string | **Optional** — present when the canonical URL was known at deletion time. |
| `deletedAt` | number | Milliseconds since the epoch. |

**Why `canon` is here.** This is the field that makes deletion survive an import. A foreign export
file — a Pocket CSV, an Omnivore `metadata_0.json` — carries none of our ids, so an id-only tombstone
cannot recognise a link the user already deleted. Re-importing that file would quietly resurrect every
article they had thrown away. Recording the canonical URL alongside the id means the import can tell
"deleted here" apart from "never seen here". A tombstone arriving from another device still has only an
`id`; that is fine, because the item it refers to arrived with that same id.

Tombstones older than **365 days** are pruned on write, so the list cannot become the next scaling wall
at 50,000 items.

---

## 2 · Bookmark HTML (Netscape format)

`Storage.exportBookmarkHtml()` — the format every browser, and nearly every read-later service, still
imports. It carries links, titles, dates, folders, tags and notes. **It cannot carry page text**; the
format has nowhere to put it.

| Kipideck field | Bookmark HTML | Notes |
|---|---|---|
| deck (`deckId`) | `<DT><H3>` folder, one per deck | Items are grouped by deck because folders are the format's only hierarchy. The deck **emoji is not written** — a bookmark file is interchange data, and every other app would show the folder as "📖 Reading", including our own importer, which would then tag items with the icon. |
| `url` | `HREF="…"` | Escaped as an attribute. |
| `title` | the `<A>` text | Whitespace collapsed, capped at 400 chars, falls back to the URL, then `Untitled`. |
| `createdAt` | `ADD_DATE` | **Unix seconds**, which is what every bookmark file in the wild uses. A value already seconds-sized is passed through rather than divided into 1970. |
| `updatedAt` | `LAST_MODIFIED` | Written only when it differs from `ADD_DATE`. |
| `tags` | `TAGS="a,b"` | Comma-joined. Commas inside a tag are replaced with spaces. |
| `note` | `<DD>` description | Newlines flattened to spaces, capped at 2,000 chars. Highlights arrive here too, since they live in `note`. |
| `pinned` | `PRIVATE="1"` | Only attribute available that means "special" without breaking importers. |
| session item | one `<DT><H3>` folder holding one `<A>` per tab | Titled “<name> (N tabs)” with the session's `ADD_DATE`. A session with no restorable tabs exports nothing. |
| `content` | *not exported* | The format cannot hold page text. |

An item with **no URL exports nothing** — a `<DT><A>` with an empty `HREF` is invalid and would be
rejected by the very importers this format exists to satisfy. Sessions are the exception: they have
no URL of their own and export as a folder of their tabs instead.

---

## 3 · Markdown

`Storage.exportMarkdown({ withContent })` — the library as plain notes, readable in Obsidian, a wiki or
a text editor. Grouped by deck, with an `---` separator between items.

```
# Kipideck library

Exported 2026-09-12 · 2 items · with page text

Everything below is plain Markdown. It does not need Kipideck to be read, searched or edited.

# 📖 Reading            <- one H1 per deck (icon included here: it is for humans)

## [Title](<url>)       <- one H2 per item; angle brackets keep URLs with spaces/parens working
_domain · saved 2026-09-12 · pinned · type_     <- italic meta line
`#tag1` `#tag2`
> excerpt
**2 tabs**                  <- sessions list their tabs as links, right here
- [Alpha](https://example.com/a)

**Notes & highlights**
> “quoted highlight”
>   — your annotation

<details><summary>Page text</summary>   <- page text lives here, and ONLY here
…up to 40,000 chars…
</details>

---
```

Page text is capped at **40,000 characters** per item and is omitted entirely unless
`withContent` is set.

---

## 4 · A worked example

Real output from a two-item library — one saved article with a highlight, one bare link — produced by
running the actual exporters. Only the interesting parts are shown; the nine default decks are elided.

```json
{
  "version": 2,
  "app": "kipideck",
  "exportedAt": "2026-09-12T02:16:52.894Z",
  "counts": { "items": 2, "decks": 9 },
  "decks":  [ … ],
  "settings": { "autoOrganize": true, "theme": "system", "onboardingDone": false, … },
  "tombstones": [],
  "items": [
    {
      "id": "k_mtxr86fo_7ihqq8u",
      "type": "page",
      "title": "The garden path and other ways to lose an afternoon",
      "url": "https://example.com/2024/03/garden-path",
      "sourceUrl": "https://news.ycombinator.com/item?id=1",
      "image": "https://example.com/img/cover.jpg",
      "excerpt": "A short piece about attention, and the paths that quietly take it.",
      "note": "“Attention is the rarest form of generosity.”\n  — Simone Weil",
      "tags": ["reading", "attention"],
      "deckId": "reading",
      "createdAt": 1789179412884,
      "updatedAt": 1789179412884,
      "pinned": true,
      "status": "reading",
      "pf": 1,
      "canon": "example.com/2024/03/garden-path",
      "fp": "u:example.com/2024/03/garden-path",
      "content": "The full text of the article, every word of it, stored locally and indexed for search."
    },
    {
      "id": "k_mtxr86fw_qks4je0",
      "type": "link",
      "title": "MDN — IndexedDB API",
      "url": "https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API",
      "tags": ["dev", "reference"],
      "deckId": "dev",
      "createdAt": 1789179412892,
      "updatedAt": 1789179412892,
      "pinned": false,
      "status": "unread",
      "pf": 0,
      "canon": "developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API",
      "fp": "u:developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API"
    }
  ]
}
```

Reading it line by line:

- **`"content"` appears on the first item and is absent on the second.** The second item has no stored
  page text, so the key is not written at all. This is rule 1 from the top of the file, and it is why a
  links-only export is a fraction of the size.
- **`createdAt` / `updatedAt` are equal** on both: neither has been edited since it was saved.
- **`pinned: true` on the first** also appears as `pf: 1` — the numeric mirror the search index uses.
  Read `pinned`, ignore `pf`.
- **`canon` and `fp`** are the de-duplication keys. If this library were re-imported, a matching `canon`
  is what makes the second import add nothing.

The same two items as bookmark HTML:

```html
<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<!-- Exported from Kipideck on 2026-09-12. -->
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3>Reading</H3>
    <DL><p>
        <DT><A HREF="https://example.com/2024/03/garden-path" ADD_DATE="1789179413" TAGS="reading,attention" PRIVATE="1">The garden path and other ways to lose an afternoon</A>
        <DD>“Attention is the rarest form of generosity.”   — Simone Weil
    </DL><p>
    <DT><H3>Dev &amp; Docs</H3>
    <DL><p>
        <DT><A HREF="https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API" ADD_DATE="1789179413" TAGS="dev,reference">MDN — IndexedDB API</A>
    </DL><p>
</DL><p>
```

Note `ADD_DATE="1789179413"` — seconds, not the `1789179412884` milliseconds in the JSON. Note also
that the folder is `Reading`, not `📖 Reading`, and that `Dev & Docs` is escaped as `Dev &amp; Docs`.

---

## 5 · Re-import guarantees

Which fields survive a round trip through which format, and the test that proves it.

| Field | JSON | Bookmark HTML | Markdown |
|---|---|---|---|
| `url` | ✅ | ✅ | ✅ |
| `title` | ✅ | ✅ | ✅ |
| `tags` | ✅ | ✅ (`TAGS`) | ✅ |
| `createdAt` | ✅ (ms) | ✅ (Unix seconds) | ⚠️ date only, in the meta line |
| `updatedAt` | ✅ | ✅ (`LAST_MODIFIED`) | ❌ |
| `note` + highlights | ✅ | ✅ (`<DD>`) | ✅ |
| `pinned` | ✅ | ✅ (`PRIVATE="1"`) | ⚠️ in the meta line, not machine-readable |
| deck / folder | ✅ (`deckId`) | ✅ (`<H3>` folder → tag on re-import) | ✅ (H1 section) |
| `type` | ✅ | ❌ | ⚠️ meta line only |
| `image`, `excerpt`, `sourceUrl`, `reference` | ✅ | ❌ | ⚠️ excerpt only |
| `content` (page text) | ✅ | ❌ | ✅ (inside `<details>`) |
| decks, settings, tombstones | ✅ | ❌ | ❌ |

**Only JSON is lossless.** That is stated in the export dialog and asserted by a test, so the UI cannot
drift from the truth.

### The tests that prove it

| Guarantee | Test |
|---|---|
| Our bookmark export imports back through our own importer with URLs, titles, tags, dates, folders and notes intact | `test/export.test.js` → *"the exported file imports back with URLs, titles, tags and dates"* |
| Round trip through the **real** library, not a fixture | `test/export.test.js` → *"bookmark HTML comes out of the real library and imports back whole"* |
| JSON export stays valid and re-imports **without duplicating** | `test/export.test.js` → *"JSON export stays valid and re-imports without duplicating"* |
| Dates are Unix seconds, and an already-seconds value is not divided into 1970 | *"dates are exported as Unix seconds…"*, *"a timestamp that is already in seconds is not divided into 1970"* |
| Tags, notes and pins land where browsers read them | *"tags ride along in the attribute browsers actually read"*, *"notes become the `<DD>` description"*, *"pinned items are marked, and an item with no URL exports nothing"* |
| Markdown carries titles, links, tags, notes and optional page text | *"Markdown carries titles, links, tags and notes"*, *"Markdown can include page text on request"* |
| An item in a deleted deck is exported, not dropped | *"an item in a deck that no longer exists is exported, not dropped"* |
| An empty library produces a valid file, not a crash | *"an empty library still produces a valid file, not a crash"* |
| Only JSON claims to be lossless | *"three formats, and only JSON claims to be lossless"* |
| 1,000 items export to HTML fast enough to feel instant (~12 ms) | *"1,000 items export to HTML fast enough to feel instant"* |

Run them with `npm test`. The suite is 315 tests, and it runs on Node 20 and 22 in CI.

---

## 6 · Notes for anyone writing a converter

- **Timestamps in JSON are milliseconds; timestamps in bookmark HTML are seconds.** Converting
  between the two is the single easiest way to corrupt an export, and there is a test for it precisely
  because of that.
- **A missing `content` key is normal.** Treat absent and `""` identically, but do not treat either as
  an error.
- **Ignore `canon`, `fp` and `pf` unless you are re-importing into Kipideck.** They are internal
  de-duplication and index mirrors of `url` / `title` and `pinned`.
- **`version` will change.** Refuse a `version` higher than you understand rather than guessing; the
  importer in `lib/import.js` is the reference implementation.
- **The bookmark HTML folder name is the deck name with no emoji.** If you add the emoji back, our own
  importer will turn it into a tag.
