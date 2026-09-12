// lib/exporters.js — turning a Kipideck library back into files other tools read.
//
// The shutdown-proof promise (ideas.md I-07) is only real if a user can leave
// with everything, in a format that does not need Kipideck to exist. So besides
// our own JSON, an export can be:
//
//   • Netscape bookmark HTML — the one format every browser, and nearly every
//     read-later service, still imports fifteen years later. It carries URLs,
//     titles, save dates, folders and tags. It cannot carry page text.
//   • Markdown — for people who want their library as notes they can read,
//     search and keep in Obsidian, a wiki, or a plain folder.
//
// Every function here is pure text in / text out, and the item-level ones are
// exported separately so Storage can stream a 50,000-item library to disk in
// chunks instead of building one gigantic string in memory.

import { sessionTabs } from "./sessions.js";

/** What the export dialog offers, and what each choice costs the user. */
export const EXPORT_FORMATS = [
  {
    id: "json",
    label: "Kipideck JSON",
    ext: "json",
    mime: "application/json",
    lossless: true,
    note: "Everything: page text, notes, tags, decks, dates. The file to restore from.",
  },
  {
    id: "html",
    label: "Bookmark HTML",
    ext: "html",
    mime: "text/html",
    lossless: false,
    note: "Links, titles, dates, folders and tags. Opens in any browser or read-later app.",
  },
  {
    id: "markdown",
    label: "Markdown notes",
    ext: "md",
    mime: "text/markdown",
    lossless: false,
    note: "Your library as readable notes, with highlights and page text if you want them.",
  },
];

const MAX_TITLE = 400;

export function escapeHtmlText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escapeHtmlAttr(value) {
  return escapeHtmlText(value).replace(/"/g, "&quot;");
}

/** Unix seconds, which is what every bookmark file in the wild uses. */
function toSeconds(millis) {
  const n = Number(millis);
  if (!Number.isFinite(n) || n <= 0) return "";
  // A value that is already seconds-sized (some imports carry them) is passed
  // through rather than divided into 1970.
  return String(n > 1e11 ? Math.round(n / 1000) : Math.round(n));
}

function title(item) {
  const t = String(item?.title ?? "").replace(/\s+/g, " ").trim();
  return (t || item?.url || "Untitled").slice(0, MAX_TITLE);
}

function tagList(item) {
  const tags = Array.isArray(item?.tags) ? item.tags : [];
  return tags.map((t) => String(t).replace(/[,]/g, " ").trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Netscape bookmark HTML
// ---------------------------------------------------------------------------

export function bookmarkHtmlHead({ exportedAt = Date.now() } = {}) {
  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file. It will be read and overwritten. DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<!-- Exported from Kipideck on ${new Date(exportedAt).toISOString().slice(0, 10)}. -->
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
`;
}

export function bookmarkHtmlFoot() {
  return "</DL><p>\n";
}

/** One bookmark line. `note` becomes the <DD> description browsers understand. */
export function bookmarkHtmlForItem(item, { indent = "    " } = {}) {
  // A saved window has no single URL — it exports as one bookmark per tab, so
  // the links (the valuable part) survive in every browser and read-later app
  // instead of the session silently exporting nothing.
  if (item?.type === "session") return bookmarkHtmlForSession(item, { indent });
  const url = String(item?.url || item?.sourceUrl || "").trim();
  if (!url) return "";
  const added = toSeconds(item?.createdAt);
  const modified = toSeconds(item?.updatedAt);
  const tags = tagList(item);
  const attrs = [
    `HREF="${escapeHtmlAttr(url)}"`,
    added ? `ADD_DATE="${added}"` : "",
    modified && modified !== added ? `LAST_MODIFIED="${modified}"` : "",
    tags.length ? `TAGS="${escapeHtmlAttr(tags.join(","))}"` : "",
    item?.pinned ? `PRIVATE="1"` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const note = String(item?.note || "").trim();
  const line = `${indent}<DT><A ${attrs}>${escapeHtmlText(title(item))}</A>\n`;
  // <DD> is the standard place for a description; browsers keep it on import.
  return note ? `${line}${indent}<DD>${escapeHtmlText(note.replace(/\n+/g, " ").slice(0, 2000))}\n` : line;
}

// A session becomes one folder holding one bookmark per tab: the shape a
// browser already understands, so nothing is lost in translation. The folder
// matches bookmarkFolderOpen's shape (<DT>-wrapped <H3>) with the save date
// on it, the way single bookmarks carry theirs.
export function bookmarkHtmlForSession(item, { indent = "    " } = {}) {
  const tabs = sessionTabs(item);
  // A session with nothing restorable exports nothing: an empty folder in a
  // bookmark file is clutter that imports as clutter.
  if (!tabs.length) return "";
  const title = escapeHtmlText(item.title || "Untitled session") + ` (${tabs.length} tabs)`;
  const added = toSeconds(item.createdAt);
  const lines = [
    `${indent}<DT><H3${added ? ` ADD_DATE="${added}"` : ""}>${title}</H3>`,
    `${indent}<DL><p>`,
  ];
  for (const t of tabs) {
    lines.push(
      `${indent}    <DT><A HREF="${escapeHtmlAttr(t.url)}">${escapeHtmlText(t.title || t.url)}</A>`
    );
  }
  lines.push(`${indent}</DL><p>`);
  return lines.join("\n") + "\n";
}

export function bookmarkFolderOpen(deck, { indent = "    " } = {}) {
  // No emoji here on purpose: a bookmark file is interchange data, and every
  // other app would show the folder as "📖 Reading" — including our own
  // importer, which would then tag the item with the icon.
  const name = deck?.name || "Inbox";
  return `${indent}<DT><H3>${escapeHtmlText(name)}</H3>\n${indent}<DL><p>\n`;
}

export function bookmarkFolderClose({ indent = "    " } = {}) {
  return `${indent}</DL><p>\n`;
}

/** A whole library as one bookmark file. Grouped by deck, because folders are
 * the only hierarchy the format has. */
export function bookmarkHtml({ items = [], decks = [], exportedAt = Date.now() } = {}) {
  const deckById = new Map((decks || []).map((d) => [d.id, d]));
  const groups = new Map();
  for (const item of items || []) {
    const key = item?.deckId || "inbox";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const parts = [bookmarkHtmlHead({ exportedAt })];
  for (const [deckId, list] of groups) {
    const deck = deckById.get(deckId);
    parts.push(bookmarkFolderOpen({ name: deck?.name || deckId }));
    for (const item of list) parts.push(bookmarkHtmlForItem(item, { indent: "        " }));
    parts.push(bookmarkFolderClose());
  }
  parts.push(bookmarkHtmlFoot());
  return parts.join("");
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

/** `[Title](<url>)` — the angle brackets keep URLs with spaces or parentheses
 * working, which plain parentheses do not. */
function markdownLink(text, url) {
  const label = String(text ?? "").replace(/([\[\]])/g, "\\$1").trim() || String(url ?? "");
  return `[${label}](<${String(url ?? "").replace(/\s+/g, "%20")}> )`.replace(" )", ")");
}

export function markdownHead({ exportedAt = Date.now(), count = 0, includeContent = false } = {}) {
  return `# Kipideck library

Exported ${new Date(exportedAt).toISOString().slice(0, 10)} · ${count.toLocaleString()} item${count === 1 ? "" : "s"}${includeContent ? " · with page text" : ""}

Everything below is plain Markdown. It does not need Kipideck to be read, searched or edited.

`;
}

export function markdownDeckHeading(deck) {
  const name = deck?.name || "Inbox";
  return `# ${deck?.icon ? deck.icon + " " : ""}${name}\n\n`;
}

export function markdownForItem(item, { content = "", includeContent = false, heading = "##" } = {}) {
  const url = String(item?.url || item?.sourceUrl || "").trim();
  const tags = tagList(item);
  const lines = [`${heading} ${markdownLink(title(item), url)}`, ""];
  const meta = [];
  if (item?.domain) meta.push(item.domain);
  if (item?.createdAt) meta.push(`saved ${new Date(item.createdAt).toISOString().slice(0, 10)}`);
  if (item?.pinned) meta.push("pinned");
  if (item?.type && item.type !== "page") meta.push(item.type);
  if (meta.length) lines.push(`_${meta.join(" · ")}_`, "");
  if (tags.length) lines.push(tags.map((t) => `\`#${t}\``).join(" "), "");

  // A saved window lists its tabs as links — the note and the excerpt describe
  // the window, but the tabs ARE the window.
  if (item?.type === "session") {
    const tabs = sessionTabs(item);
    if (tabs.length) {
      lines.push(`**${tabs.length} tab${tabs.length === 1 ? "" : "s"}**`, "");
      for (const tab of tabs) lines.push(`- ${markdownLink(tab.title || tab.url, tab.url)}`);
      lines.push("");
    }
  }

  const excerpt = String(item?.excerpt || "").trim();
  if (excerpt) lines.push(`> ${excerpt.replace(/\n+/g, " ").slice(0, 600)}`, "");

  const note = String(item?.note || "").trim();
  if (note) {
    lines.push("**Notes & highlights**", "");
    for (const chunk of note.split(/\n{2,}/)) lines.push(`> ${chunk.replace(/\n/g, "\n> ")}`, "");
  }

  const body = String(content || "").trim();
  if (includeContent && body) {
    lines.push("<details><summary>Page text</summary>", "", body.slice(0, 40000), "", "</details>", "");
  }
  return lines.join("\n");
}

/** A whole library as Markdown, grouped by deck. `contents` maps id → text. */
export function markdownLibrary({ items = [], decks = [], contents = null, includeContent = false, exportedAt = Date.now() } = {}) {
  const deckById = new Map((decks || []).map((d) => [d.id, d]));
  const groups = new Map();
  for (const item of items || []) {
    const key = item?.deckId || "inbox";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const parts = [markdownHead({ exportedAt, count: (items || []).length, includeContent })];
  for (const [deckId, list] of groups) {
    const deck = deckById.get(deckId);
    parts.push(markdownDeckHeading(deck ? { ...deck, name: deck.name || deckId } : { name: deckId }));
    for (const item of list) {
      const content = includeContent ? contents?.[item.id] || item.content || "" : "";
      parts.push(markdownForItem(item, { content, includeContent, heading: "##" }), "\n---\n\n");
    }
  }
  return parts.join("");
}
