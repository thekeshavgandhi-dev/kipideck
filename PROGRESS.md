# Kipideck — Progress

**Last updated:** 12 September 2026 · **Branch:** `arena/01a0935d-kipideck` · **Version:** 1.5.0 ·
**Companion:** [`TASK.md`](./TASK.md) (what's next), [`ideas.md`](./ideas.md) (the full idea list),
[`CHANGELOG.md`](./CHANGELOG.md) (what shipped when)

One-line status: **Phase 0 (foundation) is shipped and measured. Phase 1 is done — all four refugee
pages, the documented export schema, the store-submission paperwork and the finished onboarding all
shipped in v1.5.0. What remains is the act of submitting to the stores (I-01) and Phase 2.**

Everything below is either verified by a test in `test/` or explicitly marked as *not yet verified*.

---

## Phase scoreboard

| Phase | Scope | Status | Notes |
|---|---|---|---|
| **0 · Foundation** | Data layer at 50k, sync v2 (delta), trust leaks, tests + CI, privacy policy | ✅ **Complete** | Shipped in v1.4. Four ideas are deliberately partial (see below). |
| **1 · Exist** | I-05 importers, I-06 refugee pages, I-07 shutdown-proof export, I-01 stores, I-03 onboarding | ✅ **Complete** | All four pages + the schema doc + the submission paperwork shipped in v1.5.0. Only the act of submitting to the stores remains (I-01). |
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

### I-07 · Shutdown-proof export — ✅ **complete (code + documented schema + pledge page)**

`lib/exporters.js` + three streamed exporters in `Storage`:

| Format | Method | What it carries |
|---|---|---|
| Kipideck JSON | `exportChunks()` | everything, lossless: page text, notes, tags, decks, dates, tombstones |
| Netscape bookmark HTML | `exportBookmarkHtml()` | links, titles, `ADD_DATE`, folders (one per deck), `TAGS`, `<DD>` notes, `PRIVATE` for pins |
| Markdown | `exportMarkdown()` | the library as readable notes; page text optional inside `<details>` |

The guarantee that is actually tested: **our own bookmark export imports back through our own
importer with URLs, titles, tags, dates, folders and notes intact** (`test/export.test.js`). That
round trip is what makes "you can always leave" a property rather than a claim.

**✅ `docs/EXPORT_FORMAT.md` now exists** — the documented schema the pledge promises. It covers the
JSON envelope (`version`, `app`, `exportedAt`, `counts`, `decks`, `settings`, `tombstones`, `items`),
every item field with its type and whether it is optional, the deck/settings/tombstone shapes (and why
tombstones carry a canonical URL), the bookmark-HTML mapping table, the Markdown structure, a worked
example generated from **real exporter output** rather than written by hand, a field-by-field
round-trip matrix, and the specific test that proves each guarantee.

Writing it surfaced three things worth knowing:

- The `content` key is **absent** (not empty-string) when there is no page text — the single most
  important rule for anyone writing a converter.
- Items also carry internal fields (`canon`, `fp`, `pf`), and `idx`/`n` are deliberately stripped on
  export. The doc marks the internal ones as internal so nobody builds on them.
- JSON timestamps are **milliseconds**; bookmark-HTML timestamps are **seconds**. There is a test for
  that conversion because getting it wrong is the easiest way to corrupt an export.

**✅ `/shutdown-proof`** is live, and it links to the schema.

### I-06 · Refugee landing pages — ✅ **all 4 pages**

Shipped in v1.5.0. All four build as static routes, and every internal link on the site now
resolves (verified by crawling each built page — see "Test & build status").

- ✅ `/pocket-alternative` — the 22 May / 8 Jul / 12 Nov 2025 timeline, the four-step rescue,
  what survives (and the honest "Pocket never exported article text"), a Pocket-vs-Kipideck table,
  and six FAQs including "I never exported — can I get it back?" (answer: no).
- ✅ `/omnivore-alternative` — the structural argument: **Omnivore was open source and still died**,
  because the code was free but the library lived in their Postgres. Verified timeline (29 Oct 2024
  announcement → 15 Nov 2024 deletion, ~2 weeks to export), the export anatomy table
  (`metadata_*.json` + `contents/<slug>.html` + `highlights/*.md`), and a rescue that rejoins article
  text by slug.
- ✅ `/raindrop-alternative` — deliberately not a competitor hit job. "Keep Raindrop, also keep a
  copy that needs no subscription and no server", plus a real migration path. **No pricing numbers** —
  the page says "some features need a paid plan" rather than a figure we cannot keep current.
- ✅ `/shutdown-proof` — the pledge as structural facts, "how to leave in three clicks", a **what we
  cannot promise** section, and the graveyard timeline. Names only products that have already shut
  down.
- ✅ Homepage funnel — an "Arriving from Pocket or Omnivore?" section near the top with one honest
  sentence about what cannot be recovered, plus footer links to all four pages.
- ✅ `app/components/PageShell.js` — shared nav/footer.
- ⬜ Directory submissions (AlternativeTo, G2, Capterra) — not started.


- ✅ `/pocket-alternative` — written and **building as a static route**: the 22 May / 8 Jul / 12 Nov
  2025 timeline, the four-step rescue (unzip → install → select all CSVs → preview), what survives
  (and the honest "Pocket never exported article text"), a Pocket-vs-Kipideck table, and six FAQs
  including "I never exported — can I get it back?" (answer: no).
- ✅ `app/components/PageShell.js` — shared nav/footer so the remaining pages cannot ship with a
  stale header or a missing privacy link.
- ⬜ `/omnivore-alternative`, `/raindrop-alternative`, `/shutdown-proof` — not written yet.
- ⬜ Homepage links + a "moving from Pocket?" section — not added yet.

### I-01 · Store submission — 🟡 **paperwork done, submission not sent**

`docs/STORE_SUBMISSION.md` now exists and is ready to paste into the forms. The decision it records:

> **Keep `<all_urls>`,** with the optional-host-permission variant written down as a fallback.

The justification is narrower than "we need to save from any page". Capture itself would survive on
`activeTab` alone — `getPageMeta` and `getFullPageText` already use `scripting.executeScript`. What
would **not** survive is anything that must be listening *before* the user acts: auto-save of selected
text, `Space`+`K`, the "already in your Kipideck" toast, and per-site muting. The doc lists the four
features the fallback variant would delete, and requires their UI and copy to be removed in the same
commit rather than left silently inert.

Also documented: permission justifications (kept in sync with `/privacy` — the doc says to change both
if either changes), CWS single-purpose / remote-code / data-handling answers, listing copy that leads
with the trust story and the importer, a seven-shot screenshot list, Edge and Firefox AMO deltas
(AMO needs a real `browser_specific_settings.gecko.id` — the placeholder domain is still in
`manifest.json` and **must be replaced before submitting**), and a pre-submission checklist.

**Cost, and the order to submit in** — the part that decides what happens next:

| Store | Cost |
|---|---|
| Firefox AMO | **Free** |
| Edge Add-ons | **Free** |
| Chrome Web Store | **$5, once** (per developer account, not per extension, not annual; unavoidable) |

**Order: Firefox → Edge → Chrome.** Two stores are free today, so the extension becomes installable
in one click before any money changes hands, and the $5 is spent on a submission that has already
been through two reviewers.

**✅ Screenshot harness built** (`tools/screenshots/`) — renders the real Library UI with a seeded
41-item library, six scenes, `H` hides the controls. Screenshots are now a ~10-minute job. `tools/`
is not in the packaging list, so none of it ships to users.

**🟡 Edge submission in progress** (12 Sept 2026). `docs/STORE_SUBMISSION.md` now carries an
Edge-specific quick-fill block — the exact values for each Partner Center field, and the three
privacy-practice answers, so the form can be filled without re-reading the whole document.

⬜ **Not yet done — and none of it is code:**

1. Replace the **Firefox gecko id** (currently the placeholder `kipideck@example-addon.org`) with a
   domain we control. Blocks AMO outright, and must never change afterwards.
2. **Pay Chrome's $5** and register the developer account.
3. **Capture the screenshots** using the harness.
4. **Verify `https://kipideck.vercel.app/privacy` renders** — all three stores require a live policy
   URL. DNS resolves to Vercel; it needs a human to open it once and confirm.
5. **Record any Edge reviewer objection here when it arrives.** Edge reviews faster than Chrome, so
   an objection there is a free early warning for the Chrome submission.

---

## Test & build status

| Check | Result |
|---|---|
| `npm test` (`node --test test/*.test.js`) | **330 / 330 passing**, 11 suites |
| `npm run package` | 32 files, **145 KB**, extension v1.5.0 |
| `npm run build` (website) | compiles; **9 static routes**, incl. all four refugee pages |
| Internal link crawl of every built page | **no 404s** (this is how the three footer 404s were caught) |
| Shipping JS syntax | all files parse |
| `globals.css` | brace-balanced, no duplicated blocks, no unused rules added |
| GitHub Actions | Node 20 + 22, runs the suite on push/PR |
| Runtime dependencies | **zero** (the only devDependency is `fake-indexeddb`) |

Test suites: `db` (29) · `storage` (28) · `canon` (37) · `sync` (25) · `wiring` (18) · `classify` (20)
· `policy` (**27**) · `import` (95) · `import-storage` (15) · `export` (25) · **`samples` (13)**.

> **Note:** `npm test` needs `npm install` first — the suite imports `fake-indexeddb`, and a fresh
> clone with no `node_modules` fails 7 suites with `ERR_MODULE_NOT_FOUND`. That is expected, but it
> looks like a code failure, so it is worth saying out loud.

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
   either a dependency or a hand-written inflate; both were rejected for now. The dialog explains it,
   and the refugee pages say so plainly rather than letting people discover it mid-import.
2. **Pocket exports contain no article text** — nobody can recover what was never exported. Kipideck
   stores text for items saved from now on. Omnivore's export *does* contain it, which is why that
   page makes a point of selecting the `contents/` folder.
3. **No first-party OAuth client**, so Drive sync still needs a BYO client ID (I-02's other half).
4. **Not in any store.** Sideloading only, which is the single biggest conversion killer (I-01). The
   paperwork is now written; the submissions are not sent.
5. **The Firefox gecko id is still a placeholder** (`kipideck@example-addon.org`) on a domain we do
   not control. It must be replaced before the AMO submission, and never changed afterwards — changing
   it post-publication breaks updates for existing users.
6. **No reader view.** Saved text is stored and searchable but never rendered cleanly (I-08).
7. **No directory submissions yet** — AlternativeTo, G2 and Capterra are untouched (I-28).
