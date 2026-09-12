# Kipideck — Upcoming tasks

**Last updated:** 12 September 2026 · **Status:** v1.8.0 shipped — related rail (I-16), Daily 5 (I-11 core), reader + TTS (I-08/I-10), keyword tagging layer (I-15 p2), rebuilt detail modal, and the security/QA pass (`docs/QA-SECURITY-REPORT-2026-09-12.md`). Open: I-02 sign-in half, I-01 store submission, I-09 highlights. · **Companion:** [`PROGRESS.md`](./PROGRESS.md) (what's done), [`ideas.md`](./ideas.md) (the full idea list)

Ordered by what unblocks the most. Each task has acceptance criteria that are testable — if it can't
be checked, it isn't finished. Effort: XS < 1 h · S ≈ half a day · M ≈ 1–2 days · L ≈ a week.

**Standing constraints for every task below**

- Engineered for **50,000+ items**: no full-library scans in a UI path, no whole-library strings in
  memory, paginate or stream.
- **Zero runtime dependencies.** Vendoring a single file is allowed; adding an npm dependency to the
  extension is not.
- **Local-first, no Kipideck server.** Anything that would require one is out of scope by design.
- **Honest copy.** Public pages state limitations plainly (see `/pocket-alternative`'s "can I get my
  data back? → no").
- **Tests for behaviour, not coverage.** Every parser, merge rule and export format has a fixture test.

---

## Now — finish Phase 1

### T1 · `/omnivore-alternative` page — I-06 · **S**

Omnivore's users got 17 days (announced 29 Oct 2024, deleted 15 Nov 2024) and 500k+ libraries.
The structural story is the strongest one we have: **Omnivore was open source and still died**, because
the hosted library was the product. Kipideck has no hosted library.

- [x] Facts, dated and correct: acqui-hire by ElevenLabs, 15 Nov 2024 shutdown, repo archived, the
      community fork cannot recover deleted cloud data.
- [x] Export anatomy: `metadata_*.json` (batches) + `contents/<slug>.html` + `highlights/*.md`.
- [x] Steps: unzip → select **all** `metadata_*.json` **and** the `contents/` HTML files → Kipideck
      rejoins them by slug, so article text survives, not just links.
- [x] What survives table: labels→tags, `savedAt`, ARCHIVED state, highlights + annotations → notes,
      author, preview image, **article text**.
- [x] FAQ: "open source didn't save it — why would local-first?", "what if I only kept the metadata?",
      "can I recover data I never exported?" (no).
- [x] Uses `PageShell`; builds as a static route; linked from the footer (already is) and homepage.

### T2 · `/shutdown-proof` pledge page — I-07 · **S**

The page people look for *before* they look at features.

- [x] The pledge as a list of structural facts, not promises: no server, no account, data in the
      browser's own storage, optional sync to **your** Drive with **your** OAuth client, export any
      time in three open formats, import is a first-class feature.
- [x] "How to leave in three clicks" — Library → ⬇ → pick a format.
- [x] **What we cannot promise** (this section is the credibility): browser APIs change; an extension
      you never update can stop working; if you never export and your disk dies, that is a backup
      problem — turn on sync or export regularly.
- [x] The read-later graveyard timeline: Omnivore 15 Nov 2024, Pocket 12 Nov 2025. No predictions
      about living products.
- [x] Links to `docs/EXPORT_FORMAT.md` and the privacy policy.

### T3 · `/raindrop-alternative` page — I-06 · **S**

Raindrop is alive and good — the page must not pretend otherwise, or it reads as spam and loses the
trust the other two pages earned.

- [x] Angle: *keep Raindrop, also keep a copy that needs no subscription and no server* — plus a real
      migration path for people leaving.
- [x] Import specifics: Settings → Backup → JSON; Kipideck keeps tags, collections → tags, notes,
      `important` → favourite, type (image/video/article), created dates, **highlights**.
- [x] Repeatable mirror: importing the same backup again adds nothing (canonical-URL dedupe).
- [x] Comparison table with no unverifiable pricing claims — say "some features need a paid plan",
      not a number we cannot keep current.

### T4 · `docs/EXPORT_FORMAT.md` — I-07 · **S**

The pledge promises a *documented* schema. Without this file the promise is marketing.

- [x] JSON: envelope (`version`, `app`, `exportedAt`, `counts`, `decks`, `settings`, `tombstones`,
      `items`), every item field with type + meaning + which are optional, and the rule that
      `content` is absent when empty.
- [x] Deck and settings objects; tombstone shape (`id`, `canon`, `deletedAt`) and why canon is there.
- [x] Bookmark HTML mapping table: deck → `<H3>` folder, tags → `TAGS`, note → `<DD>`, pinned →
      `PRIVATE="1"`, dates → Unix seconds.
- [x] Markdown structure and where page text goes (`<details>`).
- [x] A worked example: 20 lines of real export output, annotated.
- [x] Re-import guarantees: which fields round-trip through which format (link the tests that prove it).

### T5 · Homepage: the refugee funnel — I-06 · **XS**

- [x] A section near the top of the page: "Arriving from Pocket or Omnivore?" → the two pages.
- [x] Footer links to all four new pages (nav already has `/shutdown-proof`).
- [x] One honest sentence about what cannot be recovered, so the pages aren't clicked on false hope.

### T6 · `docs/STORE_SUBMISSION.md` — I-01 · **M**

The #1 conversion killer is sideloading. This is the paperwork that ends it.

- [x] Decision recorded: **keep `<all_urls>`** with a written justification (saving from any page is
      the core feature; `activeTab` alone breaks the content-script capture path), *and* document the
      optional-host-permission variant as a fallback if review pushes back.
- [x] Permission-by-permission justification table, matching `/privacy` exactly (they must not drift).
- [x] Single purpose, remote-code, data-handling and privacy-policy answers for the CWS form.
- [x] Listing copy: title, short description, full description leading with the trust story +
      importer, not features.
- [x] Screenshot/video shot list (library grid, import preview, reader-less detail view, onboarding).
- [x] Edge Add-ons + Firefox AMO deltas (Firefox needs the `browser_specific_settings` gecko id).
- [x] Pre-submission checklist: version bump to **1.5.0**, `npm run check`, zip regenerated.

### T7 · Finish I-03 onboarding — **M**

Disclosure ships; the first 60 seconds still don't.

- [x] One-click "save this demo page" that produces a real item.
- [x] Three pre-seeded sample items (deletable, clearly marked) so search and decks demo themselves.
- [x] Deck tour + keyboard-shortcut card.
- [x] **"Import from…" shortcut on the first-run page** — a refugee should be able to go install →
      import without ever finding the ⬆ button.
- [x] Test: nothing is captured silently before the disclosure is accepted (already covered by
      `test/policy.test.js` — extend, don't duplicate).

---

## Next — Phase 2 (sync for humans, retention)

| Task | Idea | Effort | One-line acceptance |
|---|---|---|---|
| First-party OAuth client, "Sign in with Google" | I-02 | L | A non-developer can turn on sync in under 2 minutes; BYO client stays as advanced fallback |
| ✅ Save-state workflow (Unread → Reading → Done → Archive) — shipped v1.6.0 | I-12 | S | Status is per-item, filterable in the Library, and survives sync + import (the importer already maps foreign read-state onto it) |
| ✅ Save-all-tabs + session restore — shipped v1.6.0 | I-19 | S | "Save N tabs to deck…" from popup + shortcut; restore reopens them; sessions searchable |
| ✅ Import polish: ZIP handling — shipped v1.7.0 | I-05 | M | Either a vendored inflate for `part_*.csv` ZIPs, or a clearer "unzip first" flow with a file-count check |
| ✅ Related-items rail — shipped v1.8.0 | I-16 | M | Shared tags + deck/domain/overlap scoring in `lib/related.js`, bounded pool (no full scan), reasons shown per chip |
| ✅ Kipi Daily 5 — shipped v1.8.0 | I-11 | M | Day-seeded five, identical in popup/library/notification, honest shrink, opt-out |
| ✅ Reader view + read-aloud — shipped v1.8.0 | I-08 · I-10 | M | Saved-copy render with themes/type/scroll-resume; OS-voice queue with sentence highlight |
| ✅ Security audit + QA report — done v1.8.0 | — | M | URL sanitisation at the DB write chokepoint, bridge origin allowlist; `docs/QA-SECURITY-REPORT-2026-09-12.md` |
| QA-report follow-ups (not code) | I-01 | XS | See §5 of the report: gecko id, Chrome $5, screenshots, live privacy URL, Edge objections |

## Later — Phases 3–6 (unchanged from `ideas.md`)

| Phase | Items | Why this order |
|---|---|---|
| 3 · Consume | I-08 ✅, I-11 ✅ (core), I-10 ✅, I-09 highlights + new I-33 highlights page | Reader + resurfacing shipped v1.8.0; I-09 is the one left — build its page (I-33) in the same pass, per the Obsidian-Clipper lesson |
| 4 · Free AI | I-13 summaries (vehicle now: I-39 Chrome built-in AI), I-14 semantic search, I-15 ✅ keyword layer, I-35 BYO-LLM Q&A, I-36 tag provenance | On-device only; progressive enhancement (Chrome desktop first), never a hard dependency |
| 5 · Everywhere | I-17 mobile PWA, I-18 snapshots, I-20 formats, I-26 Safari | Mobile share-target is the biggest adoption blocker after stores |
| 6 · Moat & money | I-22 E2EE, I-23 sharing, I-24 export targets, M-01/M-04 | Virality + revenue, without touching the free core |

---

## Bugs found during the QA pass (and fixed)

A full read-through and test run of the repository before starting T1 surfaced two real defects, both
of which were live on the site rather than hypothetical. They are recorded here because they are the
kind of thing that recurs — and because "the suite is green" did not catch either of them.

### B1 · Three 404s in every page footer

`PageShell.js` linked to `/omnivore-alternative`, `/raindrop-alternative` and `/shutdown-proof`.
None existed. Since `PageShell` renders the footer on every content page, **every page on the site
had three broken links** — including `/pocket-alternative`, which links to all three in its
"Not arriving from Pocket?" card.

- *Why the tests missed it:* the suite has no link-integrity check. `npm run build` happily built 6
  static routes while the footer advertised 9.
- *Fixed by:* T1, T2 and T3 creating the three pages.
- *Verified by:* crawling every internal `href` on every built page and asserting a 200 — all resolve.
- *Worth adding:* a link-integrity test over the built output, so a future page rename cannot
  silently reintroduce this.

### B2 · `globals.css` had a 48-line block duplicated verbatim

Lines 271–318 were byte-identical to lines 110–157 (`.rescue-stats` through `.page-cta`).

- *Fixed by:* removing the duplicate. 327 → 286 lines, braces balanced, **zero unique rules lost**
  (verified by set-diffing every statement against a backup).
- *Trap:* the duplicated block ended **mid-media-query** — its last line was the opening
  `@media (max-width: 880px) {`. Deleting the block therefore also deleted that brace and broke the
  CSS parse. The first attempt did exactly this and the build failed with `Unexpected end of input`.
  The opening brace was restored manually. A contiguous-run duplicate detector should stop at rule
  boundaries, not at the longest match.

### Also noted

- `npm test` on a fresh clone **fails 7 of 10 suites** with `ERR_MODULE_NOT_FOUND` until `npm install`
  runs (no `node_modules` committed, as expected). It looks like a code regression but is not. Now
  called out in `PROGRESS.md`.
- `.pledge-list` existed in the stylesheet but was used nowhere — dead CSS left in anticipation of the
  pledge page. It is now used, by `/shutdown-proof`.

## Timing note

Pocket deleted user data on **12 November 2025**. The first anniversary — **November 2026**, two
months from now — is when "they deleted my library" retrospectives get written and searched (I-28).
T1–T6 are now live and build as static routes; what remains is getting them **indexed** before then,
which means the store submissions (I-01) and the directory listings (I-28). That is the deadline that
matters, not the roadmap table.
