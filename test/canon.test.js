// test/canon.test.js — URL canonicalisation, duplicate fingerprints and the
// local-only favicon fallback. Pure functions, so no IndexedDB needed for most
// of it; the dedupe lookups at the bottom exercise the real index.

import { test, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

await import("./harness.js");
const { resetWorld } = await import("./harness.js");
const { canonicalUrl, fingerprint, hostMatches, hostOf, siteLabel } = await import("../lib/canon.js");
const { letterAvatar } = await import("../lib/favicons.js");
const db = await import("../lib/db.js");
const { Storage } = await import("../lib/storage.js");

describe("canonicalUrl", () => {
  test("tracking parameters are dropped, content parameters are kept", () => {
    assert.equal(
      canonicalUrl("https://www.example.com/post?utm_source=newsletter&utm_medium=email&id=42"),
      "example.com/post?id=42"
    );
    assert.equal(canonicalUrl("https://example.com/a?fbclid=xyz"), "example.com/a");
    assert.equal(canonicalUrl("https://example.com/a?gclid=1&pk_campaign=x"), "example.com/a");
  });

  test("hash, trailing slash, www and case are normalised", () => {
    assert.equal(canonicalUrl("https://WWW.Example.COM/article/#comments"), "example.com/article");
    assert.equal(canonicalUrl("https://example.com/article/"), "example.com/article");
    assert.equal(canonicalUrl("https://example.com"), "example.com");
  });

  test("query parameters are sorted so order cannot hide a duplicate", () => {
    assert.equal(canonicalUrl("https://e.com/x?b=2&a=1"), "e.com/x?a=1&b=2");
    assert.equal(canonicalUrl("https://e.com/x?a=1&b=2"), "e.com/x?a=1&b=2");
  });

  test("subdomains are preserved (they are usually different content)", () => {
    assert.equal(canonicalUrl("https://blog.example.com/x"), "blog.example.com/x");
    assert.notEqual(canonicalUrl("https://blog.example.com/x"), canonicalUrl("https://example.com/x"));
  });

  test("junk and non-http URLs canonicalise to empty, so callers skip safely", () => {
    assert.equal(canonicalUrl(""), "");
    assert.equal(canonicalUrl("not a url"), "");
    assert.equal(canonicalUrl("chrome://extensions"), "");
    assert.equal(canonicalUrl("about:blank"), "");
    assert.equal(canonicalUrl(undefined), "");
  });
});

describe("host helpers", () => {
  test("hostOf strips www and lowercases", () => {
    assert.equal(hostOf("https://WWW.GitHub.com/user/repo"), "github.com");
    assert.equal(hostOf("garbage"), "");
  });

  test("hostMatches treats subdomains as the same site", () => {
    assert.equal(hostMatches("music.youtube.com", "youtube.com"), true);
    assert.equal(hostMatches("www.youtube.com", "youtube.com"), true);
    assert.equal(hostMatches("youtube.com", "youtube.com"), true);
    assert.equal(hostMatches("notyoutube.com", "youtube.com"), false);
    assert.equal(hostMatches("youtube.com.evil.example", "youtube.com"), false);
    assert.equal(hostMatches("", "youtube.com"), false);
  });
});

describe("fingerprint", () => {
  test("URL captures fingerprint on the canonical URL", () => {
    const a = fingerprint({ url: "https://example.com/a?utm_source=x", type: "page" });
    const b = fingerprint({ url: "https://www.example.com/a/", type: "page" });
    assert.equal(a, b);
    assert.equal(a, "u:example.com/a");
  });

  test("selections fingerprint on source + text, not text alone", () => {
    const fromA = fingerprint({ type: "selection", sourceUrl: "https://a.com/1", content: "To be or not to be" });
    const fromB = fingerprint({ type: "selection", sourceUrl: "https://b.com/2", content: "To be or not to be" });
    const sameAsA = fingerprint({ type: "selection", sourceUrl: "https://a.com/1?utm_source=x", content: "To be or not to be" });
    assert.notEqual(fromA, fromB, "the same quote from two articles is not a duplicate");
    assert.equal(fromA, sameAsA, "the same quote from the same article is");
  });

  test("whitespace and case differences do not create a new fingerprint", () => {
    const a = fingerprint({ type: "note", content: "Buy  milk", sourceUrl: "https://a.com" });
    const b = fingerprint({ type: "note", content: "buy milk", sourceUrl: "https://a.com" });
    assert.equal(a, b);
  });

  test("empty input fingerprints to empty", () => {
    assert.equal(fingerprint({}), "");
  });
});

describe("letterAvatar (the offline, tracker-free icon fallback)", () => {
  test("produces a self-contained SVG data URL with the first letter", () => {
    const icon = letterAvatar("github.com");
    assert.ok(icon.startsWith("data:image/svg+xml;charset=utf-8,"));
    const svg = decodeURIComponent(icon.split(",")[1]);
    assert.ok(svg.includes(">G<"), "shows the initial letter");
    assert.ok(!svg.includes("google.com"), "no third-party request anywhere");
  });

  test("is stable for a domain and differs between domains", () => {
    assert.equal(letterAvatar("github.com"), letterAvatar("github.com"));
    assert.notEqual(letterAvatar("github.com"), letterAvatar("gitlab.com"));
    assert.ok(letterAvatar("", "").length > 0, "never returns nothing");
  });
});

describe("duplicate detection against the real index", () => {
  beforeEach(async () => {
    await resetWorld();
    await Storage.init();
  });

  test("re-saving the same URL with different tracking params is caught", async () => {
    await Storage.saveItem({ title: "Article", url: "https://example.com/a?utm_source=x", type: "page" });
    const dup = await Storage.findDuplicate({ url: "https://www.example.com/a/#top", type: "page" });
    assert.ok(dup, "should find the existing item");
    assert.equal(dup.title, "Article");
    assert.equal(await Storage.countCanonical("https://example.com/a"), 1);
  });

  test("a genuinely different URL is not a duplicate", async () => {
    await Storage.saveItem({ title: "One", url: "https://example.com/a", type: "page" });
    assert.equal(await Storage.findDuplicate({ url: "https://example.com/b", type: "page" }), null);
  });

  test("the same text from a different page is not a duplicate", async () => {
    await Storage.saveItem({ type: "selection", content: "Carpe diem", sourceUrl: "https://a.com/1", url: "https://a.com/1" });
    assert.equal(
      await Storage.findDuplicate({ type: "selection", content: "Carpe diem", sourceUrl: "https://b.com/2", url: "https://b.com/2" }),
      null
    );
    assert.ok(await Storage.findDuplicate({ type: "selection", content: "Carpe diem", sourceUrl: "https://a.com/1", url: "https://a.com/1" }));
  });

  test("excludeId lets an item be re-saved over itself", async () => {
    const saved = await Storage.saveItem({ title: "A", url: "https://example.com/a", type: "page" });
    assert.equal(await Storage.findDuplicate({ url: "https://example.com/a", type: "page" }, { excludeId: saved.id }), null);
  });

  test("withinMs limits how far back text duplicates are considered", async () => {
    await db.writeItem({
      id: "old_sel",
      type: "selection",
      title: "Old quote",
      url: "https://a.com/1",
      sourceUrl: "https://a.com/1",
      content: "Same words",
      deckId: "quotes",
      tags: [],
      createdAt: Date.now() - 40 * 24 * 60 * 60 * 1000,
      updatedAt: Date.now() - 40 * 24 * 60 * 60 * 1000,
    }, "Same words");
    const candidate = { type: "selection", content: "Same words", sourceUrl: "https://a.com/1", url: "https://a.com/1" };
    assert.ok(await Storage.findDuplicate(candidate), "found with no window");
    assert.equal(
      await Storage.findDuplicate(candidate, { withinMs: 24 * 60 * 60 * 1000 }),
      null,
      "ignored outside a 24 h window"
    );
  });
});

describe("siteLabel — the tag a domain is worth", () => {
  const cases = [
    ["theverge.com", "theverge"],
    ["www.theverge.com", "theverge"],
    ["m.facebook.com", "facebook"],
    ["docs.python.org", "python"],
    ["www.bbc.co.uk", "bbc"],
    ["news.bbc.co.uk", "bbc"],
    ["nytimes.com", "nytimes"],
    ["sub.example.com.br", ""], // "example" is on the junk list
    ["a.io", ""], // single letters are not useful tags
    ["x.com", ""],
    ["192.168.1.1", ""], // IP addresses
    ["[2001:db8::1]", ""],
    ["localhost", ""],
    ["localhost:8080", ""],
    ["", ""],
    ["   ", ""],
    ["GOOGLE.COM", "google"],
    ["xn--80ak6aa92e.com", "xn80ak6aa92e"], // punycode survives, hyphens dropped
  ];

  for (const [input, expected] of cases) {
    test(`${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
      assert.equal(siteLabel(input), expected);
    });
  }

  test("never emits the v1.3 junk labels", () => {
    // `domain.split(".")[0]` used to produce all of these as real tags.
    for (const domain of ["www.anything.com", "theverge.com", "bbc.co.uk", "m.site.org"]) {
      const label = siteLabel(domain);
      assert.ok(!["www", "the", "co", "m", "com"].includes(label), `${domain} → ${label}`);
    }
  });

  test("is stable — the same domain always yields the same tag", () => {
    assert.equal(siteLabel("www.github.com"), siteLabel("github.com"));
  });
});
