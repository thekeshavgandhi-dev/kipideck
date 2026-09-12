// test/samples.test.js — the first-run sample items (ideas.md I-03).
//
// Three things can go wrong with sample data, and none of them are cosmetic:
//
//   1. Seeding duplicates itself, so a second click litters the library.
//   2. Samples cannot be removed, so they become permanent junk.
//   3. Seeding silently flips the disclosure gate — which would mean the
//      first-run page lied about when automatic capture starts.
//
// Each of those has a test below. The third one is the important one: it is the
// same promise `policy.test.js` guards, and it is re-checked there too.

import { test, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

await import("./harness.js");
const { resetWorld } = await import("./harness.js");
const { Storage } = await import("../lib/storage.js");
const { seedSamples, countSamples, removeSamples, SAMPLE_ITEMS, SAMPLE_TAG } = await import(
  "../lib/samples.js"
);

beforeEach(async () => {
  await resetWorld();
  await Storage.init();
});

describe("the sample items themselves", () => {
  test("every sample carries the sample tag, so they are findable as one group", () => {
    assert.ok(SAMPLE_ITEMS.length >= 3, "enough samples to demo decks, search and pins");
    for (const item of SAMPLE_ITEMS) {
      assert.ok(Array.isArray(item.tags), `${item.title} has a tag array`);
      assert.ok(
        item.tags.includes(SAMPLE_TAG),
        `“${item.title}” is tagged "${SAMPLE_TAG}" so it can be removed`
      );
    }
  });

  test("the samples actually exercise the features they are meant to demo", () => {
    assert.ok(
      SAMPLE_ITEMS.some((i) => String(i.content || "").length > 0),
      "at least one sample has page text, so full-text search has something to hit"
    );
    assert.ok(SAMPLE_ITEMS.some((i) => i.pinned), "at least one sample is pinned");
    assert.ok(
      new Set(SAMPLE_ITEMS.map((i) => i.deckId)).size > 1,
      "samples span more than one deck, so deck filtering is visible"
    );
    assert.ok(
      SAMPLE_ITEMS.some((i) => i.status && i.status !== "unread"),
      "at least one sample is triaged past unread, so the status filter has something to show"
    );
  });

  test("every sample has an absolute url and a title", () => {
    for (const item of SAMPLE_ITEMS) {
      assert.match(item.url, /^https?:\/\//, `“${item.title}” has an absolute url`);
      assert.ok(String(item.title || "").trim().length > 0, "every sample has a title");
    }
  });

  test("every sample lands in a deck that exists by default", async () => {
    const ids = new Set((await Storage.getDecks()).map((d) => d.id));
    for (const item of SAMPLE_ITEMS) {
      assert.ok(ids.has(item.deckId), `“${item.title}” targets a real deck (${item.deckId})`);
    }
  });
});

describe("seeding", () => {
  test("adds the whole set to a fresh library", async () => {
    const r = await seedSamples();
    assert.equal(r.added, SAMPLE_ITEMS.length);
    assert.equal(r.skipped, 0);
    assert.equal(await countSamples(), SAMPLE_ITEMS.length);
  });

  test("is idempotent — a second click adds nothing", async () => {
    await seedSamples();
    const r = await seedSamples();
    assert.equal(r.added, 0, "nothing is added the second time");
    assert.equal(r.skipped, SAMPLE_ITEMS.length);
    assert.equal(await countSamples(), SAMPLE_ITEMS.length, "still exactly one set");
  });

  test("does NOT flip the disclosure gate", async () => {
    await seedSamples();
    const settings = await Storage.getSettings();
    assert.equal(
      settings.onboardingDone,
      false,
      "seeding samples must never count as accepting the disclosure"
    );
  });
});

describe("removing", () => {
  test("deletes exactly the samples and leaves everything else alone", async () => {
    await seedSamples();
    const keep = await Storage.saveItem({
      type: "page",
      title: "My own save",
      url: "https://example.com/mine",
      tags: ["mine"],
      content: "this one is the user's",
    });

    const removed = await removeSamples();
    assert.equal(removed, SAMPLE_ITEMS.length);
    assert.equal(await countSamples(), 0);

    const left = await Storage.getItem(keep.id);
    assert.ok(left, "the user's own item survives a sample cleanup");
    assert.equal(left.title, "My own save");
  });

  test("on an empty library it is a no-op, not an error", async () => {
    assert.equal(await removeSamples(), 0);
  });

  test("removing twice is safe", async () => {
    await seedSamples();
    assert.equal(await removeSamples(), SAMPLE_ITEMS.length);
    assert.equal(await removeSamples(), 0);
  });

  test("samples can be seeded again after being removed", async () => {
    await seedSamples();
    await removeSamples();
    const r = await seedSamples();
    assert.equal(r.added, SAMPLE_ITEMS.length, "re-seeding after removal works");
    assert.equal(await countSamples(), SAMPLE_ITEMS.length);
  });

  test("removal records tombstones, so a re-import cannot resurrect them", async () => {
    await seedSamples();
    await removeSamples();
    const tombs = await Storage.getTombstones();
    assert.ok(tombs.length >= SAMPLE_ITEMS.length, "deletions were recorded");
    assert.ok(
      tombs.every((t) => t.id && typeof t.deletedAt === "number"),
      "each tombstone has an id and a deletion time"
    );
  });
});

describe("round trip through our own export", () => {
  test("samples survive export and re-import without duplicating", async () => {
    await seedSamples();
    const json = await Storage.exportJSON({ withContent: true });
    await Storage.importJSON(json);
    assert.equal(
      await countSamples(),
      SAMPLE_ITEMS.length,
      "re-importing our own export must not create a second set of samples"
    );
  });
});
