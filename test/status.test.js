// test/status.test.js — the save-state workflow (ideas.md I-12).
//
// Unread → Reading → Done, plus Archived. The states that matter for
// correctness rather than convenience:
//
//   1. every stored record carries exactly one of the four values, no matter
//      which path wrote it (save, update, sync merge, import, old backup);
//   2. filtering is index-driven with exact totals, never a scan with a filter;
//   3. a v1 library (whose records have no `status` key at all) upgrades to v2
//      with every item reading as unread — nothing vanishes from any view.

import { test, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

await import("./harness.js");
const { resetWorld } = await import("./harness.js");
const db = await import("../lib/db.js");
const { Storage } = await import("../lib/storage.js");
const { searchItems, parseQuery, snippet } = await import("../lib/search.js");
const { toKipideckItems } = await import("../lib/import.js");
const { normalizeStatus, statusOf, fromForeignStatus, isStatus, STATUSES } = await import(
  "../lib/status.js"
);

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

describe("the vocabulary", () => {
  test("the four canonical values pass through untouched", () => {
    assert.deepEqual(STATUSES, ["unread", "reading", "done", "archived"]);
    for (const s of STATUSES) {
      assert.equal(normalizeStatus(s), s);
      assert.equal(isStatus(s), true);
    }
  });

  test("foreign spellings map to the nearest state", () => {
    assert.equal(normalizeStatus("archive"), "archived");
    assert.equal(normalizeStatus("ARCHIVED"), "archived");
    assert.equal(normalizeStatus("read"), "done");
    assert.equal(normalizeStatus("finished"), "done");
    assert.equal(normalizeStatus("toread"), "unread");
    assert.equal(normalizeStatus("to-read"), "unread");
    assert.equal(normalizeStatus("started"), "reading");
  });

  test("favouriting is enthusiasm, not progress", () => {
    assert.equal(normalizeStatus("favorite"), "unread");
    assert.equal(normalizeStatus("favourite"), "unread");
    assert.equal(normalizeStatus("starred"), "unread");
  });

  test("unknown, empty and missing values become unread — the only safe default", () => {
    for (const v of ["", "   ", "bogus", null, undefined, 42, "read-later-ish"]) {
      assert.equal(normalizeStatus(v), "unread", JSON.stringify(v));
      assert.equal(isStatus(v), false, JSON.stringify(v));
    }
  });

  test("statusOf reads pre-v1.6 records (no status key) as unread", () => {
    assert.equal(statusOf({}), "unread");
    assert.equal(statusOf(null), "unread");
    assert.equal(statusOf({ status: "done" }), "done");
    assert.equal(statusOf({ status: "archive" }), "archived");
    assert.equal(statusOf({ status: "nonsense" }), "unread");
  });

  test("fromForeignStatus maps importer states, including our own", () => {
    assert.equal(fromForeignStatus(null), "unread");
    assert.equal(fromForeignStatus(""), "unread");
    assert.equal(fromForeignStatus("archive"), "archived");
    assert.equal(fromForeignStatus("unread"), "unread");
    assert.equal(fromForeignStatus("favorite"), "unread");
    assert.equal(fromForeignStatus("reading"), "reading");
    assert.equal(fromForeignStatus("done"), "done");
  });
});

describe("stored records", () => {
  test("a save starts unread", async () => {
    const rec = await Storage.saveItem(item({ id: "st_default" }));
    assert.equal(rec.status, "unread");
    assert.equal((await Storage.getItem("st_default")).status, "unread");
  });

  test("an explicit status is honoured, garbage is normalised", async () => {
    assert.equal((await Storage.saveItem(item({ id: "st_done", status: "done" }))).status, "done");
    assert.equal((await Storage.saveItem(item({ id: "st_garbage", status: "eventually" }))).status, "unread");
  });

  test("updateItem moves an item between states", async () => {
    await Storage.saveItem(item({ id: "st_move" }));
    assert.equal((await Storage.updateItem("st_move", { status: "reading" })).status, "reading");
    assert.equal((await Storage.updateItem("st_move", { status: "archived" })).status, "archived");
    assert.equal((await Storage.getItem("st_move")).status, "archived");
  });

  test("bulk writes normalise too — imports cannot smuggle a foreign spelling in", async () => {
    await db.writeItemsBulk([
      { item: item({ id: "st_b1", status: "archive" }), text: "" },
      { item: item({ id: "st_b2" }), text: "" },
    ]);
    assert.equal((await db.getItemMeta("st_b1")).status, "archived");
    assert.equal((await db.getItemMeta("st_b2")).status, "unread");
  });
});

describe("filtering", () => {
  async function seed() {
    await Storage.saveItem(item({ id: "f_u1", title: "U1", deckId: "reading", createdAt: 1000, status: "unread" }));
    await Storage.saveItem(item({ id: "f_u2", title: "U2", deckId: "dev", createdAt: 2000, status: "unread", tags: ["x"] }));
    await Storage.saveItem(item({ id: "f_r1", title: "R1", deckId: "reading", createdAt: 3000, status: "reading", tags: ["x"] }));
    await Storage.saveItem(item({ id: "f_d1", title: "D1", deckId: "reading", createdAt: 4000, status: "done", pinned: true }));
    await Storage.saveItem(item({ id: "f_a1", title: "A1", deckId: "dev", createdAt: 5000, status: "archived" }));
  }

  test("each state filters with an exact total", async () => {
    await seed();
    assert.equal((await db.listItems({ status: "unread", limit: 10 })).total, 2);
    assert.equal((await db.listItems({ status: "reading", limit: 10 })).total, 1);
    assert.equal((await db.listItems({ status: "done", limit: 10 })).total, 1);
    assert.equal((await db.listItems({ status: "archived", limit: 10 })).total, 1);
    assert.equal((await db.listItems({ limit: 10 })).total, 5, "no filter still shows everything");
  });

  test("filtered pages stay newest-first", async () => {
    await seed();
    const res = await db.listItems({ status: "unread", sort: "new", limit: 10 });
    assert.deepEqual(res.items.map((i) => i.id), ["f_u2", "f_u1"]);
  });

  test("deck + status combines through the compound index", async () => {
    await seed();
    const res = await db.listItems({ deckId: "reading", status: "unread", limit: 10 });
    assert.equal(res.total, 1);
    assert.equal(res.items[0].id, "f_u1");
  });

  test("status + A–Z sorts by title, not by accident of insertion", async () => {
    await seed();
    const res = await db.listItems({ status: "unread", sort: "az", limit: 10 });
    assert.deepEqual(res.items.map((i) => i.title), ["U1", "U2"]);
    const decked = await db.listItems({ deckId: "reading", status: "unread", sort: "az", limit: 10 });
    assert.equal(decked.total, 1);
  });

  test("tag + status and pinned + status narrow the in-memory paths too", async () => {
    await seed();
    assert.equal((await db.listItems({ tag: "x", status: "reading", limit: 10 })).total, 1);
    assert.equal((await db.listItems({ tag: "x", status: "unread", limit: 10 })).total, 1);
    assert.equal((await db.listItems({ pinned: true, status: "done", limit: 10 })).total, 1);
    assert.equal((await db.listItems({ pinned: true, status: "unread", limit: 10 })).total, 0);
  });

  test("an unrecognised status filters to nothing, not to unread", async () => {
    await seed();
    // Silently reinterpreting garbage as a real state would hide the library.
    assert.equal((await db.listItems({ status: "eventually", limit: 10 })).total, 5);
  });

  test("sidebar counts include every state", async () => {
    await seed();
    const counts = await Storage.getCounts();
    assert.deepEqual(counts.byStatus, { unread: 2, reading: 1, done: 1, archived: 1 });
  });

  test("pinned-first respects the status filter", async () => {
    await seed();
    assert.equal((await Storage.pinnedInScope({ status: "done" })).length, 1);
    assert.equal((await Storage.pinnedInScope({ status: "unread" })).length, 0);
  });

  test("status pages exclude already-floated pins without losing the total", async () => {
    await seed();
    const res = await db.listItems({ status: "done", limit: 10, excludeIds: new Set(["f_d1"]) });
    assert.equal(res.items.length, 0);
    assert.equal(res.total, 1, "total stays the true scope size");
  });
});

describe("search", () => {
  test("parseQuery splits the status: operator from free text", () => {
    const { filters, freeTerms } = parseQuery("carbonara status:done tag:recipe");
    assert.deepEqual(freeTerms, ["carbonara"]);
    assert.deepEqual(filters.status, ["done"]);
    assert.deepEqual(filters.tag, ["recipe"]);
  });

  test("a status scope narrows search results", async () => {
    await Storage.saveItem(item({ id: "s_u", title: "kettle manual", status: "unread" }));
    await Storage.saveItem(item({ id: "s_d", title: "kettle review", status: "done" }));
    assert.equal((await searchItems({ query: "kettle", status: "done" })).total, 1);
    assert.equal((await searchItems({ query: "kettle", status: "unread" })).total, 1);
    assert.equal((await searchItems({ query: "kettle status:done" })).total, 1);
    assert.equal((await searchItems({ query: "kettle" })).total, 2);
  });

  test("the operator wins over the view filter", async () => {
    await Storage.saveItem(item({ id: "s_o1", title: "kettle manual", status: "unread" }));
    await Storage.saveItem(item({ id: "s_o2", title: "kettle review", status: "done" }));
    const res = await searchItems({ query: "kettle status:done", status: "unread" });
    assert.equal(res.total, 1);
    assert.equal(res.items[0].id, "s_o2");
  });

  test("an unknown status: operator matches nothing, not everything", async () => {
    await Storage.saveItem(item({ id: "s_x", title: "kettle manual", status: "unread" }));
    assert.equal((await searchItems({ query: "kettle status:eventually" })).total, 0);
  });

  test("status intersects deck scope inside search", async () => {
    await Storage.saveItem(item({ id: "s_i1", title: "kettle manual", deckId: "reading", status: "unread" }));
    await Storage.saveItem(item({ id: "s_i2", title: "kettle review", deckId: "dev", status: "unread" }));
    assert.equal((await searchItems({ query: "kettle", deckId: "reading", status: "unread" })).total, 1);
    assert.equal((await searchItems({ query: "kettle", deckId: "reading", status: "done" })).total, 0);
  });

  test("snippets ignore the status: operator", () => {
    const s = snippet("a kettle manual for stovetop kettles", "kettle status:done");
    assert.ok(s.includes("kettle"));
  });
});

describe("imports map foreign read-states onto real states", () => {
  function normalized(rawItems) {
    return toKipideckItems({ format: "test", items: rawItems }, { targetDeck: "inbox" }).items;
  }

  test("archive arrives archived, unread arrives unread", () => {
    const [archived, unread] = normalized([
      { url: "https://example.com/a", title: "A", status: "archive" },
      { url: "https://example.com/u", title: "U", status: "unread" },
    ]);
    assert.equal(archived.status, "archived");
    assert.equal(unread.status, "unread");
  });

  test("a favourite stays unread but keeps its tag", () => {
    const [fav] = normalized([{ url: "https://example.com/f", title: "F", status: "favorite" }]);
    assert.equal(fav.status, "unread");
    assert.ok(fav.tags.includes("favorite"));
  });

  test("an archived item also keeps its tag, like before", () => {
    const [archived] = normalized([{ url: "https://example.com/a", title: "A", status: "archive" }]);
    assert.ok(archived.tags.includes("archive"));
  });

  test("importRecords stores the mapped states", async () => {
    const items = normalized([
      { url: "https://example.com/a", title: "A", status: "archive", addedAt: Date.now() },
      { url: "https://example.com/u", title: "U", addedAt: Date.now() },
    ]);
    const result = await Storage.importRecords(items);
    assert.equal(result.added, 2);
    assert.equal((await db.listItems({ status: "archived", limit: 10 })).total, 1);
    assert.equal((await db.listItems({ status: "unread", limit: 10 })).total, 1);
  });

  test("a foreign spelling that slips through is normalised, never stored raw", async () => {
    const result = await Storage.importRecords([
      { url: "https://example.com/w", title: "W", status: "read", createdAt: Date.now(), updatedAt: Date.now() },
    ]);
    assert.equal(result.added, 1);
    // "read" is not a Kipideck state — but it is also not stored verbatim.
    const stored = (await db.listItems({ limit: 10 })).items[0];
    assert.ok(STATUSES.includes(stored.status), `stored ${JSON.stringify(stored.status)}`);
  });
});

describe("states survive export, import and merge", () => {
  test("JSON export carries states and re-import preserves them", async () => {
    await Storage.saveItem(item({ id: "x_s1", title: "S1", status: "reading" }));
    const json = await Storage.exportJSON({ withContent: false });
    assert.ok(json.includes('"status":"reading"'), "the state is in the file");
    const before = await Storage.getItem("x_s1");
    const result = await Storage.importJSON(json);
    assert.equal(result.added, 0, "re-importing our own export adds nothing");
    assert.equal((await Storage.getItem("x_s1")).status, before.status);
  });

  test("a newer edit from another device carries its state through the merge", async () => {
    const saved = await Storage.saveItem(item({ id: "x_m1", title: "M1", status: "unread" }));
    const remote = {
      version: 2,
      app: "kipideck",
      items: [{ ...saved, status: "done", updatedAt: saved.updatedAt + 1000 }],
    };
    const result = await Storage.importJSON(remote);
    assert.equal(result.updated, 1);
    // importJSON goes through mergeRecords — the same record-level merge sync
    // uses — so whatever survives here survives cross-device sync too.
    assert.equal((await Storage.getItem("x_m1")).status, "done");
  });
});

describe("the v1 → v2 upgrade", () => {
  test("a v1 library backfills unread onto every record and gains the indexes", async () => {
    // Start over with a genuine v1 database: the items store as v1.5 created
    // it (no status index) and records with no status key at all.
    await resetWorld();
    await new Promise((resolve, reject) => {
      const req = indexedDB.open("kipideck", 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        // Every index v1.5's fresh-create made (lib/db.js), minus the status
        // family v2 adds: pf, canon and the compounds must already exist or
        // the fixture is testing an upgrade path no real user can hit.
        const items = d.createObjectStore("items", { keyPath: "id" });
        items.createIndex("createdAt", "createdAt");
        items.createIndex("updatedAt", "updatedAt");
        items.createIndex("title", "title");
        items.createIndex("pf", "pf");
        items.createIndex("canon", "canon");
        items.createIndex("fp", "fp");
        items.createIndex("deckId", "deckId");
        items.createIndex("byDeckCreated", ["deckId", "createdAt"]);
        items.createIndex("byDeckTitle", ["deckId", "title"]);
        items.createIndex("tags", "tags", { multiEntry: true });
      };
      req.onsuccess = () => {
        const d = req.result;
        const t = d.transaction(["items"], "readwrite");
        t.objectStore("items").put({ id: "old1", title: "Old one", deckId: "reading", createdAt: 1000 });
        t.objectStore("items").put({ id: "old2", title: "Old two", deckId: "dev", createdAt: 2000 });
        t.oncomplete = () => {
          d.close();
          resolve();
        };
        t.onerror = () => reject(t.error);
      };
      req.onerror = () => reject(req.error);
    });

    // Reopen through the real openDB: this is the upgrade under test.
    await db.openDB();

    assert.equal((await db.getItemMeta("old1")).status, "unread");
    assert.equal((await db.getItemMeta("old2")).status, "unread");
    assert.equal((await db.listItems({ status: "unread", limit: 10 })).total, 2);
    assert.equal((await db.listItems({ deckId: "reading", status: "unread", limit: 10 })).total, 1);
    const counts = await db.countsForDecks(["reading", "dev"]);
    assert.deepEqual(counts.byStatus, { unread: 2, reading: 0, done: 0, archived: 0 });
  });
});
