# Changelog

All versions are the extension version in `manifest.json`.

## 1.7.0 — ZIP import (12 September 2026)

Phase 2 continues: the import dialog now opens ZIP archives in the browser.

### Added (I-05 · import polish)

- Pocket's `part_*.csv` ZIP and Omnivore's metadata + `contents/` ZIP import
  straight from the download — no unzipping by hand. DEFLATE comes from a
  vendored single-file codec (fflate, MIT); only importable text formats come
  out, everything is bomb-capped (500 files / 256 MB), and failures read like
  help ("holds no files Kipideck can import") instead of stack traces.
- RAR, 7z and gzip are still refused, honestly: the dialog says Kipideck opens
  ZIPs but not those, instead of pretending.

## 1.6.0 — save-states + tab sessions (12 September 2026)

Phase 2 begins: two ideas from `ideas.md` ship their core.

### Added (I-12 · save-state workflow)

- Every item now has a save-state — Unread → Reading → Done, plus Archive — stored in the
  database (schema v2; existing libraries backfill to Unread on upgrade) and honoured
  everywhere: Library status chips with live counts, per-item pills, bulk re-triage, the
  `status:` search operator, and an optional “opening an item marks it done” setting.
- Importers map foreign read-states onto it; JSON export/import round-trips it, so it
  survives sync.

### Added (I-19 · save-all-tabs + session restore)

- “Save N tabs to deck…” in the popup, plus `Ctrl/⌘+Shift+S`: the whole window becomes one
  searchable session card. Browser pages are skipped, duplicates merged, the list capped at
  100 — and the button shows the real count before you click.
- One-click restore reopens the window (first tab focused, the rest backgrounded, with a
  confirmation above 20 tabs). Sessions export to bookmark HTML (one folder of links),
  Markdown (a tab list) and JSON, and re-import whole.

## Unreleased — store-submission preparation

No extension code changed. This is everything needed to make the actual submissions a formality.

### Fixed — the first Edge Add-ons upload was rejected (12 September 2026)

Partner Center refused `kipideck-extension.zip` with three package-validation errors. All three are
fixed, and none of them can be rebuilt now because the packager refuses to write a package that
violates the rule:

1. **`The string … has exceeded the maximum length of 132`** — the manifest `description` was 316
   characters. Trimmed to **127**: *"Save pages, links, images and text in one click. Auto-organized,
   searchable, stored on your own device — no account, no server."* This is now the same string as the
   store listing's short description in `docs/STORE_SUBMISSION.md` §4; they must not drift.
2. **`The background.scripts field cannot be used with manifest version 3`** — `manifest.json` tried
   to serve Chromium and Firefox from one file. See "Changed — one source manifest, two packages"
   below.
3. **`JSON does not match all schemas from 'allOf'`** — the same `description` field; it went away
   with #1.

### Changed — one source manifest, two packages

- **`manifest.json` is now the Chromium manifest.** `background.service_worker` only; no
  `background.scripts`, no `browser_specific_settings`. Firefox-only keys moved to
  **`tools/firefox-manifest-overlay.json`** (`background.scripts`, `service_worker: null`,
  `browser_specific_settings.gecko`) and are merged in only when the Firefox package is built.
  Chromium ignores `scripts` locally but its store validator rejects it; Firefox ignores
  `service_worker` and runs an event page declared with `scripts` instead — and on Firefox < 121 the
  event page never started at all when `service_worker` was present (bug 1860304), which is why the
  overlay *deletes* the key rather than adding to it.
- **`npm run package` now builds three zips** instead of one:
  | Zip | Manifest | `manifest.json` at root | For |
  |---|---|---|---|
  | `kipideck-extension.zip` | Chromium | no (`kipideck/`) | website download — "Load unpacked" |
  | `kipideck-extension-chromium.zip` | Chromium | **yes** | **Edge Add-ons + Chrome Web Store** |
  | `kipideck-extension-firefox.zip` | Firefox | **yes** | **Firefox AMO** |
  Store validators require `manifest.json` at the zip root; the website download keeps the nested
  folder the install docs tell people to select.
- **The website's download button is now browser-aware.** It served the single zip to everyone
  before; now Firefox visitors get `kipideck-extension-firefox.zip` and everyone else the Chromium
  package, because handing Firefox the Chromium manifest is not a warning — it is an extension with
  no background context at all. Install copy on `/` and `/deck` updated to match.
- **`npm run verify:package`** (`npm --prefix website run verify-extension`) re-checks the built zips
  against the store rules. The packager only ever validated the *source*; it could not tell that the
  zip about to be uploaded was built last week from a different branch.
- The rules themselves live in **`website/scripts/store-rules.mjs`**, shared by the packager and the
  verifier so they cannot drift: description ≤ 132, name ≤ 45, dotted-numeric version, MV3 background
  shape per target, gecko id present for Firefox and absent for Chromium, no unrecognized top-level
  keys, every manifest-referenced file present in the zip, no `.DS_Store`/`.map`/`node_modules`.
  It caught one bug in its own first run (it flagged `browser_specific_settings` in the Firefox
  package, which is required there).

### Added

- **`tools/screenshots/`** — a screenshot harness that renders the **real** Library UI (real
  `library.html`, `library.css`, `library.js` and `lib/storage.js`) in an ordinary browser tab behind
  a shim of the handful of `chrome.*` APIs the Library touches, seeded with a 41-item library across
  7 decks. Six scenes (grid, search, detail, import banner, export, settings), `H` hides the control
  bar. It fetches `library.html` rather than copying it, so the screenshots cannot drift from the UI.
  **`tools/` is not in the packaging list**, so none of it ships.
- **`tools/firefox-manifest-overlay.json`** — the Firefox half of the manifest (see "Changed" above).
  Also outside the packaging list, so it never ships inside either zip.
- **Tests** for all of it in `test/wiring.test.js`: the manifest description fits 132 characters, the
  Chromium manifest uses `service_worker` and never `scripts` or `browser_specific_settings`, the
  Firefox overlay restores what Firefox needs, and — read out of the built zips — `manifest.json`
  sits at the root of each store package with only that browser's keys.

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
