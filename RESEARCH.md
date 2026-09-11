# Kipideck — Competitive Research & Market Analysis

**Date:** 2026-09-11 · **Author:** Arena Agent Mode (web research + codebase audit)
**Companion doc:** [`ideas.md`](./ideas.md) — the prioritized plan to beat every competitor below.

> Method: full audit of this repo (extension code, classifier, search, sync, library UI, website)
> + web research across review sites (MakerStack, Marqly, ToolRadar, Capterra, Chrome Web Store,
> App Store), Reddit communities (r/readwise, r/raindropio, r/PKMS, r/productivity, r/instapaper),
> comparison roundups (2025–2026, post-Pocket-shutdown), and indie review blogs. Key sources are
> linked in §8.

---

## Table of contents

1. [Kipideck internal analysis](#1-kipideck-internal-analysis)
2. [Market landscape — category map](#2-market-landscape--category-map)
3. [Competitor deep dives](#3-competitor-deep-dives)
4. [What users complain about — cross-market pain synthesis](#4-what-users-complain-about--cross-market-pain-synthesis)
5. [Market gaps & opportunities](#5-market-gaps--opportunities)
6. [Feature comparison matrix](#6-feature-comparison-matrix)
7. [SWOT](#7-swot)
8. [Sources](#8-sources)

---

## 1. Kipideck internal analysis

### 1.1 What it is today (v1.2.0, from the code)

A Manifest-V3, local-first browser extension + library dashboard + Next.js marketing site:

| Layer | Implementation |
|---|---|
| Capture | Right-click context menu (page / link / selection / image / video), floating selection bubble, toolbar popup (save page + quick note), shortcuts `Ctrl/⌘+Shift+K/L` |
| Page text | `lib/extract.js` — TreeWalker over `<article>/<main>/body`, skips nav/ads/scripts, caps at 20k chars |
| Auto-organize | `lib/classify.js` — offline regex classifier: type + ~6 domain rules + ~7 keyword rules → 1 of 9 decks + tags |
| Search | `lib/search.js` — in-memory inverted index, field-weighted ranking (title 6 > tags 5 > excerpt/note 3 > domain 2 > content 1), prefix matching, `tag:`/`site:` operators, match snippets |
| Storage | `browser.storage.local` (`items`, `decks`, `settings`, deletion tombstones), JSON export/import |
| Sync (opt-in) | `lib/drive-sync.js` — user's **own** Google Drive appData folder, OAuth implicit flow via `launchWebAuthFlow`, record-level last-write-wins + tombstones, 10-min alarm + sync-on-save |
| Library UI | Decks sidebar + counts, tag cloud, search, grid/list views, sort, detail editor (title/deck/tags/note/pin), multi-select bulk ops, settings, sync UI |
| Compat | `browser.*` API + vendored Mozilla polyfill; dual `service_worker`+`scripts` background keys → Chrome, Edge, Brave, Opera, Firefox from one codebase |
| Distribution | Direct `.zip` download from own site (auto-packaged at build), sideload instructions; **not yet in any extension store** |

### 1.2 Genuine strengths (verified in code, rare in market)

1. **Truly local-first & free.** Works offline at install, no account, no server, no paywall on any current feature. Almost every competitor requires an account; most paywall search, sync, or AI.
2. **Full-text search is free and good.** Field-weighted + prefix + operators + snippets. Raindrop, Instapaper, Evernote all paywall full-text search.
3. **Auto-organize out of the box.** 9 smart decks + auto-tags with zero config. Instapaper = manual folders only; Chrome/Edge/Safari built-ins = zero organization.
4. **Capture breadth.** Page + link + selection + image + video + note + floating bubble + shortcuts in one tool. Most rivals do 1–2 of these.
5. **BYO-cloud sync = zero server cost + privacy story.** No competitor uses this exact model; it makes Kipideck *structurally shutdown-proof* (see §5 — this is the #1 emotional wedge after Pocket/Omnivore died).
6. **5-browser support, one codebase.** Firefox support alone beats mymind (no Firefox ext), Toby-era tools, and every Apple-only app (GoodLinks, Reeder).
7. **Tiny & fast.** No framework in the extension; <100KB download.

### 1.3 Weaknesses / gaps (honest, ranked by damage)

| # | Gap | Why it hurts |
|---|---|---|
| 1 | **No mobile app / mobile capture** | Every serious rival has iOS/Android + share-sheet save. A large share of saving happens on phones. This is the single biggest adoption blocker. |
| 2 | **Sync setup requires a BYO Google OAuth client ID** | A Google Cloud Console developer flow — 95%+ of normal users will never complete it. Sync might as well not exist for them. |
| 3 | **Not in extension stores** | Sideloading ("Load unpacked", Firefox temp add-on that vanishes on restart) kills conversion and trust. |
| 4 | **No reader view** | Kipideck *saves* full text but never renders a clean reading experience. All read-it-later rivals lead with this. |
| 5 | **No in-page highlighting/annotation** | Diigo/Glasp/Weava/Hypothesis/Readwise own this; Kipideck saves selections as new items instead of annotating the source. |
| 6 | **No AI layer** | No summaries, no semantic search, no smart tagging (current classifier is ~13 regexes, English-only). 2026 buyers expect at least summaries. |
| 7 | **No archive snapshot → link rot** | Saves 20k chars of text; images are hotlinks; pages change/die. Raindrop Pro, Linkwarden, Wallabag archive full pages. |
| 8 | **No PDF / newsletter / RSS / YouTube support** | Readwise/Matter/Cubox ingest these; researchers/live-learners need them. |
| 9 | **No recall engine** | No resurfacing, digests, spaced repetition, serendipity, TTS/audio. The "read-it-never graveyard" problem (§4.3) is unaddressed. |
| 10 | **No importers** | Can't ingest Pocket HTML export, Instapaper CSV, Raindrop export, browser bookmarks — blocks refugee migration, the #1 2025–26 growth wave. |
| 11 | **Sync robustness gaps** | Implicit-flow token expires hourly with no refresh (`SESSION_EXPIRED`); single-JSON-snapshot upload won't scale to 10k-item libraries; record-level merge only; no E2E encryption. |
| 12 | **Small privacy/quality leaks** | Favicons fetched from `google.com/s2` (tracks domains, fails offline); `<all_urls>` content script will scare store reviewers/users; no duplicate detection; classifier adds junk tags (`domain.split('.')[0]`). |
| 13 | **No sharing/collaboration, no integrations** | No public boards, no Notion/Obsidian export, no API, no teams. |
| 14 | **No Safari build, no onboarding, no telemetry** | Safari needs a Mac+Xcode conversion; first-run UX is empty; zero usage data for decisions. |

---

## 2. Market landscape — category map

The "save anything online" market has fragmented into 8 sub-categories. Kipideck sits between **bookmark managers** and **read-it-later**, which is exactly where the Pocket-refugee demand is:

```
READ-IT-LATER (articles)          BOOKMARK MANAGERS (everything)
  Instapaper, Matter,               Raindrop.io, Diigo, Start.me,
  Readwise Reader, GoodLinks,       Pinboard, Linkwarden, Shiori
  Reeder, Wallabag, Readeck            ▲
        ▲                              │
        └────── ★ KIPIDECK ★ ──────────┘
              (save-anything + auto-organize)

AI-FIRST SAVE-EVERYTHING          HIGHLIGHTERS / ANNOTATORS
  Recall, Fabric, mymind,           Glasp, Weava, Liner,
  Marqly, Cubox, Ultrathink,        Hypothesis, Zotero
  Sensefold, MarkIt

NOTE-TAKER CLIPPERS               TAB / SESSION MANAGERS
  Evernote, Notion, Obsidian,       Toby, OneTab, Session Buddy,
  Apple Notes, OneNote              Tab Manager Plus, Marqly Tab Saver

SELF-HOSTED / OPEN SOURCE         BROWSER BUILT-INS (free, default)
  Wallabag, Karakeep, Linkwarden,   Chrome Reading List, Edge Collections,
  Shiori, LinkAce, ArchiveBox,      Safari Reading List, Firefox (Pocket removed)
  Readeck, Heimdal (Omnivore fork)
```

**Market shocks that redefined everything:**
- **Pocket shut down July 8, 2025** (Mozilla; exports/API killed Nov 12, 2025, all data deleted). 20M+ registered users, 2B+ saves displaced. The largest forced migration in the category's history.
- **Omnivore shut down Nov 15, 2024** (ElevenLabs acquihire). Open-source code abandoned; Obsidian/Logseq plugins broke; 2-week export window, then data deleted.
- Net effect: **trust is the scarcest commodity.** Users now actively ask "will this shut down and delete my stuff?" — a question Kipideck's architecture answers better than anyone (see §5.1).

---

## 3. Competitor deep dives

Legend: 💰 pricing · ⭐ rating (with source) · ✅ strengths · ❌ verified complaints · 🎯 lesson for Kipideck.

### 3.1 Read-it-later apps

**Readwise Reader** — the power-reader leader.
💰 No free tier (30-day trial only); Full plan **$9.99/mo annual** (~$120/yr; Lite $5.59/mo does *not* include Reader — a constant confusion). ⭐ 4.8/5 (AI-for-Business, 1180 ratings) but 3.5/5 value-adjusted (NubiaPage).
✅ Everything-in-one-inbox (articles, PDFs, newsletters, RSS, ebooks, YouTube transcripts); best highlight→PKM pipeline (Obsidian/Notion); Ghostreader AI; spaced repetition; best Pocket import (6/6 score).
❌ Price is the #1 complaint across Reddit ("too expensive for casual readers", "can't justify $100/yr"); confusing tier split; overwhelming onboarding; mobile sync lag; weak scanned-PDF handling; no RSVP/speed-reading; review backlog feels "demoralising"; review habit required or it's "an elaborate inbox".
🎯 *Beat on: free tier + simplicity + price. Reader proves the ceiling of what readers will pay — Kipideck should own everything below it.*

**Matter** — the polished iOS-first reader.
💰 Generous free tier; Premium ~**$8–9/mo or $60/yr**. Still operating (free + Premium; slow release cadence).
✅ Beautiful reading + listening (TTS) experience; newsletter + RSS support; 2-tap Pocket import; "Welcome Pocket Readers" campaign; Obsidian highlight sync.
❌ **No Android app** — the single most common complaint, a dealbreaker; parsing hiccups (missing images, scrambled captions); audio/playback reliability gripes; Readwise integration broken 1+ year with no fix; support unresponsive; features moved free→paid annoyed users; app crashes reported on recent versions.
🎯 *Beat on: Android + reliability + support responsiveness. Matter shows polish wins iOS — Kipideck needs a reader view before it can compete here at all.*

**Instapaper** — the minimalist classic (est. ~2008).
💰 Free unlimited saves; Premium **~$4–6/mo ($40–60/yr)** — price doubled in 2025. ⭐ 3.5/5 (Marqly 2026).
✅ Calmest reading UX; offline; Kindle/Kobo (only native Kobo sync); TTS + speed-read on Premium; stable.
❌ Folders-only organization (no tags, no auto-organize — "organizes your guilt beautifully"); search paywalled + literal keyword-only; essentially no AI; glacial development ("unchanged since 2012"); TTS crashes; paywalled-article capture breaks; notes UX fragments highlights into separate notes; image display bugs.
🎯 *Beat on: auto-organization + free search + any AI at all. Instapaper is the "do-nothing incumbent" — easiest to outflank on features while matching its calm.*

**GoodLinks / Reeder** — Apple-only minimalists.
💰 One-time ~**$9.99** (+ small add-ons). ✅ Native, fast, private (iCloud sync), no subscription. ❌ Apple-only; no AI; basic highlights; no Android/web parity.
🎯 *Beat on: cross-platform + free. Their fans are subscription-averse — Kipideck's free-forever core is the pitch.*

### 3.2 Bookmark managers (Kipideck's closest ring)

**Raindrop.io** — the default Pocket replacement; closest direct competitor.
💰 Free: unlimited bookmarks/collections/devices (!); Pro **~$28–38/yr (~$3/mo)**. ⭐ 8.2/10 (MakerStack).
✅ Best-value in category; visual collections; tags + nested collections; cross-platform + mobile; Pocket import; Stella AI (Pro); web archive (Pro).
❌ Best features paywalled (full-text search, permanent library, AI tagging); free upload cap 100MB/mo; **support is "a total joke"** (billing tickets unanswered 1+ month; duplicate charges; "Internal Server Error" on Pro activation); search result inconsistencies; Safari extension unreliable; saves default to "Unsorted" (manual filing every time); tag-autocomplete regression; learning curve; weak/no offline.
🎯 *Beat on: free full-text search (already done!), auto-filing (their #1 UX complaint), support, offline. Raindrop is the competitor to position against most explicitly.*

**Diigo** — the veteran research bookmarker.
💰 Free caps (1000 bookmarks / 200 highlights / 50 images + ads); paid tiers above. ⭐ 7.3/10 (MakerStack).
✅ Unmatched bundle for researchers: in-page highlight + sticky notes + cached pages + outliners, cheap.
❌ Dated, clunky UI ("not super modern or user-friendly"); mouse-dependent, poor keyboard support; no offline; free full-text search absent (tag-only search on free); premium "a little pricey".
🎯 *Beat on: modern UX + free search + offline. Copy its annotation bundle eventually — it's the only cheap all-in-one for researchers.*

**Pinboard / Start.me** — simple/old-school.
💰 Pinboard ~$22/yr, no free tier. ❌ Outdated UI, basic search, no official mobile apps, no AI. ✅ Simple, private, fast, cheap.
🎯 *Beat on everything except simplicity — and match that with Kipideck's zero-config default.*

### 3.3 AI-first save-everything (the 2026 wave)

**Recall** — deepest raw AI. 💰 Free: 10 AI summaries; Plus **$10/mo** (unlimited summaries, auto-categorize, AI Q&A). ✅ 2-hr video → summary in ~30s w/ timestamps; articles/PDFs/podcasts; knowledge graph; multi-model chat; spaced quizzes. ❌ Price; chat-app capture missing.
**mymind** — the beautiful private canvas. 💰 **No permanent free plan**; $7.99–12.99/mo ($72–129/yr); Bookmarker $4.99/mo "a trap" (no AI = pointless). ⭐ 3.8/5. ✅ Gorgeous; zero-organizing philosophy; good AI tagging; privacy stance. ❌ Price (#1 complaint); **lose access to your saves if you cancel** (account suspended — widely hated); weak long-form retrieval ("show me that red sneaker" ✓, "the article about remote work" ✗); thin import/export; gallery-view-only; iOS bugs; no Firefox extension; Google/Apple-login-only signup.
🎯 *mymind proves users will pay for "no organizing required" — Kipideck's auto-decks are the free version of that promise. And its cancel-loses-data policy is the anti-pattern to advertise against.*
**Fabric / Marqly / Cubox / Ultrathink / Sensefold / MarkIt** — fast-moving AI challengers ($5–10/mo, free tiers mostly capped at 10–50 items). Common pattern: strong demos, capped free tiers, cloud-locked data, small teams (shutdown risk), chat/WhatsApp capture emerging (MarkIt), semantic search standard.
🎯 *Beat on: free depth + local-first privacy + survival-proof architecture. Match: semantic search + summaries (via on-device/local AI to keep $0 cost).*

### 3.4 Highlighters / annotators

**Glasp** (social highlighter) ⭐ 4.5/5 (971 Chrome Store ratings). ✅ Generous free tier. ❌ Cluttered, hard-to-navigate UI; private highlights + >5 PDFs paywalled; forced AI features w/ data-use concerns; shortcut bugs; login delays.
**Weava** ⭐ **5.7/10 and falling** (Tooltivity, re-tested down from 6.5). ❌ **Highlights disappearing (data loss!)**, PDF upload failures, signup loop, **no working way to cancel + no support reply**. A case study in how reliability + support kill a tool.
**Liner / Hypothesis / Zotero** — Liner: limited free tier, cloud/privacy concerns, needs internet. Hypothesis: annotation-only, academic niche. Zotero Connector: free, snapshots decent for academic pages, weak on JS-heavy/modern pages, useless without Zotero.
🎯 *In-page annotation is Kipideck's biggest capture gap — but Weava/Glasp show the bar is low: reliable + private + free basics wins.*

### 3.5 Note-taker clippers

**Evernote Web Clipper** — still "best-in-class" capture quality, but the mothership is burning: Bending Spoons gutted Free (50 notes / 1 notebook / 1 device), Personal ~$15/mo; Chrome Store recent reviews: "Doesn't work, and hasn't for a while", "only getting worse", Chromebook support dropped. ⭐ 6.5/10 (MakerDeck).
**Notion Web Clipper** — official clipper reconstructs pages into blocks; persistent complaint: **saved content needs manual cleanup** on anything but clean articles; no citation metadata; minimal development; third-party clippers surpassed it.
**Obsidian Web Clipper** — clean Markdown via Readability-style extraction; free. ❌ Obsidian-only destination; no citation formatting; mobile limitations (no extensions in Chrome/Brave mobile); occasional settings glitches.
🎯 *Every note-taker clipper is either dying, mediocre, or locked to its mothership. Kipideck as the neutral, high-quality capture layer + one-click export to all of them is an open lane.*

### 3.6 Tab / session managers (adjacent, overlapping users)

**Toby** — new-tab visual workspaces. ❌ No bookmark import (!), account required for features.
**Session Buddy** — single-machine sessions; **no cross-device sync**; **recurring "saved sessions vanished" reports**; doesn't preserve Chrome tab groups; overwhelming UI. Value 8.5/10 but Performance 5.5/10 (Tooltivity).
**OneTab** — one-click tab collapse. ❌ **No automatic backup — data loss risk**; no workspaces/projects.
🎯 *"Save all tabs to a deck" + auto-backup would absorb this entire adjacent use case with ~1 week of work.*

### 3.7 Self-hosted / open source

| Tool | Pitch | Catch |
|---|---|---|
| **Wallabag** | Most mature Pocket clone; clean reader; hosted €11/yr | Dated UX, PHP setup, no AI |
| **Karakeep** | AI auto-tag/summarize (OpenAI or local Ollama); apps; cloud beta | Docker+LLM-key setup; archive fails on login-walled sites; cloud free = 10 items (a trial) |
| **Linkwarden** | Best archival (auto PDF + screenshot of every page); collections | Setup effort; limited AI |
| **Shiori / Readeck** | Single-binary, 5-min setup | No AI, minimal features |
| **ArchiveBox** | True multi-format web archiving | Heavy setup, overkill for most |
| **Heimdal** | Community Omnivore fork | Early, no e-reader support yet |

🎯 *Self-hosters accept pain for ownership. Kipideck already gives ownership with zero setup — message it as "self-hosted privacy without the server". Karakeep validates local-LLM tagging — Kipideck can do on-device AI with no server at all.*

### 3.8 Browser built-ins (the "do nothing" competitor)

- **Chrome Reading List**: add from menu, basic offline cache; ❌ no organization, no search, no tags, profile/account-locked sync, no cross-browser, interactive/login pages fail offline.
- **Edge Collections**: manual cards/notes, syncs via MS account; ❌ fully manual, no offline download, Edge-only.
- **Safari Reading List**: Apple-only, offline OK; ❌ no organization/search of note, no extension parity.
- **Firefox**: Pocket integration removed with the shutdown; nothing first-party left.
🎯 *Built-ins win on zero friction and lose on everything else. Kipideck must match their friction (1-click save, zero setup) while beating them on find-it-again — that's the whole game.*

---

## 4. What users complain about — cross-market pain synthesis

Ranked by frequency × intensity across all sources above:

1. **Subscription fatigue.** $8–13/mo per app, stacked across 5+ apps. "Can't justify $100/yr" (Readwise), "annual cost = a month of groceries" (mymind), free tiers gutted (Evernote, mymind). One-time-purchase fans (GoodLinks) are vocal and growing.
2. **Shutdown trauma & data hostage-taking.** Pocket + Omnivore deleted everything. mymind suspends access on cancel. Weava/Session Buddy lose data to bugs. Users now ask: *"Can I export everything? What happens if you die / I stop paying?"* — before they ask about features.
3. **The read-it-never graveyard.** ~70% of saves never reopened (Readless); guilt → app avoidance → churn. Only Readwise (habit-required, $120/yr) and Burn 451 (24h auto-delete triage) address it; everyone else is "a pile with search".
4. **Manual organizing burden.** Instapaper folders-only, Raindrop "Unsorted"-by-default, Edge Collections fully manual. Users want auto-file + auto-tag (mymind's appeal, Recall's auto-categorize).
5. **Search that can't find.** Paywalled (Raindrop, Instapaper, Evernote free), keyword-literal everywhere except AI tier, inconsistent results (Raindrop), tag-only on free (Diigo). Users describe articles by meaning; tools match by string.
6. **Broken capture.** Paywalled articles (Instapaper), JS-heavy pages (Zotero), cookie-consent text in clips (generic clippers), formatting corruption (Notion), missing images/captions (Matter), login-walled archive fails (Karakeep).
7. **Data-loss bugs.** Weava highlights vanishing, Session Buddy sessions gone after updates, OneTab no-backup, sync conflicts resurrecting deletes (everyone without tombstones — Kipideck already handles this).
8. **Platform gaps.** No Android (Matter), no Firefox (mymind), Apple-only (GoodLinks/Reeder), no mobile capture, desktop-only sync.
9. **Cloud/account dependence.** Forced logins, no offline (Raindrop partial, Liner, Weava), privacy fears (Glasp AI data use, Evernote history).
10. **Support black holes + billing pain.** Raindrop (months, duplicate charges), Matter (integration broken 1yr+), Weava (can't cancel), Evernote (price up, quality down).
11. **Import/export lock-in.** Thin export (mymind: spreadsheet of URLs, no content/summaries, random PDF names), no Pocket-HTML importers in young tools, Pinboard archive download broken.
12. **Complexity & clutter.** Readwise onboarding overwhelm, Glasp cluttered UI, Session Buddy option overload, Diigo dated density.
13. **Link rot.** Saved URLs die; only Pro/paid archives (Raindrop Pro, Linkwarden) or heavy self-host (ArchiveBox) solve it.
14. **No recall/surfacing.** Beyond Readwise's expensive loop and mymind's unused Serendipity, nobody resurfaces saves. Users forget what they saved = tool feels worthless over time.
15. **Audio/TTS gap.** Commuters want listen-to-my-saves; implementations crash (Instapaper), wobble (Matter), or cost extra (Speechify).

---

## 5. Market gaps & opportunities

**5.1 The #1 opening: "the save-everything tool that can't shut down."**
Pocket (20M users) + Omnivore died within a year of each other. Every competitor is a VC-or-subscription-backed cloud that can do the same. Kipideck is local-first with BYO-cloud sync — *there is no Kipideck server to shut off*. No rival can credibly claim this. This should be the headline position.

**5.2 The refugee migration window is still open (2025–26).**
Millions are mid-migration. Winners added Pocket import + "Welcome Pocket Readers" banners (Matter, Readwise 6/6 import score). Kipideck has **no importer at all** — the single highest-ROI growth feature.

**5.3 Free full-text search + auto-organize is an unoccupied corner.**
The two most-loved capabilities are paywalled almost everywhere (Raindrop Pro, Instapaper Premium, Evernote paid). Kipideck already ships both free. Nobody else can say "unlimited saves, auto-organized, full-text searchable, free forever, no account".

**5.4 The trust stack is a feature checklist:** one-click full export (JSON + HTML + Markdown) · readable local data · no account required · published "if we disappear" guarantee · open data format. Each item converts shutdown-traumatized users.

**5.5 AI expectations without AI prices.**
Users expect summaries + semantic search (Recall/Fabric set the bar) but hate $10/mo. On-device AI (Chrome built-in Prompt API, Transformers.js embeddings, local Ollama-optional like Karakeep) lets Kipideck ship AI with $0 marginal cost — a moat subscription tools can't follow down-market.

**5.6 Capture quality is everyone's Achilles heel.**
Paywalls, cookie walls, JS-heavy pages, login-walled content. A clipper that captures *what the user sees* (DOM-level, post-render, with credentials) + archives snapshots beats server-side fetchers (Instapaper, Karakeep) structurally.

**5.7 Mobile capture is table stakes.**
Share-sheet → save on iOS/Android. Without it, Kipideck loses every phone-heavy user regardless of desktop quality. (PWA + share-target is the cheap wedge; native later.)

**5.8 Adjacent absorption is cheap.**
Save-all-tabs (Toby/OneTab/Session Buddy users), reader view (Instapaper users), highlights (Diigo/Glasp users), TTS listen (commuters) — each is a small build that unlocks a whole competitor's user base.

---

## 6. Feature comparison matrix

✅ full · ◐ partial · ❌ missing · 💰 paid-only

| Capability | Kipideck | Raindrop | Instapaper | Reader | Matter | mymind | Diigo | Glasp | Evernote | Wallabag | Karakeep | Chrome RL |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Free tier usable long-term | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ◐ | ✅ | ❌ | ✅ | ✅ | ✅ |
| No account required | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Offline-first | ✅ | ❌ | ◐ | ◐ | ◐ | ❌ | ❌ | ❌ | ❌ | ◐ | ◐ | ◐ |
| Auto-organize + auto-tag | ✅ | 💰AI | ❌ | ◐ | ❌ | ✅💰 | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Full-text search free | ✅ | 💰 | 💰 | 💰 | ◐ | ◐ | 💰 | ◐ | 💰 | ✅ | ✅ | ❌ |
| Semantic/AI search | ❌ | 💰 | ❌ | ✅💰 | ❌ | ◐💰 | ❌ | ❌ | 💰 | ❌ | ✅ | ❌ |
| AI summaries | ❌ | 💰 | ◐ | ✅💰 | ✅💰 | 💰 | ❌ | ✅ | 💰 | ❌ | ✅ | ❌ |
| Reader view | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ◐ | ✅ | ◐ | ✅ |
| In-page highlights | ❌ | 💰basic | 💰 | ✅💰 | ✅ | ❌ | ✅ | ✅ | ◐ | ◐ | ❌ | ❌ |
| Page snapshots (anti-rot) | ❌ | 💰 | 💰archive | ◐ | ❌ | 💰 | ✅cache | ❌ | ❌ | ✅text | ✅ | ◐cache |
| PDF / newsletter / RSS / video | ❌ | ◐ | ◐ | ✅💰 | ✅ | ❌ | ◐ | ❌ | ✅💰 | ◐ | ◐ | ❌ |
| Resurfacing / spaced rep. | ❌ | ❌ | ❌ | ✅💰 | ❌ | ◐ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| TTS / audio | ❌ | ❌ | ✅💰 | ✅💰 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Mobile apps + share sheet | ❌ | ✅ | ✅ | ✅ | ◐iOS | ✅ | ✅ | ◐ | ✅ | ✅ | ✅ | ✅ |
| Cross-device sync free | ◐DIY | ✅ | ✅ | 💰 | ✅ | 💰 | ✅ | ✅ | 💰 | ✅self | ✅self | ✅ |
| One-click full export | ◐JSON | ✅ | ✅ | ✅ | ✅ | ◐thin | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Pocket/alt importers | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ |
| Sharing / collab | ❌ | ✅ | ❌ | ◐ | ◐ | ❌ | ✅groups | ✅social | ✅ | ❌ | ❌ | ❌ |
| Firefox support | ✅ | ✅ | ✅ | ✅ | ✅ext | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Survival-proof (no kill-switch) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ◐ |

**Reading the matrix:** Kipideck already owns the *trust row* (free, no-account, offline, survival-proof) and the *find-it-again row* (auto-organize, free full-text search). It loses on *consume* (reader, highlights, audio, recall) and *capture breadth* (mobile, PDF/newsletter/RSS). The roadmap in `ideas.md` attacks exactly those two rows while deepening the moat rows.

---

## 7. SWOT

- **Strengths:** local-first + offline; free full-text search w/ operators; auto-decks/tags; 5-browser one-codebase; multi-type capture; zero-cost BYO sync; tiny/fast; privacy (no server, no tracking).
- **Weaknesses:** no mobile; sync setup unusable for normals; not in stores; no reader/highlights/AI/archive/recall; no importers; token-expiry + snapshot-scale sync limits; hotlinked images; no sharing/integrations; no Safari.
- **Opportunities:** Pocket/Omnivore refugee wave; shutdown-trust positioning; on-device AI ($0 cost); refugee importers; tab-manager absorption; note-app export hub; audio/TTS; PWA mobile wedge.
- **Threats:** AI incumbents (Recall/Fabric/Reader) moving down-market; Raindrop adding free AI; browser built-ins improving; Chrome built-in AI changing expectations; store review friction (`<all_urls>`); Drive API/quota policy changes; single-maintainer support load.

---

## 8. Sources

Market & shutdowns:
- SupaSidebar, "Pocket Alternatives (2026)" — supasidebar.com/blog/pocket-alternatives-read-later-2026
- Fast Company, "5 read-it-later alternatives now that Pocket is shutting down" (2025-06-03)
- Burn451, "Best Pocket Replacement 2026" — burn451.cloud/blog/pocket-replacement-2026
- Readless, "Pocket Alternatives in 2026" + "Best Read Later Apps 2026" + "Omnivore Alternatives 2026" — readless.app/blog
- TechPP, "7 Best Pocket Alternatives" (2025-05-24, upd. Oct 2025)
- Yaps.ai, "Omnivore App Shut Down" + Readless "Omnivore Alternatives" (ElevenLabs acquihire 2024-10-29, offline 2024-11-15)
- Sensefold, "Best Read-It-Later Apps in 2026" — sensefold.app/blog/best-read-it-later-app
- Buyersprint, "10 Best Pocket Alternatives 2026" — buyersprint.com/2026/05/22/best-pocket-alternatives-2026
- Readless, "Pocket Is Gone" (70%-never-reopened claim) — readless.app/compare/readless-vs-pocket
- 3 Quarks Daily, "Pocket And The Archaeology Of Self" (2025-07-10); Ultrathink blog (save-but-never-read)

Reviews & complaints:
- Marqly reviews: Instapaper 3.5/5, mymind 3.8/5 (2026-08) — marqly.com/blog
- MakerStack reviews: Raindrop 8.2/10, Diigo 7.3/10, Marqly 7.6/10 — makerstack.co/reviews
- MakerDeck, "Evernote Review (2026)" 6.5/10; ToolRadar: Evernote, Raindrop pages
- NubiaPage, "Readwise Review 2026" 3.5/5; AI-for-Business-Automation, "Readwise Reader Review" 4.8/5; SpeedReadingLounge Reader review
- MakeHeadway, "Matter App Review 2026"; mwm.ai Matter App Store reviews; Burn451 "Matter App Alternative"
- JustUseApp: Instapaper + Raindrop.io review aggregates; Capterra Diigo reviews
- Chrome Web Store reviews: Evernote Web Clipper, Glasp (4.5/5, 971 ratings)
- Tooltivity: Weava 5.7/10 (falling), Session Buddy (Perf 5.5/10), Liner-vs-Weava (SaaSHub)
- Reddit: r/readwise ("Price is too high", "Is Reader worth it?"), r/raindropio (billing/support, search), r/PKMS (mymind threads, AI bookmarking), r/productivity (mymind), r/instapaper (paywall scraping breakage 2025-09)
- Doolpa Karakeep review 84/100; ContextBolt "7 Best Self-Hosted Bookmark Managers (2026)"; Marqly self-hosted comparison
- Mark-It, "AI Bookmark Manager: 9 Options Compared (2026)"; Recall.it "Best Chrome Extensions for Reading 2026"
- ClipCite "Best Web Clippers for Researchers (2026)" (Notion/Obsidian/Zotero); Obsidian Web Clipper App Store reviews; Bookmarkify tab-organizer roundup; freedom251 Chrome Reading List guide

---

*Next: [`ideas.md`](./ideas.md) — 40+ prioritized, evidence-backed ideas to beat every tool above.*
