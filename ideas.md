# Kipideck — Ideas to Beat Everyone

**Companion:** [`RESEARCH.md`](./RESEARCH.md) — full competitor analysis, review synthesis, comparison matrix.
**Status:** [`PROGRESS.md`](./PROGRESS.md) — what is shipped and measured · [`TASK.md`](./TASK.md) — what is next, with acceptance criteria.
**Date:** 2026-09-11 (updated 2026-09-12) · Living doc: check off `✅` as shipped.

> Strategy in one line: **own trust** (local-first, free, shutdown-proof), **match capture**,
> **win find-it-again with free AI**, and **absorb adjacent jobs** (tabs, reader, highlights, audio)
> that competitors charge $5–13/mo for.

**Scoring:** Impact 🔥×1–5 (users won / churn prevented) · Effort XS–XL · `R§x` = evidence in RESEARCH.md.

---

## ✅ Phase 0 — foundation, shipped in v1.4 (2026-09-12)

Sequenced *ahead* of this list on purpose: every idea below multiplies on a data
layer that could hold 50,000 items, and v1.3 could not. What changed, with the
measurements that justified it:

| Was | Now |
|---|---|
| Full scan per keystroke: **2.2 s at 500 items, 45 s at 10,000** | Persistent IndexedDB index: **369 ms per keystroke, 376 ms for a 2-word AND at 50,000 items** |
| Whole grid re-rendered on every change | 60-item pages + `IntersectionObserver` sentinel; first paint **59 ms**, offset 10,000 **481 ms** |
| Sync = one JSON blob of the entire library: **4 MB @500, 20 MB @1k, 219 MB @50k** vs Drive's 5 MB limit | Sharded delta sync (64 metadata + 256 content buckets, hash-gated, resumable >4 MB, 40 ops/pass): **0.03 MB per 50 changed items** |
| OAuth implicit flow — token died hourly, error swallowed | Authorization Code + **PKCE** + refresh token, silent refresh, failures counted and surfaced |
| `importJSON` **replaced** the library | Merge with a dry-run preview (added/updated/skipped arithmetic shown first) |
| Favicons from `google.com/s2` — leaked every domain to Google | Local favicon cache + letter avatars (**I-04**) |
| Silent auto-capture with no disclosure | First-run disclosure page gating all silent capture (**I-03 slice**) + per-site mute |
| No tests, no CI | **152 tests** (`node --test`) incl. a mocked Drive/OAuth sync suite, a wiring test, and a 50k-item benchmark; GitHub Actions on Node 20 + 22 |
| No privacy policy | <https://kipideck.vercel.app/privacy> — every permission justified |
| `Space`+`K` fired in YouTube/Gmail text fields | Per-site opt-out + a guard list, and a visible toggle |

Items below marked **v1.4 (partial)** were started here and still have work left.

---

## P0 — Foundations (do first; everything else multiplies on these)

- [ ] **I-01 · Publish to the Chrome Web Store + Edge Add-ons + Firefox AMO** 🔥🔥🔥🔥🔥 · Effort M
  Problem: sideloading ("Load unpacked", Firefox temp add-on lost on restart) kills conversion and trust (R§1.3).
  Build: store listings with screenshots/video, privacy self-certification, reduce `<all_urls>` to `activeTab` + optional host permission to pass review smoothly.
  Beats: the #1 reason anyone picks a competitor at install time. Metric: install conversion rate, store rating ≥4.5.
  **v1.5.0 (paperwork done, submission not sent):** `docs/STORE_SUBMISSION.md` records the decision to **keep `<all_urls>`** — with a narrower justification than "we save from anywhere": capture would survive on `activeTab` alone, but auto-save-selection, `Space`+`K`, the duplicate toast and per-site muting would not, because `executeScript` only fires on a user gesture. It also holds the permission table (kept in sync with `/privacy`), the CWS form answers, listing copy, a shot list and the Edge/AMO deltas. **Open:** the gecko id is still a placeholder on a domain we do not control, and no submission has actually been sent.
- [ ] **I-02 · One-click sync that normals can use** 🔥🔥🔥🔥🔥 · Effort M–L
  Problem: BYO OAuth client-ID setup ≈ 0% completion by non-developers; hourly token expiry (`SESSION_EXPIRED`) (R§1.3).
  Build: ship a first-party OAuth client (free tier of Google Cloud; Drive appData scope is non-sensitive-ish) with one "Sign in with Google" button; keep BYO-client as advanced fallback; silent token refresh via short-lived re-auth or move to a tiny refresh-token-safe flow. Keep the "no Kipideck server" guarantee — tokens stay in the browser.
  Beats: Raindrop/Matter (account-locked clouds) on privacy + convenience simultaneously. Metric: % of installs with sync on.
  **v1.4 (partial):** the *reliability* half is done — Authorization Code + PKCE, refresh tokens, silent refresh forever after, an optional client-secret field for Web/Desktop clients, and failures that are counted, shown in the Library pill and notified instead of swallowed. The *one-click* half is not: it still needs a first-party OAuth client (deliberately deferred, since it puts a Google-verified consent screen and a restricted-scope review in front of the store submission).
- [x] **I-03 · First-run onboarding (60 seconds to first save)** 🔥🔥🔥🔥 · Effort S — **shipped v1.5.0**
  Problem: empty library + no guidance = bounce; competitors (even bad ones) onboard (R§4.12).
  Build: welcome page on install: 1-click "save this demo page", deck tour, "import from…" shortcuts, keyboard shortcut card. Pre-seed 3 sample items (deletable) so search/decks demo themselves.
  Metric: D1 save rate, D7 retention.
  **v1.4 (partial):** `onboarding/onboarding.html` shipped as the *disclosure* half.
  ✅ **v1.5.0 completes it.** `lib/samples.js` seeds three sample items — one with page text so
  full-text search has something to hit, one in a second deck so filtering is visible, one pinned —
  all tagged `sample` so `removeSamples()` deletes exactly them and nothing else. The page can also
  save itself as a real item, and the **"Import from…" shortcut** opens `library.html#import=1`, which
  raises an import banner, so a refugee goes install → import without ever hunting for the ⬆ button.
  A deck tour and a keyboard-shortcut card (incl. `Space`+`K`, with its caveats) are on the page too.
  Two invariants are test-enforced rather than trusted: **seeding is idempotent** (matching on
  canonical URL, so a second click adds nothing) and **neither the demo save nor the samples flips
  `onboardingDone`** — both are explicit actions, and the silent-capture gate is opened only by the
  consent buttons (`test/samples.test.js` 13, `test/policy.test.js` +2).
- [x] **I-04 · Kill the small trust leaks** 🔥🔥🔥 · Effort XS–S — **shipped v1.4**
  Problem: favicons via `google.com/s2` (tracks every domain, fails offline); junk auto-tags (`domain.split('.')[0]` → tags like "the"); no duplicate detection (R§1.3).
  Build: local favicon cache (fetch once, store blob, fallback to letter-icon); smarter tag hygiene (deny-list, max 5, de-dupe vs title words); "already saved" detection with "open existing" prompt.
  Beats: privacy story becomes airtight — required for the §5.1 positioning.
  ✅ v1.4: `lib/favicons.js` (IndexedDB icon cache + locally drawn letter avatars, zero third-party requests); `lib/canon.js` `siteLabel()` + classifier hygiene (compound-suffix aware, junk deny-list, ≤5 suggestions, deduped against title words, user tags always win); duplicate fingerprints + `findDuplicate` with an "Already in your Kipideck — Open" toast (pages/links/images at any age, selections inside a 60 s window). Covered by `test/canon.test.js` + `test/classify.test.js`.

## P1 — Capture the refugee wave (highest ROI growth, do within weeks)

- [x] **I-05 · Pocket HTML + Instapaper CSV + Raindrop + browser-bookmark importers** 🔥🔥🔥🔥🔥 · Effort S–M — **shipped (Phase 1)**
  Problem: millions mid-migration; winners all ship importers (Readwise 6/6, Matter 2-tap, Raindrop/Instapaper/Wallabag all accept Pocket HTML) (R§5.2). Kipideck has zero.
  Build: Library → Import: Pocket `.html`/`.csv`, Instapaper export, Raindrop backup, Chrome/Firefox bookmark HTML, generic URL list. Preserve tags, dates, read-state; auto-run classifier on import; show "N items rescued" celebration.
  Metric: imports/week; % of new users arriving via "Pocket alternative" pages.
  ✅ `lib/import.js`: **13 formats** — Pocket CSV *and* `ril_export.html` (redirect wrappers unwrapped, read state from the Unread/Read-Archive sections), Instapaper, Raindrop, Omnivore metadata **plus its `contents/<slug>.html` article text rejoined by slug**, Pinboard, Wallabag, Readwise Reader, browser bookmark HTML (nested folders → tags, Firefox `TAGS`/`PRIVATE`/`<DD>`), Chrome's raw `Bookmarks` JSON (1601-epoch microseconds), plain URL/Markdown lists, and our own JSON. Tags/dates/read-state preserved; archive and favourite become tags; highlights and annotations become notes; classifier runs when the target deck is "auto-organise". Multi-file import merges Pocket's `part_*.csv` and Omnivore's `metadata_*.json`; dedupe is by canonical URL within a file, across files, and against the library (tombstones now carry canon, so a delete survives re-import); preview-before-write with per-file warnings, a progress bar, and an "N items rescued" panel. 20k-row CSV parses in ~450 ms; 2,000 records write + index in ~755 ms. v1.7.0: ZIPs open in the browser (vendored fflate + `lib/unzip.js`, bomb-capped, RAR/7z still refused honestly); Pocket parts and Omnivore metadata+contents import straight from the download. Covered by `test/import.test.js` (94) + `test/import-storage.test.js` (15) + `test/zip.test.js` (23).
- [x] **I-06 · "Welcome, Pocket & Omnivore refugees" landing + SEO pages** 🔥🔥🔥🔥 · Effort S — **all 4 pages shipped v1.5.0**
  Problem: Matter/Readwise/Wallabag openly campaign for refugees; Kipideck invisible (R§3.1).
  Build: `/pocket-alternative`, `/omnivore-alternative`, `/raindrop-alternative` pages: honest comparison table (reuse R§6), 3-step migration guide, "your data can't be deleted by us" guarantee. Submit to alternative-to directories.
  Metric: organic signups/installs from these pages.
  ✅ **All four pages ship in v1.5.0**, plus the homepage funnel.
  · `/pocket-alternative` — verified shutdown timeline (22 May / 8 Jul / **12 Nov 2025** deletion), the four-step rescue, a what-survives table that admits Pocket never exported article text, a comparison table, and six FAQs including "I never exported — can I recover it?" (no).
  · `/omnivore-alternative` — the strongest structural story we have: **Omnivore was open source and still died**, because the code was free while the library sat in their Postgres. Verified timeline (29 Oct 2024 → 15 Nov 2024, ~2 weeks to export), the export anatomy (`metadata_*.json` + `contents/<slug>.html` + `highlights/*.md`), and a rescue that rejoins article text by slug.
  · `/raindrop-alternative` — deliberately *not* a hit job on a good live product: "keep Raindrop, also keep a copy that needs no subscription and no server", with a repeatable mirror rather than a one-way exit. **No pricing figures** — the page says "some features need a paid plan" instead of a number we cannot keep current.
  · `/shutdown-proof` — the pledge, plus the "what we cannot promise" section that makes the rest credible.
  `app/components/PageShell.js` gives all of them one shared nav/footer. A QA pass also found and fixed **three 404s** — the footer linked to the three new pages before they existed (`TASK.md` B1). Directory submissions still not started.
- [x] **I-07 · "Shutdown-proof" guarantee page + full export (JSON/HTML/Markdown)** 🔥🔥🔥🔥 · Effort S — **shipped v1.5.0 (exports + documented schema + pledge page)**
  Problem: post-shutdown, users ask "what happens if you die?" before asking about features; mymind's thin export is hated (R§4.2/4.11).
  Build: public pledge — readable local format, one-click export of *everything incl. full text + notes + tags*, documented schema, "works forever offline even if we vanish". Export to portable HTML (Netscape bookmark format = imports everywhere) + Markdown vault.
  Beats: literally every cloud competitor on the question users now ask first.
  🟡 `lib/exporters.js` + `Storage.exportBookmarkHtml()` / `exportMarkdown()` join the existing streamed JSON export, all three chunked so a 50k library never becomes one string, and offered in a Library export dialog that states each format's trade-off. Bookmark HTML carries links, titles, `ADD_DATE`, one folder per deck, `TAGS`, `<DD>` notes and `PRIVATE` for pins; Markdown carries the library as notes with optional page text in `<details>`. Our own bookmark export re-imports through our own importer with URLs, titles, tags, dates, folders and notes intact — asserted as a round trip in `test/export.test.js` (25). 1,000 items export to HTML in ~12 ms.
  ✅ **v1.5.0 completes the promise.** `docs/EXPORT_FORMAT.md` documents the schema field by field — envelope, item fields (type, optionality, and the internal ones marked internal), deck/settings/tombstone shapes, the bookmark-HTML mapping table, the Markdown structure, a worked example generated from **real** exporter output, and a round-trip matrix naming the test that proves each row. `/shutdown-proof` is live and links to it. Writing the doc surfaced two rules worth knowing before trusting any export: `content` is **absent** (not `""`) when empty, and JSON timestamps are **milliseconds** while bookmark-HTML ones are **seconds**.

## P2 — Win "consume" (reader, highlights, audio, recall)

- [x] **I-08 · Distraction-free Reader View** 🔥🔥🔥🔥🔥 · Effort M
  Problem: Kipideck saves full text but never renders it cleanly; every read-it-later rival leads with a reader (R§1.3).
  Build: Mozilla Readability (vendored, offline) → clean article render inside Library; fonts, themes, line-width; saves scroll position; "parsed from your saved copy" (works offline, paywall-safe since captured post-render).
  Beats: Instapaper's calm + Raindrop's reader, free, offline. Metric: % of items opened in reader.
  ✅ v1.8.0: reader renders the **saved copy** ("parsed from what you stored" — offline, paywall-safe). `lib/reader.js` splits text into paragraphs; the overlay sets type (serif/sans), three themes, font size and line width, and saves scroll position per item (kv `read:<id>`, debounced). "~N min" rides along in the card and detail meta. Covered by `test/reader.test.js` + wiring. Still open: highlighting *inside* reader (that's I-09).
- [ ] **I-09 · In-page highlighter + notes that persist** 🔥🔥🔥🔥 · Effort M–L
  Problem: Diigo/Glasp/Weava/Hypothesis own annotation; Kipideck turns selections into detached items (R§3.4).
  Build: select → highlight (4 colors) + optional note, stored against URL + text quote (fuzzy re-attach like Hypothesis); highlights searchable, listed per-item, exportable. Reliability first — Weava's vanishing highlights are the cautionary tale; store locally, sync via existing tombstone-safe merge.
  Beats: Weava (reliability), Glasp (privacy + free private highlights), Diigo (modern UX).
- [x] **I-10 · Listen to your saves (TTS)** 🔥🔥🔥🔥 · Effort S–M
  Problem: commuters' top ask; Instapaper TTS crashes, Matter playback wobbles (R§4.15).
  Build: free tier = offline OS voices (`speechSynthesis`, $0 cost); queue + playback position saved; optional upgrade path to premium voices later. Works from Reader View + popup.
  Beats: good-enough audio free vs everyone's paywalled/crashy audio.
  ✅ v1.8.0: read-aloud lives in the reader. Free tier = OS voices via `speechSynthesis` (zero cost, zero network); `speechQueue()` walks paragraphs sentence by sentence, the spoken sentence gets a `.tts-now` highlight, playback rate is a selector, position resumes from the reader scroll state. Matter charges $60/yr for HD voices; ours never leaves the device.
- [x] **I-11 · Resurfacing: daily digest + "stumble" + smart reminders** — **Daily 5 core shipped v1.8.0** 🔥🔥🔥🔥🔥 · Effort M
  Problem: ~70% of saves never reopened; guilt → avoidance → churn; only $120/yr Readwise addresses recall (R§4.3/4.14).
  Build: "Kipi Daily 5" (new-tab or notification digest: 2 unread + 2 forgotten gems + 1 random — spaced-repetition-lite); "🔀 Surprise me" button; per-deck "going stale" nudges; reading streaks (opt-in). All local, no account.
  Beats: the graveyard problem nobody free solves — this is the retention engine.
  ✅ v1.8.0: **Kipi Daily 5** — `lib/digest.js` picks 2 unread + 1 forgotten gem (oldest unread past 30 days) + 1 surprise + a filler, seeded by the day so the popup, the library "Daily" view and the browser notification all show the *same five*. 🔀 rerolls only the surprise slot. A background alarm posts one quiet notification per day (click → `library#daily=1`); opt-out in Settings, 0↔09:00 local. Honest shrink: fewer than 5 candidates → fewer shown, never padded. Covered by `test/digest.test.js` (incl. Storage integration). Still open: streaks, per-deck stale nudges, new-tab digest page.
- [x] **I-12 · Save-state workflow (Unread → Reading → Done + Archive)** 🔥🔥🔥 · Effort S — **core shipped v1.6.0**
  Problem: piles grow unbounded; Burn 451's forced triage and Readwise's filters prove workflow beats buckets (R§3.1).
  Build: per-item status + Library filters; optional "triage mode" (swipe/keyboard through Inbox); auto-archive rules ("mark done after opening", "archive shopping after 30d").
  Metric: % of users at inbox-zero weekly.
  ✅ v1.6.0: per-item `status` (schema v2, backfilled to unread) with indexed Library filters, status chips with live counts, `status:` search, bulk re-triage, per-item pills, and “mark done after opening”. Foreign read-states map onto it at import; JSON round-trips it, so it survives sync. Covered by `test/status.test.js` (33). Still open: keyboard/swipe triage mode, time-based auto-archive rules.

## P3 — Free AI layer (match $10/mo expectations at $0 marginal cost)

- [ ] **I-13 · On-device article summaries** 🔥🔥🔥🔥🔥 · Effort M
  Problem: summaries are table stakes (Recall, Fabric, Matter, Reader all have them) and always paywalled (R§5.5).
  Build: Chrome built-in AI (Prompt/Summarizer API where available) → free, private, offline summaries with graceful fallback ("summary needs Chrome's built-in AI"); later: Transformers.js small model fallback for Firefox. 3-bullet + 1-line TL;DR per item, shown in cards + reader.
  Beats: every paywalled summary; privacy (nothing leaves device). Metric: % of items summarized/read.
- [ ] **I-14 · Semantic search (meaning, not just keywords)** 🔥🔥🔥🔥🔥 · Effort M–L
  Problem: users describe articles by meaning; all keyword tools fail them; semantic search is paywalled everywhere (R§4.5).
  Build: local embeddings (Transformers.js MiniLM, quantized, lazy-loaded; vectors in IndexedDB), hybrid rank = keyword score + cosine similarity; keep current engine as instant fallback. "Find that article about X" demo on the site.
  Beats: Raindrop/Instapaper/Evernote search (all literal + mostly paid); matches Recall/Fabric free.
- [ ] **I-15 · Smart auto-tagging v2 (beyond regex)** 🔥🔥🔥🔥 · Effort M
  Problem: current classifier is ~13 English regexes; mymind/Recall prove auto-tag quality is the magic (R§1.3).
  Build: layered: keep instant regex → add on-device keyword extraction (TF-IDF/TextRank over saved text) → optional user-trained rules ("always file `*.edu` → Research"); learn from manual deck moves (per-domain memory). Show "why filed here" with one-click correction that teaches.
  Beats: Raindrop's paywalled AI tagging, mymind's opaque AI, Instapaper's nothing.
  ✅ v1.8.0 (layer 2 of 3): `suggestKeywords()` — TF-IDF-flavoured extraction over the saved text, appended *after* the regex layer at capture, existing tags never overwritten, max 5. Covered by `test/classify.test.js` (+6). Still open: per-domain deck memory, user-trained rules, on-device model for Firefox.
- [x] **I-16 · Auto-dedupe + "related items"** — **both halves shipped (dedupe v1.4, rail v1.8)** 🔥🔥🔥 · Effort S–M — **auto-dedupe shipped v1.4; "related" still open**
  Problem: re-saves and URL variants pile up; nobody connects related saves except expensive graphs (Recall knowledge graph) (R§3.3).
  Build: canonical-URL + title-fingerprint dedupe at save ("you saved this 3mo ago — open it?"); related-items rail via shared tags + embedding similarity.
  Beats: keeps libraries clean automatically — a quiet, loved moat.
  ✅ v1.8.0: "You also saved" rail in the detail modal — `lib/related.js` scores shared tags ×4, same domain ×2, same deck ×1.5, title-overlap ×2 over a *bounded candidate pool* (never a full-library scan; 50k items stay instant), ties break newest-first, reasons shown per chip. Embedding-based similarity is deliberately left to I-14 rather than half-done here.

## P4 — Capture breadth (mobile, formats, snapshots, tabs)

- [ ] **I-17 · Mobile capture wedge (PWA + share-target + bottom-sheet save)** 🔥🔥🔥🔥🔥 · Effort M–L
  Problem: the #1 adoption blocker — every rival has share-sheet save; phone-heavy users unreachable (R§1.3/§5.7).
  Build: installable PWA (library + reader, offline via service worker) reading the same Drive snapshot; Android share-target for link/text/image; iOS shortcut recipe as bridge; native wrappers (Capacitor/Tauri) only after traction. Syncs through existing Drive backend — no server needed.
  Beats: unlocks the mobile half of every competitor's base. Metric: % saves from mobile.
- [ ] **I-18 · True snapshots: archive the page, not just the link** 🔥🔥🔥🔥 · Effort M
  Problem: link rot; images hotlinked; only 20k chars; archives paywalled (Raindrop Pro) or heavy (ArchiveBox) (R§4.13).
  Build: save MHTML/single-file snapshot (local, capped size, per-deck retention rules) + screenshot thumbnail; "view archived copy" when live page 404s; images downloaded locally (respects size caps). Offline-first = works where server fetchers (Karakeep/Instapaper) fail on login-walled pages.
  Beats: paywalled archives + server-side fetchers, structurally.
- [x] **I-19 · Save-all-tabs + session restore (absorb tab managers)** 🔥🔥🔥🔥 · Effort S — **core shipped v1.6.0**
  Problem: Toby/OneTab/Session Buddy users overlap heavily; their tools lose data and lack sync/search (R§3.6).
  Build: "Save N tabs to deck…" (popup + shortcut), named tab-groups-as-decks, one-click restore, auto-backup of sessions (anti-Session-Buddy-data-loss), tab search across saved sessions.
  Beats: absorbs 3 competitors' use case in ~1 week of work.
  ✅ v1.6.0: “Save N tabs to deck…” (popup + Ctrl/⌘+Shift+S) saves the window as one searchable session; one-click restore (first tab focused, rest backgrounded, confirm above 20); tab titles + URLs indexed and searchable; sessions survive JSON/bookmark/Markdown export and re-import. Covered by `test/sessions.test.js` (23). Still open: named tab-groups-as-decks, automatic session back-ups.
- [ ] **I-20 · PDF / newsletter / RSS / YouTube ingestion** 🔥🔥🔥🔥 · Effort L (staged)
  Problem: researchers/learners live in these formats; Readwise/Matter/Cubox ingest them, Kipideck can't (R§1.3).
  Build (staged): (a) PDF save + text extraction (pdf.js, local) + PDF highlight; (b) "email-to-Kipi" inbound address → newsletter deck (needs tiny receiver — or parse via user-Gmail API to stay serverless); (c) RSS follow → auto-save to Research; (d) YouTube: save + local transcript capture + summary (I-13).
  Beats: completes the "save *anything*" promise; unlocks Readwise-switcher messaging at $0.
- [ ] **I-21 · Screenshot / area-capture + OCR** 🔥🔥🔥 · Effort M
  Problem: visual savers (designers, shoppers, researchers) screenshot constantly; mymind/Pinterest own them (R§3.3).
  Build: area capture → saved image item with local OCR text (Tesseract.js, on-device) indexed for search.
  Beats: free visual search nobody offers.

## P5 — Moat: sync v2, sharing, integrations

- [ ] **I-22 · Sync v2: delta sync + scale + E2E encryption** 🔥🔥🔥🔥 · Effort L — **delta + scale shipped v1.4; E2E still open**
  Problem: single-JSON-snapshot upload won't scale to 10k items; record-level merge; no encryption (R§1.3).
  Build: chunked/delta uploads (only changed records), pagination + lazy content fetch, field-level merge for notes/tags/pins, optional E2E encryption (passphrase-derived key, zero-knowledge — Drive sees ciphertext). Keep tombstone discipline.
  Beats: privacy absolutists (Wallabag/Karakeep self-hosters) get their guarantees with zero setup.
- [ ] **I-23 · Public decks & share links (opt-in)** 🔥🔥🔥🔥 · Effort M–L
  Problem: no sharing = no virality; Raindrop collections, Glasp social, mymind-spaces envy (R§3.2–3.4).
  Build: publish any deck → read-only link (rendered statically; data stays yours, unpublish anytime); embeds for blogs; "subscribe to deck" (RSS). Local-first compatible: share renders from your Drive snapshot, no Kipideck account needed to view.
  Beats: every private-only rival; turns users into distributors. Metric: shared-deck views → installs.
- [ ] **I-24 · Become the neutral capture layer: 1-click export to Notion/Obsidian/Readwise/Markdown** 🔥🔥🔥🔥 · Effort M
  Problem: every note-taker clipper is dying, mediocre, or locked to its mothership (R§3.5).
  Build: per-item and bulk "Send to…": Notion API, Obsidian vault Markdown (+ readwise-compatible highlight format), Markdown/ZIP download; templates (citation format for researchers: APA/BibTeX — nobody free does this).
  Beats: positions Kipideck *above* the note wars instead of in them.
- [ ] **I-25 · Local API + URL scheme (power-user glue)** 🔥🔥🔥 · Effort S
  Problem: Omnivore's dead API orphaned plugin ecosystems; power users fear lock-in (R§2).
  Build: documented local REST-ish API (via native messaging or library-page bridge) + `kipideck://save?url=` scheme + Raycast/Alfred/CLI recipes. Lets the community build what we won't.
- [ ] **I-26 · Safari build** 🔥🔥🔥 · Effort M (needs Mac)
  Problem: Safari users (esp. Apple-heavy readers) excluded; GoodLinks/Reeder own them by default (R§1.3).
  Build: `safari-web-extension-converter` wrap + App Store listing (free). Reuses the standard-API codebase unchanged.
- [ ] **I-27 · Teams/family shared decks (later, paid)** 🔥🔥 · Effort L
  Problem: research teams, couples, classrooms share saves (Diigo groups, Raindrop collab, Notion) — no local-first option exists.
  Build: shared Drive-folder sync for a deck (Google-native sharing = permissions solved, still no Kipideck server). Natural Pro tier (see M-02).

## P6 — Growth & distribution (cheap, specific)

- [ ] **I-28 · Launch where refugees gather** 🔥🔥🔥🔥 · Effort S
  Build: Product Hunt + Hacker News ("Show HN: shutdown-proof Pocket alternative") + Reddit (r/productivity, r/PKMS, r/bookmarks) + AlternativeTo/G2/Capterra listings. Lead with the trust story + importer, not features. Time around "1 year since Pocket died" retrospectives (July 2026 missed — use "deleted your data" anniversary Nov 2026).
- [ ] **I-29 · Comparison content engine** 🔥🔥🔥 · Effort S (ongoing)
  Build: extend I-06 to `/vs/raindrop`, `/vs/instapaper`, `/vs/mymind`, `/vs/evernote`… honest tables (R§6), updated each release. Comparison keywords convert best in this category.
- [ ] **I-30 · In-product viral loops** 🔥🔥🔥 · Effort S
  Build: shared decks (I-23) with "Made with Kipideck" footer; export files credit the tool; referral-free — instead: "gift a pre-filled starter deck" (recipes, dev resources) new users can clone.
- [ ] **I-31 · Privacy-proof marketing kit** 🔥🔥🔥 · Effort XS
  Build: "No account. No server. No tracking." badges; public architecture diagram (browser ↔ your Drive, nothing else); open-source the extension code (keeps trust maximal, enables contributors) while keeping brand/distribution.
- [ ] **I-32 · Community & support that answers (the anti-Raindrop)** 🔥🔥🔥 · Effort ongoing
  Problem: support black holes are a top-10 complaint (Raindrop, Matter, Weava) (R§4.10).
  Build: public roadmap + changelog + GitHub Discussions; "we reply in 48h" SLA; every 1-star store review gets a human reply. Support quality is a *feature* in this market.

## P7 — Monetization without betrayal (keep the trust moat)

Principles: core capture/organize/search/sync stays **free forever**; charge only for things with real marginal cost or team value. Never: gate search, cap saves, hold data hostage (the mymind/Evernote sins, R§4.1/4.2).

- [ ] **M-01 · Kipideck Cloud (optional hosted sync, $3–4/mo or $29/yr)** 🔥🔥🔥🔥 · Effort L
  For users who won't touch Google setup: instant account sync + web library + mobile push, E2E-encrypted. Undercuts Readwise ($120) and matches Raindrop Pro pricing while core stays free. Free tier keeps DIY Drive sync.
- [ ] **M-02 · Teams/Family ($5–8/mo)** 🔥🔥 · Effort L — shared decks + roles + team search (needs I-27).
- [ ] **M-03 · Pro AI pack (one-time or $2/mo)** 🔥🔥🔥 · Effort M — cloud-LLM summaries Q&A for huge libraries (local AI stays free); pay-per-use transparency.
- [ ] **M-04 · Lifetime deal launch ($49–79 once)** 🔥🔥🔥 · Effort XS — funding + evangelists; subscription-averse buyers (GoodLinks fans, G2 "one-time purchase" seekers) convert hard on LTDs.
- [ ] **M-05 · Never list (anti-monetization)** — no ads, no data sale, no save caps, no search paywall, no cancel-loses-data. Publish as "The Kipideck Pledge" — it *is* the marketing.

---

## Suggested roadmap (phases)

| Phase | Weeks | Ship | Unlocks |
|---|---|---|---|
| 1 · Exist | 1–3 | I-01 stores, I-03 onboarding, I-04 leaks, I-05 importers, I-06/I-07 refugee pages | install conversion + refugee capture |
| 2 · Sync for humans | 3–6 | I-02 one-click sync, I-12 triage, I-19 tabs | retention + tab-manager absorption |
| 3 · Consume | 6–12 | I-08 reader, I-11 resurfacing, I-10 TTS, I-09 highlights | daily-use habit; parity with read-it-later |
| 4 · Free AI | 10–16 | I-13 summaries, I-14 semantic search, I-15 tagging v2, I-16 dedupe | the $10/mo-killer story; press + PH relaunch |
| 5 · Everywhere | 14–24 | I-17 mobile PWA, I-18 snapshots, I-26 Safari, I-20 formats (staged) | platform parity; researcher unlock |
| 6 · Moat & money | 20+ | I-22 sync v2/E2EE, I-23 sharing, I-24 exports, M-01/M-04 | virality + revenue |

## 2026-09-12 competitor scan — ideas added in the v1.8 cycle

Research pass over the 2026 read-later market (aitrove / Fabric / Beemind roundups, Karakeep v0.29–0.33 release notes, Chrome built-in AI announcements, Obsidian Web Clipper 1.5). Ammo worth putting on the site: **Raindrop Pro now paywalls full-text search and annotations**; Readwise Reader is $9.99/mo with no free plan; Instapaper's only moat is Kobo sync; **Firefox deleted Pocket** and left a built-in "save for later" vacuum; mymind's missing export is its most-hated flaw.

- [ ] **I-33 · Highlights page with per-highlight notes** 🔥🔥🔥🔥 · Effort M (ride-along of I-09)
  Obsidian's free Clipper shipped a dedicated browse/search page for highlights (1.5) and Karakeep added notes + search to highlights. Lesson: highlights without a *home* are dead weight — build the page with I-09, don't bolt it on later.
  Beats: Readwise charges $120/yr for exactly this page.
- [ ] **I-34 · EPUB export of saved copies (Kobo/Kindle drop-in)** 🔥🔥🔥 · Effort M
  Instapaper's remaining moat is e-reader sync; Karakeep added yt-dlp archiving and OCR — format breadth is where the credible free tools compete now. Kipideck already *has* the clean text (reader pipeline); bundling saved copies into an EPUB is a local, zero-server one-shot. Pairs with I-24 export targets.
  Beats: Instapaper's lock-in (their Kobo sync needs their cloud), Matter (no EPUB path).
- [ ] **I-35 · BYO-LLM Q&A over your library ("Ask Kipi")** 🔥🔥🔥🔥 · Effort M
  Fabric ($5/mo), Trove ($2.99/mo "answers questions about your saves"), BeeMind (BYO API key) — Q&A is the paid feature everyone launches with; BeeMind proves the user-paid-key model is acceptable. Build: existing search + saved text → context pack → user's own key (Gemini/OpenRouter). Never ship a server-side inference bill; consent banner per query.
  Beats: Readwise Ghostreader at $0 marginal cost to us.
- [ ] **I-36 · Tag provenance + tag-sprawl control** 🔥🔥🔥 · Effort S–M
  Karakeep (the "most credible Pocket successor", 24k+ stars) ships `attachBy: human|ai` provenance, per-user auto-tag toggles, and — the clever bit — proposes *existing* similar tags before minting new ones. Our regex + suggestKeywords layers should record who applied a tag so "show only my tags" and one-click "keep/discard suggestions" work later.
  Beats: mymind's opaque AI tagging users can't audit or undo.
- [ ] **I-37 · Local rules engine v2 (conditions → actions on save)** 🔥🔥🔥 · Effort M
  Karakeep's rule-based management engine is its power-user differentiator; our deck-rules are one regex deep. Build: declarative local rules (domain/path/title match → deck, tags, status, mute favicon), stored in the sync-safe kv namespace, exportable in the JSON bundle. Extends the "auto-archive after 30d" stub left open in I-12.
  Beats: every rival whose automation is server-side.
- [ ] **I-38 · Clipboard/share-target dedupe check ("already saved?" on mobile)** 🔥🔥 · Effort S
  Karakeep added a `checkUrl` REST endpoint + one-tap clipboard save on mobile because the share sheet is where saves actually happen. We own `findDuplicate` already — the mobile PWA (I-17) share target should run it *before* capture and toast "you saved this 3mo ago". Cheap; kills the #1 PWA complaint (duplicate piles).
- [ ] **I-39 · Chrome built-in AI tier (Summarizer/Translator on-device)** 🔥🔥🔥🔥 · Effort M (I-13 delivery vehicle)
  Chrome 138+ ships on-device Gemini Nano Summarizer/Translator APIs (widening through 2026); Geminify already tiers "built-in AI on-device" + "BYO Gemini/OpenRouter key" — a proven pattern to copy. And a large cohort *wants* AI off: every surface is an opt-in with a visible "on-device, never uploaded" badge, matching the local-first story.
  Beats: paywalled summaries everywhere; no cloud bill from us, ever.

---

## Kill list — what NOT to build

1. **Another cloud account system as the default** — destroys the #1 differentiator (R§5.1). Hosted sync only as opt-in paid.
2. **Social network / public graph** (Glasp-style) — privacy brand poison; sharing = links, not profiles.
3. **Full PKM (backlinks, canvas, tasks)** — Obsidian/Notion/Logseq quicksand; instead be their best capture front-end (I-24/I-25).
4. **Server-side AI on free tier** — unit economics death; AI must be on-device or user-paid (I-13/M-03).
5. **Paywalling search, saves, export, or sync-basics** — the exact sins killing Evernote/mymind/Raindrop-goodwill (R§4.1).
6. **Browser built-in clone features without differentiation** (plain reading list) — must always add organize + search + recall on top.
7. **Crypto/NFT/token anything** — instant trust suicide in a privacy brand.

---

## Idea scoreboard (top 10 by impact/effort)

| Rank | ID | Idea | Impact | Effort |
|---|---|---|---|---|
| 1 | I-05 | Refugee importers | 🔥×5 | S–M |
| 2 | I-01 | Store publishing | 🔥×5 | M |
| 3 | I-02 | One-click sync | 🔥×5 | M–L |
| 4 | I-08 | Reader view | 🔥×5 | M |
| 5 | I-11 | Resurfacing/digest | 🔥×5 | M |
| 6 | I-14 | Semantic search (local) | 🔥×5 | M–L |
| 7 | I-13 | On-device summaries | 🔥×5 | M |
| 8 | I-19 | Save-all-tabs | 🔥×4 | S |
| 9 | I-06 | Refugee landing/SEO | 🔥×4 | S |
| 10 | I-17 | Mobile PWA wedge | 🔥×5 | M–L |

*Start at the top. Each line is a release; each release steals a competitor's users for a reason the research proves they already want.*
