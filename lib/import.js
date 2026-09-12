// lib/import.js — read other people's export files and turn them into Kipideck
// records. ideas.md I-05.
//
// WHY THIS IS PURE: every parser here is text in → normalized records out, with
// no DOM, no browser APIs and no storage access. That means a Pocket export, a
// Raindrop backup and a 40,000-line bookmarks file can all be tested in node
// against real fixture text (see test/import.test.js). The only code that
// touches IndexedDB is Storage.importRecords, which receives what this produces.
//
// THE PRODUCT POINT: Pocket went read-only on 8 July 2025 and Mozilla deleted
// every account's data after 12 November 2025. Millions of people are holding a
// CSV or an HTML file in their Downloads folder and looking for somewhere it
// will still work in ten years. Importing that file well IS the acquisition
// strategy — so it has to survive the real-world messiness: split CSVs, pipe vs
// comma tags, Pocket's redirect-wrapped URLs, missing titles, 20-year-old
// timestamps, and files big enough that a naive parse would hang the tab.

import { canonicalUrl, hostOf } from "./canon.js";
import { classify } from "./classify.js";
import { fromForeignStatus } from "./status.js";

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

/** Everything the importer recognises, in the order the UI should offer them. */
export const FORMATS = [
  { id: "kipideck", label: "Kipideck JSON backup", hint: "exported from Library → Export" },
  { id: "pocket-csv", label: "Pocket CSV", hint: "the final Pocket export — drop the ZIP itself, or the part_*.csv files" },
  { id: "pocket-html", label: "Pocket HTML", hint: "older ril_export.html with Unread / Read Archive sections" },
  { id: "instapaper", label: "Instapaper CSV", hint: "Settings → Export" },
  { id: "raindrop", label: "Raindrop JSON", hint: "Settings → Backup → JSON" },
  { id: "omnivore", label: "Omnivore JSON", hint: "metadata_*.json + contents/*.html — or just drop the export ZIP" },
  { id: "pinboard", label: "Pinboard JSON", hint: "Settings → Export" },
  { id: "wallabag", label: "Wallabag JSON", hint: "Config → Export → JSON" },
  { id: "readwise", label: "Readwise Reader CSV", hint: "Export all books and articles" },
  { id: "article-html", label: "Saved article HTML", hint: "a single article file, e.g. Omnivore's contents/<slug>.html" },
  { id: "bookmarks-html", label: "Browser bookmarks (HTML)", hint: "Chrome, Edge, Brave, Firefox, Safari, Opera" },
  { id: "bookmarks-json", label: "Browser bookmarks (JSON)", hint: "a Chrome profile Bookmarks file" },
  { id: "url-list", label: "URL list", hint: "plain text or Markdown, one link per line" },
];

const FORMAT_BY_ID = new Map(FORMATS.map((f) => [f.id, f]));

/** Article text is capped the same way the in-page extractor caps it, so an
 * import cannot create records the rest of the app does not expect. */
const MAX_CONTENT_CHARS = 20_000;
const MAX_TITLE_CHARS = 400;
const MAX_NOTE_CHARS = 8_000;
const MAX_TAGS = 12;

// ---------------------------------------------------------------------------
// Small text utilities (dependency-free on purpose)
// ---------------------------------------------------------------------------

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–",
  mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
  eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", uuml: "ü", ouml: "ö",
  auml: "ä", szlig: "ß", ntilde: "ñ", copy: "©", reg: "®", trade: "™",
};

/** Decode the entities that actually appear in exported bookmark files. */
export function decodeEntities(input) {
  const text = String(input ?? "");
  if (!text.includes("&")) return text;
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    const named = ENTITIES[body.toLowerCase()];
    return named !== undefined ? named : whole;
  });
}

/** Strip tags from exported HTML bodies (Omnivore's contents/*.html, Wallabag's
 * `content`) so the text is searchable without shipping a DOM parser. */
export function htmlToText(html, max = MAX_CONTENT_CHARS) {
  let text = String(html ?? "");
  if (!text) return "";
  text = text
    .replace(/<\s*(script|style|noscript|template|svg|head)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    // Block boundaries become breaks; inline ones become nothing at all, so
    // "Hello <b>world</b>." reads as "Hello world." and not "Hello world .".
    .replace(/<\s*\/?\s*(a|abbr|b|bdi|bdo|cite|code|data|dfn|em|i|kbd|mark|q|s|samp|small|span|strong|sub|sup|time|u|var|wbr)\b[^>]*>/gi, "")
    .replace(/<\s*\/\s*(p|div|li|h[1-6]|tr|td|th|article|section|blockquote|pre|figure|figcaption|ul|ol|dl|dt|dd|table|tbody|thead)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  text = decodeEntities(text).replace(/[ \t\r\f\v]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return text.length > max ? text.slice(0, max) : text;
}

function cleanText(value, max = 0) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return max && text.length > max ? text.slice(0, max).trim() : text;
}

/** Split a tag blob on whatever separator the source used. */
export function splitTags(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return [];
  // Pipe (Pocket CSV), comma (Pocket HTML, Instapaper, most CSVs), semicolon
  // (Raindrop CSV) and space (Pinboard) all appear in real exports.
  const parts = value.includes("|")
    ? value.split("|")
    : value.includes(",")
      ? value.split(",")
      : value.includes(";")
        ? value.split(";")
        : value.split(/\s+/);
  return parts.map((t) => cleanText(t).toLowerCase()).filter((t) => t && t.length <= 40);
}

/** Unix seconds, milliseconds, ISO-8601, Chrome's 1601 epoch, or "" → ms|null. */
export function toMillis(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return normalizeNumericDate(raw);
  const text = String(raw).trim();
  if (!text) return null;
  if (/^-?\d+$/.test(text)) return normalizeNumericDate(Number(text));
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return parsed;
  // "31/12/2020" and friends: give up rather than guess wrong.
  return null;
}

function normalizeNumericDate(n) {
  // Chrome's Bookmarks JSON stores microseconds since 1601-01-01.
  if (n > 1e16) return Math.round(n / 1000 - 11_644_473_600_000);
  if (n > 1e12) return Math.round(n); // already milliseconds
  if (n > 1e8) return Math.round(n * 1000); // seconds, 1973 onwards
  return null; // too small to be a real timestamp
}

/** Reasonable bounds, because exports contain junk dates and a bad timestamp
 * would sort an item to the top of "Newest" forever. */
const MIN_SANE_MS = Date.UTC(1990, 0, 1);
function saneDate(ms, fallback) {
  if (ms === null || !Number.isFinite(ms)) return fallback;
  if (ms < MIN_SANE_MS || ms > Date.now() + 86_400_000) return fallback;
  return Math.round(ms);
}

/**
 * Undo redirect wrappers. Pocket's HTML export wraps every link in
 * `https://getpocket.com/extredirect?url=<encoded>`, which — imported
 * literally — turns a library of articles into a library of dead Pocket URLs.
 */
export function unwrapRedirect(rawUrl) {
  const url = String(rawUrl ?? "").trim();
  if (!url) return "";
  const wrappers = [
    { host: "getpocket.com", params: ["url"] },
    { host: "www.google.com", params: ["q", "url"] },
    { host: "google.com", params: ["q", "url"] },
    { host: "www.youtube.com", params: ["q"] },
    { host: "l.instagram.com", params: ["u"] },
    { host: "lm.facebook.com", params: ["u"] },
    { host: "outgoing.prod.mozaws.net", params: ["q"] },
  ];
  try {
    const parsed = new URL(url);
    const wrapper = wrappers.find((w) => parsed.hostname === w.host || parsed.hostname.endsWith(`.${w.host}`));
    if (!wrapper) return url;
    for (const key of wrapper.params) {
      const candidate = parsed.searchParams.get(key);
      if (!candidate) continue;
      // Google encodes the target and appends its own tracking after it.
      const decoded = decodeURIComponent(candidate).split(/&(?:sa|ved|usg|eurl)=/)[0];
      if (/^https?:\/\//i.test(decoded) && !decoded.includes(parsed.hostname)) return decoded;
    }
    return url;
  } catch {
    return url;
  }
}

function looksLikeUrl(value) {
  const text = String(value ?? "").trim();
  if (!text || /\s/.test(text)) return false;
  return /^(https?|ftp):\/\//i.test(text) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(text);
}

function withProtocol(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return text;
  if (/^[\w-]+(\.[\w-]+)+([/?#]\S*)?$/i.test(text)) return `https://${text}`;
  return "";
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** RFC4180-ish: quoted fields, "" escapes, embedded newlines, BOM, and a
 * delimiter sniffed from the header line (Raindrop and some EU exports use `;`). */
export function parseCsv(text, { delimiter } = {}) {
  const src = String(text ?? "").replace(/^\uFEFF/, "");
  if (!src.trim()) return [];
  const sep = delimiter || sniffDelimiter(src);
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = src.length;

  while (i < n) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === sep) { row.push(field); field = ""; i++; continue; }
    if (ch === "\r") { i++; continue; }
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += ch; i++;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  // Trailing empty rows from a final newline.
  while (rows.length && rows[rows.length - 1].every((c) => c === "")) rows.pop();
  return rows;
}

function sniffDelimiter(src) {
  const firstLine = src.split(/\r?\n/, 1)[0] || "";
  const counts = [",", ";", "\t", "|"].map((d) => ({ d, count: countUnquoted(firstLine, d) }));
  counts.sort((a, b) => b.count - a.count);
  return counts[0].count > 0 ? counts[0].d : ",";
}

function countUnquoted(line, delim) {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (!inQuotes && ch === delim) count++;
  }
  return count;
}

const KNOWN_COLUMNS = new Set([
  "url", "title", "time_added", "tags", "status", "description", "cursor", "href", "added",
  "date", "note", "notes", "folder", "read_status", "author", "category", "content", "image",
  "labels", "saved_at", "savedat", "created", "last_modified", "private", "toread", "extended",
]);

/** True when the first row is a header rather than data. */
export function isHeaderRow(row) {
  if (!row || !row.length) return false;
  const hits = row.filter((cell) => KNOWN_COLUMNS.has(String(cell).trim().toLowerCase().replace(/[^a-z_]/g, ""))).length;
  if (hits >= 2) return true;
  // A header never contains an actual URL in the first data-looking column.
  if (row.some((cell) => looksLikeUrl(cell))) return false;
  // "a,b,c" and "Title,URL,Tags" are headers; "1,2,3" and "Hello,World,!" are not.
  if (row.every((cell) => /^[a-z][a-z0-9 _-]{0,24}$/i.test(cell))) return true;
  return hits >= 1;
}

function columnName(raw) {
  // "Read Status" → read_status, "Date Added" → date_added. Real exports use
  // spaces, hyphens and title case interchangeably, and a column we fail to
  // recognise is a column whose data we silently throw away.
  return String(raw ?? "").trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Rows → objects, using the header when there is one, else positional guesses. */
export function csvToObjects(rows) {
  if (!rows.length) return { objects: [], header: null };
  if (isHeaderRow(rows[0])) {
    const header = rows[0].map(columnName);
    const objects = [];
    for (let r = 1; r < rows.length; r++) {
      const obj = {};
      for (let c = 0; c < header.length; c++) obj[header[c] || `col${c}`] = rows[r][c] ?? "";
      objects.push(obj);
    }
    return { objects, header };
  }
  // No header: put the URL-looking column first, then title, then the rest.
  const objects = rows.map((row) => {
    const cells = row.map((c) => String(c ?? "").trim());
    const urlIndex = cells.findIndex((c) => looksLikeUrl(c));
    // Only a cell that actually looks like an address becomes the URL. Taking
    // cells[0] on faith is how a notes spreadsheet gets imported as 40,000
    // items with the address "1".
    const url = urlIndex >= 0 ? cells[urlIndex] : "";
    const title = cells.find((c, idx) => idx !== urlIndex && c && !looksLikeUrl(c) && !/^\d{9,}$/.test(c)) || "";
    return { url, title, _cells: cells };
  });
  return { objects, header: null };
}

// ---------------------------------------------------------------------------
// Netscape bookmark HTML (browsers + Pocket's older export)
// ---------------------------------------------------------------------------

/**
 * Parse a Netscape bookmark file without a DOM.
 *
 * Handles both shapes that occur in the wild:
 *   • browser exports — nested `<DL>` folders, `<A HREF ADD_DATE ICON TAGS>`
 *   • Pocket's ril_export.html — `<H1>Unread</H1>` / `<H1>Read Archive</H1>`
 *     sections whose `<A>` tags carry lowercase `time_added` and `tags`
 */
export function parseNetscapeHtml(html, { headingsAsStatus = false } = {}) {
  const src = String(html ?? "");
  const items = [];
  let skipped = 0;
  /** Stack of open containers. `status` is set for Pocket-style section
   * headings ("Unread" / "Read Archive"), which are NOT folders — turning them
   * into tags is how an archived item ends up tagged both "unread" and "archive". */
  const stack = [];
  let pending = null;
  // The anchor a following <DD> describes. Cleared whenever structure intervenes,
  // so a folder description can never land on the previous bookmark's note.
  let lastAnchor = null;

  // A sequential tag scanner rather than one big regex: bookmark files nest, and
  // a lookahead-based regex silently mismatches the nesting, which leaks folder
  // and read-state context between sections.
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt === -1) break;
    const gt = src.indexOf(">", lt);
    if (gt === -1) break;
    const tagText = src.slice(lt + 1, gt);
    const closing = tagText.startsWith("/");
    const name = (/^\/?\s*([a-zA-Z0-9]+)/.exec(tagText) || [, ""])[1].toLowerCase();

    if (name === "a" && !closing) {
      const closeIdx = src.toLowerCase().indexOf("</a", gt);
      const inner = closeIdx === -1 ? "" : src.slice(gt + 1, closeIdx);
      const attrs = tagText.slice(1);
      const parsed = parseAnchor(attrs, inner, stack, pending);
      if (parsed) {
        items.push(parsed);
        lastAnchor = parsed;
      } else if (attr(attrs, ["href"])) {
        skipped++;
      }
      i = closeIdx === -1 ? gt + 1 : src.indexOf(">", closeIdx) + 1 || gt + 1;
      continue;
    }

    if (/^h[1-6]$/.test(name) && !closing) {
      const closeIdx = src.toLowerCase().indexOf(`</${name}`, gt);
      const inner = closeIdx === -1 ? "" : src.slice(gt + 1, closeIdx);
      const heading = cleanText(decodeEntities(stripTags(inner)), 120);
      pending = {
        name: heading,
        // Only Pocket's ril_export.html encodes read state in section headings.
        // In a browser bookmark file (or our own export) a heading is a folder
        // the user named — "Inbox" and "Archive" included.
        status: headingsAsStatus ? statusFromHeading(heading) : null,
        root: isRootHeading(heading),
      };
      lastAnchor = null;
      i = closeIdx === -1 ? gt + 1 : src.indexOf(">", closeIdx) + 1;
      continue;
    }

    // <DD> is the standard description field: Firefox writes it, and our own
    // bookmark export writes notes there. It belongs to the anchor above it.
    if (name === "dd" && !closing) {
      const closeIdx = src.toLowerCase().indexOf("</dd", gt);
      const nextTag = src.indexOf("<", gt + 1);
      const stop = closeIdx === -1 ? (nextTag === -1 ? src.length : nextTag) : closeIdx;
      const note = cleanText(decodeEntities(stripTags(src.slice(gt + 1, stop))), MAX_NOTE_CHARS);
      if (lastAnchor && note && !lastAnchor.note) lastAnchor.note = note;
      i = closeIdx === -1 ? stop : src.indexOf(">", closeIdx) + 1 || stop;
      continue;
    }

    if ((name === "dl" || name === "ul") && !closing) {
      lastAnchor = null;
      stack.push(pending || { name: "", status: null, root: false });
      pending = null;
      i = gt + 1;
      continue;
    }
    if ((name === "dl" || name === "ul") && closing) {
      if (stack.length) stack.pop();
      i = gt + 1;
      continue;
    }
    i = gt + 1;
  }

  // Files with no <DL>/<UL> at all (hand-edited, or truncated downloads) still
  // deserve to import: fall back to a flat scan of every anchor.
  if (!items.length) {
    for (const anchor of src.matchAll(/<\s*a\b([^>]*)>([\s\S]*?)<\s*\/\s*a\s*>/gi)) {
      const parsed = parseAnchor(anchor[1], anchor[2], [], null);
      if (parsed) items.push(parsed);
      else if (/href\s*=/i.test(anchor[1])) skipped++;
    }
  }
  // Non-enumerable so the list still behaves like a plain array everywhere.
  Object.defineProperty(items, "skippedNoUrl", { value: skipped, enumerable: false });
  return items;
}

/** The container headings every browser puts at the top of an export. They are
 * structure, not a folder the user chose, so they must not become tags. */
const ROOT_HEADINGS = /^(bookmarks?|bookmarks?\s+(menu|bar|toolbar)|favorites?(\s+bar)?|reading\s+list|links|my\s+bookmarks?)$/i;
function isRootHeading(heading) {
  return ROOT_HEADINGS.test(cleanText(heading));
}

function stripTags(fragment) {
  return String(fragment ?? "").replace(/<[^>]*>/g, " ");
}

function statusFromHeading(heading) {
  const h = cleanText(heading).toLowerCase();
  if (!h) return null;
  // Order matters: "Unread" contains "read", and Pocket's "Read Archive"
  // contains both. Most specific first, and `\bread\b` so "unread" cannot match.
  if (/favourite|favorite|starred|liked/.test(h)) return "favorite";
  if (/unread|to\s*-?read|read\s+later|reading\s+list|inbox|saved/.test(h)) return "unread";
  if (/archive|archived|\bread\b|finished|completed/.test(h)) return "archive";
  return null;
}

function attr(attrs, names) {
  for (const name of names) {
    const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
    if (m) return decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return "";
}

function parseAnchor(attrs, inner, folders, pendingHeading) {
  const rawHref = String(attr(attrs, ["href"]) ?? "").trim();
  // Not bookmarks at all: script links, mail links, in-page anchors, embedded
  // data. Anything else with an unusable address is kept and reported, because
  // a silently dropped row is a row the user will go looking for.
  if (!rawHref || /^(?:javascript:|mailto:|data:|about:|#)/i.test(rawHref)) return null;
  const href = unwrapRedirect(rawHref);
  const url = withProtocol(href);

  const title = cleanText(decodeEntities(stripTags(inner)), MAX_TITLE_CHARS);
  const stack = [...folders, pendingHeading].filter(Boolean);
  // Section headings that carry read-state (Pocket's "Unread" / "Read Archive")
  // and the browser's own root heading are not user-chosen folders.
  const folder = stack
    .filter((f) => f.name && !f.status && !f.root)
    .map((f) => f.name)
    .join(" / ");
  const status = [...stack].reverse().find((f) => f.status)?.status || null;

  const addedRaw = attr(attrs, ["add_date", "time_added", "added", "date_added", "created"]);
  const modifiedRaw = attr(attrs, ["last_modified", "lastmodified", "modified", "updated"]);
  const tagsRaw = attr(attrs, ["tags", "tag"]);
  const privateFlag = attr(attrs, ["private"]) === "1";

  return {
    url,
    title,
    tags: splitTags(tagsRaw),
    folder,
    status,
    addedAt: toMillis(addedRaw),
    updatedAt: toMillis(modifiedRaw),
    private: privateFlag,
    source: "bookmarks-html",
  };
}

// ---------------------------------------------------------------------------
// JSON libraries
// ---------------------------------------------------------------------------

/** Chrome profile Bookmarks file → flat records. date_added is µs since 1601. */
export function parseChromeBookmarksJson(data) {
  const items = [];
  const walk = (node, path) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "url") {
      items.push({
        url: withProtocol(node.url),
        title: cleanText(node.name, MAX_TITLE_CHARS),
        folder: path.filter(Boolean).join(" / "),
        addedAt: toMillis(node.date_added),
        updatedAt: toMillis(node.date_modified),
        tags: [],
        status: null,
      });
      return;
    }
    const nextPath = node.type === "folder" ? [...path, node.name] : path;
    for (const child of node.children || []) walk(child, nextPath);
  };
  const roots = data?.roots || data;
  for (const key of Object.keys(roots || {})) {
    if (key === "sync_transaction_version") continue;
    walk(roots[key], key === "bookmark_bar" || key === "other" ? [] : [roots[key]?.name]);
  }
  return items;
}

const RAINDROP_TYPES = new Set(["link", "article", "image", "video", "document", "audio", "book"]);

/** Raindrop, Pinboard, Wallabag, Omnivore, Readwise JSON, or a bare array. */
export function parseJsonLibrary(data) {
  const array = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : Array.isArray(data?.bookmarks) ? data.bookmarks : null;

  if (!array) {
    if (data?.roots) return { kind: "bookmarks-json", items: parseChromeBookmarksJson(data) };
    if (data?.content && Array.isArray(data.content)) return parseJsonLibrary(data.content); // Wallabag
    return { kind: "unknown", items: [] };
  }
  if (!array.length) return { kind: "unknown", items: [] };
  const first = array.find((x) => x && typeof x === "object") || {};

  if ("href" in first && "toread" in first) return { kind: "pinboard", items: array.map(fromPinboard) };
  if ("originalUrl" in first || "savedAt" in first || "slug" in first) return { kind: "omnivore", items: array.map(fromOmnivore) };
  if ("is_archived" in first || "reading_time" in first || "created_at" in first) return { kind: "wallabag", items: array.map(fromWallabag) };
  if (("link" in first || "collection" in first) && (RAINDROP_TYPES.has(String(first.type || "").toLowerCase()) || "excerpt" in first)) {
    return { kind: "raindrop", items: array.map(fromRaindrop) };
  }
  if ("title" in first && ("url" in first || "link" in first)) return { kind: "generic", items: array.map(fromGenericJson) };
  return { kind: "unknown", items: array.map(fromGenericJson).filter((i) => i && (i.url || i.title)) };
}

function fromPinboard(raw) {
  return {
    url: withProtocol(unwrapRedirect(raw.href || raw.url || "")),
    title: cleanText(raw.description || raw.title, MAX_TITLE_CHARS),
    excerpt: cleanText(raw.extended, 400),
    note: cleanText(raw.extended, MAX_NOTE_CHARS),
    tags: splitTags(raw.tags),
    addedAt: toMillis(raw.time),
    status: raw.toread === "1" || raw.toread === true ? "unread" : raw.toread === "0" ? "archive" : null,
    private: raw.shared === "0" || raw.shared === false,
  };
}

function fromOmnivore(raw) {
  // `slug` is not decoration: Omnivore's export puts each article's text in
  // contents/<slug>.html and its tags, dates and highlights in metadata_*.json.
  // Without the slug the two halves cannot be rejoined.
  const labels = Array.isArray(raw.labels) ? raw.labels.map((l) => (typeof l === "string" ? l : l?.name)).filter(Boolean) : splitTags(raw.labels);
  const highlights = Array.isArray(raw.highlights) ? raw.highlights : [];
  return {
    url: withProtocol(unwrapRedirect(raw.originalUrl || raw.url || "")),
    title: cleanText(raw.title, MAX_TITLE_CHARS),
    excerpt: cleanText(raw.description || raw.contentPreview, 400),
    note: highlightsToNote(highlights, raw.content),
    content: raw.content ? htmlToText(raw.content) : "",
    tags: labels.map((t) => cleanText(t).toLowerCase()).filter(Boolean),
    addedAt: toMillis(raw.savedAt || raw.saved_at || raw.updatedAt),
    status: raw.state === "ARCHIVED" ? "archive" : raw.state === "COMPLETED" ? "archive" : "unread",
    author: cleanText(raw.author, 120),
    image: cleanText(raw.image, 500),
    type: raw.type === "FILE" ? "document" : null,
    slug: cleanText(raw.slug || raw.id, 160),
  };
}

function fromWallabag(raw) {
  const tags = Array.isArray(raw.tags) ? raw.tags.map((t) => (typeof t === "string" ? t : t?.label)).filter(Boolean) : splitTags(raw.tags);
  return {
    url: withProtocol(unwrapRedirect(raw.url || raw.originUrl || "")),
    title: cleanText(raw.title, MAX_TITLE_CHARS),
    content: htmlToText(raw.content || ""),
    excerpt: cleanText(htmlToText(raw.content || "", 300), 300),
    tags: tags.map((t) => cleanText(t).toLowerCase()).filter(Boolean),
    addedAt: toMillis(raw.created_at || raw.createdAt),
    updatedAt: toMillis(raw.updated_at || raw.updatedAt),
    status: raw.is_archived || raw.isArchived ? "archive" : "unread",
    favorite: !!(raw.is_favorite || raw.isFavorite || raw.starred),
    readingTime: Number(raw.reading_time || raw.readingTime || 0) || 0,
  };
}

function fromRaindrop(raw) {
  const collection = raw.collection?.title || raw.collectionTitle || raw.folder || "";
  const highlights = Array.isArray(raw.highlights) ? raw.highlights : [];
  return {
    url: withProtocol(unwrapRedirect(raw.link || raw.url || "")),
    title: cleanText(raw.title, MAX_TITLE_CHARS),
    excerpt: cleanText(raw.excerpt, 400),
    note: highlightsToNote(highlights, raw.note),
    content: raw.content && typeof raw.content === "string" ? htmlToText(raw.content) : "",
    tags: Array.isArray(raw.tags) ? raw.tags.map((t) => cleanText(t).toLowerCase()).filter(Boolean) : splitTags(raw.tags),
    folder: cleanText(collection, 120),
    addedAt: toMillis(raw.created),
    updatedAt: toMillis(raw.lastUpdate || raw.updated),
    type: raw.type && RAINDROP_TYPES.has(String(raw.type).toLowerCase()) ? String(raw.type).toLowerCase() : null,
    favorite: !!raw.important,
    image: cleanText(raw.cover || raw.media?.[0]?.link, 500),
    broken: !!raw.broken,
  };
}

function fromGenericJson(raw) {
  if (!raw || typeof raw !== "object") return { url: "" };
  const url = withProtocol(unwrapRedirect(raw.url || raw.link || raw.href || ""));
  const highlights = Array.isArray(raw.highlights) ? raw.highlights : [];
  return {
    url,
    title: cleanText(raw.title || raw.name || raw.description, MAX_TITLE_CHARS),
    excerpt: cleanText(raw.excerpt || raw.description || raw.summary, 400),
    note: highlightsToNote(highlights, raw.note || raw.notes),
    content: typeof raw.content === "string" ? (raw.content.includes("<") ? htmlToText(raw.content) : cleanText(raw.content, MAX_CONTENT_CHARS)) : "",
    tags: Array.isArray(raw.tags) ? raw.tags.map((t) => cleanText(String(t)).toLowerCase()).filter(Boolean) : splitTags(raw.tags),
    folder: cleanText(raw.folder || raw.collection?.title || raw.collection || raw.category, 120),
    addedAt: toMillis(raw.created || raw.createdAt || raw.time_added || raw.date || raw.savedAt || raw.added),
    updatedAt: toMillis(raw.updated || raw.updatedAt || raw.modified || raw.last_modified),
    status: normalizeStatus(raw.status ?? raw.read_status ?? raw.state ?? raw.archived),
    image: cleanText(raw.image || raw.cover || raw.thumbnail, 500),
    author: cleanText(raw.author, 120),
  };
}

/** Highlights/annotations are the most valuable part of a read-later export and
 * the part most importers throw away. Keep them as a readable note. */
function highlightsToNote(highlights, existingNote) {
  const parts = [];
  if (existingNote) parts.push(cleanText(typeof existingNote === "string" ? existingNote : "", MAX_NOTE_CHARS));
  for (const h of highlights || []) {
    const quote = cleanText(typeof h === "string" ? h : h?.text || h?.quote || h?.patch || "", 1200);
    if (!quote) continue;
    const annotation = cleanText(typeof h === "object" ? h?.note || h?.annotation || h?.comment || "" : "", 600);
    parts.push(annotation ? `“${quote}”\n  — ${annotation}` : `“${quote}”`);
  }
  return cleanText(parts.join("\n\n"), MAX_NOTE_CHARS);
}

function normalizeStatus(raw) {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return null;
  if (/^(1|archive|archived|read|done)$/.test(value)) return "archive";
  if (/^(2|favorite|favourite|starred|liked)$/.test(value)) return "favorite";
  if (/^(0|unread|new|to.?read|reading)$/.test(value)) return "unread";
  return null;
}

// ---------------------------------------------------------------------------
// Plain URL / Markdown lists
// ---------------------------------------------------------------------------

/** One link per line, or Markdown `- [title](url)`, or `title<TAB>url`. */
export function parseUrlList(text) {
  const items = [];
  const lines = String(text ?? "").replace(/^\uFEFF/, "").split(/\r?\n/);
  let folder = "";
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = line.match(/^(#{1,6}|\*\*|==)\s*(.+?)\s*(\*\*|==)?$/);
    if (heading && !looksLikeUrl(heading[2])) {
      folder = cleanText(heading[2], 120);
      continue;
    }
    if (/^(<!--|#(?!#)|\/\/)/.test(line)) continue; // comments

    // Strip list markup first: "- https://…", "1) https://…", "* [t](url)".
    const stripped = line.replace(/^(?:[-*+•]|\d+[.)])\s+/, "");
    const md = stripped.match(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/);
    if (md) {
      items.push({ url: unwrapRedirect(md[2]), title: cleanText(md[1], MAX_TITLE_CHARS), folder });
      continue;
    }
    const tabbed = stripped.split(/\t| {2,}/);
    const words = stripped.split(/\s+/);
    const urlCell = tabbed.find((c) => looksLikeUrl(c)) || (looksLikeUrl(words[0]) ? words[0] : "");
    if (!urlCell) continue;
    const title = cleanText(tabbed.filter((c) => c !== urlCell && !looksLikeUrl(c)).join(" "), MAX_TITLE_CHARS);
    items.push({ url: unwrapRedirect(urlCell), title, folder });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Single-article HTML (Omnivore's contents/<slug>.html, or any saved page)
// ---------------------------------------------------------------------------

/**
 * Read one article out of an HTML file.
 *
 * This is the other half of an Omnivore export: the metadata JSON holds the
 * labels, dates and highlights, while the article text sits in a folder of HTML
 * files named by slug. Imported alone, the metadata gives you a list of links
 * that may well be dead by now. Joined by slug, you get the library back —
 * including the words.
 */
export function parseArticleHtml(html, { name = "" } = {}) {
  const src = String(html ?? "");
  if (!src.trim()) return [];

  const grab = (re) => {
    const m = src.match(re);
    return m ? m[1] : "";
  };
  const metaContent = (metaName) =>
    grab(new RegExp(`<meta[^>]+name=["\']?${metaName}["\']?[^>]+content=["\']([^"\']*)`, "i")) ||
    grab(new RegExp(`<meta[^>]+content=["\']([^"\']*)["\']?[^>]+name=["\']?${metaName}`, "i"));
  const canonical =
    grab(/<link[^>]+rel=["\']?canonical["\']?[^>]+href=["\']([^"\']*)/i) ||
    metaContent("original-url") ||
    metaContent("og:url") ||
    "";

  const title = cleanText(
    decodeEntities(stripTags(grab(/<title[^>]*>([\s\S]*?)<\/title>/i) || grab(/<h1[^>]*>([\s\S]*?)<\/h1>/i))),
    MAX_TITLE_CHARS,
  );

  // Prefer the article element; fall back to <body>; strip the furniture either
  // way so navigation and footers do not end up inside the saved text.
  const article = src.match(/<article\b[\s\S]*?<\/article>/i);
  const body = src.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const region = article ? article[0] : body ? body[1] : src;
  const text = htmlToText(region, MAX_CONTENT_CHARS);
  if (text.length < 80) return []; // a stub, a redirect page, or not an article

  // Basename first: inside a ZIP the name is a path (contents/<slug>.html) and
  // the folder prefix must not become part of the slug the metadata joins on.
  const base = String(name).split(/[\\/]/).pop() || "";
  const slug = cleanText(base.replace(/\.[a-z0-9]+$/i, "").replace(/[^\w.-]+/g, "-").toLowerCase(), 160);
  return [
    {
      url: withProtocol(unwrapRedirect(canonical)),
      title,
      content: text,
      excerpt: cleanText(text.slice(0, 300), 300),
      slug,
      tags: [],
      source: "article-html",
    },
  ];
}

/** Prose-dense HTML that is not a bookmark file. Kept conservative on purpose:
 * misreading a bookmarks.html as an article would flatten someone's folders. */
export function looksLikeArticleHtml(html) {
  const lower = String(html ?? "").slice(0, 200000).toLowerCase();
  if (!lower.includes("<")) return false;
  if (/<!doctype\s+netscape-bookmark/.test(lower)) return false;
  if (/<dl[^>]*>\s*<p>/.test(lower) || /<h3[^>]*add_date/.test(lower) || /<h1>\s*(bookmarks?|unread|read archive)/.test(lower)) return false;
  if (/<article\b/.test(lower)) return true;
  const paras = (lower.match(/<p[\s>]/g) || []).length;
  const anchors = (lower.match(/<a\s/g) || []).length;
  return paras >= 5 && paras >= anchors;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Guess the format from the filename and the first few KB of content.
 *
 * Deliberately does NOT parse JSON: a Pocket-scale export can be tens of
 * megabytes, and parsing it once to guess the format and again to read it would
 * double the memory and the wait. Shape is sniffed from the head of the file
 * instead; `parseExport` does the single real parse.
 */
export function detectFormat({ name = "", text = "" } = {}) {
  const file = String(name).toLowerCase();
  const head = String(text).slice(0, 8000);
  const lower = head.toLowerCase();

  // ZIPs no longer land here: the import dialog expands them into their inner
  // files before detection ever runs. RAR, 7z and gzip stay unsupported.
  if (/\.(gz|rar|7z)$/.test(file)) {
    return {
      id: "zip",
      label: "Archive (unzip first)",
      confidence: 1,
      reason: "Kipideck opens ZIP files in the browser, but not RAR, 7z or gzip — unzip it and import the files inside.",
    };
  }

  // Pocket's older export is a bookmark-shaped file with its own attributes and
  // section headings. Check it before the generic HTML branch, and do not
  // require the Netscape doctype — plenty of copies in the wild lack it.
  if (/<a\s[^>]*href=/i.test(lower) && (/time_added=/i.test(lower) || /getpocket\.com\/extredirect/i.test(lower) || /<h1>\s*(unread|read\s+archive)/i.test(lower) || /ril_export/i.test(file))) {
    return { id: "pocket-html", label: FORMAT_BY_ID.get("pocket-html").label, confidence: 0.9, reason: "Pocket's ril_export.html shape" };
  }

  const looksJson = /^\s*[[{]/.test(head) || /\.json$/i.test(file);
  if (looksJson) {
    const jsonGuess = sniffJsonShape(head, file);
    if (jsonGuess) return jsonGuess;
    if (/\.json$/i.test(file)) return { id: "url-list", label: FORMAT_BY_ID.get("url-list").label, confidence: 0.3, reason: "JSON with no recognised shape" };
  }

  if (/<!doctype\s+netscape-bookmark/i.test(lower) || /<h1>\s*bookmarks?\s*<\/h1>/i.test(lower)) {
    if (/time_added=/i.test(lower) || /getpocket\.com/i.test(lower) || /<h1>\s*(unread|read archive)/i.test(lower)) {
      return { id: "pocket-html", label: FORMAT_BY_ID.get("pocket-html").label, confidence: 0.9, reason: "Netscape-style file with Pocket's time_added attribute" };
    }
    return { id: "bookmarks-html", label: FORMAT_BY_ID.get("bookmarks-html").label, confidence: 0.95, reason: "Netscape bookmark doctype" };
  }

  if (/\.html?$/i.test(file) && looksLikeArticleHtml(head.length < 200000 ? String(text) : head)) {
    return { id: "article-html", label: FORMAT_BY_ID.get("article-html").label, confidence: 0.8, reason: "prose-dense HTML rather than a list of bookmarks" };
  }

  if (/<a\s[^>]*href=/i.test(lower) && /<(dl|h3|ul)\b/i.test(lower)) {
    return { id: "bookmarks-html", label: FORMAT_BY_ID.get("bookmarks-html").label, confidence: 0.7, reason: "HTML containing bookmark links" };
  }

  if (/\.(csv|tsv)$/i.test(file) || isProbablyCsv(head)) {
    const header = (parseCsv(head)[0] || []).map(columnName);
    const has = (col) => header.includes(col);
    if (has("time_added") && has("status") && (has("tags") || has("title"))) {
      return { id: "pocket-csv", label: FORMAT_BY_ID.get("pocket-csv").label, confidence: 0.95, reason: "title,url,time_added,tags,status header" };
    }
    if (has("read_status") || (has("title") && has("author") && has("category"))) {
      return { id: "readwise", label: FORMAT_BY_ID.get("readwise").label, confidence: 0.85, reason: "Readwise Reader column names" };
    }
    if ((has("url") || has("href")) && has("title")) {
      return { id: "instapaper", label: FORMAT_BY_ID.get("instapaper").label, confidence: 0.75, reason: "url,title,… header" };
    }
    return { id: "url-list", label: FORMAT_BY_ID.get("url-list").label, confidence: 0.5, reason: "tabular text with no recognised header" };
  }

  if (/^\s*[-*\d.)\s]*https?:\/\//im.test(head) || /\[[^\]]+\]\(https?:\/\//.test(head)) {
    return { id: "url-list", label: FORMAT_BY_ID.get("url-list").label, confidence: 0.6, reason: "lines of URLs" };
  }

  return {
    id: "unknown",
    label: "Unrecognised file",
    confidence: 0,
    reason: "Send it as JSON, CSV, or an HTML bookmark export and Kipideck will read it.",
  };
}

/** Field-name fingerprints, checked against the head of a JSON file. */
function sniffJsonShape(head, file) {
  const label = (id, reason, confidence = 0.9) => ({ id, label: FORMAT_BY_ID.get(id)?.label || id, confidence, reason });
  if (/"roots"\s*:/.test(head) && /"bookmark_bar"|"synced"|"other"\s*:/.test(head)) return label("bookmarks-json", "Chrome profile Bookmarks file", 0.95);
  if (/"deckId"\s*:/.test(head) || (/"sourceUrl"\s*:/.test(head) && /"excerpt"\s*:/.test(head))) return label("kipideck", "Kipideck export shape", 0.98);
  if (/"originalUrl"\s*:/.test(head) || (/"slug"\s*:/.test(head) && /"savedAt"\s*:/.test(head)) || /omnivore|metadata_/i.test(file)) {
    return label("omnivore", "Omnivore metadata fields", 0.9);
  }
  if (/"href"\s*:/.test(head) && (/"toread"\s*:/.test(head) || /"shared"\s*:/.test(head) || /"hash"\s*:/.test(head))) return label("pinboard", "Pinboard export fields", 0.9);
  if (/"is_archived"\s*:/.test(head) || /"reading_time"\s*:/.test(head)) return label("wallabag", "Wallabag export fields", 0.85);
  if ((/"link"\s*:/.test(head) && (/"excerpt"\s*:/.test(head) || /"collection"\s*:/.test(head))) || /raindrop/i.test(file)) {
    return label("raindrop", "Raindrop backup fields", 0.85);
  }
  if (/"(url|link|href)"\s*:/.test(head)) return label("url-list", "generic JSON array of links", 0.6);
  return null;
}

function isProbablyCsv(head) {
  const lines = head.split(/\r?\n/).filter(Boolean).slice(0, 5);
  if (lines.length < 2) return false;
  const counts = lines.map((l) => countUnquoted(l, ","));
  return counts[0] >= 1 && counts.every((c) => c === counts[0]);
}

// ---------------------------------------------------------------------------
// Normalization → Kipideck records
// ---------------------------------------------------------------------------

/**
 * Merge several parsed files into one import. Pocket's final export is a ZIP of
 * `part_000000.csv`, `part_000001.csv`… and Omnivore's is `metadata_0.json`,
 * `metadata_1.json`…, so multi-file import is the normal case, not an edge case.
 * Deduplication happens in toKipideckItems, across the combined set.
 */
export function combineParsed(parsedList) {
  const raw = [];
  const warnings = [];
  const formats = new Set();
  for (const parsed of parsedList || []) {
    if (!parsed) continue;
    raw.push(...(parsed.items || []));
    warnings.push(...(parsed.warnings || []));
    if (parsed.format) formats.add(parsed.format);
  }

  // Rejoin split exports. Omnivore ships metadata_<n>.json (tags, labels, dates,
  // highlights) beside contents/<slug>.html (the article text); neither half is
  // the library on its own, and the text half is what survives link rot.
  const articles = new Map();
  for (const item of raw) {
    if (item?.source === "article-html" && item.slug) articles.set(item.slug, item);
  }
  const items = [];
  const usedSlugs = new Set();
  let joinedText = 0;
  for (const item of raw) {
    if (item?.source === "article-html") continue; // handled below
    const article = item?.slug ? articles.get(String(item.slug).toLowerCase()) || articles.get(item.slug) : null;
    if (article) {
      usedSlugs.add(article.slug);
      if (!item.content && article.content) {
        item.content = article.content;
        joinedText++;
      }
      if (!item.title && article.title) item.title = article.title;
    }
    items.push(item);
  }
  // An article file with no metadata partner is still worth keeping if it
  // carries its own canonical URL.
  let orphaned = 0;
  for (const [slug, article] of articles) {
    if (usedSlugs.has(slug)) continue;
    if (article.url) items.push(article);
    else orphaned++;
  }
  if (joinedText) warnings.push(`Article text recovered for ${joinedText.toLocaleString()} item${joinedText === 1 ? "" : "s"} from the matching HTML files.`);
  if (orphaned) warnings.push(`${orphaned.toLocaleString()} article HTML file${orphaned === 1 ? "" : "s"} had no URL and no matching metadata, so ${orphaned === 1 ? "it was" : "they were"} skipped.`);

  return {
    format: formats.size === 1 ? [...formats][0] : [...formats].join("+") || "unknown",
    label: [...formats].map((f) => FORMAT_BY_ID.get(f)?.label || f).join(" + "),
    items,
    warnings: [...new Set(warnings)],
    fileCount: (parsedList || []).length,
    joinedArticleText: joinedText,
  };
}

/**
 * @param {object} parsed  `{ format, items }` from parseExport()
 * @param {object} [options]
 * @param {string} [options.targetDeck="inbox"]  deck for imported items, or "auto" to classify each one
 * @param {boolean} [options.foldersAsTags=true] keep source folders/collections as tags
 * @param {boolean} [options.statusAsTags=true]  keep archive/favourite state as tags
 * @param {boolean} [options.keepDates=true]     use the source's saved-at date
 * @param {boolean} [options.autoTag=true]       run the offline classifier for extra tags
 * @returns {{items: Array, stats: object, warnings: string[]}}
 */
export function toKipideckItems(parsed, options = {}) {
  const {
    targetDeck = "inbox",
    foldersAsTags = true,
    statusAsTags = true,
    keepDates = true,
    autoTag = true,
  } = options;

  const now = Date.now();
  const out = [];
  const warnings = [];
    const stats = {
    parsed: parsed?.items?.length || 0,
    usable: 0, noUrl: 0, noTitle: 0, withTags: 0, withDates: 0,
    unread: 0, archived: 0, favorites: 0, highlights: 0, duplicatesInFile: 0,
    decks: new Set(),
  };
  const seenCanon = new Set();
  let duplicatesInFile = 0;

  for (const raw of parsed?.items || []) {
    const url = withProtocol(unwrapRedirect(raw?.url || raw?.link || raw?.href || ""));
    // A saved window has no single URL of its own — its links live in `tabs`.
    // It is still a first-class record, not a row to skip.
    const isSession = String(raw?.type || "").toLowerCase() === "session" && Array.isArray(raw?.tabs);
    if ((!url || !canonicalUrl(url)) && !isSession) {
      stats.noUrl++;
      continue;
    }

    // Same URL twice inside one export is common (Pocket lists unread and
    // archive separately, and people merge CSV parts by hand). Sessions have no
    // canonical URL to collide on — two saves of one window are two moments,
    // not a duplicate — so only URL items dedupe here.
    const canon = canonicalUrl(url);
    if (canon) {
      if (seenCanon.has(canon)) {
        duplicatesInFile++;
        continue;
      }
      seenCanon.add(canon);
    }

    const domain = hostOf(url);
    let title = cleanText(raw.title, MAX_TITLE_CHARS);
    if (!title) {
      title = domain || url;
      stats.noTitle++;
    }

    const tags = new Set((raw.tags || []).map((t) => cleanText(String(t)).toLowerCase()).filter(Boolean));
    if (foldersAsTags && raw.folder) {
      for (const part of String(raw.folder).split("/")) {
        const tag = cleanText(part).toLowerCase();
        if (tag && tag.length <= 40 && !tag.includes("bookmarks bar")) tags.add(tag);
      }
    }
    if (raw.status === "archive") stats.archived++;
    else if (raw.status === "unread") stats.unread++;
    if (raw.favorite || raw.status === "favorite") stats.favorites++;
    // Read-state is preserved, but only the non-default states become tags:
    // tagging 90% of an imported library "unread" is noise, not information.
    if (statusAsTags && (raw.status === "archive" || raw.status === "favorite")) tags.add(raw.status);
    if (statusAsTags && raw.favorite && raw.status !== "favorite") tags.add("favorite");
    if (raw.private) tags.add("private");

    const type = mapType(raw.type, url, title);
    const note = cleanText(raw.note, MAX_NOTE_CHARS);
    if (note) stats.highlights++;
    const content = cleanText(raw.content, MAX_CONTENT_CHARS);
    const addedAt = keepDates ? saneDate(toMillis(raw.addedAt), now) : now;
    const updatedAt = keepDates ? saneDate(toMillis(raw.updatedAt), addedAt) : now;

    const candidate = {
      type,
      title,
      url,
      sourceUrl: url,
      domain,
      tags: [],
      deckId: "inbox",
      // Pocket/Raindrop/Instapaper read-states land here; unknown text falls
      // back to unread rather than inventing a fifth save-state.
      status: fromForeignStatus(raw.status ?? raw.read ?? raw.archived),
      excerpt: cleanText(raw.excerpt, 400),
      note,
      content,
      createdAt: addedAt,
      updatedAt,
    };
    if (raw.image) candidate.image = cleanText(raw.image, 500);
    if (raw.pinned) candidate.pinned = true;
    if (raw.author) candidate.reference = cleanText(`By ${raw.author}`, 200);
    if (type === "session" && Array.isArray(raw.tabs)) {
      candidate.tabs = raw.tabs;
      candidate.tabCount = Number(raw.tabCount) || raw.tabs.length;
    }

    // A Kipideck export carries its own deck; honour it over the dialog's choice.
    const deckId = raw.keepDeckId || (targetDeck === "auto" || !targetDeck ? null : targetDeck);
    if (deckId) {
      candidate.deckId = deckId;
      if (autoTag) {
        const suggested = classify(candidate).tags;
        for (const t of suggested) tags.add(t);
      }
    } else {
      const suggested = classify(candidate);
      candidate.deckId = suggested.deckId || "inbox";
      for (const t of suggested.tags) tags.add(t);
    }

    candidate.tags = [...tags].slice(0, MAX_TAGS);
    if (candidate.tags.length) stats.withTags++;
    if (raw.addedAt) stats.withDates++;
    stats.usable++;
    stats.decks.add(candidate.deckId);
    out.push(candidate);
  }

  if (duplicatesInFile) warnings.push(`${duplicatesInFile.toLocaleString()} duplicate link${duplicatesInFile === 1 ? "" : "s"} inside the file were merged into one item each.`);
  if (stats.noUrl) warnings.push(`${stats.noUrl.toLocaleString()} row${stats.noUrl === 1 ? "" : "s"} had no usable URL and were skipped.`);
  if (stats.noTitle) warnings.push(`${stats.noTitle.toLocaleString()} item${stats.noTitle === 1 ? "" : "s"} had no title, so the domain is used instead.`);

  return { items: out, stats: { ...stats, decks: [...stats.decks], duplicatesInFile }, warnings };
}

function mapType(rawType, url, title) {
  const t = String(rawType || "").toLowerCase();
  if (t === "session") return "session";
  if (t === "image" || /\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i.test(url)) return "image";
  if (t === "video" || /(youtube\.com|youtu\.be|vimeo\.com|twitch\.tv|netflix\.com)/i.test(url)) return "video";
  if (t === "document" || t === "book" || /\.pdf(\?|#|$)/i.test(url)) return "page";
  if (t === "audio") return "page";
  if (t === "note" || t === "selection" || t === "quote") return "selection";
  return "page";
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Parse one exported file.
 * @param {{name?: string, text: string}} file
 * @param {{format?: string}} [options] force a format instead of detecting one
 * @returns {{format: string, label: string, items: Array, warnings: string[], confidence: number}}
 */
export function parseExport(file, options = {}) {
  const name = file?.name || "";
  const text = String(file?.text ?? "");
  const label = name ? `\u201c${name}\u201d` : "That file";
  const warnings = [];

  // A ZIP reaching the text parser means the dialog's archive expansion was
  // bypassed. Refuse with an instruction — never by "parsing" the mojibake
  // into phantom links. (Char codes, not escapes: PK\x03\x04 and siblings.)
  const looksZipped =
    text.length >= 4 &&
    text[0] === "P" &&
    text[1] === "K" &&
    ((text.charCodeAt(2) === 3 && text.charCodeAt(3) === 4) ||
      (text.charCodeAt(2) === 5 && text.charCodeAt(3) === 6) ||
      (text.charCodeAt(2) === 7 && text.charCodeAt(3) === 8));
  if (looksZipped) {
    throw new Error(`${label} is a ZIP archive — pick it in the import dialog and Kipideck will unzip it in the browser.`);
  }

  const detected = options.format && FORMAT_BY_ID.has(options.format)
    ? { id: options.format, label: FORMAT_BY_ID.get(options.format).label, confidence: 1, reason: "chosen manually" }
    : detectFormat({ name, text });

  if (detected.id === "zip") throw new Error(`${label}: ${detected.reason}`);
  if (!text.trim()) throw new Error(`${label} is empty \u2014 re-export it and try again.`);

  // One JSON parse for the whole file, and a message a person can act on.
  // Scavenging URLs out of a corrupt 40 MB JSON would look like success while
  // losing almost everything, so a failed parse is an error, not a fallback.
  const jsonShaped = /^\s*[[{]/.test(text);
  let data = null;
  if (jsonShaped) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`${label} is not valid JSON \u2014 it may be truncated, still downloading, or inside a zip. Re-export it and try again.`);
    }
  }

  let items = [];
  let format = detected.id;

  switch (detected.id) {
    case "kipideck": {
      // Storage.importJSON is the real path for our own export (it also merges
      // decks and tombstones). Normalising it here lets the dialog preview a
      // Kipideck file exactly like a foreign one.
      const rawItems = Array.isArray(data?.items) ? data.items : [];
      items = rawItems.map((r) => ({
        url: r.url || r.sourceUrl || "",
        title: r.title,
        excerpt: r.excerpt,
        note: r.note,
        content: r.content,
        tags: r.tags,
        folder: "",
        addedAt: r.createdAt,
        updatedAt: r.updatedAt,
        type: r.type,
        image: r.image,
        keepDeckId: r.deckId,
        pinned: !!r.pinned,
        status: r.status,
        tabs: Array.isArray(r.tabs) ? r.tabs : undefined,
        tabCount: r.tabCount,
      }));
      break;
    }

    case "bookmarks-json":
      items = parseChromeBookmarksJson(data);
      break;

    case "raindrop":
    case "pinboard":
    case "wallabag":
    case "omnivore": {
      const parsed = parseJsonLibrary(data);
      items = parsed.items;
      if (parsed.kind === "unknown") {
        warnings.push("That JSON did not match a known export, so links were read from whatever url/link/href fields it has.");
      }
      break;
    }

    case "article-html": {
      items = parseArticleHtml(text, { name });
      if (!items.length) warnings.push(`${label} did not contain enough article text to import.`);
      break;
    }

    case "pocket-html":
    case "bookmarks-html": {
      items = parseNetscapeHtml(text, { headingsAsStatus: detected.id === "pocket-html" });
      if (!items.length) {
        warnings.push(`No links were found in ${label}.`);
      } else if (items.skippedNoUrl) {
        const n = items.skippedNoUrl;
        warnings.push(`${n} bookmark${n === 1 ? "" : "s"} had no usable address and ${n === 1 ? "was" : "were"} skipped.`);
      }
      break;
    }

    case "pocket-csv":
    case "instapaper":
    case "readwise": {
      items = parseTabular(text, detected.id);
      if (!items.length) warnings.push(`No rows with a usable URL were found in ${label}.`);
      break;
    }

    case "url-list": {
      if (jsonShaped) items = parseJsonLibrary(data).items;
      else if (isProbablyCsv(text.slice(0, 4000)) || /\.(csv|tsv)$/i.test(name)) items = parseTabular(text, "generic");
      else items = parseUrlList(text);
      if (!items.length) warnings.push(`No URLs were found in ${label}.`);
      break;
    }

    default: {
      // Last resort: try every shape and keep whichever produced the most.
      const attempts = [
        ["bookmarks-html", () => parseNetscapeHtml(text, { headingsAsStatus: false })],
        ["url-list", () => parseUrlList(text)],
        ["csv", () => parseTabular(text, "generic")],
      ];
      for (const [id, run] of attempts) {
        try {
          // A guess only counts if it found actual links. Otherwise binary junk
          // would "import" as a CSV of titled, addressless rows.
          const result = run().filter((r) => r && r.url);
          if (result.length > items.length) { items = result; format = id; }
        } catch {
          /* try the next shape */
        }
      }
      if (!items.length) throw new Error(`Kipideck could not read ${label}. ${detected.reason || ""}`.trim());
      warnings.push(`Read as ${FORMAT_BY_ID.get(format)?.label || format} after guessing \u2014 check the preview before importing.`);
    }
  }

  // Rows with a title but no address stay in the list so they get counted and
  // reported; rows with neither are noise.
  items = items.filter((item) => item && (item.url || item.title));

  return { format, label: FORMAT_BY_ID.get(format)?.label || format, items, warnings, confidence: detected.confidence ?? 0.5 };
}

/** CSV/TSV shapes: Pocket, Instapaper, Readwise, Raindrop CSV, or unknown columns. */
export function parseTabular(text, kind = "generic") {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const { objects } = csvToObjects(rows);
  return objects.map((row) => {
    const get = (...names) => {
      for (const n of names) {
        if (row[n] !== undefined && String(row[n]).trim() !== "") return row[n];
      }
      return "";
    };

    const url = withProtocol(unwrapRedirect(get("url", "href", "link", "originalurl")));
    const title = cleanText(get("title", "name", "description_title"), MAX_TITLE_CHARS);
    const description = cleanText(get("description", "excerpt", "summary", "extended"), 400);
    const tagsRaw = get("tags", "labels", "tag");
    const status = normalizeStatus(get("status", "read_status", "state", "archived", "toread"));
    const addedRaw = get("time_added", "added", "date", "created", "saved_at", "savedat", "timestamp");
    const updatedRaw = get("updated", "modified", "last_modified", "updated_at");
    const note = cleanText(get("notes", "note"), MAX_NOTE_CHARS);
    const body = get("content");
    const folder = cleanText(get("folder", "collection", "category"), 120);
    const image = cleanText(get("image", "cover", "thumbnail"), 500);
    const author = cleanText(get("author"), 120);

    return {
      url, title, excerpt: description, tags: splitTags(tagsRaw), status,
      addedAt: toMillis(addedRaw), updatedAt: toMillis(updatedRaw), note, folder, image, author,
      content: body && String(body).length > 40 ? cleanText(body, MAX_CONTENT_CHARS) : "",
      source: kind,
    };
  }).filter((item) => item && (item.url || item.title));
}
