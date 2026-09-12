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

const { classify, excerptFromText } = await import("../lib/classify.js");

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
