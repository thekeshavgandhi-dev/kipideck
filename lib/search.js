// lib/search.js
// Offline full-text search & ranking engine for Kipideck. Indexes the full
// captured page text (see lib/extract.js) alongside title/tags/notes/domain,
// so you can find a saved item by something it *said*, not just its title.
// No network calls, no external search service — everything runs in-memory
// against chrome.storage.local's contents.

const FIELD_WEIGHTS = {
  title: 6,
  tags: 5,
  excerpt: 3,
  note: 3,
  domain: 2,
  content: 1, // full page text — big but lowest weight per occurrence
};

const STOPWORDS = new Set(
  "a an the and or but of to in on for with is are was were be been being this that it its as at by from into over under again further than then once here there all any both each few more most other some such no nor not only own same so than too very s t can will just don should now".split(
    " "
  )
);

function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s#]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function fieldText(item, field) {
  if (field === "tags") return (item.tags || []).join(" ");
  return item[field] || "";
}

/**
 * Build a lightweight in-memory inverted index: term -> [{id, field, count}]
 * Rebuilt on demand (fast even for thousands of items; pure string ops).
 */
export function buildIndex(items) {
  const index = new Map();
  for (const item of items) {
    for (const field of Object.keys(FIELD_WEIGHTS)) {
      const tokens = tokenize(fieldText(item, field));
      const seen = new Map();
      for (const t of tokens) seen.set(t, (seen.get(t) || 0) + 1);
      for (const [term, count] of seen) {
        if (!index.has(term)) index.set(term, []);
        index.get(term).push({ id: item.id, field, count });
      }
    }
  }
  return index;
}

/**
 * Search items by a free-text query. Returns items sorted by relevance score
 * (highest first), each annotated with `_score` and `_matchedFields`.
 * Supports simple `tag:foo` and `site:example.com` filters in the query.
 */
export function search(items, rawQuery) {
  const query = (rawQuery || "").trim();
  if (!query) return items;

  // Pull out structured filters like "tag:recipe" or "site:github.com"
  const filters = { tag: [], site: [] };
  const freeTerms = [];
  for (const part of query.split(/\s+/)) {
    const m = part.match(/^(tag|site):(.+)$/i);
    if (m) filters[m[1].toLowerCase()].push(m[2].toLowerCase());
    else if (part) freeTerms.push(part);
  }

  let pool = items;
  if (filters.tag.length) {
    pool = pool.filter((it) => filters.tag.every((t) => (it.tags || []).map((x) => x.toLowerCase()).includes(t)));
  }
  if (filters.site.length) {
    pool = pool.filter((it) => filters.site.some((s) => (it.domain || "").toLowerCase().includes(s)));
  }

  const terms = tokenize(freeTerms.join(" "));
  if (terms.length === 0) return pool;

  const index = buildIndex(pool);
  const scores = new Map(); // id -> { score, fields:Set }

  for (const term of terms) {
    // exact match + simple prefix match (so "prog" finds "programming")
    for (const [key, postings] of index) {
      if (key === term || key.startsWith(term)) {
        const boost = key === term ? 1 : 0.5;
        for (const p of postings) {
          const weight = FIELD_WEIGHTS[p.field] || 1;
          const s = scores.get(p.id) || { score: 0, fields: new Set() };
          s.score += p.count * weight * boost;
          s.fields.add(p.field);
          scores.set(p.id, s);
        }
      }
    }
  }

  const byId = new Map(pool.map((it) => [it.id, it]));
  const results = [];
  for (const [id, s] of scores) {
    const item = byId.get(id);
    if (item) results.push({ ...item, _score: s.score, _matchedFields: Array.from(s.fields) });
  }
  results.sort((a, b) => b._score - a._score || b.createdAt - a.createdAt);
  return results;
}

/** Small helper to build a highlighted snippet around the first query hit in a text field. */
export function snippet(text, rawQuery, radius = 60) {
  if (!text) return "";
  const terms = tokenize(rawQuery.replace(/\b(tag|site):\S+/gi, ""));
  if (terms.length === 0) return text.slice(0, radius * 2);
  const lower = text.toLowerCase();
  let idx = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i !== -1 && (idx === -1 || i < idx)) idx = i;
  }
  if (idx === -1) return text.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + radius);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}
