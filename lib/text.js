// lib/text.js
// Shared text primitives used by BOTH the indexer (lib/db.js) and the query
// engine (lib/search.js). Kept in its own module so the two can never drift
// apart — a term that the indexer drops but the query keeps (or vice versa)
// would silently make items unfindable.
//
// Pure functions, no browser APIs, no dependencies: safe to import from the
// service worker, the popup, the library page, and the node test harness.

/** Words that carry no retrieval signal. Kept deliberately small — over-aggressive
 * stopword lists make non-English libraries unsearchable. */
export const STOPWORDS = new Set(
  (
    "a an the and or but of to in on for with is are was were be been being this that it its as at by " +
    "from into over under again further than then once here there all any both each few more most other " +
    "some such no nor not only own same so too very s t can will just don should now"
  ).split(/\s+/)
);

/** Bit flags recording which field(s) a term occurred in. Packed into the
 * postings arrays so one record can serve all field-weighted scoring. */
export const FIELD_BITS = {
  title: 1,
  tags: 2,
  excerpt: 4,
  note: 8,
  domain: 16,
  content: 32,
};

/** Lowercase, strip punctuation, drop stopwords and 1-char tokens.
 *
 * v1.3 replaced every non-ASCII character with a space, which made saves in
 * Hindi/Devanagari (or any non-Latin script) literally unsearchable — the whole
 * language indexed as nothing. Letters and digits from ANY script are kept now.
 * Accents are still folded, but only for Latin-script tokens, where "café" and
 * "cafe" ought to match; stripping combining marks from other scripts would
 * mangle the word instead. */
export function tokenize(text) {
  if (!text) return [];
  const spaced = String(text)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\p{M}\s#]/gu, " ");
  const out = [];
  for (let tok of spaced.split(/\s+/)) {
    if (!tok) continue;
    if (/[a-z\u00c0-\u024f]/.test(tok)) tok = tok.replace(/\p{Mn}/gu, "").normalize("NFC");
    if (tok.length > 1 && !STOPWORDS.has(tok)) out.push(tok);
  }
  return out;
}

/**
 * Term frequencies for a string, optionally capped to the N most frequent
 * terms. Capping is what keeps a 50,000-item library's index bounded: an
 * 8,000-char article has ~700 distinct terms, but the top ~250 carry almost
 * all of the retrieval signal.
 * @returns {Map<string, number>}
 */
export function termFrequencies(text, cap = 0) {
  const freq = new Map();
  for (const t of tokenize(text)) freq.set(t, (freq.get(t) || 0) + 1);
  if (!cap || freq.size <= cap) return freq;
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, cap);
  return new Map(top);
}

/**
 * Build the per-term field mask + total occurrence count for one item.
 * `fields` is `{ title, tags, excerpt, note, domain, content }`; `caps` limits
 * how many terms each of the heavy fields contributes.
 * @returns {{ byTerm: Map<string, {mask:number,count:number}>, smallTerms: string[], contentTerms: string[] }}
 */
export function analyzeFields(fields, caps = {}) {
  const byTerm = new Map();

  const add = (fieldName, text, cap) => {
    const bit = FIELD_BITS[fieldName];
    if (!bit) return [];
    const freq = termFrequencies(text, cap || 0);
    for (const [term, count] of freq) {
      const cur = byTerm.get(term) || { mask: 0, count: 0 };
      cur.mask |= bit;
      cur.count += count;
      byTerm.set(term, cur);
    }
    return [...freq.keys()];
  };

  // Small fields are indexed in full — they are what users actually remember.
  const smallTerms = [
    ...add("title", fields.title, caps.small),
    ...add("tags", fields.tags, caps.small),
    ...add("excerpt", fields.excerpt, caps.small),
    ...add("note", fields.note, caps.small),
    ...add("domain", fields.domain, caps.small),
  ];

  // Full page text is capped: it is by far the biggest contributor to index
  // size, and the marginal term almost never changes what a search finds.
  const contentTerms = add("content", fields.content, caps.content);

  return {
    byTerm,
    smallTerms: [...new Set(smallTerms)],
    contentTerms: [...new Set(contentTerms)],
  };
}

/** Which fields a mask says a term appeared in (used for the "matched in" UI). */
export function fieldsFromMask(mask) {
  const out = [];
  for (const [name, bit] of Object.entries(FIELD_BITS)) if (mask & bit) out.push(name);
  return out;
}
