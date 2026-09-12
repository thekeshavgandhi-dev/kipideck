// lib/search.js — query engine over the persistent inverted index in lib/db.js.
//
// WHAT CHANGED AND WHY
// v1.3 rebuilt the entire inverted index inside `search()` on every call, and
// the Library called it twice per keystroke. Measured on the real v1.3 code:
// a 10-character query cost 2.2 s of frozen UI at 500 items, 8.5 s at 2,000
// and 21 s at 5,000. Nothing here re-scans the corpus any more — a query reads
// the term dictionary plus a handful of chunked postings records, so cost tracks
// the number of *matches*, not the size of the library.
//
// Ranking keeps v1.3's field weighting (title > tags > excerpt/note > domain >
// content), exact beats prefix, and `tag:` / `site:` operators still work.
//
// Everything is offline: no network, no external service, no account.

import { tokenize, fieldsFromMask, FIELD_BITS } from "./text.js";
import * as db from "./db.js";

/** Field weights — identical priority order to v1.3 so saved searches rank the same. */
export const FIELD_WEIGHTS = {
  title: 6,
  tags: 5,
  excerpt: 3,
  note: 3,
  domain: 2,
  content: 1,
};

const PREFIX_BOOST = 0.5;
/** Prefix expansions for extremely common terms are skipped: they cost a lot
 * and can only push noise above a real exact hit. */
const HIGH_DF_PREFIX_SKIP = 20_000;

// ---------------------------------------------------------------------------
// Query parsing
// ---------------------------------------------------------------------------

/** Split `carbonara site:foodblog.com tag:recipe` into free terms + filters. */
export function parseQuery(rawQuery) {
  const filters = { tag: [], site: [] };
  const freeTerms = [];
  for (const part of String(rawQuery || "").trim().split(/\s+/)) {
    const m = part.match(/^(tag|site):(.+)$/i);
    if (m) filters[m[1].toLowerCase()].push(m[2].toLowerCase());
    else if (part) freeTerms.push(part);
  }
  return { filters, freeTerms, terms: tokenize(freeTerms.join(" ")) };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function weightForMask(mask) {
  // A posting packs every field the term appeared in. Scoring with the strongest
  // field plus a small multi-field bonus keeps title hits on top (as in v1.3)
  // without over-inflating terms that happen to appear in four fields.
  let max = 0;
  let fields = 0;
  for (const [name, bit] of Object.entries(FIELD_BITS)) {
    if (mask & bit) {
      fields++;
      const w = FIELD_WEIGHTS[name] || 1;
      if (w > max) max = w;
    }
  }
  return max + (fields > 1 ? (fields - 1) * 0.5 : 0);
}

function accumulate(scores, postings, boost, termSet) {
  for (let i = 0; i + 2 < postings.length; i += 3) {
    const n = postings[i];
    const mask = postings[i + 1];
    const count = postings[i + 2];
    const cur = scores.get(n) || { score: 0, mask: 0 };
    cur.score += count * weightForMask(mask) * boost;
    cur.mask |= mask;
    scores.set(n, cur);
    if (termSet) termSet.add(n);
  }
}

/**
 * Multi-word queries match ALL words when every word hits something, and fall
 * back to ranked OR results when they don't — so "carbonara recipe" narrows
 * instead of dumping the whole library, while a query with one typo still
 * returns the closest matches instead of an empty screen.
 */
function intersectTermSets(termSets) {
  if (termSets.length < 2) return null;
  if (termSets.some((set) => set.size === 0)) return null;
  const ordered = [...termSets].sort((a, b) => a.size - b.size);
  const [smallest, ...rest] = ordered;
  const out = new Set();
  for (const n of smallest) if (rest.every((set) => set.has(n))) out.add(n);
  return out.size ? out : null;
}

// ---------------------------------------------------------------------------
// The search
// ---------------------------------------------------------------------------

/**
 * Full-text search across the persistent index.
 *
 * @param {object} opts
 * @param {string} opts.query       free text, may include `tag:` / `site:`
 * @param {string|null} opts.deckId scope to one deck
 * @param {string|null} opts.tag    scope to one tag
 * @param {boolean} opts.pinned     scope to pinned items
 * @param {number} opts.limit       page size
 * @param {number} opts.offset      page offset
 * @param {"relevance"|"new"|"old"|"az"} opts.sort
 * @param {Set<string>|null} opts.excludeIds  ids already rendered (pinned-first)
 * @returns {Promise<{items: object[], total: number, matchedTerms: string[], degraded: boolean, totalApprox: boolean}>}
 *   `items` are metadata records (no `content`) annotated with `_score` and
 *   `_matchedFields`. Fetch text with `db.getContent(id)` for the handful of
 *   cards actually on screen.
 */
export async function searchItems({
  query = "",
  deckId = null,
  tag = null,
  pinned = false,
  limit = 60,
  offset = 0,
  sort = "relevance",
  excludeIds = null,
} = {}) {
  const { filters, terms } = parseQuery(query);
  const scopeTag = filters.tag[0] || tag || null;
  const scopeSite = filters.site[0] || null;

  // No searchable text → this is a browse, not a search.
  if (terms.length === 0) {
    const res = await db.listItems({ deckId, tag: scopeTag, pinned, sort: sort === "relevance" ? "new" : sort, limit, offset, excludeIds });
    return { items: res.items, total: res.total, matchedTerms: [], degraded: false };
  }

  const allowed = await db.filterNums({ deckId, tag: scopeTag, pinned });
  const scores = new Map();
  const termSets = [];
  const matchedTerms = [];
  let budget = db.MAX_POSTINGS_PER_QUERY;
  let degraded = false;

  for (const term of terms) {
    const termSet = new Set();
    termSets.push(termSet);

    // Exact match — always scored, whatever its document frequency.
    const exact = await db.postingsForTerm(term);
    if (exact.length) {
      matchedTerms.push(term);
      accumulate(scores, exact, 1, termSet);
      budget -= exact.length / 3;
    }

    // Prefix match ("prog" → "programming"), most selective first.
    for (const { term: t, df } of await db.termsWithPrefix(term)) {
      if (t === term) continue;
      if (df > HIGH_DF_PREFIX_SKIP) continue;
      if (budget <= 0) {
        degraded = true;
        break;
      }
      const postings = await db.postingsForTerm(t);
      if (!postings.length) continue;
      accumulate(scores, postings, PREFIX_BOOST, termSet);
      budget -= postings.length / 3;
    }

    if (budget <= 0) degraded = true;
  }

  // Scope filter, then the all-words intersection.
  let candidates = [...scores.entries()];
  if (allowed) candidates = candidates.filter(([n]) => allowed.has(n));
  const allWords = intersectTermSets(termSets);
  if (allWords) candidates = candidates.filter(([n]) => allWords.has(n));
  if (excludeIds && excludeIds.size) {
    const excluded = new Set();
    for (const id of excludeIds) {
      const n = await db.numById(id);
      if (n !== undefined) excluded.add(n);
    }
    if (excluded.size) candidates = candidates.filter(([n]) => !excluded.has(n));
  }
  if (candidates.length === 0) {
    return { items: [], total: 0, matchedTerms, degraded, totalApprox: false };
  }

  const matchesSite = (meta) => !scopeSite || String(meta.domain || "").toLowerCase().includes(scopeSite);
  const annotate = (meta, info) => ({ ...meta, _score: info.score, _matchedFields: fieldsFromMask(info.mask) });

  // Non-relevance sorts are answered by walking the right index and testing
  // set membership — exact global ordering with no bulk record resolution.
  if (sort !== "relevance") {
    const nums = new Set(candidates.map(([n]) => n));
    const res = await db.listItemsMatching({ nums, sort, deckId, tag: scopeTag, pinned, limit, offset });
    const items = res.items.filter(matchesSite).map((meta) => annotate(meta, scores.get(meta.n) || { score: 0, mask: 0 }));
    return {
      items,
      total: scopeSite ? items.length : res.total,
      matchedTerms,
      degraded,
      totalApprox: !!scopeSite,
    };
  }

  // Relevance: only the requested page is ever resolved to records.
  candidates.sort((a, b) => b[1].score - a[1].score);
  const need = offset + limit;
  const overFetch = scopeSite ? 3 : 1; // site: is checked on the record, so grab spare rows
  const windowSize = Math.min(candidates.length, Math.max(need * overFetch, need + 60), db.RESOLVE_CAP);
  const window = candidates.slice(0, windowSize);
  if (windowSize < candidates.length && scopeSite) degraded = true;

  const ids = await db.idsByNums(window.map(([n]) => n));
  const metas = await db.getItemMetas(ids.filter(Boolean));
  const metaById = new Map(metas.map((m) => [m.id, m]));

  const scored = [];
  for (let i = 0; i < window.length; i++) {
    const meta = metaById.get(ids[i]);
    if (!meta || !matchesSite(meta)) continue;
    scored.push(annotate(meta, window[i][1]));
  }
  scored.sort((a, b) => b._score - a._score || b.createdAt - a.createdAt);

  return {
    items: scored.slice(offset, offset + limit),
    total: scopeSite ? scored.length : candidates.length,
    matchedTerms,
    degraded,
    totalApprox: !!scopeSite && windowSize < candidates.length,
  };
}

// ---------------------------------------------------------------------------
// Snippets
// ---------------------------------------------------------------------------

/** Highlighted snippet around the first query hit in a text field. Sync, and
 * only ever called for the cards actually on screen. */
export function snippet(text, rawQuery, radius = 60) {
  if (!text) return "";
  const terms = tokenize(String(rawQuery || "").replace(/\b(tag|site):\S+/gi, ""));
  if (terms.length === 0) return text.slice(0, radius * 2);
  const lower = String(text).toLowerCase();
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

// ---------------------------------------------------------------------------
// In-memory engine (fallback + tests)
// ---------------------------------------------------------------------------

/** Build a throwaway inverted index over an array of items. Only used by the
 * node test suite and as a defensive fallback when IndexedDB is unavailable
 * (private-browsing edge cases); the Library never calls this per keystroke. */
export function buildIndex(items) {
  const index = new Map();
  for (const item of items) {
    for (const field of Object.keys(FIELD_WEIGHTS)) {
      const text = field === "tags" ? (item.tags || []).join(" ") : item[field] || "";
      const seen = new Map();
      for (const t of tokenize(text)) seen.set(t, (seen.get(t) || 0) + 1);
      for (const [term, count] of seen) {
        if (!index.has(term)) index.set(term, []);
        index.get(term).push({ id: item.id, field, count });
      }
    }
  }
  return index;
}

/** Synchronous search over a plain array of items (v1.3-compatible). */
export function searchInMemory(items, rawQuery) {
  const { filters, terms } = parseQuery(rawQuery);
  let pool = items;
  if (filters.tag.length) {
    pool = pool.filter((it) => filters.tag.every((t) => (it.tags || []).map((x) => x.toLowerCase()).includes(t)));
  }
  if (filters.site.length) {
    pool = pool.filter((it) => filters.site.some((s) => (it.domain || "").toLowerCase().includes(s)));
  }
  if (terms.length === 0) return pool;

  const index = buildIndex(pool);
  const scores = new Map();
  for (const term of terms) {
    for (const [key, postings] of index) {
      if (key === term || key.startsWith(term)) {
        const boost = key === term ? 1 : PREFIX_BOOST;
        for (const p of postings) {
          const s = scores.get(p.id) || { score: 0, fields: new Set() };
          s.score += p.count * (FIELD_WEIGHTS[p.field] || 1) * boost;
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
    if (item) results.push({ ...item, _score: s.score, _matchedFields: [...s.fields] });
  }
  results.sort((a, b) => b._score - a._score || b.createdAt - a.createdAt);
  return results;
}
