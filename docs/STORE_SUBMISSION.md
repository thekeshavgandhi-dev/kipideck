# Store submission

**Applies to:** v1.5.0 · **Last updated:** 12 September 2026 · **Targets:** Chrome Web Store, Edge Add-ons, Firefox AMO

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

> Save pages, links, images and text in one click. Auto-organized, searchable, and stored on your
> own device — no account, no server. (131 chars)

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

Screenshots: 1280×800, no browser chrome, no mock data that looks fake — import a real export first.

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

### Chrome Web Store

- Upload `website/public/downloads/kipideck-extension.zip` (regenerate first — see §7).
- Complete the data-use disclosure and the permissions-justification boxes from §2 and §3.
- Expect a review question about `<all_urls>`. Answer with §1, not with a one-liner.

### Edge Add-ons

- The same `.zip` works unchanged; Edge accepts MV3 Chrome packages.
- Listing copy can be identical. Shorten the full description to fit Edge's field limits if required.
- Edge asks for a "privacy practices" summary — reuse §3 verbatim.

### Firefox AMO

- **Needs the gecko id.** It is already present in `manifest.json`:
  ```json
  "browser_specific_settings": { "gecko": { "id": "kipideck@example-addon.org", "strict_min_version": "115.0" } }
  ```
  Replace the placeholder `example-addon.org` domain with a domain we actually control **before
  submitting**, and keep it stable — changing the gecko id after publication breaks updates for
  existing users.
- AMO runs automated lint. Two things to check in advance:
  - No `eval`, no remote scripts, no `innerHTML` from remote data. (Extension code is clean; verify
    with the linter rather than by eye.)
  - `browser_specific_settings.gecko.strict_min_version` must be a real Firefox version — `115.0`
    (the current ESR baseline) is correct.
- Firefox loads unpacked add-ons **temporarily**, which is exactly the sideloading problem this
  document exists to end. AMO submission is the fix.
- AMO requires source code submission if any code is minified or built. `lib/browser-polyfill.js` is
  Mozilla's own vendored polyfill and is unmodified — say so in the submission notes.

---

## 7 · Pre-submission checklist

Run in order. Do not skip the version bump — a store package still labelled 1.4.0 will be
indistinguishable from the sideload build users already have.

- [ ] **Bump the version to 1.5.0** in `manifest.json` (and `package.json`, which mirrors it).
- [ ] Add the 1.5.0 entry to the changelog: importers, three export formats, the refugee pages, the
      shutdown-proof pledge and the published export schema.
- [ ] `npm ci` at the repo root.
- [ ] `npm test` — all 315 tests pass.
- [ ] `npm run check` — tests **and** `npm run package` together.
- [ ] Confirm the zip regenerated: `website/public/downloads/kipideck-extension.zip`, and that
      `version.json` reports `1.5.0`.
- [ ] `cd website && npm run build` — all routes build static, including the four new pages.
- [ ] Open every route once and click every internal link (the footer of every page links to all
      four new pages; a 404 there is the most likely regression).
- [ ] Re-read `/privacy` §7 against §2 of this document. They must match.
- [ ] Replace the Firefox gecko placeholder domain with one we control.
- [ ] Capture the seven screenshots from a real library, not an empty one.
- [ ] Submit to Chrome Web Store first — it has the longest review — then Edge, then AMO.
- [ ] Record the submission date and the variant shipped (`<all_urls>` or optional-host) below.

### Submission log

| Date | Store | Version | Variant | Status |
|---|---|---|---|---|
| — | Chrome Web Store | 1.5.0 | `<all_urls>` | not yet submitted |
| — | Edge Add-ons | 1.5.0 | `<all_urls>` | not yet submitted |
| — | Firefox AMO | 1.5.0 | `<all_urls>` | not yet submitted |
