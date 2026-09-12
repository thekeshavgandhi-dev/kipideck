# Kipideck — Upcoming tasks

**Last updated:** 12 September 2026 · **Companion:** [`PROGRESS.md`](./PROGRESS.md) (what's done), [`ideas.md`](./ideas.md) (the full idea list)

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

- [ ] Facts, dated and correct: acqui-hire by ElevenLabs, 15 Nov 2024 shutdown, repo archived, the
      community fork cannot recover deleted cloud data.
- [ ] Export anatomy: `metadata_*.json` (batches) + `contents/<slug>.html` + `highlights/*.md`.
- [ ] Steps: unzip → select **all** `metadata_*.json` **and** the `contents/` HTML files → Kipideck
      rejoins them by slug, so article text survives, not just links.
- [ ] What survives table: labels→tags, `savedAt`, ARCHIVED state, highlights + annotations → notes,
      author, preview image, **article text**.
- [ ] FAQ: "open source didn't save it — why would local-first?", "what if I only kept the metadata?",
      "can I recover data I never exported?" (no).
- [ ] Uses `PageShell`; builds as a static route; linked from the footer (already is) and homepage.

### T2 · `/shutdown-proof` pledge page — I-07 · **S**

The page people look for *before* they look at features.

- [ ] The pledge as a list of structural facts, not promises: no server, no account, data in the
      browser's own storage, optional sync to **your** Drive with **your** OAuth client, export any
      time in three open formats, import is a first-class feature.
- [ ] "How to leave in three clicks" — Library → ⬇ → pick a format.
- [ ] **What we cannot promise** (this section is the credibility): browser APIs change; an extension
      you never update can stop working; if you never export and your disk dies, that is a backup
      problem — turn on sync or export regularly.
- [ ] The read-later graveyard timeline: Omnivore 15 Nov 2024, Pocket 12 Nov 2025. No predictions
      about living products.
- [ ] Links to `docs/EXPORT_FORMAT.md` and the privacy policy.

### T3 · `/raindrop-alternative` page — I-06 · **S**

Raindrop is alive and good — the page must not pretend otherwise, or it reads as spam and loses the
trust the other two pages earned.

- [ ] Angle: *keep Raindrop, also keep a copy that needs no subscription and no server* — plus a real
      migration path for people leaving.
- [ ] Import specifics: Settings → Backup → JSON; Kipideck keeps tags, collections → tags, notes,
      `important` → favourite, type (image/video/article), created dates, **highlights**.
- [ ] Repeatable mirror: importing the same backup again adds nothing (canonical-URL dedupe).
- [ ] Comparison table with no unverifiable pricing claims — say "some features need a paid plan",
      not a number we cannot keep current.

### T4 · `docs/EXPORT_FORMAT.md` — I-07 · **S**

The pledge promises a *documented* schema. Without this file the promise is marketing.

- [ ] JSON: envelope (`version`, `app`, `exportedAt`, `counts`, `decks`, `settings`, `tombstones`,
      `items`), every item field with type + meaning + which are optional, and the rule that
      `content` is absent when empty.
- [ ] Deck and settings objects; tombstone shape (`id`, `canon`, `deletedAt`) and why canon is there.
- [ ] Bookmark HTML mapping table: deck → `<H3>` folder, tags → `TAGS`, note → `<DD>`, pinned →
      `PRIVATE="1"`, dates → Unix seconds.
- [ ] Markdown structure and where page text goes (`<details>`).
- [ ] A worked example: 20 lines of real export output, annotated.
- [ ] Re-import guarantees: which fields round-trip through which format (link the tests that prove it).

### T5 · Homepage: the refugee funnel — I-06 · **XS**

- [ ] A section near the top of the page: "Arriving from Pocket or Omnivore?" → the two pages.
- [ ] Footer links to all four new pages (nav already has `/shutdown-proof`).
- [ ] One honest sentence about what cannot be recovered, so the pages aren't clicked on false hope.

### T6 · `docs/STORE_SUBMISSION.md` — I-01 · **M**

The #1 conversion killer is sideloading. This is the paperwork that ends it.

- [ ] Decision recorded: **keep `<all_urls>`** with a written justification (saving from any page is
      the core feature; `activeTab` alone breaks the content-script capture path), *and* document the
      optional-host-permission variant as a fallback if review pushes back.
- [ ] Permission-by-permission justification table, matching `/privacy` exactly (they must not drift).
- [ ] Single purpose, remote-code, data-handling and privacy-policy answers for the CWS form.
- [ ] Listing copy: title, short description, full description leading with the trust story +
      importer, not features.
- [ ] Screenshot/video shot list (library grid, import preview, reader-less detail view, onboarding).
- [ ] Edge Add-ons + Firefox AMO deltas (Firefox needs the `browser_specific_settings` gecko id).
- [ ] Pre-submission checklist: version bump to **1.5.0**, `npm run check`, zip regenerated.

### T7 · Finish I-03 onboarding — **M**

Disclosure ships; the first 60 seconds still don't.

- [ ] One-click "save this demo page" that produces a real item.
- [ ] Three pre-seeded sample items (deletable, clearly marked) so search and decks demo themselves.
- [ ] Deck tour + keyboard-shortcut card.
- [ ] **"Import from…" shortcut on the first-run page** — a refugee should be able to go install →
      import without ever finding the ⬆ button.
- [ ] Test: nothing is captured silently before the disclosure is accepted (already covered by
      `test/policy.test.js` — extend, don't duplicate).

---

## Next — Phase 2 (sync for humans, retention)

| Task | Idea | Effort | One-line acceptance |
|---|---|---|---|
| First-party OAuth client, "Sign in with Google" | I-02 | L | A non-developer can turn on sync in under 2 minutes; BYO client stays as advanced fallback |
| Save-state workflow (Unread → Reading → Done → Archive) | I-12 | S | Status is per-item, filterable in the Library, and survives sync + import (the importer already maps foreign read-state onto it) |
| Save-all-tabs + session restore | I-19 | S | "Save N tabs to deck…" from popup + shortcut; restore reopens them; sessions searchable |
| Import polish: ZIP handling | I-05 | M | Either a vendored inflate for `part_*.csv` ZIPs, or a clearer "unzip first" flow with a file-count check |
| Related-items rail | I-16 | M | Shared tags + similarity, shown on the detail view, computed without a full scan |

## Later — Phases 3–6 (unchanged from `ideas.md`)

| Phase | Items | Why this order |
|---|---|---|
| 3 · Consume | I-08 reader, I-11 resurfacing, I-10 TTS, I-09 highlights | Reader + resurfacing are the daily-habit engine; ~70% of saves are never reopened |
| 4 · Free AI | I-13 summaries, I-14 semantic search, I-15 tagging v2 | On-device only; progressive enhancement (Chrome desktop first), never a hard dependency |
| 5 · Everywhere | I-17 mobile PWA, I-18 snapshots, I-20 formats, I-26 Safari | Mobile share-target is the biggest adoption blocker after stores |
| 6 · Moat & money | I-22 E2EE, I-23 sharing, I-24 export targets, M-01/M-04 | Virality + revenue, without touching the free core |

---

## Timing note

Pocket deleted user data on **12 November 2025**. The first anniversary — **November 2026**, two
months from now — is when "they deleted my library" retrospectives get written and searched (I-28).
T1–T6 should be live and indexed before then; that is the deadline that matters, not the roadmap table.
