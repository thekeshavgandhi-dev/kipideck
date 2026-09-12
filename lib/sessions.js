// lib/sessions.js — save-all-tabs as one searchable item (ideas.md I-19).
//
// WHY THIS SHAPE: Toby/OneTab/Session Buddy users keep whole windows as named
// groups, and their tools lose data and have no search. Kipideck already has a
// searchable, synced, exported store of items — so a saved window becomes ONE
// item of type "session" whose content is every tab's title and URL. That one
// decision buys the whole feature list for free:
//
//   • sessions are searchable (tab titles and URLs are indexed like page text),
//   • sessions sync (they are ordinary records, merged like everything else),
//   • sessions export (bookmark HTML expands them to one link per tab),
//   • restore is reading one record and opening its URLs.
//
// What this module deliberately does NOT do is auto-backup open windows on a
// timer. That would be silent capture of browsing history — exactly the thing
// the first-run disclosure exists to prevent. Saving a window is always an
// explicit click (popup button, Library restore card, or keyboard shortcut).
//
// Pure tab-list in → item out. No tabs API, no storage: the background script
// owns the browser side, Storage owns the write, and this owns the shape.

import { canonicalUrl } from "./canon.js";

/** Item type for a saved window. */
export const SESSION_TYPE = "session";

/** More tabs than this in one window is either a cry for help or a scraper —
 * either way, one item should not hold an unbounded list. */
export const MAX_SESSION_TABS = 100;

/** Searchable text per session, capped like imported article text. */
export const MAX_SESSION_CONTENT_CHARS = 20_000;

/** Schemes that are never worth saving: browser UI, other extensions, and
 * pages with no address at all. */
const UNSAVABLE_SCHEMES = [
  "chrome:",
  "edge:",
  "brave:",
  "opera:",
  "vivaldi:",
  "about:",
  "view-source:",
  "devtools:",
  "chrome-extension:",
  "moz-extension:",
  "safari-extension:",
  "safari-web-extension:",
];

/**
 * True when a tab URL is worth saving. `http(s)` only: anything else is browser
 * chrome, another extension's page, or a blank tab — restoring those would at
 * best reopen an empty page and at worst an error page.
 */
export function isSavableTabUrl(rawUrl) {
  const url = String(rawUrl ?? "").trim();
  if (!url) return false;
  const lower = url.toLowerCase();
  if (UNSAVABLE_SCHEMES.some((scheme) => lower.startsWith(scheme))) return false;
  return /^https?:\/\//i.test(url);
}

/** `8 tabs · 12 Sept 2026` — the default name when the user does not type one. */
export function defaultSessionName(count, when = Date.now()) {
  const date = new Date(when).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const n = Number(count) || 0;
  return `${n} tab${n === 1 ? "" : "s"} · ${date}`;
}

/**
 * Build a session item from a window's tabs.
 *
 * @param {Array<{url?: string, title?: string}>} tabs  the window, in tab order
 * @param {object} [options]
 * @param {string} [options.name]    display name (defaults to "N tabs · date")
 * @param {string} [options.deckId]  target deck (defaults to "inbox")
 * @param {string[]} [options.tags]  extra tags (always includes "session")
 * @returns {{ item: object|null, saved: number, skipped: number, duplicates: number, capped: boolean }}
 *   `item` is null when nothing was savable — the caller should say so instead
 *   of writing an empty session.
 */
export function buildSessionItem(tabs, { name = "", deckId = "inbox", tags = [] } = {}) {
  const seen = new Set();
  const kept = [];
  let skipped = 0;
  let duplicates = 0;

  for (const tab of Array.isArray(tabs) ? tabs : []) {
    const url = String(tab?.url ?? "").trim();
    if (!isSavableTabUrl(url)) {
      skipped++;
      continue;
    }
    // Same page open twice (or once with UTM noise) restores once.
    const canon = canonicalUrl(url) || url.toLowerCase();
    if (seen.has(canon)) {
      duplicates++;
      continue;
    }
    seen.add(canon);
    kept.push({ url, title: String(tab?.title ?? "").trim() || url });
  }

  const capped = kept.length > MAX_SESSION_TABS;
  const finalTabs = capped ? kept.slice(0, MAX_SESSION_TABS) : kept;

  if (!finalTabs.length) {
    return { item: null, saved: 0, skipped, duplicates, capped: false };
  }

  // The searchable body: every title and URL, so "that github repo I had open
  // on Tuesday" is a search query, not an archaeological dig.
  const content = finalTabs
    .map((t) => `${t.title}\n${t.url}`)
    .join("\n")
    .slice(0, MAX_SESSION_CONTENT_CHARS);

  const now = Date.now();
  const sessionName = String(name || "").trim() || defaultSessionName(finalTabs.length, now);
  const item = {
    type: SESSION_TYPE,
    title: sessionName,
    url: "",
    sourceUrl: "",
    domain: "",
    excerpt: sessionExcerpt(finalTabs),
    note: "",
    tags: [...new Set(["session", ...tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean)])],
    deckId,
    tabs: finalTabs,
    tabCount: finalTabs.length,
    createdAt: now,
    updatedAt: now,
    pinned: false,
  };
  return { item, content, saved: finalTabs.length, skipped, duplicates, capped };
}

/** The card subtitle: the first few tab titles, so a session is recognisable
 * without opening it. */
export function sessionExcerpt(tabs, maxTitles = 3) {
  const list = Array.isArray(tabs) ? tabs : [];
  const titles = list
    .map((t) => String(t?.title || t?.url || "").trim())
    .filter(Boolean)
    .slice(0, maxTitles);
  if (!titles.length) return "";
  const rest = list.length - titles.length;
  return titles.join(" · ") + (rest > 0 ? ` · +${rest} more` : "");
}

/**
 * The restorable URLs of a session item, defensively: a session edited by hand,
 * synced from an older client, or re-imported from JSON may carry a ragged
 * list, and restore must open what is valid rather than fail on what is not.
 */
export function sessionTabs(item) {
  const tabs = item?.tabs;
  if (!Array.isArray(tabs)) return [];
  const out = [];
  const seen = new Set();
  for (const tab of tabs) {
    const url = String(tab?.url ?? "").trim();
    if (!isSavableTabUrl(url)) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url, title: String(tab?.title ?? "").trim() || url });
  }
  return out;
}

/** One URL per line — the "copy all links" clipboard shape. */
export function sessionAsUrlList(item) {
  return sessionTabs(item)
    .map((t) => t.url)
    .join("\n");
}
