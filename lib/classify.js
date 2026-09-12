// lib/classify.js
// Lightweight, offline heuristic classifier that decides which deck a saved
// item belongs to and generates suggested tags. No network calls — everything
// runs locally so saving stays instant and private.
//
// TAG HYGIENE (ideas.md I-04): v1.3 tagged every save with `domain.split(".")[0]`,
// which produced tags like "the" for theverge.com, "www" for half the internet,
// and "co" for every .co.uk site. Suggestions now go through siteLabel(), are
// deduped against words already in the title (a tag that is already in the title
// adds nothing to findability), and are capped so the tag cloud stays readable.
// The user's own tags always win and are never dropped.
//
// v1.8 adds the second layer ideas.md I-15 sketched: when a save carries page
// text, keywords are extracted FROM THE TEXT (term frequency, position boost,
// the same hygiene rules), so a 4,000-word article about sourdough gets
// "sourdough" tagged without a regex ever having heard of bread. Regex rules
// still run first and still win ties — the new layer only fills spare slots.
// (Chrome built-in AI, when available, can become layer three — see I-13.)

import { siteLabel } from "./canon.js";
import { tokenize } from "./text.js";

/** Auto-suggestions stop here; the user's own tags are kept regardless. */
const MAX_AUTO_TAGS = 5;

const DOMAIN_RULES = [
  { test: /(youtube\.com|youtu\.be|vimeo\.com|twitch\.tv|netflix\.com)/, deckId: "videos", tags: ["video"] },
  { test: /(github\.com|gitlab\.com|stackoverflow\.com|developer\.mozilla\.org|npmjs\.com|readthedocs|docs\.|devdocs\.io)/, deckId: "dev", tags: ["dev"] },
  { test: /(amazon\.|flipkart\.|ebay\.|etsy\.|myntra\.|shopify|aliexpress)/, deckId: "shopping", tags: ["shopping"] },
  { test: /(arxiv\.org|scholar\.google|jstor\.org|ncbi\.nlm\.nih\.gov|researchgate\.net|springer\.com|sciencedirect\.com)/, deckId: "research", tags: ["research"] },
  { test: /(twitter\.com|x\.com|reddit\.com|instagram\.com|linkedin\.com|facebook\.com|threads\.net)/, deckId: "links", tags: ["social"] },
  { test: /(medium\.com|substack\.com|nytimes\.com|theguardian\.com|bbc\.|wired\.com|techcrunch\.com)/, deckId: "reading", tags: ["article"] },
];

const KEYWORD_TAGS = [
  { test: /\b(recipe|ingredients|cook|bake)\b/i, tag: "recipe" },
  { test: /\b(tutorial|how to|guide|step by step)\b/i, tag: "tutorial" },
  { test: /\b(react|javascript|python|typescript|api|css|html|node\.js|sql)\b/i, tag: "programming" },
  { test: /\b(travel|itinerary|flight|hotel|visa)\b/i, tag: "travel" },
  { test: /\b(job|resume|career|hiring|interview)\b/i, tag: "career" },
  { test: /\b(design|ui|ux|figma|typography)\b/i, tag: "design" },
  { test: /\b(price|discount|sale|\$\d|₹\d|deal)\b/i, tag: "deal" },
];

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Words so generic they only ever tag noise. The stopword list is retrieval-
 * tuned; this list is suggestion-tuned — "article" is a fine search term and a
 * useless tag. */
const JUNK_KEYWORDS = new Set([
  ...["article", "page", "web", "site", "video", "image", "photo", "post", "story", "news", "content", "information",
     "update", "version", "review", "best", "top", "new", "free", "online", "download", "pdf", "html", "https", "http",
     "www", "com", "org", "net", "app", "apps", "user", "users", "one", "two", "many", "much", "also", "than", "just",
     "like", "know", "want", "need", "good", "great", "really", "thing", "things", "time", "year", "years", "day", "days",
     "people", "way", "made", "make", "get", "got", "will", "would", "could", "should", "today", "week", "month"],
]);

/**
 * Keyword extraction, one document at a time (ideas.md I-15's second layer).
 *
 * A TextRank-lite without a second corpus: score = frequency × position
 * weight (tokens from the first ~40 sentences count triple — a word mentioned
 * early is a topic word, not a footer word), over tokens that survive
 * tokenize()'s stopword filter plus a suggestion-specific deny-list. Returns
 * at most `max` tags, ranked, each appearing ≥ `minCount` times.
 *
 * Honest limits: this is vocabulary, not semantics. It finds what the page
 * repeats prominently; it cannot find "monetary policy" in a page that only
 * says "the Fed raised rates". Chrome's built-in AI can later replace or
 * augment this layer (I-13/I-15) — behind the same cap, with the same hygiene.
 */
export function suggestKeywords(text, { max = 3, minCount = 2, title = "" } = {}) {
  const clean = String(text || "");
  if (clean.length < 600) return []; // below this, frequency is noise, not topic
  const titleWords = new Set(
    String(title || "")
      .toLowerCase()
      .split(/[^a-z0-9\u00c0-\uffff]+/)
      .filter((w) => w.length > 2)
  );
  const tokens = tokenize(clean);
  if (tokens.length < 60) return [];
  const earlyZone = Math.floor(tokens.length * 0.35);
  const score = new Map();
  tokens.forEach((tok, i) => {
    if (tok.length < 4 || /^\d+$/.test(tok) || JUNK_KEYWORDS.has(tok)) return;
    const w = i < earlyZone ? 3 : 1;
    score.set(tok, (score.get(tok) || 0) + w);
  });
  return [...score.entries()]
    .filter(([tok, s]) => s >= minCount * 2 && !titleWords.has(tok)) // a tag the title already carries adds nothing
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, max)
    .map(([tok]) => tok);
}

/**
 * Classify a captured item into { deckId, tags[] } using its type, domain,
 * title, and any captured text. This never blocks — pure string matching.
 */
export function classify(item) {
  const domain = item.domain || hostnameOf(item.url || item.sourceUrl || "");
  const haystack = [item.title, item.excerpt, item.content, item.note, domain].filter(Boolean).join(" ");
  // The user's tags are preserved verbatim (lowercased) and never trimmed away.
  const ownTags = (item.tags || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean);
  const tags = new Set(ownTags);
  const suggested = [];
  const suggest = (tag) => {
    if (!tag || tags.has(tag)) return;
    tags.add(tag);
    suggested.push(tag);
  };
  let deckId = null;

  // Type-based first pass
  if (item.type === "image") {
    deckId = "images";
    suggest("image");
  } else if (item.type === "selection") {
    deckId = "quotes";
    suggest("quote");
  }

  // Domain-based rules (can override / refine deck)
  for (const rule of DOMAIN_RULES) {
    if (rule.test.test(domain) || rule.test.test(haystack)) {
      if (!deckId || item.type === "page" || item.type === "link") deckId = rule.deckId;
      rule.tags.forEach((t) => suggest(t));
      break;
    }
  }

  // Keyword tags (additive, don't necessarily change deck)
  for (const kw of KEYWORD_TAGS) {
    if (kw.test.test(haystack)) suggest(kw.tag);
  }

  // Fallbacks by type
  if (!deckId) {
    if (item.type === "link") deckId = "links";
    else if (item.type === "page") deckId = "reading";
    else deckId = "inbox";
  }

  // Site label, e.g. "github" — but only if it is actually a useful word.
  const label = siteLabel(domain);
  if (label) suggest(label);

  // Text-derived keywords fill the spare slots LAST (I-15 layer 2): regex and
  // domain rules carry the confident signals; frequency carries the topic.
  if (item.content) {
    for (const kw of suggestKeywords(item.content, { max: 3, title: item.title })) suggest(kw);
  }

  // Drop suggestions the title already contains: "How to make pasta" does not
  // need a "pasta" tag to be findable, and the cloud stays meaningful.
  const titleWords = new Set(
    String(item.title || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2)
  );
  const kept = suggested.filter((t) => !titleWords.has(t)).slice(0, MAX_AUTO_TAGS);

  return { deckId, tags: [...new Set([...ownTags, ...kept])] };
}

export function excerptFromText(text, max = 280) {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}
