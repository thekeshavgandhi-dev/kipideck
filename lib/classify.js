// lib/classify.js
// Lightweight, offline heuristic classifier that decides which deck a saved
// item belongs to and generates suggested tags. No network calls — everything
// runs locally so saving stays instant and private.

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

/**
 * Classify a captured item into { deckId, tags[] } using its type, domain,
 * title, and any captured text. This never blocks — pure string matching.
 */
export function classify(item) {
  const domain = item.domain || hostnameOf(item.url || item.sourceUrl || "");
  const haystack = [item.title, item.excerpt, item.content, item.note, domain].filter(Boolean).join(" ");
  const tags = new Set((item.tags || []).map((t) => t.toLowerCase()));
  let deckId = null;

  // Type-based first pass
  if (item.type === "image") {
    deckId = "images";
    tags.add("image");
  } else if (item.type === "selection") {
    deckId = "quotes";
    tags.add("quote");
  }

  // Domain-based rules (can override / refine deck)
  for (const rule of DOMAIN_RULES) {
    if (rule.test.test(domain) || rule.test.test(haystack)) {
      if (!deckId || item.type === "page" || item.type === "link") deckId = rule.deckId;
      rule.tags.forEach((t) => tags.add(t));
      break;
    }
  }

  // Keyword tags (additive, don't necessarily change deck)
  for (const kw of KEYWORD_TAGS) {
    if (kw.test.test(haystack)) tags.add(kw.tag);
  }

  // Fallbacks by type
  if (!deckId) {
    if (item.type === "link") deckId = "links";
    else if (item.type === "page") deckId = "reading";
    else deckId = "inbox";
  }

  if (domain) tags.add(domain.split(".")[0]);

  return { deckId, tags: Array.from(tags).slice(0, 8) };
}

export function excerptFromText(text, max = 280) {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}
