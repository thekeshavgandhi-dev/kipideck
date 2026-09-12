# Kipideck — Progress

**Last updated:** 12 September 2026 · **Branch:** `arena/01a092e4-kipideck` · **Companion:** [`TASK.md`](./TASK.md) (what's next), [`ideas.md`](./ideas.md) (the full idea list)

One-line status: **Phase 0 (foundation) is shipped and measured. Phase 1 is roughly two-thirds done —
the importers (I-05) and the export formats (I-07 code) are finished and tested; the refugee landing
pages (I-06) and the store submission (I-01) are the remaining work.**

Everything below is either verified by a test in `test/` or explicitly marked as *not yet verified*.

---

## Phase scoreboard

| Phase | Scope | Status | Notes |
|---|---|---|---|
| **0 · Foundation** | Data layer at 50k, sync v2 (delta), trust leaks, tests + CI, privacy policy | ✅ **Complete** | Shipped in v1.4. Four ideas are deliberately partial (see below). |
| **1 · Exist** | I-05 importers, I-06 refugee pages, I-07 shutdown-proof export, I-01 stores, I-03 onboarding | 🟡 **~65%** | I-05 done · I-07 code done, doc pending · I-06 1 of 4 pages · I-01 not started · I-03 partial |
| 2 · Sync for humans | I-02 one-click sync, I-12 triage, I-19 save-all-tabs | ⬜ Not started | I-02's reliability half shipped in Phase 0 |
| 3 · Consume | I-08 reader, I-09 highlights, I-10 TTS, I-11 resurfacing | ⬜ Not started | |
| 4 · Free AI | I-13 summaries, I-14 semantic search, I-15 tagging v2 | ⬜ Not started | Progressive enhancement only |
| 5 · Everywhere | I-17 mobile PWA, I-18 snapshots, I-20 formats, I-26 Safari | ⬜ Not started | |
| 6 · Moat & money | I-22 E2EE, I-23 sharing, I-24 export targets, M-01/M-04 | ⬜ Not started | I-22's delta + scale half shipped in Phase 0 |

---

## Phase 0 — foundation ✅ (shipped v1.4)

The reason this came first: every later idea multiplies on a data layer that can hold 50,000 items,
and v1.3 could not hold 500 without a 2-second scan per keystroke.

| Was | Now | Verified by |
|---|---|---|
| Full scan per keystroke: 2.2 s @500, 45 s @10k | Persistent IndexedDB index: **369 ms per keystroke, 376 ms for a 2-word AND at 50,000 items** | `test/scale.bench.js` |
| Whole grid re-rendered on every change | 60-item pages + sentinel; first paint **59 ms**, offset 10,000 **481 ms** | `test/scale.bench.js` |
| Sync = one JSON blob (219 MB @50k vs Drive's 5 MB limit) | Sharded delta sync (64 meta + 256 content buckets, hash-gated, resumable >4 MB): **0.03 MB per 50 changed items** | `test/sync.test.js` |
| OAuth implicit flow, token died hourly | Authorization Code + **PKCE** + refresh token, silent refresh, failures surfaced | `test/sync.test.js` |
| `importJSON` **replaced** the library | Merge with dry-run preview; newest edit wins; deletions stay deleted | `test/storage.test.js` |
| Favicons from `google.com/s2` (leaked every domain) | Local icon cache + drawn letter avatars (**I-04 ✅**) | `test/canon.test.js` |
| Silent auto-capture, no disclosure | First-run disclosure page gating all silent capture; per-site mute; blank host fails **closed** | `test/policy.test.js` |
| No tests, no CI | **315 tests**, GitHub Actions on Node 20 + 22 | `npm test` |
| No privacy policy | `/privacy` — every permission justified | live page |

**Deliberately partial** (tracked in `TASK.md`):

- **I-02** — reliability half done (PKCE, refresh, error surfacing). *Missing:* first-party OAuth
  client, so sync still needs a BYO client ID. Deferred on purpose: it puts a Google-verified consent
  screen and a restricted-scope review in front of the store submission.
- **I-03** — disclosure onboarding ships. *Missing:* demo save, deck tour, import shortcuts, sample items.
- **I-16** — auto-dedupe ships. *Missing:* "related items" rail.
- **I-22** — delta + scale ship. *Missing:* optional E2E encryption.

---

## Phase 1 — exist 🟡 (~65%)

### I-05 · Importers — ✅ **DONE**

`lib/import.js` (1,050 lines, **zero dependencies, no DOM, no storage**) reads **13 export shapes**
and turns them into Kipideck records. Because it is pure text-in/text-out, every parser is tested
against realistic fixtures in Node.

| Format | id | What is preserved |
|---|---|---|
| Pocket final CSV (`part_*.csv`) | `pocket-csv` | pipe-separated tags, `time_added`, unread/archive, `cursor` ignored |
| Pocket `ril_export.html` | `pocket-html` | `extredirect` URLs **unwrapped**, read state from `Unread`/`Read Archive` sections, `time_added`, comma tags |
| Instapaper CSV | `instapaper` | url/title/description/tags |
| Raindrop JSON backup | `raindrop` | tags, collection → tag, type (image/video/article), `important` → favourite, **highlights + notes → note** |
| Omnivore metadata JSON | `omnivore` | `originalUrl`, labels → tags, `savedAt`, ARCHIVED state, author, **highlights + annotations → note** |
| Omnivore `contents/<slug>.html` | `article-html` | **the article text**, rejoined to its metadata by slug |
| Pinboard JSON | `pinboard` | space-separated tags, `extended` → note, `toread`, `shared:0` → private |
| Wallabag JSON | `wallabag` | HTML body → searchable text (scripts stripped), tags, archived, reading time |
| Readwise Reader CSV | `readwise` | Read Status, Notes, long Content column, cover image |
| Browser bookmarks HTML | `bookmarks-html` | nested folders → tags, `ADD_DATE`, Firefox `TAGS`/`PRIVATE`, `<DD>` notes, root heading ignored |
| Chrome profile `Bookmarks` JSON | `bookmarks-json` | **microseconds since 1601** converted, all roots walked, folder paths |
| Plain URL list / Markdown | `url-list` | bullets, numbering, markdown links, headings → folders, inline titles |
| Kipideck JSON | `kipideck` | decks, pins, types, timestamps — round-trips |

Behaviour that mattered enough to test:

- **Multi-file import.** Pocket ships a ZIP of `part_*.csv`; Omnivore ships `metadata_0.json`,
  `metadata_1.json`… The dialog takes them all at once and merges. The extension cannot unzip
  (zero deps, and `DecompressionStream` does not do ZIP) — it says so instead of failing quietly.
- **Dedupe everywhere.** Within a file, across files, and against the existing library, all by
  canonical URL. Importing twice adds nothing. An article listed under both *Unread* and *Archive*
  arrives once.
- **Deletions win.** Tombstones now carry the canonical URL, so an import cannot resurrect
  something the user already threw away (an id-only tombstone could not recognise a foreign file).
- **Newest edit wins**, in both directions, exactly like sync.
- **Honest reporting.** Rows with no usable address are counted and reported, not silently dropped;
  unread state is preserved in the summary but *not* tagged (tagging 90% of a library "unread" is
  noise); corrupt JSON is an error with a actionable message, never a partial import that looks like
  success.
- **Preview before write.** The dialog shows *ready / already here / newer elsewhere / skipped* plus
  per-file warnings before a byte is written, with options for target deck (or auto-organise),
  folders→tags, status→tags and keep-original-dates.
- **"N items rescued"** celebration panel after the write, with a progress bar during it.

Measured (in the test environment, which is pessimistic — `fake-indexeddb` in Node):

| Operation | Time |
|---|---|
| 20,000-row Pocket CSV: parse + normalise | **452 ms** (~44,000 rows/s) |
| 2,000 records: IndexedDB write + search index | **755 ms** (~2,650 items/s) |
| 1,000 items → bookmark HTML export | **12 ms** (82 KB) |

### I-07 · Shutdown-proof export — 🟡 **code done, documentation pending**

`lib/exporters.js` + three streamed exporters in `Storage`:

| Format | Method | What it carries |
|---|---|---|
| Kipideck JSON | `exportChunks()` | everything, lossless: page text, notes, tags, decks, dates, tombstones |
| Netscape bookmark HTML | `exportBookmarkHtml()` | links, titles, `ADD_DATE`, folders (one per deck), `TAGS`, `<DD>` notes, `PRIVATE` for pins |
| Markdown | `exportMarkdown()` | the library as readable notes; page text optional inside `<details>` |

The guarantee that is actually tested: **our own bookmark export imports back through our own
importer with URLs, titles, tags, dates, folders and notes intact** (`test/export.test.js`). That
round trip is what makes "you can always leave" a property rather than a claim.

*Still missing:* `docs/EXPORT_FORMAT.md` (the documented schema the pledge promises) and the public
`/shutdown-proof` pledge page.

### I-06 · Refugee landing pages — 🟡 **1 of 4 pages**

- ✅ `/pocket-alternative` — written and **building as a static route**: the 22 May / 8 Jul / 12 Nov
  2025 timeline, the four-step rescue (unzip → install → select all CSVs → preview), what survives
  (and the honest "Pocket never exported article text"), a Pocket-vs-Kipideck table, and six FAQs
  including "I never exported — can I get it back?" (answer: no).
- ✅ `app/components/PageShell.js` — shared nav/footer so the remaining pages cannot ship with a
  stale header or a missing privacy link.
- ⬜ `/omnivore-alternative`, `/raindrop-alternative`, `/shutdown-proof` — not written yet.
- ⬜ Homepage links + a "moving from Pocket?" section — not added yet.

### I-01 · Store submission — ⬜ **not started**

`docs/STORE_SUBMISSION.md` does not exist yet. The open decision is recorded in `TASK.md`: keep
`<all_urls>` with a written justification (removing it kills saving from arbitrary pages) versus an
optional-host-permission variant.

---

## Test & build status

| Check | Result |
|---|---|
| `npm test` (`node --test test/*.test.js`) | **315 / 315 passing**, 10 suites |
| `npm run package` | 31 files, **139 KB**, extension v1.4.0 |
| `npm run build` (website) | compiles; 6 static routes incl. `/pocket-alternative` |
| GitHub Actions | Node 20 + 22, runs the suite on push/PR |
| Runtime dependencies | **zero** (the only devDependency is `fake-indexeddb`) |

Test suites: `db` (29) · `storage` (28) · `canon` (37) · `sync` (25) · `wiring` (18) · `classify` (20)
· `policy` (25) · **`import` (95)** · **`import-storage` (15)** · **`export` (25)**.

The `wiring` suite is worth knowing about: it statically checks that every `id` the JS touches exists
in the HTML (or is created by the JS), and that UI calls into `lib/` match the real API — so the
interface and the data layer cannot drift apart silently.

---

## Where things live

```
lib/
  db.js          IndexedDB: items/contents/termdict/postings/idmap/kv/favicons/dirty
  storage.js     data layer: decks, settings, tombstones, importJSON, importRecords, 3 exporters
  import.js      13-format import engine (pure text → records)
  exporters.js   bookmark HTML + Markdown generators (pure)
  canon.js       URL canonicalisation, site labels, fingerprints
  search.js      ranked search over the chunked index
  text.js        tokenisation, stemming, stopwords
  classify.js    deck/type classification + tag hygiene
  favicons.js    local icon cache + letter avatars
  drive-sync.js  BYO-Drive sharded delta sync (PKCE)
  policy.js      capture policy contract (what may be silent, where)
library/         the Library UI: grid, search, detail, import + export dialogs
onboarding/      first-run disclosure/consent
test/            315 tests + a 50k-item benchmark
website/         Next.js marketing site: /, /deck, /privacy, /sync-setup, /pocket-alternative
```

---

## Known gaps and honest limitations

1. **ZIP files cannot be opened.** Users must unzip Pocket/Omnivore exports first. Fixing it means
   either a dependency or a hand-written inflate; both were rejected for now. The dialog explains it.
2. **Pocket exports contain no article text** — nobody can recover what was never exported. Kipideck
   stores text for items saved from now on.
3. **No first-party OAuth client**, so Drive sync still needs a BYO client ID (I-02's other half).
4. **Onboarding is disclosure-only** — no demo save, deck tour or sample items yet (I-03's other half).
5. **Not in any store.** Sideloading only, which is the single biggest conversion killer (I-01).
6. **No reader view.** Saved text is stored and searchable but never rendered cleanly (I-08).
7. **Version is still 1.4.0** — bump to 1.5.0 when Phase 1 ships.
