# Changelog

All versions are the extension version in `manifest.json`.

## Unreleased — store-submission preparation

No extension code changed. This is everything needed to make the actual submissions a formality.

### Added

- **`tools/screenshots/`** — a screenshot harness that renders the **real** Library UI (real
  `library.html`, `library.css`, `library.js` and `lib/storage.js`) in an ordinary browser tab behind
  a shim of the handful of `chrome.*` APIs the Library touches, seeded with a 41-item library across
  7 decks. Six scenes (grid, search, detail, import banner, export, settings), `H` hides the control
  bar. It fetches `library.html` rather than copying it, so the screenshots cannot drift from the UI.
  **`tools/` is not in the packaging list**, so none of it ships.

### Changed

- **`docs/STORE_SUBMISSION.md`** gained the cost facts and a submission order:
  - **Firefox AMO: free. Edge Add-ons: free. Chrome Web Store: $5 one-time** (per developer account,
    not per extension, not annual — and unavoidable).
  - **Submit Firefox → Edge → Chrome.** Two stores are free today, so the extension becomes
    installable in one click before spending anything, and any reviewer objection surfaces while it
    is still cheap to fix.
  - Per-store sections reordered to match, with the AMO lint requirements and the 5-screenshot cap
    folded into the Firefox section.
  - Screenshot section now points at the harness.
  - A "what I cannot do for you" list: paying the $5, choosing the gecko domain, and taking the
    screenshots are not code.

### Known blockers (need a human)

1. **Firefox gecko id** is still `kipideck@example-addon.org` — a placeholder on a domain we do not
   control. AMO will not accept it, and it must never change after publication.
2. **Chrome's $5** developer registration fee.
3. **Screenshots** still need capturing (the harness makes it ~10 minutes).
4. **`https://kipideck.vercel.app/privacy` must be verified live** — all three stores require a
   working policy URL. DNS resolves to Vercel, but the sandbox cannot reach it to confirm.

## 1.5.0 — 12 September 2026

Phase 1 ("exist") completes. The theme of this release is **the refugee wave**: people whose
read-later app deleted their library, and who ask "what happens if you die too?" before they ask
about a single feature.

### Added

- **`/omnivore-alternative` page** (T1, I-06). The structural story: Omnivore was open source and
  still died, because the hosted library was the product. Verified timeline (29 Oct 2024 announcement
  → 15 Nov 2024 deletion), the anatomy of the export (`metadata_*.json` + `contents/<slug>.html` +
  `highlights/*.md`), a four-step rescue that rejoins article text by slug, a what-survives table, and
  FAQs including "open source didn't save it — why would local-first?" and "can I recover data I never
  exported?" (no).
- **`/raindrop-alternative` page** (T3, I-06). Deliberately not a hit job: Raindrop is alive and good.
  The angle is "keep it, also keep a copy that needs no subscription and no server", plus a real
  migration path. No pricing numbers we cannot keep current.
- **`/shutdown-proof` page** (T2, I-07). The pledge as structural facts rather than intentions,
  "how to leave in three clicks", a **what we cannot promise** section (browser APIs change, an
  extension you never update can stop working, a dead disk is a backup problem, maintenance forever is
  not a promise we make), and the read-later graveyard timeline. No predictions about living products.
- **`docs/EXPORT_FORMAT.md`** (T4, I-07). The documented schema the pledge promises: the JSON envelope,
  every item field with type and whether it is optional, deck/settings/tombstone shapes (and why
  tombstones carry a canonical URL), the bookmark-HTML mapping table, the Markdown structure, a worked
  example generated from real exporter output, a field-by-field round-trip matrix, and the tests that
  prove each guarantee.
- **`docs/STORE_SUBMISSION.md`** (T6, I-01). The `<all_urls>` decision with its justification and the
  optional-host fallback, permission justifications kept in sync with `/privacy`, CWS form answers,
  listing copy, a screenshot shot list, per-store deltas for Edge and Firefox AMO, and the
  pre-submission checklist.
- **Onboarding, finished** (T7, I-03). The first-run page can now:
  - save the page you are on, producing one real item;
  - seed **three sample items** (`lib/samples.js`) — one with page text so search has something to hit,
    one in a second deck, one pinned — all tagged `sample` and removable in one click;
  - open the Library with the importer ready (`library.html#import=1`), so a refugee goes install →
    import without hunting for the ⬆ button;
  - show a deck tour and a keyboard-shortcut card.

### Changed

- Homepage: an "Arriving from Pocket or Omnivore?" funnel near the top, with one honest sentence about
  what cannot be recovered, and footer links to all four new pages (T5).
- `lib/samples.js` is new and packaged (32 files in the zip, up from 31).

### Fixed

- **Three broken links.** `PageShell`'s footer linked to `/omnivore-alternative`,
  `/raindrop-alternative` and `/shutdown-proof`, none of which existed — every page on the site had
  404s in its footer. All three pages now exist and build as static routes.
- **Duplicated CSS.** `website/app/globals.css` contained a 48-line block duplicated verbatim
  (lines 271–318 repeated 110–157). Removed; 327 → 286 lines, no rule lost, braces balanced.

### Tests

- 315 → **330 passing**. New `test/samples.test.js` (13) covering idempotent seeding, removal that
  spares the user's own items, tombstone recording, and export/re-import with no duplication.
- `test/policy.test.js` extended (2): saving a demo item, and seeding samples, must **not** flip
  `onboardingDone` — both are explicit actions, and neither opens the silent-capture gate.

---

## 1.4.0 — 12 September 2026

Phase 0, the foundation. Rebuilt the data layer for 50,000 items (persistent IndexedDB index instead of
a full scan per keystroke: 45 s → 376 ms at 50k), sharded delta sync to the user's own Drive (219 MB →
0.03 MB per 50 changes), Authorization Code + PKCE with refresh tokens, a 13-format importer, three
export formats, local favicons, a first-run disclosure page, 315 tests and CI.
