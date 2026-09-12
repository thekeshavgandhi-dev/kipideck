# Store submission

**Applies to:** v1.6.0 · **Last updated:** 12 September 2026 · **Targets:** Chrome Web Store, Edge Add-ons, Firefox AMO

This is the paperwork that ends sideloading. Everything here is written to be pasted into a store
form, and the permission justifications are kept in sync with [`/privacy`](https://kipideck.vercel.app/privacy)
— **if a permission explanation changes on one side, change it on both.** A privacy policy that
disagrees with a store listing is the fastest route to a rejection.

---

## 1 · Decision: keep `<all_urls>`

**Decision: ship with `<all_urls>` as a required host permission, and keep the optional-host-permission
variant below ready as a fallback if review pushes back.**

### Why we keep it

Saving from *any* page is the core feature, not an edge case. `<all_urls>` is what lets the content
script be present on every page, and four shipping behaviours depend on it:

| Behaviour | Needs a pre-injected content script? | Works with `activeTab` alone? |
|---|---|---|
| Reading title, description, image and page text (capture) | No — `scripting.executeScript` | ✅ Yes |
| **Auto-save of highlighted text** (selection capture) | **Yes** | ❌ **No** |
| **`Space`+`K` quick-save** | **Yes** | ❌ **No** |
| **"Already in your Kipideck" in-page toast** | **Yes** | ❌ **No** |
| Per-site mute and policy enforcement | **Yes** | ❌ **No** |

`chrome.scripting.executeScript` (used by `getPageMeta` and `getFullPageText` in
`background/background.js`) only runs as a result of a user gesture. It therefore **cannot** power
anything that must be listening before the user acts: selection capture fires when the mouse is
released, `Space`+`K` fires on a keypress, and the duplicate-detection toast is a reply to a save that
already happened. Removing `<all_urls>` would silently delete four features, and "auto-save the text
you highlight" is one of the two things that makes Kipideck different from a bookmark folder.

The content script is also *inert* until it is needed: it reads no data on load, sends nothing
anywhere, and is gated by `lib/policy.js` — nothing is captured automatically until the first-run
disclosure has been accepted, and per-site mute is honoured.

### Fallback variant (only if review insists)

If a reviewer rejects `<all_urls>`, ship this variant and accept the feature loss knowingly:

1. Remove the `host_permissions` block and the `content_scripts` block from `manifest.json`.
2. Add `"optional_host_permissions": ["<all_urls>"]`.
3. On the onboarding page, request broad host permission with
   `chrome.permissions.request({ origins: ["<all_urls>"] })` behind an explicit, user-initiated
   button, and inject the content script programmatically on grant.
4. **Before shipping the fallback, cut these four things** — do not ship UI that silently does
   nothing: selection auto-save, `Space`+`K`, the in-page duplicate toast, and per-site mute. Remove
   their settings toggles and their copy from the listing and the privacy policy in the same commit.

Record which variant shipped here, and why. Do not let the two drift into an undocumented state.

---

## 1b · What each store costs, and the order to submit in

| Store | Cost | Notes |
|---|---|---|
| **Firefox Add-ons (AMO)** | **Free** | No fee. Needs a developer account and the Add-on Distribution Agreement. |
| **Edge Add-ons** | **Free** | Free, but needs a Microsoft Partner Center enrollment in the Edge program. |
| **Chrome Web Store** | **$5, once** | One-time developer registration fee, per developer account — not per extension, and not annual. One account covers up to ~20 items. Unavoidable: there is no free route to the Chrome Web Store. |

**Recommended order: Firefox → Edge → Chrome.**

Two free stores are available today, so start with them. That gets the extension installable in one
click for a real number of people before spending anything, it surfaces any review objections while
they are still cheap to fix, and it means the $5 is spent on a submission that has already been through
two reviewers rather than on the first attempt.

Do **not** delay the whole submission waiting on the $5. Do **not** wait for Chrome before submitting
to the other two.

## 2 · Permission justifications

These must match `/privacy` §7 word for word. Source of truth:
`website/app/privacy/page.js` → `PERMISSIONS`.

| Permission | Why it is needed | When it is used |
|---|---|---|
| `contextMenus` | Adds the "Save to Kipi" entry to the right-click menu — the main way you save a page, link, image, or selection. | On install, to register menu items. |
| `activeTab` + `scripting` | Reads the title, URL, preview image and visible text of the tab you just acted on, so the saved item is searchable. Only runs on that tab, only at that moment. | Only when you save. |
| `tabs` | Needs the URL and title of the tab being saved, and lets the "Open" button on a save-toast focus the right tab. Kipideck does not read your tab list, history, or other tabs. | Only when you save, and only for the tab you acted on. |
| `<all_urls>` (host) | You can save from any website, so the content script has to be able to run anywhere. It does nothing until you act on the page (or until you enable auto-save of selections). | Only on pages you interact with; gated by the capture policy. |
| `storage` + `unlimitedStorage` | Keeps your library, decks, tags, notes and search index on this device. "unlimitedStorage" exists so a large library of saved article text is not truncated by the browser's quota. | Always — this is the local database. |
| `identity` | Only used if you turn on Google Drive sync: it runs Google's own sign-in sheet and holds the token that lets Kipideck read and write your private Drive app-data folder. | Only if sync is enabled. |
| `alarms` | Only used if sync is on: wakes the background script every 10 minutes to push and pull changes. No alarm exists for anything else. | Only if sync is enabled. |
| `notifications` | The small "Saved to Kipideck" toast, and a warning if syncing to your Drive has stopped working. Both can be turned off in Settings. | Only on save, or on a sync failure. |

---

## 3 · Chrome Web Store form answers

### Single purpose

> Kipideck lets you save anything you find on the web — a page, a link, an image, or a piece of
> selected text — and find it again later. That is its only job: capture, organise into decks, and
> search. It has no social features, no feed, no analytics, no advertising and no user accounts.

### Remote code

> **No remote code.** The extension executes only the JavaScript bundled in its own package. No
> script, stylesheet, configuration or template is fetched from the network at runtime and executed.
> The only network requests the extension makes are (a) fetching a site's favicon, once, to cache it
> locally, and (b) — only if the user turns on sync — Google Drive API calls to the user's own
> account. Neither is executed as code.

### Data handling

> Kipideck is local-first and has **no server and no accounts**. All library data — items, page text,
> notes, tags, decks and the search index — is stored on the user's own device in `storage.local` and
> IndexedDB. Nothing is transmitted to the developer.
>
> If, and only if, the user opts in, the extension syncs with **the user's own Google Drive**
> app-data folder, using an OAuth client the user configures themselves (or a first-party client once
> available). The OAuth token is held in the browser and is never sent anywhere except Google. The
> developer cannot read, and has no access to, any user data.
>
> Kipideck collects no analytics, no telemetry, no crash reports and no usage statistics of any kind.

### Privacy policy

> <https://kipideck.vercel.app/privacy>

### Permissions (short form for the "why do you need this" box)

> `contextMenus` and `activeTab`+`scripting` power the right-click save and the capture of the item
> you saved. `<all_urls>` is required because you can save from any website. `storage` and
> `unlimitedStorage` hold the library locally on the device so a large collection of saved article
> text is not truncated. `identity`, `alarms` and `notifications` are used **only** if the user turns
> on optional Google Drive sync (sign-in, periodic sync, and a failure warning); if sync is off they
> are never exercised. `tabs` reads only the URL and title of the tab being saved.

### Data-use disclosure checklist (CWS)

| Question | Answer |
|---|---|
| Collects personally identifiable information? | No |
| Collects web history? | No |
| Collects user activity? | No |
| Collects location? | No |
| Collects website content? | **Yes** — but only what the user explicitly saves, and it is stored **locally on the user's device** and never transmitted to the developer. |
| Sells data to third parties? | No |
| Uses data for purposes unrelated to the single purpose? | No |
| Transfers data outside the extension? | Only to the user's own Google Drive, when the user opts in to sync. To nobody else, ever. |
| Encryption in transit? | Yes — HTTPS for all requests (Drive API, favicon fetch). |
| User can request deletion? | Yes — "Delete everything" in Settings, and uninstalling removes all local data. |

---

## 4 · Listing copy

### Title (max 45 chars)

`Kipideck — Save & Organize` (28 chars)

### Short description (max 132 chars)

> Save pages, links, images and text in one click. Auto-organized, searchable, stored on your own
> device — no account, no server. (127 chars)

**This must be byte-for-byte the `description` in `manifest.json`.** Both stores read the manifest
description and show it on the listing, and Edge caps *that field* at 132 characters too — the first
upload was rejected on a 316-character manifest description while this listing copy was already fine.
A test in `test/wiring.test.js` fails the build if the manifest description goes over 132.

### Full description

Lead with the trust story and the importer. Features come third, because the person reading this has
just lost a library or is worried about losing one.

```
Save anything you find on the web — and keep it, no matter what happens to anyone's servers.

Kipideck is a local-first save tool. Your library lives in your own browser, on your own device.
There is no Kipideck account, no Kipideck server, and nothing you save is ever sent to us. If this
project disappeared tomorrow, the extension you installed would keep working and your library would
still be yours.

ARRIVING FROM POCKET OR OMNIVORE?
Both shut down and deleted their users' libraries. If you still have your export, Kipideck reads it:
Pocket CSV and ril_export.html, Omnivore metadata_*.json and its contents/ article text, Raindrop
backups, Instapaper, Pinboard, Wallabag, Readwise Reader, browser bookmarks and plain URL lists —
13 formats. Your tags, save dates, read state, highlights and annotations come with you.

WHAT IT DOES
• One right-click saves a page, a link, an image, a video, or exactly the text you selected.
• Everything is auto-filed into decks — Reading, Videos, Shopping, Dev & Docs, Research and more.
• Full-text search across everything you have ever saved, not just titles. Works offline.
• Highlighted text can save itself, so a quote becomes an item with a reference to where you found it.
• Duplicate detection: save something you already have and Kipideck offers to open the original.
• Export the whole library any time as JSON, bookmark HTML or Markdown. The schema is published.

OPTIONAL SYNC, ON YOUR TERMS
Turn on sync and Kipideck mirrors your library to a hidden app-data folder in your own Google
Drive. Not ours — yours. Skip it entirely and everything still works, fully offline.

PRIVACY
No account. No analytics. No ads. No tracking. No third-party requests. Favicons are cached locally
rather than fetched from a Google endpoint. Every permission the extension asks for is explained in
the privacy policy, including the ones that stay dormant until you turn on sync.

Works on Chrome, Edge, Brave, Opera and Firefox. Free, with no premium tier.
```

### Category

Productivity

### Language

English

---

## 5 · Screenshot and video shot list

Screenshots: **1280×800**, no browser chrome, no mock data that looks fake.

**Use the screenshot harness** (`tools/screenshots/`) for shots 1–6. It renders the real
`library.html`, `library.css` and `library.js` in a normal browser tab, seeded with a 42-item library,
behind a shim of the handful of `chrome.*` APIs the Library touches:

```bash
# from the repo root
python3 -m http.server 8000
# open http://localhost:8000/tools/screenshots/
```

Pick a scene from the top bar, set the window to 1280×800, press **`H`** to hide the control bar, then
screenshot. Full instructions are in `tools/screenshots/README.md`. Using it matters for two reasons:
a mocked-up screenshot is grounds for rejection, and the harness re-seeds identically on every reload,
so the shots stay consistent if you need to re-take one later.

| # | Shot | Shows | Caption |
|---|---|---|---|
| 1 | Library grid, ~40 real items | The deck sidebar, the card grid, favicons, tags | "Your library, organized into decks — on your own device." |
| 2 | Import dialog, preview step | The ready / already-here / skipped counts **before** anything is written | "See exactly what you're importing — before a single byte is written." |
| 3 | Import progress + "items rescued" | The progress bar and the celebration panel | "20,000 links imported in about a minute." |
| 4 | Search results | A two-word search returning hits, with matched text | "Full-text search across everything you've saved." |
| 5 | Item detail view | Title, domain, saved date, tags, note with a highlight, stored page text | "Highlights and annotations come across as notes." |
| 6 | Onboarding / first-run disclosure | What is captured, what never is, the toggles | "Nothing is captured automatically until you say so." |
| 7 | Export dialog | The three formats with their trade-offs stated | "Leave any time, with everything, in three open formats." |

**Promo video (optional, 30–45 s, no audio):** install → save a page with a right-click → watch it
land in a deck → search for a phrase inside it → open the export dialog. The last frame should be the
three format buttons. The point of the video is "your data is on your device", so finish on export,
not on features.

**Firefox note:** AMO accepts a maximum of 5 screenshots and no video. Use shots 1, 2, 4, 5, 6.

---

## 6 · Per-store differences

### Firefox AMO — **submit first (free)**

- **Cost: free.**
- **⚠ Blocked on one thing:** the gecko id. It is currently a placeholder in
  `tools/firefox-manifest-overlay.json`:
  ```json
  "browser_specific_settings": { "gecko": { "id": "kipideck@example-addon.org", "strict_min_version": "115.0" } }
  ```
  Replace `example-addon.org` with a domain we actually control **before submitting**, and keep it
  stable forever after — changing the gecko id post-publication breaks updates for existing users.
- **Upload `kipideck-extension-firefox.zip`, not `kipideck-extension.zip`** — see §7. The repo's
  `manifest.json` is the Chromium one, and a Chromium package gives Firefox an extension with no
  background context at all.
- AMO runs automated lint. Two things to check in advance:
  - No `eval`, no remote scripts, no `innerHTML` from remote data. (The extension code is clean;
    verify with the linter rather than by eye.)
  - `strict_min_version` must be a real Firefox version — `115.0` (the current ESR baseline) is
    correct.
- Firefox loads unpacked add-ons **temporarily**, which is exactly the sideloading problem this
  document exists to end. AMO submission is the fix.
- AMO accepts a maximum of **5 screenshots and no video** — use shots 1, 2, 4, 5, 6 from §5.
- AMO requires source code submission if any code is minified or built. `lib/browser-polyfill.js` is
  Mozilla's own vendored polyfill and is unmodified — say so in the submission notes.

### Edge Add-ons — **submit second (free)**

- **Cost: free,** but it needs a Microsoft Partner Center enrollment in the Edge program.
- Edge accepts MV3 Chrome packages, and `kipideck-extension-chromium.zip` is built for exactly that
  (see §7 for which zip goes where).
- Edge asks for a "privacy practices" summary — reuse §3 verbatim.

#### What Edge rejected on the first upload (12 September 2026) — and why it cannot happen again

The first package uploaded to Partner Center came back with three hard errors. All three are now
impossible to rebuild, because `npm run package` refuses to write a zip that violates them:

| Edge error | Cause | Fix |
|---|---|---|
| `The string … has exceeded the maximum length of 132` (+ the matching `allOf` error) | the manifest `description` was 316 characters | trimmed to 127 — the same string as the listing below |
| `The background.scripts field cannot be used with manifest version 3` | one manifest tried to serve Chromium and Firefox at once | Chromium `service_worker`, Firefox `scripts` — merged at build time (§7) |

Worth internalising: **Chrome and Edge both load a Manifest V3 extension that carries
`background.scripts` without complaint** (Chrome has ignored the key since 121). The store validator
does not. Local testing cannot catch this class of error, which is why the rules now live in code
(`website/scripts/store-rules.mjs`) and run on every build.

#### Quick fill for the Partner Center form

| Field | Value |
|---|---|
| **Name** | `Kipideck — Save & Organize` |
| **Package** | `website/public/downloads/kipideck-extension-chromium.zip` (v1.5.0, ~145 KB) |
| **Category** | Productivity |
| **Short description** (≤132) | `Save pages, links, images and text in one click. Auto-organized, searchable, stored on your own device — no account, no server.` — **copy it out of `manifest.json`;** the listing and the manifest must not drift. |
| **Full description** | The full description from §4, verbatim. |
| **Privacy policy URL** | `https://kipideck.vercel.app/privacy` |
| **Website / support URL** | `https://kipideck.vercel.app` |

**Privacy practices** — Edge asks these as discrete questions. All answers are the same three facts:

- *Does this extension collect or transmit any user data?* → **No.** All library data stays on the
  user's device. If — and only if — the user opts in, it syncs to **their own** Google Drive.
- *Does it transmit data over the network?* → **Only** (a) a one-time favicon fetch per saved domain,
  cached locally, and (b) Google Drive API calls, only when the user has turned sync on. Nothing is
  sent to the developer.
- *Does it collect personally identifiable information / browsing history / location?* → **No** to all
  three.

**If Edge reviewers ask about `<all_urls>`** — same answer as Chrome, from §1: capture itself would
work on `activeTab` alone, but auto-save of selected text, `Space`+`K`, the duplicate-detection toast
and per-site muting require a script that is already present on the page, because `executeScript` only
fires on a user gesture.

**Two Edge-specific notes:**

- Edge's form fields are shorter than Chrome's. If the full description exceeds the limit, cut from
  the *feature bullets* — never from the trust paragraphs at the top or the "no account, no server"
  lines at the end.
- Edge review tends to be **faster** than Chrome's, which is part of why it goes second rather than
  last: you learn the shape of any objection while it is still cheap to fix.

### Chrome Web Store — **submit last ($5 once)**

- **Cost: $5 one-time** developer registration fee, before you can publish anything. One account
  covers up to ~20 items.
- Upload `website/public/downloads/kipideck-extension-chromium.zip` (regenerate first — see §7).
- Complete the data-use disclosure and the permissions-justification boxes from §2 and §3.
- Expect a review question about `<all_urls>`. Answer with §1, not with a one-liner.

---

## 7 · Packaging: three zips, and which one goes where

`npm run package` (repo root) builds all three into `website/public/downloads/` from one source tree.
They differ only in the manifest inside them and in where `manifest.json` sits:

| Zip | Manifest | `manifest.json` at the zip root? | Upload it to |
|---|---|---|---|
| `kipideck-extension.zip` | Chromium | No — nested under `kipideck/` | **Nowhere.** It is the website download: the folder is so unzipping gives people a folder to point "Load unpacked" at. |
| `kipideck-extension-chromium.zip` | Chromium | **Yes** | **Edge Add-ons** and **Chrome Web Store** |
| `kipideck-extension-firefox.zip` | Firefox | **Yes** | **Firefox AMO** (and temporary sideloading) |

Stores require `manifest.json` at the root of the zip, which is why the two store packages are flat
while the website download is nested.

The single source of truth is the repo's `manifest.json`, which is the **Chromium** manifest.
`tools/firefox-manifest-overlay.json` holds the keys Firefox needs instead
(`background.scripts`, `service_worker: null`, `browser_specific_settings.gecko`), merged in only for
the Firefox package. The split is not cosmetic:

- Chromium's background is `background.service_worker`; the Edge validator **rejects** a Manifest V3
  package that also declares `background.scripts`.
- Firefox's background is a non-persistent event page declared with `background.scripts`
  ([bug 1573659](https://bugzilla.mozilla.org/show_bug.cgi?id=1573659)), and on Firefox < 121 the
  event page never starts at all when `service_worker` is also present
  ([bug 1860304](https://bugzilla.mozilla.org/show_bug.cgi?id=1860304)) — hence deleting the key
  rather than merely adding to it.

Then, before you upload anything:

```bash
npm run package          # rebuild all three
npm run verify:package   # re-check the BUILT zips against the store rules
```

`verify:package` exists because the packager only checks the source: it cannot tell that the zip you
are about to drag into the upload form was built last week from a different branch. It fails loudly on
a missing manifest, a rule violation, a file the manifest points at but the zip does not contain, or
stray files (`.DS_Store`, `.map`, `node_modules`).

## 8 · Pre-submission checklist

Run in order. Do not skip the version bump — a store package still labelled 1.4.0 will be
indistinguishable from the sideload build users already have.

- [ ] **Confirm the privacy policy URL is live.** All three stores require one, and every copy here
      points at `https://kipideck.vercel.app/privacy`. Open it in a browser and check it renders —
      a submission with a dead policy URL is rejected outright. (DNS for `kipideck.vercel.app`
      resolves to Vercel, so this should be a formality, but *check it*.)
- [ ] **Bump the version to 1.6.0** in `manifest.json` (and `package.json`, which mirrors it).
- [ ] Add the 1.5.0 entry to the changelog: importers, three export formats, the refugee pages, the
      shutdown-proof pledge and the published export schema.
- [ ] `npm ci` at the repo root.
- [ ] `npm test` — all 315 tests pass.
- [ ] `npm run check` — tests, `npm run package` **and** `npm run verify:package` together.
- [ ] Confirm all three zips regenerated in `website/public/downloads/`
      (`kipideck-extension.zip`, `kipideck-extension-chromium.zip`,
      `kipideck-extension-firefox.zip`) and that `version.json` reports `1.5.0`.
- [ ] Upload the **right** zip to each store — `…chromium.zip` to Edge and Chrome,
      `…firefox.zip` to AMO (§7). Uploading the website zip to a store is the one mistake
      `verify:package` cannot catch for you.
- [ ] `cd website && npm run build` — all routes build static, including the four new pages.
- [ ] Open every route once and click every internal link (the footer of every page links to all
      four new pages; a 404 there is the most likely regression).
- [ ] Re-read `/privacy` §7 against §2 of this document. They must match.
- [ ] **Replace the Firefox gecko placeholder domain with one we control**, and never change it again
      afterwards (see §6). This is the one item that blocks AMO outright.
- [ ] Capture the screenshots from the harness, from a real seeded library, not an empty one.
- [ ] **Submit in cost order: Firefox (free) → Edge (free) → Chrome ($5).**
- [ ] Record the date and the variant shipped (`<all_urls>` or optional-host) below, as you go.

### Submission log

| Date | Store | Version | Cost | Variant | Status |
|---|---|---|---|---|---|
| — | Firefox AMO | 1.5.0 | Free | `<all_urls>` | not yet submitted — **blocked on the gecko id** |
| 2026-09-12 | **Edge Add-ons** | 1.5.0 | Free | `<all_urls>` | 🔴 **rejected at package validation** — 316-char manifest `description` + `background.scripts` under MV3. Fixed same day; all three rules now fail `npm run package`. Resubmit with `kipideck-extension-chromium.zip`. |
| — | Chrome Web Store | 1.5.0 | $5 once | `<all_urls>` | not yet submitted — needs the registration fee |

**If Edge comes back with a rejection or a question, record it here before fixing it.** The same
objection will very likely be raised by Chrome, and Chrome's review is slower — so an Edge objection
is a free early warning. Note the date, the reviewer's wording, and what we changed in response.

### What I cannot do for you

Three steps in this checklist are not code, so they are not done and cannot be done from a repository:

1. **Pay the $5** and register the Chrome developer account.
2. **Choose the domain** for the Firefox gecko id — it has to be a domain you control.
3. **Take the screenshots.** The harness makes it a 10-minute job, but it needs a real browser.
