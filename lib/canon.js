// lib/canon.js — URL canonicalisation and duplicate fingerprints.
//
// WHY: v1.3 had no duplicate detection at all, so re-saving the same article
// (or saving it from a link with `?utm_source=...` appended) created a new card
// every time and libraries quietly filled up with near-identical items. This is
// the "already saved — open it?" check, and it is pure string work so it can be
// unit-tested without a browser.

/** Query parameters that never identify content — tracking and share noise. */
const STRIP_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
  "fbclid", "gclid", "dclid", "gbraid", "wbraid", "msclkid", "twclid", "igshid",
  "mc_cid", "mc_eid", "yclid", "_hsenc", "_hsmi", "ref", "ref_src", "ref_url",
  "source", "share", "spm", "vero_id", "trk", "epik", "pk_campaign", "pk_kwd",
]);

/** Hosts whose `www.` prefix is cosmetic. */
function stripWWW(host) {
  return host.toLowerCase().replace(/^www\./, "");
}

/**
 * Canonical form of a URL for duplicate comparison:
 * lowercase host without `www.`, no hash fragment, tracking parameters removed,
 * empty query dropped, trailing slash dropped, remaining params sorted.
 * Returns "" for anything unparseable so callers can skip the check safely.
 */
export function canonicalUrl(rawUrl) {
  if (!rawUrl) return "";
  let u;
  try {
    u = new URL(String(rawUrl).trim());
  } catch {
    return "";
  }
  if (!/^https?:$/.test(u.protocol)) return "";

  const params = new URLSearchParams(u.search);
  for (const key of [...params.keys()]) {
    if (STRIP_PARAMS.has(key.toLowerCase())) params.delete(key);
  }
  const sorted = [...params.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const query = sorted.map(([k, v]) => `${k}=${v}`).join("&");

  let path = u.pathname.replace(/\/+$/, "");
  if (!path) path = "";
  return `${stripWWW(u.hostname)}${path}${query ? "?" + query : ""}`;
}

/** Bare registrable-ish host for display and per-site settings. */
export function hostOf(rawUrl) {
  try {
    return stripWWW(new URL(String(rawUrl).trim()).hostname);
  } catch {
    return "";
  }
}

/**
 * Fingerprint used to decide "you already saved this".
 *
 * URL-identified captures (page, link, image, video) fingerprint on the
 * canonical URL. Text captures (selection, note) have no URL of their own, so
 * they fingerprint on WHERE the text came from plus the text itself — which
 * keeps "the same quote from the same article" a duplicate without treating
 * every short note as one.
 *
 * Returns "" when there is nothing to compare on, so callers skip the check.
 */
export function fingerprint({ url = "", sourceUrl = "", title = "", content = "", type = "page" } = {}) {
  const canon = canonicalUrl(url);
  if (canon && type !== "selection" && type !== "note") return "u:" + canon;

  const text = String(content || title || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
  if (!text) return canon ? "u:" + canon : "";
  const origin = canonicalUrl(sourceUrl || url);
  return `t:${type}:${origin}:${text}`;
}

/** True when `host` is the same site as, or a subdomain of, `blocked`. */
export function hostMatches(host, blocked) {
  const h = stripWWW(host || "");
  const b = stripWWW(blocked || "");
  if (!h || !b) return false;
  return h === b || h.endsWith("." + b);
}

// ---------------------------------------------------------------------------
// Site labels for tagging
// ---------------------------------------------------------------------------

/** Two-label public suffixes worth knowing. This is deliberately NOT the full
 * Public Suffix List: the job is "never emit a junk tag", not perfect registrable
 * domains, so a compact list plus a heuristic is the right trade for a
 * dependency-free extension. */
const COMPOUND_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "net.uk", "ltd.uk", "plc.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au", "id.au",
  "co.in", "net.in", "org.in", "gov.in", "ac.in", "edu.in", "firm.in", "gen.in",
  "co.jp", "or.jp", "ne.jp", "ac.jp", "go.jp", "ad.jp",
  "com.br", "net.br", "org.br", "gov.br", "edu.br",
  "co.nz", "net.nz", "org.nz", "govt.nz", "ac.nz",
  "com.mx", "org.mx", "gob.mx", "edu.mx", "net.mx",
  "co.za", "org.za", "web.za", "net.za", "gov.za", "ac.za",
  "com.sg", "com.hk", "com.tw", "edu.tw", "org.tw",
  "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn",
  "co.kr", "or.kr", "go.kr", "ne.kr", "ac.kr",
  "com.tr", "org.tr", "gov.tr", "net.tr", "edu.tr",
  "com.ar", "com.co", "com.pe", "com.cl", "com.ve", "com.ec", "com.uy",
  "co.il", "org.il", "gov.il", "ac.il", "net.il",
  "com.ua", "org.ua", "net.ua", "edu.ua", "gov.ua",
  "com.my", "com.vn", "com.ph", "com.pk", "com.bd", "com.eg", "com.sa",
  "com.ng", "co.id", "com.mm", "com.np", "com.lk",
  "co.ke", "com.gh", "com.tz", "com.qa", "com.kw", "com.bh", "com.om",
  "com.ru", "com.pl", "com.gr", "com.pt", "com.ro", "com.bg", "com.rs",
]);

/** Labels that would make a useless tag on their own. */
const JUNK_SITE_LABELS = new Set([
  "www", "www2", "web", "m", "mobile", "amp", "en", "us", "i", "my", "the", "a",
  "an", "home", "index", "default", "main", "new", "old", "localhost",
  "localdomain", "lan", "internal", "intranet", "test", "dev", "staging",
  "example", "site", "website", "online", "app", "apps", "secure", "login",
  "account", "accounts", "untitled",
]);

/**
 * A human-meaningful site label for tagging: `www.bbc.co.uk` → `bbc`,
 * `docs.python.org` → `python`, `theverge.com` → `theverge`.
 *
 * Returns "" whenever the honest answer is "no useful tag here" — an IP address,
 * a bare hostname, a version marker, or a label that is itself junk. v1.3 used
 * `domain.split(".")[0]`, which tagged every theverge.com save as "the" and
 * every www.* site as "www"; that is the tag-hygiene leak ideas.md I-04 calls out.
 */
export function siteLabel(domain) {
  const host = stripWWW(String(domain || "").toLowerCase().trim());
  if (!host) return "";
  if (host.includes(":")) return ""; // host:port — not a name worth tagging
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return ""; // IPv4
  if (host.startsWith("[") || host.includes("::")) return ""; // IPv6

  const labels = host.split(".").filter(Boolean);
  if (!labels.length) return "";
  if (labels.length === 1) return JUNK_SITE_LABELS.has(labels[0]) ? "" : labels[0];

  // Index of the registrable label: the one before the (possibly compound) suffix.
  const lastTwo = labels.slice(-2).join(".");
  let cut = labels.length - 2;
  if (labels.length >= 3 && COMPOUND_SUFFIXES.has(lastTwo)) cut = labels.length - 3;

  const label = String(labels[cut] || "").replace(/[^a-z0-9\u00c0-\uffff]/g, "");
  if (label.length < 2 || label.length > 24) return "";
  if (/^\d+$/.test(label)) return "";
  if (JUNK_SITE_LABELS.has(label)) return "";
  return label;
}
