// test/import-storage.test.js — what happens when an import meets a library
// that already exists (ideas.md I-05).
//
// The importer's job is not "write rows". It is: never duplicate, never
// resurrect something the user deleted, never overwrite a newer local edit, and
// be re-runnable — because the first thing a worried person does after an import
// is run it again to make sure it worked.

import { test, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

await import("./harness.js");
const { resetWorld } = await import("./harness.js");
const { Storage } = await import("../lib/storage.js");
const db = await import("../lib/db.js");
const { searchItems } = await import("../lib/search.js");
const { parseExport, toKipideckItems } = await import("../lib/import.js");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

function record(over = {}) {
  return {
    type: "page",
    title: "An imported article",
    url: "https://example.com/a",
    domain: "example.com",
    tags: ["imported"],
    deckId: "inbox",
    excerpt: "",
    note: "",
    content: "",
    createdAt: NOW - 10 * DAY,
    updatedAt: NOW - 10 * DAY,
    pinned: false,
    ...over,
  };
}

beforeEach(async () => {
  await resetWorld();
  await Storage.init();
});

describe("Storage.importRecords", () => {
  test("writes new items and reports what it did", async () => {
    const result = await Storage.importRecords([
      record({ url: "https://example.com/a", title: "A" }),
      record({ url: "https://example.com/b", title: "B" }),
      record({ url: "https://example.com/c", title: "C" }),
    ]);
    assert.equal(result.added, 3);
    assert.equal(result.written, 3);
    assert.equal(result.duplicates, 0);
    const metas = await db.getAllItemMetas();
    assert.equal(metas.length, 3);
    assert.deepEqual(metas.map((m) => m.title).sort(), ["A", "B", "C"]);
  });

  test("imported items are searchable immediately", async () => {
    await Storage.importRecords([
      record({ url: "https://example.com/typewriter", title: "Typewriter history", content: "A long article about typewriters and their ribbons." }),
    ]);
    assert.equal((await searchItems({ query: "typewriter" })).total, 1, "title is indexed");
    assert.equal((await searchItems({ query: "ribbons" })).total, 1, "imported content is indexed too");
  });

  test("re-importing the same file adds nothing", async () => {
    const batch = [
      record({ url: "https://example.com/a", title: "A" }),
      record({ url: "https://example.com/b", title: "B" }),
    ];
    const first = await Storage.importRecords(batch);
    const second = await Storage.importRecords(batch.map((r) => ({ ...r })));
    assert.equal(first.added, 2);
    assert.equal(second.added, 0, "the second import must be a no-op");
    assert.equal(second.duplicates, 2);
    assert.equal((await db.getAllItemMetas()).length, 2);
  });

  test("the same article reached by a different URL shape is still one item", async () => {
    await Storage.importRecords([record({ url: "https://example.com/story/", title: "Story" })]);
    const again = await Storage.importRecords([
      record({ url: "https://EXAMPLE.com/story?utm_source=pocket&utm_medium=social", title: "Story (again)" }),
    ]);
    assert.equal(again.added, 0);
    assert.equal(again.duplicates, 1);
    assert.equal((await db.getAllItemMetas()).length, 1);
  });

  test("an import cannot resurrect something the user deleted", async () => {
    const first = await Storage.importRecords([record({ url: "https://example.com/gone", title: "Gone" })]);
    const id = (await db.getAllItemMetas())[0].id;
    assert.equal(first.added, 1);
    await Storage.deleteItem(id);
    assert.equal((await db.getAllItemMetas()).length, 0);

    const again = await Storage.importRecords([record({ url: "https://example.com/gone", title: "Gone" })]);
    assert.equal(again.added, 0, "a deletion is a decision, not an accident");
    assert.equal(again.deleted, 1);
    assert.equal((await db.getAllItemMetas()).length, 0);
  });

  test("newest edit wins in both directions", async () => {
    await Storage.importRecords([record({ url: "https://example.com/x", title: "Local version", updatedAt: NOW, createdAt: NOW - DAY })]);

    // An older export cannot roll back a newer local edit.
    const stale = await Storage.importRecords([record({ url: "https://example.com/x", title: "Older import", updatedAt: NOW - 5 * DAY })]);
    assert.equal(stale.updated, 0);
    assert.equal(stale.duplicates, 1);
    assert.equal((await db.getAllItemMetas())[0].title, "Local version");

    // A newer export does replace it, keeping the same id.
    const idBefore = (await db.getAllItemMetas())[0].id;
    const fresh = await Storage.importRecords([record({ url: "https://example.com/x", title: "Newer import", updatedAt: NOW + DAY })]);
    assert.equal(fresh.updated, 1);
    assert.equal(fresh.added, 0);
    const after = (await db.getAllItemMetas())[0];
    assert.equal(after.title, "Newer import");
    assert.equal(after.id, idBefore, "updating must not create a second item");
    assert.equal((await db.getAllItemMetas()).length, 1);
  });

  test("dryRun counts without writing a single byte", async () => {
    const preview = await Storage.importRecords(
      [record({ url: "https://example.com/a" }), record({ url: "https://example.com/b" })],
      { dryRun: true },
    );
    assert.equal(preview.added, 2);
    assert.equal(preview.written, 0);
    assert.equal((await db.getAllItemMetas()).length, 0, "a preview must never touch the library");
  });

  test("progress is reported, and finishes at the total", async () => {
    const seen = [];
    const batch = Array.from({ length: 900 }, (_, i) => record({ url: `https://example.com/p/${i}`, title: `Item ${i}` }));
    const result = await Storage.importRecords(batch, { batchSize: 250, onProgress: (p) => seen.push(p) });
    assert.equal(result.added, 900);
    assert.ok(seen.length >= 3, `expected several progress events, got ${seen.length}`);
    assert.equal(seen[seen.length - 1].done, 900);
    assert.equal(seen[seen.length - 1].total, 900);
    assert.deepEqual(seen.map((p) => p.done), [...seen.map((p) => p.done)].sort((a, b) => a - b), "progress only moves forward");
  });

  test("records with no usable URL are reported, not written", async () => {
    const result = await Storage.importRecords([
      record({ url: "https://example.com/ok", title: "Fine" }),
      record({ url: "", title: "No address" }),
      record({ url: "   ", title: "Blank address" }),
    ]);
    assert.equal(result.added, 1);
    assert.equal(result.invalid, 2);
    assert.equal((await db.getAllItemMetas()).length, 1);
  });

  test("an empty import is a no-op, not an error", async () => {
    const result = await Storage.importRecords([]);
    assert.deepEqual({ added: result.added, written: result.written }, { added: 0, written: 0 });
    assert.equal((await db.getAllItemMetas()).length, 0);
  });

  test("imported items keep their own tags, dates, notes and content", async () => {
    const note = "“the best part”\n  — my annotation";
    await Storage.importRecords([
      record({
        url: "https://example.com/rich",
        title: "Rich item",
        tags: ["coffee", "recipes"],
        note,
        content: "The full article text, long enough to be indexed properly.",
        createdAt: NOW - 400 * DAY,
        updatedAt: NOW - 400 * DAY,
        deckId: "reading",
        pinned: true,
      }),
    ]);
    const stored = (await db.getAllItemMetas())[0];
    assert.deepEqual(stored.tags, ["coffee", "recipes"]);
    assert.equal(stored.note, note);
    assert.equal(stored.deckId, "reading");
    assert.equal(stored.pinned, true);
    assert.equal(stored.createdAt, NOW - 400 * DAY, "the original save date survives");
    assert.match((await db.getContent(stored.id)).text, /full article text/);
  });

  test("2,000 records import in one go and stay consistent", async () => {
    const batch = Array.from({ length: 2000 }, (_, i) =>
      record({ url: `https://example.com/big/${i}`, title: `Big import ${i}`, createdAt: NOW - i * 1000 }),
    );
    const started = Date.now();
    const result = await Storage.importRecords(batch);
    const elapsed = Date.now() - started;
    assert.equal(result.added, 2000);
    assert.equal((await db.getAllItemMetas()).length, 2000);
    assert.ok(elapsed < 60_000, `2,000 records took ${elapsed}ms`);
    console.log(`      2,000-record import (IndexedDB + search index): ${elapsed} ms`);
  });
});

describe("parser → storage, end to end", () => {
  const POCKET_CSV = [
    "title,url,time_added,tags,status",
    '"Espresso at home",https://getpocket.com/extredirect?url=https%3A%2F%2Fexample.com%2Fespresso&http=1,1709251200,coffee|recipes,unread',
    '"Old read",https://example.com/old,1500000000,keep,archive',
  ].join("\n");

  test("a Pocket CSV lands in the library with its tags, dates and read state", async () => {
    const { items } = toKipideckItems(parseExport({ name: "part_000000.csv", text: POCKET_CSV }));
    const result = await Storage.importRecords(items);
    assert.equal(result.added, 2);

    const metas = await db.getAllItemMetas();
    const espresso = metas.find((m) => m.url.includes("espresso"));
    assert.ok(espresso, "the redirect-wrapped URL was unwrapped and stored");
    assert.equal(espresso.url, "https://example.com/espresso");
    assert.deepEqual(espresso.tags, ["coffee", "recipes"]);
    assert.equal(new Date(espresso.createdAt).toISOString().slice(0, 10), "2024-03-01");
    assert.ok(metas.find((m) => m.url.includes("/old")).tags.includes("archive"));
    assert.equal((await searchItems({ query: "espresso" })).total, 1);
  });

  test("importing the same Pocket file twice is still two items", async () => {
    const parsed = parseExport({ name: "part_000000.csv", text: POCKET_CSV });
    await Storage.importRecords(toKipideckItems(parsed).items);
    const again = await Storage.importRecords(toKipideckItems(parsed).items);
    assert.equal(again.added, 0);
    assert.equal(again.duplicates, 2);
    assert.equal((await db.getAllItemMetas()).length, 2);
  });

  test("a second file that repeats a link adds only the new one", async () => {
    await Storage.importRecords(toKipideckItems(parseExport({ name: "part_000000.csv", text: POCKET_CSV })).items);
    const part2 = [
      "title,url,time_added,tags,status",
      '"Espresso at home",https://example.com/espresso,1709251200,coffee,unread',
      '"Brand new",https://example.com/new,1710000000,fresh,unread',
    ].join("\n");
    const result = await Storage.importRecords(toKipideckItems(parseExport({ name: "part_000001.csv", text: part2 })).items);
    assert.equal(result.added, 1);
    assert.equal(result.duplicates, 1);
    assert.equal((await db.getAllItemMetas()).length, 3);
  });
});
