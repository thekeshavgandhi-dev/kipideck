# Kipideck website (Next.js)

The marketing + install + docs site for Kipideck, built with **Next.js 16** (App
Router) + React 19 — the framework Vercel makes, so deploying it there is
zero-config.

**Important: visitors never see GitHub.** The site serves the extension as a
direct `.zip` download (packaged automatically at build time) and its
**Open My Deck** buttons talk to the visitor's *installed* extension to open
*their own* library (local items + their Google Drive synced items).

## Pages

| Route | What it does |
|---|---|
| `/` | Landing page: hero with **⬇ Add to Chrome** (downloads the `.zip`) + **📂 Open My Deck** (opens the user's library if installed), features, sync overview, and 1-minute install steps for Chromium + Firefox |
| `/deck` | Detects the installed extension, shows the user's saved-item count, and opens their library — or guides new visitors to download + install |
| `/sync-setup` | The full Google Drive sync guide (no external links needed) |
| `/downloads/kipideck-extension.zip` | The installable extension package (auto-generated, see below) |
| `/downloads/version.json` | `{ version, sizeKB, builtAt }` for the download card |

## How the download works (no GitHub, no store needed)

1. `scripts/build-extension-zip.mjs` zips the extension source from the repo root
   (`manifest.json`, `background/`, `content/`, `lib/`, `popup/`, `library/`,
   `icons/`) into `public/downloads/kipideck-extension.zip`, plus a
   `public/downloads/version.json` sidecar.
2. It runs automatically as the `prebuild` / `predev` npm script — including on
   Vercel, which clones the full repo before building inside `website/`, so the
   `../` extension sources are available at build time.
3. A committed copy of the `.zip` is also kept in git (allow-listed in the root
   `.gitignore`) as a fallback, so `/downloads` works even if packaging ever fails.
4. `vercel.json` serves the `.zip` with `Content-Disposition: attachment` so
   browsers download it instead of navigating to it.

Regenerate locally any time with:

```bash
cd website
npm run package-extension
```

## How "Open My Deck" works (website → extension bridge)

The website itself can never read extension data (different origin/storage). Instead:

1. The extension's content script (`content/content.js`) runs on every page —
   including this site — and sets `window.__KIPIDECK_INSTALLED__`, a
   `data-kipideck-installed` DOM marker, and answers `KIPIDECK_PING` messages.
2. `app/components/kipideck-bridge.js` detects that marker and sends
   `KIPIDECK_OPEN_LIBRARY` / `KIPIDECK_GET_COUNT` requests.
3. The content script forwards them to the background script
   (`KIPI_OPEN_LIBRARY` → opens `library/library.html` with the user's merged
   local + Drive data; `KIPI_GET_COUNT` → saved-item count).

## Deploy to Vercel

**Option A — Vercel dashboard (recommended):**
1. Go to <https://vercel.com/new> and import this GitHub repo.
2. When asked for the **Root Directory**, set it to `website`.
3. Framework preset: Vercel auto-detects **Next.js** — leave build/output
   settings on their defaults (`npm run build`, `.next`).
4. Deploy — you'll get a `https://your-project.vercel.app` URL immediately.

**Option B — Vercel CLI:**
```bash
cd website
npx vercel        # first deploy, follow the prompts
npx vercel --prod # promote to production
```

No environment variables are required — this site has no backend calls.

## Local development

```bash
cd website
npm install
npm run dev
# open http://localhost:3000
# the extension .zip is packaged automatically by the `predev` hook
```

## Production build (what Vercel runs)

```bash
cd website
npm install
npm run build   # packages the extension .zip first, then builds Next.js
npm run start   # optional local check of the production build
```

## Structure

```
website/
├── app/
│   ├── layout.js         Root layout + <head> metadata
│   ├── page.js            Landing page (download + open-deck CTAs, install steps)
│   ├── deck/page.js       "Open My Deck" detector/opener page
│   ├── sync-setup/page.js Google Drive sync guide (self-contained, no GitHub)
│   ├── components/        DownloadButton, OpenDeckButton, DeckOpener,
│   │                      VersionPill, kipideck-bridge helpers
│   └── globals.css        Styling
├── scripts/
│   └── build-extension-zip.mjs  Packages ../ extension sources → public/downloads/
├── public/
│   ├── favicon.ico
│   ├── assets/            Logo + hero screenshot
│   └── downloads/         kipideck-extension.zip + version.json (generated)
├── next.config.mjs
├── package.json
└── vercel.json            Security headers + .zip download headers
```
