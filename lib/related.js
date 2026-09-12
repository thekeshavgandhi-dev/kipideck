// lib/related.js — the "related items" rail (ideas.md I-16, second half).
//
// WHY: Kipideck's dedupe (v1.4) keeps a library clean; nothing yet made the
// library *connect*. Recall charges ~$10/mo for a knowledge graph; Raindrop
// offers nothing. A "these are about the same thing" rail on every detail view
// is the same retention trick done honestly: shared tags, shared site, shared
// deck, and title-word overlap — computed locally, from what is already
// indexed, in microseconds.
//
// COST DISCIPLINE (the 50k rule): this module NEVER sees the whole library.
// The caller assembles a bounded candidate pool (same-deck page + per-tag
// pages, each capped), and everything below is O(pool × title tokens).
//
// Pure string/set work — no browser, no storage — so `test/related.test.js`
// can pin every weight and every tie-break with fixtures.

import { tokenize } from "./text.js";

/** Weights, exposed for tests and for the "why filed here" copy. */
export const RELATED_WEIGHTS = {
  perSharedTag: 3,
  sameDomain: 2,
  sameDeck: 1,
  titleOverlap: 4, // multiplied by the token-overlap ratio
};

/**
 * Score candidate items against a source item; return the top matches with a
 * human-readable reason for each.
 *
 * @param {object} source  the open item (needs id; tags/domain/deckId/title optional)
 * @param {object[]} candidates  bounded pool from the data layer (may include the source itself)
 * @param {{limit?: number, weights?: object, now?: number}} [opts]
 * @returns {Array<{id: string, score: number, why: string[]}>} descending score, ties → newer first
 */
export function scoreRelated(source, candidates, { limit = 6, weights, now = Date.now() } = {}) {
  if (!source || !Array.isArray(candidates) || !candidates.length) return [];
  const w = { ...RELATED_WEIGHTS, ...(weights || {}) };

  const srcTags = new Set((source.tags || []).map((t) => String(t).toLowerCase().trim()).filter(Boolean));
  const srcTokens = new Set(tokenize(source.title || ""));
  const srcDomain = String(source.domain || "").toLowerCase();

  const scored = [];
  for (const c of candidates) {
    if (!c || !c.id || c.id === source.id) continue;

    let score = 0;
    const why = [];

    const shared = [];
    for (const t of c.tags || []) {
      const tag = String(t).toLowerCase().trim();
      if (tag && srcTags.has(tag)) shared.push(tag);
    }
    if (shared.length) {
      score += w.perSharedTag * Math.min(shared.length, 3);
      why.push(`#${shared.slice(0, 2).join(" #")}`);
    }

    const cDomain = String(c.domain || "").toLowerCase();
    if (srcDomain && cDomain && srcDomain === cDomain) {
      score += w.sameDomain;
      why.push("same site");
    }

    if (source.deckId && c.deckId && source.deckId === c.deckId) {
      score += w.sameDeck;
      why.push("same deck");
    }

    if (srcTokens.size) {
      const cTokens = new Set(tokenize(c.title || ""));
      if (cTokens.size) {
        let common = 0;
        for (const t of srcTokens) if (cTokens.has(t)) common++;
        if (common) {
          // Overlap against the shorter title — two 3-word titles sharing
          // 2 words are far more "related" than a 2-word save next to a 20-word one.
          const ratio = common / Math.min(srcTokens.size, cTokens.size);
          score += w.titleOverlap * Math.min(ratio, 1);
          why.push("similar title");
        }
      }
    }

    if (score > 0) scored.push({ id: c.id, score: Math.round(score * 100) / 100, why, createdAt: c.createdAt || 0 });
  }

  scored.sort((a, b) => b.score - a.score || (b.createdAt || 0) - (a.createdAt || 0));
  return scored.slice(0, Math.max(0, limit)).map(({ createdAt, ...rest }) => rest);
}

/** One-line, honest summary for the rail header; "" when there is nothing to say. */
export function relatedSummary(results) {
  if (!results || !results.length) return "";
  return `${results.length} related item${results.length === 1 ? "" : "s"}, from your own library`;
}
