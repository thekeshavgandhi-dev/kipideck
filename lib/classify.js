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

import { siteLabel } from "./canon.js";

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
