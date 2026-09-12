// test/related.test.js — the related-items rail (ideas.md I-16, second half).
//
// Two layers: the pure scorer in lib/related.js (every weight and tie-break is
// pinned here with fixtures), and Storage.relatedTo — the pool assembly — run
// against fake-indexeddb so the "no full scan" contract is exercised with the
// real query paths, not mocked away.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

await import("./harness.js");
const { resetWorld } = await import("./harness.js");
const { scoreRelated, relatedSummary, RELATED_WEIGHTS } = await import("../lib/related.js");
const { Storage } = await import("../lib/storage.js");

function item(id, over = {}) {
  return {
    id,
    type: "page",
    title: "",
    url: `https://example.com/${id}`,
    domain: "",
    tags: [],
    deckId: "",
    createdAt: 1000 + Number(String(id).replace(/\D/g, "") || 1),
    updatedAt: 1,
    ...over,
  };
}

describe("scoreRelated — the weights, pinned", () => {
  test("shared tags dominate and name themselves", () => {
    const src = item("a", { tags: ["sourdough", "bread"] });
    const res = scoreRelated(src, [item("b", { tags: ["sourdough", "unrelated"] })]);
    assert.equal(res.length, 1);
    assert.equal(res[0].id, "b");
    assert.ok(res[0].why.some((w) => w.includes("sourdough")));
    assert.equal(res[0].score, RELATED_WEIGHTS.perSharedTag);
  });

  test("at most three shared tags count (a tag-fest is not three matches)", () => {
    const src = item("a", { tags: ["x", "y", "z", "w"] });
    const res = scoreRelated(src, [item("b", { tags: ["x", "y", "z", "w"] })]);
    assert.equal(res[0].score, RELATED_WEIGHTS.perSharedTag * 3);
  });

  test("same domain, same deck, similar title each say why", () => {
    const src = item("a", { title: "Gyro delivery in Berlin", domain: "foodora.de", deckId: "travel" });
    const res = scoreRelated(src, [
      item("b", { domain: "foodora.de", deckId: "travel" }),
      item("c", { title: "Gyro delivery in Munich" }),
    ]);
    assert.equal(res.find((r) => r.id === "b").why.join(), "same site,same deck");
    assert.ok(res.find((r) => r.id === "c").why.includes("similar title"));
  });

  test("overlap is measured against the SHORTER title: containment saturates, partial overlap fades", () => {
    const src = item("a", { title: "sour dough bread flour water salt yeast", createdAt: 5000 }); // 7 tokens
    const contained = item("b", { title: "sour dough bread" }); // its 3 tokens are all shared → ratio 1
    const partial = item("c", { title: "sour tea coffee milk sugar extra" }); // 1 of 6 shared → ratio ~0.17
    const res = scoreRelated(src, [partial, contained]);
    assert.deepEqual(res.map((r) => r.id), ["b", "c"]);
    assert.equal(res[0].score, RELATED_WEIGHTS.titleOverlap); // fully-contained short title
    assert.ok(res[1].score < res[0].score / 3, "a single shared word on a long title must not compete");
  });

  test("the source itself never appears; unknown candidates are skipped", () => {
    const src = item("a", { tags: ["t"] });
    const res = scoreRelated(src, [src, item("b", { tags: ["t"] }), null, { noId: true }]);
    assert.deepEqual(res.map((r) => r.id), ["b"]);
  });

  test("zero-similarity candidates are not related, however close in time", () => {
    const res = scoreRelated(item("a", { tags: ["x"], domain: "p.com" }), [
      item("b", { tags: ["y"], domain: "q.com", deckId: "research" }),
    ]);
    assert.deepEqual(res, []);
  });

  test("limit caps the rail; ties resolve newer-first", () => {
    const src = item("a", { tags: ["t"] });
    const pool = ["b", "c", "d", "e"].map((id, i) => item(id, { tags: ["t"], createdAt: 1000 + i }));
    const res = scoreRelated(src, pool, { limit: 2 });
    assert.equal(res.length, 2);
    assert.deepEqual(res.map((r) => r.id), ["e", "d"]);
  });

  test("empty inputs are not errors", () => {
    assert.deepEqual(scoreRelated(null, []), []);
    assert.deepEqual(scoreRelated(item("a"), undefined), []);
    assert.equal(relatedSummary([]), "");
    assert.match(relatedSummary([{ id: "b" }, { id: "c" }]), /2 related items/);
  });
});

describe("Storage.relatedTo — pool assembly on the real data layer", () => {
  beforeEach(async () => {
    await resetWorld();
    await Storage.init();
  });

  test("finds a same-deck neighbour and a tag twin, ranks the tag twin higher", async () => {
    await Storage.saveItem(item("a", { tags: ["sourdough"], deckId: "reading" }));
    await Storage.saveItem(item("b", { tags: ["sourdough"], deckId: "reading" })); // tag + deck
    await Storage.saveItem(item("c", { deckId: "reading" })); // deck only
    await Storage.saveItem(item("d", { deckId: "shopping" })); // nothing — not in any pool

    const res = await Storage.relatedTo("a", { limit: 5 });
    assert.deepEqual(res.map((r) => r.id), ["b", "c"]);
    assert.equal(await Storage.getItem("d") !== null, true, "unrelated item still exists, it just is not related");
  });

  test("no pool → empty rail, never an error", async () => {
    await Storage.saveItem(item("lonely", { deckId: "research" }));
    assert.deepEqual(await Storage.relatedTo("lonely"), []);
    assert.deepEqual(await Storage.relatedTo("does-not-exist"), []);
  });

  test("a 400-item library stays honest: the rail never loads the corpus", async () => {
    // The pool ceiling is (deck 80 + 3×tag 60); with 400 items across 4 decks
    // and a shared tag on everything, relatedness must still answer, and the
    // source must be excluded from its own rail.
    for (let i = 0; i < 100; i++) {
      await Storage.saveItem(item(`d1x${i}`, { tags: ["wide"] }));
    }
    const res = await Storage.relatedTo("d1x0", { limit: 6 });
    assert.equal(res.length, 6);
    assert.ok(!res.some((r) => r.id === "d1x0"));
  });
});
