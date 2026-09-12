// test/storage.test.js — the data layer's contract, and specifically the
// behaviours that used to be able to lose a user's library:
//   • Import REPLACED everything wholesale (one click could wipe a library).
//   • The v1 → v2 migration moves 100% of items and keeps a backup.
//   • Export must stay valid JSON at sizes that cannot fit in one string.

import { test, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

await import("./harness.js");
const { resetWorld, memoryStore } = await import("./harness.js");
const { Storage, mergeRecords } = await import("../lib/storage.js");
const db = await import("../lib/db.js");
const { searchItems } = await import("../lib/search.js");

const DAY = 24 * 60 * 60 * 1000;

function rec(over = {}) {
  const now = Date.now();
  return {
    id: "k_" + Math.random().toString(36).slice(2, 10),
    type: "page",
    title: "Untitled",
    url: "https://example.com/",
    domain: "example.com",
    tags: [],
    deckId: "inbox",
    excerpt: "",
    note: "",
    content: "",
    createdAt: now,
    updatedAt: now,
    pinned: false,
    ...over,
  };
}

beforeEach(async () => {
  await resetWorld();
  await Storage.init();
});

describe("defaults and settings", () => {
  test("init seeds the nine built-in decks and default settings", async () => {
    const decks = await Storage.getDecks();
    assert.equal(decks.length, 9);
    assert.deepEqual(decks.map((d) => d.id), [
      "reading", "images", "videos", "quotes", "shopping", "dev", "research", "links", "inbox",
    ]);
    const settings = await Storage.getSettings();
    assert.equal(settings.autoOrganize, true);
    assert.equal(settings.autoSaveSelection, true);
    assert.equal(settings.onboardingDone, false, "capture stays undisclosed-but-off until first run");
  });

  test("updateSettings patches without dropping other keys", async () => {
    await Storage.updateSettings({ autoOrganize: false });
    const s = await Storage.getSettings();
    assert.equal(s.autoOrganize, false);
    assert.equal(s.showToast, true);
  });

  test("custom decks can be added, renamed and deleted (items fall back to Inbox)", async () => {
    const deck = await Storage.addDeck("Recipes", "🍝", "#123456");
    const saved = await Storage.saveItem(rec({ title: "Carbonara", deckId: deck.id }));
    await Storage.renameDeck(deck.id, "Dinner ideas");
    assert.equal((await Storage.getDecks()).find((d) => d.id === deck.id).name, "Dinner ideas");

    await Storage.deleteDeck(deck.id);
    assert.equal((await Storage.getDecks()).some((d) => d.id === deck.id), false);
    assert.equal((await Storage.getItem(saved.id)).deckId, "inbox", "orphaned items must not vanish");
  });

  test("Space→K is blocked on sites where Space and K are real shortcuts", () => {
    assert.equal(Storage.quickSaveAllowedOn("youtube.com"), false);
    assert.equal(Storage.quickSaveAllowedOn("www.youtube.com"), false);
    assert.equal(Storage.quickSaveAllowedOn("music.youtube.com"), false);
    assert.equal(Storage.quickSaveAllowedOn("mail.google.com"), false);
    assert.equal(Storage.quickSaveAllowedOn("github.com"), true);
    assert.equal(Storage.quickSaveAllowedOn("notyoutube.com"), true);
    assert.equal(Storage.quickSaveAllowedOn(""), false);
  });
});

describe("items", () => {
  test("saveItem fills in identity and timestamps, and files content separately", async () => {
    const saved = await Storage.saveItem({ title: "Test", content: "body text", deckId: "reading" });
    assert.ok(saved.id.startsWith("k_"));
    assert.equal(saved.type, "page");
    assert.equal(saved.deckId, "reading");
    assert.equal(saved.content, undefined);
    assert.equal((await Storage.getItemContent(saved.id)).text, "body text");
  });

  test("updateItem keeps existing content when the patch does not mention it", async () => {
    const saved = await Storage.saveItem({ title: "Keep me", content: "precious body text", deckId: "reading" });
    await Storage.updateItem(saved.id, { title: "Renamed", tags: ["x"] });
    assert.equal((await Storage.getItemContent(saved.id)).text, "precious body text");
    const after = await Storage.getItem(saved.id);
    assert.equal(after.title, "Renamed");
    assert.deepEqual(after.tags, ["x"]);
    assert.ok(after.updatedAt >= saved.updatedAt);
  });

  test("updateItem can replace content and the index follows", async () => {
    const saved = await Storage.saveItem({ title: "T", content: "typewriter ribbon" });
    await Storage.updateItem(saved.id, { content: "mechanical keyboard switches" });
    assert.equal((await searchItems({ query: "typewriter" })).total, 0);
    assert.equal((await searchItems({ query: "keyboard" })).total, 1);
  });

  test("updateItem on a missing id is a no-op, not a throw", async () => {
    assert.equal(await Storage.updateItem("nope", { title: "x" }), null);
  });

  test("deleteMany records tombstones for sync", async () => {
    const a = await Storage.saveItem({ title: "A" });
    const b = await Storage.saveItem({ title: "B" });
    await Storage.deleteMany([a.id, b.id]);
    const tombs = await Storage.getTombstones();
    assert.equal(tombs.length, 2);
    assert.deepEqual(tombs.map((t) => t.id).sort(), [a.id, b.id].sort());
    assert.equal((await Storage.getItems()).length, 0);
  });
});

describe("mergeRecords (shared by import and sync)", () => {
  test("newer updatedAt wins per record", () => {
    const local = [{ id: "1", updatedAt: 100, title: "local" }];
    const remote = [{ id: "1", updatedAt: 200, title: "remote" }];
    assert.equal(mergeRecords(local, remote).merged[0].title, "remote");
    assert.equal(mergeRecords(remote, local).merged[0].title, "remote");
  });

  test("a tombstone newer than the record kills it, an older one does not", () => {
    const rec1 = [{ id: "1", updatedAt: 100, title: "x" }];
    assert.equal(mergeRecords(rec1, [], [{ id: "1", deletedAt: 200 }]).merged.length, 0);
    assert.equal(mergeRecords(rec1, [], [{ id: "1", deletedAt: 50 }]).merged.length, 1);
  });

  test("both sides' records are unioned", () => {
    const { merged } = mergeRecords([{ id: "a", updatedAt: 1 }], [{ id: "b", updatedAt: 1 }]);
    assert.deepEqual(merged.map((m) => m.id).sort(), ["a", "b"]);
  });
});

describe("import never destroys an existing library", () => {
  test("v1.3 behaviour (for contrast): a raw overwrite would have wiped these", async () => {
    // This is the regression that matters: importing a small/old file must not
    // delete the larger/newer library that is already here.
    const kept = await Storage.saveItem(rec({ id: "keep", title: "Newer local item", updatedAt: Date.now() }));
    const older = rec({ id: "old", title: "Older imported item", updatedAt: Date.now() - 10 * DAY });

    const result = await Storage.importJSON(JSON.stringify({ version: 1, items: [older] }));

    assert.equal(result.added, 1);
    assert.equal((await Storage.getItems()).length, 2, "the local item must survive the import");
    assert.equal((await Storage.getItem(kept.id)).title, "Newer local item");
    assert.equal((await searchItems({ query: "newer" })).total, 1);
    assert.equal((await searchItems({ query: "older" })).total, 1, "imported items are searchable immediately");
  });

  test("a newer imported record updates the local one", async () => {
    await Storage.saveItem(rec({ id: "x", title: "Draft", updatedAt: Date.now() - DAY, content: "old body" }));
    const result = await Storage.importJSON({
      items: [{ id: "x", title: "Final", updatedAt: Date.now(), content: "new body", tags: ["edited"] }],
    });
    assert.equal(result.updated, 1);
    assert.equal((await Storage.getItem("x")).title, "Final");
    assert.equal((await Storage.getItemContent("x")).text, "new body");
    assert.equal((await searchItems({ query: "edited" })).total, 1);
  });

  test("an older imported record does not clobber newer local edits", async () => {
    await Storage.saveItem(rec({ id: "x", title: "My edit", updatedAt: Date.now(), content: "mine" }));
    await Storage.importJSON({ items: [{ id: "x", title: "Stale", updatedAt: Date.now() - DAY, content: "stale" }] });
    assert.equal((await Storage.getItem("x")).title, "My edit");
    assert.equal((await Storage.getItemContent("x")).text, "mine");
  });

  test("items deleted here are not resurrected by an import", async () => {
    const saved = await Storage.saveItem(rec({ id: "gone", title: "Deleted here" }));
    await Storage.deleteItem(saved.id);
    const result = await Storage.importJSON({ items: [{ id: "gone", title: "Deleted here", updatedAt: saved.updatedAt }] });
    assert.equal(result.added, 0);
    assert.equal(await Storage.getItem("gone"), null);
  });

  test("imported decks are added, existing decks are never renamed or replaced", async () => {
    await Storage.renameDeck("reading", "My Reading");
    await Storage.importJSON({
      decks: [
        { id: "reading", name: "Reading", icon: "📖" }, // must NOT overwrite the rename
        { id: "custom1", name: "Imported deck", icon: "🗂️" },
      ],
      items: [],
    });
    const decks = await Storage.getDecks();
    assert.equal(decks.find((d) => d.id === "reading").name, "My Reading");
    assert.equal(decks.find((d) => d.id === "custom1").name, "Imported deck");
  });

  test("dryRun reports what would happen without writing", async () => {
    await Storage.saveItem(rec({ id: "a", title: "A", updatedAt: Date.now() }));
    const preview = await Storage.importJSON(
      { items: [{ id: "a", title: "A2", updatedAt: Date.now() + 1000 }, { id: "b", title: "B" }] },
      { dryRun: true }
    );
    assert.equal(preview.written, 0);
    assert.equal(preview.added, 1);
    assert.equal(preview.updated, 1);
    assert.equal((await Storage.getItems()).length, 1, "nothing was written");
  });

  test("a bulk import of thousands of items lands searchable and intact", async () => {
    const items = Array.from({ length: 2000 }, (_, i) =>
      rec({ id: `imp${i}`, title: `Imported article ${i} about fermentation`, tags: [`batch${i % 5}`], content: `body ${i} sourdough hydration` })
    );
    const result = await Storage.importJSON({ version: 2, items });
    assert.equal(result.added, 2000);
    assert.equal((await Storage.getCounts()).total, 2000);
    assert.equal((await searchItems({ query: "fermentation" })).total, 2000);
    assert.equal((await searchItems({ query: "hydration batch2" })).total, 400);
  });
});

describe("export", () => {
  test("exported JSON is valid, round-trips, and includes full text", async () => {
    await Storage.saveItem(rec({ id: "e1", title: "Export me", content: "the complete body text", tags: ["t1"] }));
    await Storage.saveItem(rec({ id: "e2", title: "Second", content: "" }));
    const json = await Storage.exportJSON();
    const parsed = JSON.parse(json);
    assert.equal(parsed.version, 2);
    assert.equal(parsed.app, "kipideck");
    assert.equal(parsed.counts.items, 2);
    assert.equal(parsed.decks.length, 9);
    const e1 = parsed.items.find((i) => i.id === "e1");
    assert.equal(e1.content, "the complete body text");
    assert.equal(e1.title, "Export me");
    assert.equal(e1.idx, undefined, "internal index terms must not leak into user exports");
    assert.equal(e1.n, undefined, "internal numeric ids must not leak into user exports");

    // and it restores into a clean library
    await Storage.clearAll();
    assert.equal((await Storage.getCounts()).total, 0);
    const restored = await Storage.importJSON(json);
    assert.equal(restored.added, 2);
    assert.equal((await Storage.getItemContent("e1")).text, "the complete body text");
  });

  test("exportChunks streams, so a huge library never becomes one giant string", async () => {
    const items = Array.from({ length: 50 }, (_, i) => rec({ id: `c${i}`, title: `Chunk ${i}`, content: "y".repeat(5000) }));
    await db.writeItemsBulk(items.map((item) => ({ item, text: item.content })));

    const seen = [];
    const parts = await Storage.exportChunks({ batchSize: 10, onProgress: (done, total) => seen.push([done, total]) });
    assert.ok(parts.length >= 7, "header + 5 batches + footer");
    assert.deepEqual(seen[seen.length - 1], [50, 50]);
    const parsed = JSON.parse(parts.join(""));
    assert.equal(parsed.items.length, 50);
    assert.equal(parsed.items[0].content.length, 5000);
  });
});

describe("v1 → v2 migration", () => {
  test("a legacy kipi_items array is moved into IndexedDB, searchable, and backed up", async () => {
    await resetWorld();
    const legacy = [
      rec({ id: "l1", title: "Legacy carbonara", deckId: "reading", tags: ["recipe"], content: "guanciale pecorino", createdAt: Date.now() - 5 * DAY }),
      rec({ id: "l2", title: "Legacy react notes", deckId: "dev", tags: ["dev"], content: "hooks state effects", createdAt: Date.now() - 4 * DAY }),
    ];
    memoryStore.set("kipi_items", legacy);

    const migration = await Storage.init();
    assert.equal(migration.ok, true);
    assert.equal(migration.migrated, 2);

    assert.equal((await Storage.getCounts()).total, 2);
    assert.equal((await searchItems({ query: "carbonara" })).total, 1);
    assert.equal((await searchItems({ query: "guanciale" })).total, 1, "migrated full text stays searchable");
    assert.equal((await Storage.getItemContent("l1")).text, "guanciale pecorino");

    // the old array is preserved, not deleted — a migration must never be the
    // thing that loses data
    assert.equal(memoryStore.has("kipi_items"), false, "legacy key is retired");
    assert.equal(memoryStore.get("kipi_items_v1_backup").length, 2, "backup keeps the original records");
  });

  test("migration is idempotent — a second init does not duplicate anything", async () => {
    await resetWorld();
    memoryStore.set("kipi_items", [rec({ id: "only", title: "Single legacy item", content: "body" })]);
    await Storage.init();
    await Storage.init();
    await Storage.init();
    assert.equal((await Storage.getCounts()).total, 1);
    assert.equal((await searchItems({ query: "legacy" })).total, 1);
  });

  test("a fresh install with no legacy data migrates zero items and still works", async () => {
    const migration = await Storage.init();
    assert.equal(migration.migrated, 0);
    const saved = await Storage.saveItem({ title: "First save", content: "hello" });
    assert.equal((await searchItems({ query: "first" })).total, 1);
    assert.ok(saved.id);
  });
});

describe("diagnostics and reset", () => {
  test("getStats reports what support needs", async () => {
    await Storage.saveItem(rec({ title: "Stats", content: "body" }));
    const stats = await Storage.getStats();
    assert.equal(stats.items, 1);
    assert.equal(stats.contents, 1);
    assert.ok(stats.terms >= 2);
  });

  test("clearAll resets items, decks and tombstones", async () => {
    const a = await Storage.saveItem(rec({ title: "Doomed" }));
    await Storage.deleteItem(a.id);
    await Storage.addDeck("Temp");
    await Storage.clearAll();
    assert.equal((await Storage.getCounts()).total, 0);
    assert.equal((await Storage.getDecks()).length, 9);
    assert.deepEqual(await Storage.getTombstones(), []);
  });

  test("reindex recovers searchability after index damage", async () => {
    await Storage.saveItem(rec({ id: "r1", title: "Fermentation", content: "salt flour water" }));
    // simulate a corrupted/emptied index
    await db.tx(["termdict", "postings"], "readwrite", async (t) => {
      await new Promise((res, rej) => {
        const r = t.objectStore("termdict").clear();
        r.onsuccess = () => res();
        r.onerror = () => rej(r.error);
      });
      await new Promise((res, rej) => {
        const r = t.objectStore("postings").clear();
        r.onsuccess = () => res();
        r.onerror = () => rej(r.error);
      });
    });
    assert.equal((await searchItems({ query: "fermentation" })).total, 0, "index is empty");
    await Storage.reindex();
    assert.equal((await searchItems({ query: "fermentation" })).total, 1, "reindex restores it");
    assert.equal((await searchItems({ query: "flour" })).total, 1);
  });
});
