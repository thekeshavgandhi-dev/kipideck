# Screenshot harness

Capture the store screenshots without faking anything.

Every store needs screenshots, and every store rejects a screenshot of mock data.
This harness renders the **real** Library UI — real `library.html`, real `library.css`,
real `library.js`, real `lib/storage.js` and real IndexedDB — in an ordinary browser tab,
seeded with a believable 42-item library.

It works by faking only the handful of `chrome.*` APIs the Library touches
(`shim.js`), which is why this is **not** in the extension package: `tools/` is not in
the packaging list in `website/scripts/build-extension-zip.mjs`.

## Run it

From the **repo root**:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/tools/screenshots/>

(It must be served over HTTP — ES modules and `fetch` do not work from `file://`.)

## Take the shots

Each link in the top bar loads a different scene. Set your browser window to
**1280 × 800**, then press **`H`** to hide the control bar before you screenshot.

| Shot | Scene | What it should show |
|---|---|---|
| 1 | `?scene=grid` | The library grid, deck sidebar, favicons, tags |
| 2 | `?scene=search` | A live search with hits |
| 3 | `?scene=detail` | An item's detail view with its stored page text |
| 4 | `?scene=import` | The import banner the first-run page links to |
| 5 | `?scene=export` | The export dialog with the three formats |
| 6 | `?scene=settings` | Settings |

Add `&controls=0` to any URL to load with the bar already hidden.

Reloading the page re-seeds the library from scratch, so you always get a clean,
identical set of items. Nothing you do here touches your real Kipideck data —
the shim stores everything in memory and in a normal IndexedDB database
under `localhost:8000`.

## Shots this harness does *not* cover

Two of the seven shots in `docs/STORE_SUBMISSION.md` are extension pages rather
than the Library, so capture them by installing the unpacked extension:

- **The import preview** (ready / already-here / skipped counts) — needs a real
  export file selected. Use `test/fixtures/` or any Pocket/Omnivore export.
- **The first-run onboarding page** — `onboarding/onboarding.html`, which you can
  open directly as `chrome-extension://<id>/onboarding/onboarding.html`.

## The rule

Do not substitute a mocked-up screenshot. A store reviewer compares the
screenshots against what the extension actually does; a mismatch is a rejection,
and a user who installs on the strength of a picture that does not match is a
one-star review. If the UI in the harness is not what you want to ship, **change
the UI**, not the screenshot.
