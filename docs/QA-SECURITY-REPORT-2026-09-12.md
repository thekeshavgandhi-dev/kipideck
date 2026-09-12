# Kipideck — QA & Security Report · 12 September 2026

**Version under review:** 1.8.0 (from 1.7.0) · **Branch:** `arena/01a09430-kipideck` · **Runtime target:** MV3, Chrome ≥ 110 / Firefox ≥ 115
**How to reproduce:** `npm test` from the repo root (no network, no browser, no install beyond Node 20+). Last full run: **472 / 472 pass · 97 suites · ~20 s**.

---

## 1 · What this cycle changed (test-relevant surface)

Five features shipped since v1.7.0, each behind its own suite:

| Feature | Module(s) | New/updated tests | Result |
|---|---|---|---|
| "You also saved" related rail | `lib/related.js`, `lib/storage.js` (`relatedTo`) | `test/related.test.js` (11) | ✅ 11/11 |
| Kipi Daily 5 (popup + library + notification) | `lib/digest.js`, `background/background.js`, `popup/*` | `test/digest.test.js` (13, incl. IndexedDB integration) | ✅ 13/13 |
| Reader view + scroll persistence | `lib/reader.js`, `library/*` | `test/reader.test.js` (14) | ✅ 14/14 |
| Read-aloud (TTS) in reader | `lib/reader.js` (`speechQueue`), `library/*` | inside `test/reader.test.js` | ✅ |
| Keyword tag layer | `lib/classify.js` (`suggestKeywords`), `lib/text.js` | `test/classify.test.js` (+6 → 23) | ✅ 23/23 |
| Detail-modal UI redesign (v1.8 close-out) | `library/library.js` + `library/library.css` | wiring invariants (all bound ids survive) | ✅ |

Plus the security work below (`test/security.test.js`, 14 tests).

`test/wiring.test.js` was extended so every new module is registered in the MODULES list and every `getElementById` in `library.js` must exist in HTML or a JS template — this is what caught markup drift during the modal redesign.

## 2 · QA detail — what the suites actually assert

- **Related rail:** scoring weights (tag 4 / domain 2 / deck 1.5 / title-overlap 2), containment ratio saturates at 1, ties break newest-first, self-exclusion, bounded candidate pool (no full-library scan at 50k), done/archived never crowd out unread.
- **Digest:** day-seeded RNG is stable within a UTC day and differs across days; slot composition 2 unread + forgotten-gem + surprise with dedupe; honest shrink when < 5 candidates (never padded); salt changes picks; `digestSummaryLine` wording; `Storage.dailyFive` integration against real IndexedDB (oldest-unread order, `done` exclusion, read-progress clamp).
- **Reader:** sentence splitter (abbreviations, quotes, CJK-safe caps), hard-split of 5 000-char monsters at comma boundaries with lossless `join("")` coverage, paragraph caps, `readingMinutes` clamp at ≥ 1 min, `scrollProgress` clamp 0–1, `speechQueue` emits sentences in document order and stops at bounds.
- **Classifier:** 17 pre-existing regex-layer tests still pass unchanged (the keyword layer only *appends*); 6 new tests cover extraction ranking, min term length, existing-tag non-overwrite, max-5 cap, integration with `classify()`.
- **Regression baselines (fixture perf, same machine):** keyword search over 50k items ≈ 370 ms; 20k-row Pocket CSV import ≈ 450 ms parse; both unchanged by this cycle — `relatedTo` and `dailyFive` are pool-bounded, so neither walks the store per render.
- **Packaging:** `npm run package` (root) and `npm run package-extension` (website) both run `verify:package`, which fails if the two shipped ZIPs disagree on version or leak `tools/`, `test/`, or dev files. `tools/screenshots/` confirmed outside the package list.

## 3 · Security audit — method

Static sweep of every trust boundary an attacker can touch: capture pipeline (content script → background → DB write), importers (user-supplied files), sync bridge (externally reachable message ports), URL handling everywhere (`url`, `image`, `favIconUrl`, `sourceUrl`), manifest permissions, and CSP. Then hand-verified each finding and added a regression test per fix.

## 4 · Findings → fixes → proof

| # | Severity | Finding | Fix | Proof |
|---|---|---|---|---|
| S1 | **High** | `javascript:` / `data:` URLs survived import + capture and were rendered as clickable `href`s in the library — one click runs attacker JS in the extension page (same-origin as IndexedDB). | Three-layer gate: capture falls back to `pageUrl` unless `isSafeWebUrl`; **DB write chokepoint** (`db.js` `sanitizeUrls` in `writeItem` + `writeItemsBulk`) strips non-http(s) `url`/`image`/`favIconUrl`/`sourceUrl` — so even already-infected JSON imports land neutralised; render gates (`openableUrl`/`safeWebUrl`/`isSafeImageUrl`) hide what legacy rows still carry until their next write. | `test/security.test.js` + `lib/canon.js` tests; S1 specifically covered in `test/canon.test.js` |
| S2 | **High** | The sync bridge answered `runtime.sendMessage` from any page that knew the extension id, leaking the sync handshake surface. | `isBridgeOrigin()` allowlist: `https://kipideck.vercel.app` + loopback origins only; everything else refused before the payload is even parsed. | security suite (bridge-origin cases) |
| S3 | Medium | `externally_connectable` declared a match-pattern the extension never used — a needless always-open port. | Removed the key from `manifest.json` entirely (no replacement needed). | security suite asserts absence; packaging verify |
| S4 | Low | Favicon and hero images rendered from whatever string a page claimed. | `isSafeImageUrl` — `https:` only for icons; item images must pass the same URL gate before `<img src>`; `escapeHtml` confirmed on every interpolated field in the detail modal template (including during the v1.8 redesign). | security + canon suites |

**Checked and found clean:** PKCE (no secret in extension), ZIP bomb caps (500 files / 256 MB, inflate verified against a zip-bomb fixture), `KIPI_*` message contract is versioned and origin-checked before dispatch, no remote code (zero runtime deps, no eval anywhere — `grep`-verified), CSP of library/popup unchanged, OAuth tokens stored in `storage.local` only (see residual risk 1).

## 5 · Residual risks (accepted, on the record)

1. **Sync tokens are plaintext in `storage.local`** — standard for MV3 extensions, but only honest until I-22 (E2EE sync) lands; already on the ideas list.
2. **`<all_urls>` host permission** — required by the capture feature; scoped behaviour is the mitigation (content script reads only on explicit action, no listeners on navigation). Re-review before store submission.
3. **Legacy DB rows** can still hold unsafe `url` strings until that item is next written; render gates make them inert meanwhile (no anchor, no `<img>`), so this is exposure of *text*, never execution.
4. **TTS voices are OS-supplied** — playback quality varies; that is the documented price of the zero-cost promise.
5. No real-browser smoke of the MV3 service-worker alarm path (`DAILY_ALARM`) in CI — `chrome.alarms` is covered only by logic tests, not by a running browser. Manual check: install unpacked, set notify 09:00, next day expect one notification → library `#daily`.

## 6 · Sign-off

Code: ✅ all 472 tests green on Node 20 (fixture harness, `test/harness/`). Packaging: ✅ after version bump.
Not verified here (needs humans): store submission flow (I-01), the manual alarm check in §5.4, and visual review of the redesigned detail modal (`tools/screenshots/index.html?scene=detail`).
