// test/db.test.js — the IndexedDB core and the query engine built on it.
//
// These tests exist because the v1.3 data layer had none, and because the
// failure modes being fixed here (index drift, clobbered imports, unbounded
// query cost) are invisible until a library gets large.

import { test, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

await import("./harness.js");
const { resetWorld } = await import("./harness.js");
const db = await import("../lib/db.js");
const { searchItems, searchInMemory, parseQuery, snippet } = await import("../lib/search.js");
const { tokenize } = await import("../lib/text.js");
const { Storage } = await import("../lib/storage.js");

function item(over = {}) {
  return {
    id: "k_" + Math.random().toString(36).slice(2, 10),
    type: "page",
    title: "Untitled",
    url: "https://example.com/",
    domain: "example.com",
    excerpt: "",
    note: "",
    tags: [],
    deckId: "inbox",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pinned: false,
    ...over,
  };
}

beforeEach(async () => {
  await resetWorld();
  await Storage.init();
});

describe("metadata / content split", () => {
  test("full page text never lands on the metadata record", async () => {
    const rec = await db.writeItem(item({ title: "Carbonara" }), "guanciale pecorino black pepper");
    assert.equal(rec.content, undefined, "metadata must not carry content");
    assert.equal(rec.title, "Carbonara");
    assert.deepEqual(await db.getContent(rec.id), { text: "guanciale pecorino black pepper", wordCount: 4 });
  });

  test("listing returns metadata only, so a big library stays cheap to page", async () => {
    await db.writeItem(item({ title: "One" }), "x".repeat(20000));
    const { items, total } = await db.listItems({ limit: 10 });
    assert.equal(total, 1);
    assert.equal(items[0].content, undefined);
    assert.equal(items[0].idx.length > 0, true, "indexed terms are recorded for precise removal");
  });
});

describe("search", () => {
  test("finds by title, body text, tags, notes and domain", async () => {
    await db.writeItem(
      item({ title: "Carbonara recipe", tags: ["recipe"], note: "weeknight dinner", domain: "foodblog.com" }),
      "Render guanciale until crisp, then toss with pecorino."
    );
    for (const q of ["carbonara", "guanciale", "pecorino", "recipe", "weeknight", "foodblog"]) {
      const res = await searchItems({ query: q });
      assert.equal(res.total, 1, `expected "${q}" to match exactly one item`);
    }
  });

  test("prefix matching works (prog → programming)", async () => {
    await db.writeItem(item({ title: "A programming guide" }), "");
    assert.equal((await searchItems({ query: "prog" })).total, 1);
    assert.equal((await searchItems({ query: "programmin" })).total, 1);
    assert.equal((await searchItems({ query: "zzznotaterm" })).total, 0);
  });

  test("title matches outrank body-only matches", async () => {
    await db.writeItem(item({ id: "title_hit", title: "Espresso" }), "coffee beans water");
    await db.writeItem(item({ id: "body_hit", title: "Coffee notes" }), "espresso machine pressure");
    const res = await searchItems({ query: "espresso" });
    assert.equal(res.items[0].id, "title_hit");
  });

  test("exact match outranks prefix-only match", async () => {
    await db.writeItem(item({ id: "exact", title: "react" }), "");
    await db.writeItem(item({ id: "prefix", title: "reactive programming" }), "");
    const res = await searchItems({ query: "react" });
    assert.equal(res.items[0].id, "exact");
  });

  test("tag: and site: operators filter, and combine with free text", async () => {
    await db.writeItem(item({ id: "a", title: "Carbonara", tags: ["recipe"], domain: "foodblog.com" }), "");
    await db.writeItem(item({ id: "b", title: "Carbonara history", tags: ["history"], domain: "nyt.com" }), "");
    assert.equal((await searchItems({ query: "carbonara tag:recipe" })).total, 1);
    assert.equal((await searchItems({ query: "carbonara site:nyt.com" })).total, 1);
    assert.equal((await searchItems({ query: "carbonara" })).total, 2);
    assert.equal((await searchItems({ query: "carbonara site:nowhere.com" })).total, 0);
  });

  test("deck / tag / pinned scoping narrows results", async () => {
    await db.writeItem(item({ id: "a", title: "kettle", deckId: "reading" }), "");
    await db.writeItem(item({ id: "b", title: "kettle", deckId: "shopping", pinned: true }), "");
    assert.equal((await searchItems({ query: "kettle", deckId: "reading" })).total, 1);
    assert.equal((await searchItems({ query: "kettle", deckId: "shopping" })).total, 1);
    assert.equal((await searchItems({ query: "kettle", pinned: true })).total, 1);
  });

  test("multi-word queries match ALL words, and rank full matches first", async () => {
    await db.writeItem(item({ id: "both", title: "react hooks", createdAt: 1000 }), "");
    await db.writeItem(item({ id: "one", title: "react router", createdAt: 2000 }), "");
    const res = await searchItems({ query: "react hooks" });
    assert.deepEqual(res.items.map((i) => i.id), ["both"], "AND semantics: only the item with both words");
    assert.equal(res.total, 1);
  });

  test("when one word matches nothing, results fall back to ranked OR", async () => {
    await db.writeItem(item({ id: "both", title: "react hooks guide", createdAt: 1000 }), "");
    await db.writeItem(item({ id: "one", title: "react router", createdAt: 2000 }), "");
    // "zzztypo" hits nothing, so the query degrades to OR — but the item that
    // matched two of the three words still has to come first.
    const res = await searchItems({ query: "react hooks zzztypo" });
    assert.equal(res.items.length, 2, "closest matches still surface instead of an empty screen");
    assert.equal(res.items[0].id, "both");
  });

  test("matched fields are reported for the UI", async () => {
    await db.writeItem(item({ title: "Sourdough", tags: ["bread"] }), "hydrate the flour");
    const res = await searchItems({ query: "sourdough" });
    assert.ok(res.items[0]._matchedFields.includes("title"));
  });

  test("parseQuery splits operators from free text", () => {
    const { filters, freeTerms } = parseQuery("  carbonara   tag:recipe site:foodblog.com ");
    assert.deepEqual(freeTerms, ["carbonara"]);
    assert.deepEqual(filters.tag, ["recipe"]);
    assert.deepEqual(filters.site, ["foodblog.com"]);
  });

  test("snippet centres on the first hit", () => {
    const text = "a".repeat(200) + " guanciale " + "b".repeat(200);
    const s = snippet(text, "guanciale");
    assert.ok(s.includes("guanciale"));
    assert.ok(s.startsWith("…"));
  });

  test("non-Latin scripts are searchable (v1.3 indexed them as nothing)", async () => {
    assert.ok(tokenize("किपीडेक सेव").includes("किपीडेक"));
    await db.writeItem(item({ id: "hi", title: "किपीडेक गाइड" }), "");
    assert.equal((await searchItems({ query: "किपीडेक" })).total, 1);
  });

  test("Latin accents fold both ways", async () => {
    await db.writeItem(item({ id: "fr", title: "Café crème" }), "");
    assert.equal((await searchItems({ query: "cafe" })).total, 1);
    assert.equal((await searchItems({ query: "café" })).total, 1);
  });

  test("agrees with the in-memory reference engine on what matches", async () => {
    const items = [
      item({ id: "1", title: "Sourdough starter", tags: ["bread"], domain: "bake.com", content: "flour water salt ferment" }),
      item({ id: "2", title: "React hooks", tags: ["dev"], domain: "dev.io", content: "useState useEffect render" }),
      item({ id: "3", title: "Espresso at home", tags: ["coffee"], domain: "brew.com", content: "grind dose tamp pressure" }),
    ];
    for (const it of items) await db.writeItem(it, it.content);
    for (const q of ["sourdough", "bread", "espresso", "grind", "hooks", "dev.io", "zzz"]) {
      const indexHits = (await searchItems({ query: q })).items.map((i) => i.id).sort();
      const memoryHits = searchInMemory(items, q).map((i) => i.id).sort();
      assert.deepEqual(indexHits, memoryHits, `query "${q}" disagrees between engines`);
    }
  });
});

describe("index maintenance", () => {
  test("updating an item removes its old terms and adds new ones", async () => {
    const rec = await db.writeItem(item({ id: "u1", title: "Old title about typewriters" }), "ribbon keys ink");
    assert.equal((await searchItems({ query: "typewriters" })).total, 1);
    assert.equal((await searchItems({ query: "ribbon" })).total, 1);

    await db.writeItem({ ...rec, title: "New title about keyboards", updatedAt: Date.now() + 1 }, "switches keycaps");

    assert.equal((await searchItems({ query: "typewriters" })).total, 0, "stale title term must be gone");
    assert.equal((await searchItems({ query: "ribbon" })).total, 0, "stale body term must be gone");
    assert.equal((await searchItems({ query: "keyboards" })).total, 1);
    assert.equal((await searchItems({ query: "keycaps" })).total, 1);
  });

  test("deleting an item removes it from the index and the counters", async () => {
    await db.writeItem(item({ id: "d1", title: "Delete me", tags: ["temp"], deckId: "reading" }), "uniquewordhere");
    assert.equal((await searchItems({ query: "uniquewordhere" })).total, 1);
    assert.equal((await db.getTagCounts()).temp, 1);

    assert.equal(await db.removeItem("d1"), true);
    assert.equal((await searchItems({ query: "uniquewordhere" })).total, 0);
    assert.equal((await searchItems({ query: "delete" })).total, 0);
    assert.equal((await db.getTagCounts()).temp, undefined);
    assert.equal((await db.countItems()), 0);
    assert.equal(await db.removeItem("d1"), false, "deleting twice is a no-op, not an error");
  });

  test("tag counts track adds, removals and renames", async () => {
    const rec = await db.writeItem(item({ id: "t1", tags: ["a", "b"] }), "");
    assert.deepEqual(await db.getTagCounts(), { a: 1, b: 1 });
    await db.writeItem({ ...rec, tags: ["b", "c"] }, "");
    assert.deepEqual(await db.getTagCounts(), { b: 1, c: 1 });
    await db.removeItem("t1");
    assert.deepEqual(await db.getTagCounts(), {});
  });

  test("bulk import produces the same index as individual writes", async () => {
    const make = (i) => ({
      item: item({ id: `b${i}`, title: `Bulk item ${i} about fermentation`, tags: [`tag${i % 3}`], deckId: "reading" }),
      text: `sourdough hydration batch ${i} notes`,
    });
    const batch = Array.from({ length: 25 }, (_, i) => make(i));
    await db.writeItemsBulk(batch);

    assert.equal(await db.countItems(), 25);
    assert.equal((await searchItems({ query: "fermentation" })).total, 25);
    assert.equal((await searchItems({ query: "hydration" })).total, 25);
    assert.equal((await searchItems({ query: "sourdough tag:tag1" })).total, 8);

    // re-running the same bulk write must not double-count anything
    await db.writeItemsBulk(batch);
    assert.equal(await db.countItems(), 25);
    assert.equal((await searchItems({ query: "fermentation" })).total, 25);
    assert.deepEqual(await db.getTagCounts(), { tag0: 9, tag1: 8, tag2: 8 });
  });

  test("reindexAll rebuilds a searchable index from stored records", async () => {
    await db.writeItem(item({ id: "r1", title: "Fermentation basics", tags: ["bread"] }), "salt water flour");
    await db.reindexAll();
    assert.equal((await searchItems({ query: "fermentation" })).total, 1);
    assert.equal((await searchItems({ query: "flour" })).total, 1);
    assert.equal((await searchItems({ query: "bread" })).total, 1);
  });

  test("clearAllData empties every store", async () => {
    await db.writeItem(item({ id: "c1", title: "Gone soon", tags: ["x"] }), "body text");
    await db.clearAllData();
    assert.equal(await db.countItems(), 0);
    assert.equal((await searchItems({ query: "gone" })).total, 0);
    assert.deepEqual(await db.getTagCounts(), {});
  });
});

describe("pagination and sorting", () => {
  test("pages through a deck without loading everything", async () => {
    for (let i = 0; i < 25; i++) {
      await db.writeItem(
        item({ id: `p${i}`, title: `Item ${String(i).padStart(2, "0")}`, deckId: "reading", createdAt: 1000 + i }),
        ""
      );
    }
    const page1 = await db.listItems({ deckId: "reading", sort: "new", limit: 10, offset: 0 });
    const page2 = await db.listItems({ deckId: "reading", sort: "new", limit: 10, offset: 10 });
    const page3 = await db.listItems({ deckId: "reading", sort: "new", limit: 10, offset: 20 });
    assert.equal(page1.total, 25);
    assert.equal(page1.items.length, 10);
    assert.equal(page2.items.length, 10);
    assert.equal(page3.items.length, 5);
    const ids = [...page1.items, ...page2.items, ...page3.items].map((i) => i.id);
    assert.equal(new Set(ids).size, 25, "no duplicates or gaps across pages");
    assert.equal(page1.items[0].id, "p24", "newest first");
  });

  test("sort orders: new, old and A–Z", async () => {
    for (let i = 0; i < 5; i++) {
      await db.writeItem(item({ id: `s${i}`, title: `T${4 - i}`, createdAt: 1000 + i }), "");
    }
    assert.deepEqual((await db.listItems({ sort: "new", limit: 10 })).items.map((i) => i.title), ["T0", "T1", "T2", "T3", "T4"]);
    assert.deepEqual((await db.listItems({ sort: "old", limit: 10 })).items.map((i) => i.title), ["T4", "T3", "T2", "T1", "T0"]);
    assert.deepEqual((await db.listItems({ sort: "az", limit: 10 })).items.map((i) => i.title), ["T0", "T1", "T2", "T3", "T4"]);
  });

  test("pinned view returns only pinned items", async () => {
    await db.writeItem(item({ id: "n1", title: "Normal", pinned: false }), "");
    await db.writeItem(item({ id: "y1", title: "Pinned one", pinned: true }), "");
    await db.writeItem(item({ id: "y2", title: "Pinned two", pinned: true }), "");
    const { items, total } = await db.listItems({ pinned: true, limit: 10 });
    assert.equal(total, 2);
    assert.deepEqual(items.map((i) => i.id).sort(), ["y1", "y2"]);
    assert.equal((await db.countsForDecks(["inbox"])).pinned, 2);
  });

  test("excludeIds lets the Library float pins without loading the corpus", async () => {
    for (let i = 0; i < 6; i++) {
      await db.writeItem(item({ id: `e${i}`, title: `E${i}`, deckId: "reading", createdAt: 1000 + i }), "");
    }
    const res = await db.listItems({ deckId: "reading", limit: 10, excludeIds: new Set(["e5", "e4"]) });
    assert.deepEqual(res.items.map((i) => i.id), ["e3", "e2", "e1", "e0"]);
    assert.equal(res.total, 6, "total stays the true deck size");
  });

  test("pinnedInScope respects deck and tag scope", async () => {
    await db.writeItem(item({ id: "ps1", title: "P", deckId: "reading", tags: ["x"], pinned: true }), "");
    await db.writeItem(item({ id: "ps2", title: "P", deckId: "dev", tags: ["y"], pinned: true }), "");
    assert.equal((await db.pinnedInScope({ deckId: "reading" })).length, 1);
    assert.equal((await db.pinnedInScope({ tag: "y" })).length, 1);
    assert.equal((await db.pinnedInScope({})).length, 2);
  });
});

describe("delta-sync queue and diagnostics", () => {
  test("writes and deletes are queued with monotonically increasing revisions", async () => {
    await db.writeItem(item({ id: "q1", title: "One" }), "");
    await db.writeItem(item({ id: "q2", title: "Two" }), "");
    await db.removeItem("q1");
    const dirty = await db.getDirty();
    assert.equal(dirty.length, 2);
    assert.equal(dirty.find((d) => d.id === "q1").kind, "delete");
    assert.equal(dirty.find((d) => d.id === "q2").kind, "item");
    assert.ok((await db.getRev()) >= 3);

    await db.clearDirty(["q2"]);
    assert.equal((await db.getDirty()).length, 1);
  });

  test("getStats reports index health for the Settings → Diagnostics row", async () => {
    await db.writeItem(item({ id: "st1", title: "Statistics", tags: ["x"] }), "some body text here");
    const stats = await db.getStats();
    assert.equal(stats.items, 1);
    assert.equal(stats.contents, 1);
    assert.ok(stats.terms > 3);
    assert.ok(stats.postings > 3);
    assert.equal(stats.dirty, 1);
  });
});

describe("favicon cache", () => {
  test("favicons round-trip locally with no third party involved", async () => {
    assert.equal(await db.getFavicon("example.com"), null);
    await db.putFavicon("example.com", "data:image/png;base64,AAAA");
    assert.equal(await db.getFavicon("example.com"), "data:image/png;base64,AAAA");
    await db.putFavicon("", "data:,x");
    assert.equal(await db.getFavicon(""), null, "empty domains are ignored");
  });
});
