// test/classify.test.js — deck routing and tag hygiene.
//
// The classifier is 13 regexes, and that is fine: it is a suggestion engine, not
// a judge. What is NOT fine is what it used to suggest — v1.3 tagged every save
// with `domain.split(".")[0]`, so theverge.com items were tagged "the" and every
// www.* site was tagged "www". ideas.md I-04 lists that as a trust leak, because
// a tag cloud full of "the" and "co" tells a new user the product is not paying
// attention.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

const { classify, excerptFromText, suggestKeywords } = await import("../lib/classify.js");

// v1.8's second layer (ideas.md I-15): when a save carries page text, tags
// come from the TEXT, not only from regexes. Deterministic, offline, capped,
// and it must never out-shout the confident signals — keywords fill spare
// slots, they do not take them.

describe("text-derived keyword tags (I-15 layer 2)", () => {
  const article = (n = 60) =>
    `Sourdough starter needs flour and water. ` +
    Array.from({ length: n }, () => "The sourdough hydration affects the crumb of every sourdough loaf.").join(" ");

  test("a topic repeated early wins a slot", () => {
    const kws = suggestKeywords(article());
    assert.ok(kws.includes("sourdough"), `expected sourdough, got ${kws.join()}`);
  });

  test("below 600 chars there is no signal, and no invented tags", () => {
    assert.deepEqual(suggestKeywords("sourdough sourdough sourdough."), []);
    assert.deepEqual(suggestKeywords(""), []);
    assert.deepEqual(suggestKeywords(null), []);
  });

  test("title words are not re-tagged (they are already findable)", () => {
    const kws = suggestKeywords(article(), { title: "My Sourdough Notes" });
    assert.ok(!kws.includes("sourdough"), "the title already carries it");
    assert.ok(kws.includes("flour") || kws.includes("hydration") || kws.includes("crumb"), "other topics still qualify");
  });

  test("junk words never become tags: numerals, stopwords, and topic-clichés", () => {
    const boring = Array.from({ length: 120 }, () => "the best top free article update 2024 download online version site content information page news").join(" ");
    assert.deepEqual(suggestKeywords(boring), []);
  });

  test("cap respected and classify() integrates the layer without losing the rules", () => {
    const res = classify({
      type: "page",
      url: "https://blog.example/bread",
      domain: "blog.example",
      title: "A bread guide",
      content: article(),
    });
    assert.equal(res.deckId, "reading", "content regex still routes the deck");
    assert.ok(res.tags.includes("tutorial"), "the how-to guide rule still fires");
    assert.ok(res.tags.length <= 5 + 3, "user tags + MAX_AUTO_TAGS… keywords ride inside the cap");
    assert.ok(new Set(res.tags).size === res.tags.length, "never duplicated");
    assert.ok(res.tags.includes("sourdough"), "and the text-derived one is there");
  });

  test("user's own tags survive the keyword layer untouched", () => {
    const res = classify({
      type: "page",
      domain: "blog.example",
      title: "x",
      content: article(),
      tags: ["MY-CATEGORY"],
    });
    assert.ok(res.tags.includes("my-category") || res.tags.includes("MY-CATEGORY"));
  });
});

describe("deck routing", () => {
  const cases = [
    [{ type: "page", url: "https://www.youtube.com/watch?v=1", domain: "youtube.com", title: "Video" }, "videos"],
    [{ type: "page", url: "https://github.com/a/b", domain: "github.com", title: "Repo" }, "dev"],
    [{ type: "page", url: "https://www.amazon.in/dp/B01", domain: "amazon.in", title: "Thing" }, "shopping"],
    [{ type: "page", url: "https://arxiv.org/abs/1234", domain: "arxiv.org", title: "Paper" }, "research"],
    [{ type: "page", url: "https://news.ycombinator.com/", domain: "news.ycombinator.com", title: "HN" }, "reading"],
    [{ type: "image", url: "https://a.com/x.png", domain: "a.com", title: "Pic" }, "images"],
    [{ type: "selection", url: "https://a.com/p", domain: "a.com", title: "Quote" }, "quotes"],
    [{ type: "link", url: "https://a.com/p", domain: "a.com", title: "Link" }, "links"],
    [{ type: "note", url: "", domain: "", title: "Thought" }, "inbox"],
  ];
  for (const [item, deck] of cases) {
    test(`${item.type} on ${item.domain || "(none)"} → ${deck}`, () => {
      assert.equal(classify(item).deckId, deck);
    });
  }
});

describe("tag hygiene", () => {
  test("no junk domain tags", () => {
    const { tags } = classify({ type: "page", domain: "theverge.com", url: "https://theverge.com/a", title: "AI news" });
    assert.ok(!tags.includes("the"), `v1.3 bug: got ${JSON.stringify(tags)}`);
    assert.ok(tags.includes("theverge"));
  });

  test("www and IP addresses produce no site tag at all", () => {
    assert.deepEqual(classify({ type: "page", domain: "www.example.com", url: "https://www.example.com/", title: "Untitled" }).tags, []);
    assert.deepEqual(classify({ type: "page", domain: "192.168.0.10", url: "http://192.168.0.10/", title: "Router" }).tags, []);
  });

  test("a tag already in the title is not repeated", () => {
    const { tags } = classify({
      type: "page",
      domain: "github.com",
      url: "https://github.com/a/b",
      title: "A github tutorial for beginners",
      content: "step by step guide",
    });
    assert.ok(!tags.includes("github"), `title already says github: ${JSON.stringify(tags)}`);
    assert.ok(!tags.includes("tutorial"), `title already says tutorial: ${JSON.stringify(tags)}`);
  });

  test("the user's own tags survive untouched and come first", () => {
    const { tags } = classify({
      type: "page",
      domain: "github.com",
      url: "https://github.com/a/b",
      title: "Repo",
      tags: ["Keep", "READ Later", "keep"],
    });
    assert.deepEqual(tags.slice(0, 2), ["keep", "read later"]);
    assert.equal(new Set(tags).size, tags.length, "duplicates removed");
  });

  test("suggestions are capped so the tag cloud stays readable", () => {
    const { tags } = classify({
      type: "image",
      domain: "amazon.in",
      url: "https://amazon.in/x.png",
      title: "Cheap deal",
      content: "price discount sale ₹999 recipe ingredients cook tutorial how to guide react javascript api travel itinerary flight hotel job resume career design ui ux figma",
    });
    assert.ok(tags.length <= 6, `too many tags: ${JSON.stringify(tags)}`);
  });

  test("existing tags are never duplicated by a suggestion", () => {
    const { tags } = classify({ type: "selection", domain: "a.com", url: "https://a.com/p", title: "Q", tags: ["quote"] });
    assert.equal(tags.filter((t) => t === "quote").length, 1);
  });
});

describe("excerpts", () => {
  test("collapses whitespace and truncates with an ellipsis", () => {
    assert.equal(excerptFromText("  a   b\n\nc  "), "a b c");
    const long = excerptFromText("word ".repeat(200), 40);
    assert.ok(long.length <= 40);
    assert.ok(long.endsWith("…"));
  });

  test("empty input yields an empty excerpt", () => {
    assert.equal(excerptFromText(""), "");
    assert.equal(excerptFromText(null), "");
  });
});
