# Kipideck landing website

A static marketing/docs page for Kipideck — no backend, no build step.
Deploys straight from this folder.

## Deploy to Vercel

**Option A — Vercel dashboard (easiest):**
1. Go to <https://vercel.com/new>, import this GitHub repo.
2. When asked for the **Root Directory**, set it to `website`.
3. Framework preset: **Other** (it's plain static HTML/CSS).
4. Deploy — you'll get a `https://your-project.vercel.app` URL immediately.

**Option B — Vercel CLI:**
```bash
cd website
npx vercel        # first deploy, follow the prompts
npx vercel --prod # promote to production
```

## Local preview

```bash
cd website
python3 -m http.server 8080
# open http://localhost:8080
```

## Structure

```
website/
├── index.html     Landing page: hero, features, how-it-works, browsers, sync, install
├── styles.css     Styling
├── assets/        Logo + hero screenshot
└── vercel.json    Deployment config (clean URLs, security headers)
```

Update the GitHub links in `index.html` if the repo ever moves, and swap
in real Chrome Web Store / Firefox Add-ons links under the "Get Kipideck"
section once the extension is published to those stores.
