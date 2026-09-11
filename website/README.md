# Kipideck website (Next.js)

The marketing/docs landing page for Kipideck, built with **Next.js 16** (App
Router) + React 19 — the framework Vercel makes, so deploying it there is
zero-config. The whole page is statically prerendered at build time (no
server-side runtime needed), so hosting is as simple and fast as a static
site while still giving you the option to add dynamic routes/API endpoints
later without changing platforms.

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

No environment variables are required — this page has no backend calls.

## Local development

```bash
cd website
npm install
npm run dev
# open http://localhost:3000
```

## Production build (what Vercel runs)

```bash
cd website
npm install
npm run build   # -> "✓ Generating static pages" — the whole site is static
npm run start   # optional local check of the production build
```

This has been verified to build cleanly with **zero npm audit
vulnerabilities** (`next@16.3.5`, `react@19.3.0`, `react-dom@19.3.0` — all
current patched releases) and to fully static-prerender (`○ /` in the
build output), which is the least error-prone way to deploy on Vercel.

## Structure

```
website/
├── app/
│   ├── layout.js     Root layout + <head> metadata (title, description, OG image, favicon)
│   ├── page.js        The landing page itself (hero, features, how-it-works, browsers, sync, install)
│   └── globals.css    Styling
├── public/
│   ├── favicon.ico
│   └── assets/        Logo + hero screenshot
├── next.config.mjs
├── package.json
└── vercel.json        Security headers
```

Update the GitHub links in `app/page.js` if the repo ever moves, and swap
in real Chrome Web Store / Firefox Add-ons links under the "Get Kipideck"
section once the extension is published to those stores.
