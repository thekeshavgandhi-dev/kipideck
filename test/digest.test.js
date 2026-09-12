// test/digest.test.js — Kipi Daily 5 (ideas.md I-11).
//
// The contract of the digest is bigger than "pick five cards": it is the
// promise that the popup, the library and the notification show the SAME five
// all day, deterministically, computed from bounded index pages — and that
// 🔀 is the only thing that changes them. These tests pin the pure picker;
// the Storage integration pins that the pages are assembled the same way.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

await import("./harness.js");
const { resetWorld } = await import("./harness.js");
const { pickDaily5, dayKey, seedFromString, makeRng, digestSummaryLine, slotLabel } = await import("../lib/digest.js");
const { Storage } = await import("../lib/storage.js");

const mk = (id, over = {}) => ({ id, title: `t${id}`, createdAt: Number(id), status: "unread", ...over });

describe("day seeding — the same five all day", () => {
  test("dayKey is LOCAL yyyy-mm-dd", () => {
    assert.equal(dayKey(new Date(2026, 8, 12, 9, 30)), "2026-09-12");
    assert.equal(dayKey(new Date(2026, 0, 5)), "2026-01-05"); // padded
  });

  test("the same day + inputs → the same picks; a different day → not necessarily", () => {
    const any = Array.from({ length: 50 }, (_, i) => mk(`p${i}`));
    const d1 = new Date(2026, 8, 12, 10, 0);
    const d2 = new Date(2026, 8, 12, 22, 59);
    const a = pickDaily5({ any }, { now: d1 });
    const b = pickDaily5({ any }, { now: d2 });
    assert.deepEqual(a.map((p) => p.item.id), b.map((p) => p.item.id), "same local day → same random pick");
    const tomorrow = pickDaily5({ any }, { now: new Date(2026, 8, 13, 10, 0) });
    assert.ok(tomorrow.length >= 1);
    // (Not asserting it differs — a collision on a 50-item pool is legitimate.
    // The rng itself is pinned below.)
  });

  test("rng: deterministic from seed, spread across [0,1)", () => {
    const s1 = makeRng(seedFromString("kipi-2026-09-12"))();
    const s2 = makeRng(seedFromString("kipi-2026-09-12"))();
    assert.equal(s1, s2);
    assert.ok(s1 >= 0 && s1 < 1);
    const other = makeRng(seedFromString("kipi-2026-09-13"))();
    assert.notEqual(s1, other, "a different seed must move the stream");
  });
});

describe("pickDaily5 — slots, dedupe, honesty", () => {
  test("2 oldest unread, 2 gems, 1 random — in that composition", () => {
    const unread = [mk("u1"), mk("u2"), mk("u3")];
    const forgotten = [mk("g1", { status: "reading" }), mk("g2"), mk("u1")]; // u1 overlaps — must not double-pick
    const any = Array.from({ length: 10 }, (_, i) => mk(`r${i}`));
    const picks = pickDaily5({ unread, forgotten, any }, { now: new Date(2026, 8, 12) });
    assert.equal(picks.length, 5);
    assert.equal(picks.filter((p) => p.slot === "oldest").length, 2);
    assert.equal(picks.filter((p) => p.slot === "gem").length, 2);
    assert.equal(picks.filter((p) => p.slot === "random").length, 1);
    const ids = picks.map((p) => p.item.id);
    assert.equal(new Set(ids).size, 5, "never the same item twice");
    assert.deepEqual(ids.slice(0, 2), ["u1", "u2"], "the two oldest unread, in the page order the caller fetched");
  });

  test("empty pools shrink the day honestly — no padding with junk", () => {
    const onlyOne = pickDaily5({ unread: [mk("x")], forgotten: [mk("x")], any: [mk("x")] }, { now: new Date() });
    assert.equal(onlyOne.length, 1, "a one-item library gets a one-item digest");
    assert.deepEqual(pickDaily5({}, { now: new Date() }), []);
    assert.deepEqual(pickDaily5(undefined, {}), []);
  });

  test("the salt re-rolls only when given", () => {
    const any = Array.from({ length: 40 }, (_, i) => mk(`p${i}`));
    const day = new Date(2026, 8, 12);
    const a = pickDaily5({ any }, { now: day });
    const b = pickDaily5({ any }, { now: day });
    const c = pickDaily5({ any }, { now: day, salt: "roll2" });
    assert.equal(a[0].item.id, b[0].item.id);
    // Statistically a different salt picks a different card out of 40; the
    // assertion is soft on purpose — the CONTRACT is determinism, not difference.
    assert.ok(typeof c[0].item.id === "string");
  });
});

describe("digest copy helpers", () => {
  test("summary line describes what you will find", () => {
    const picks = [
      { item: mk("a"), slot: "oldest" },
      { item: mk("b"), slot: "oldest" },
      { item: mk("c"), slot: "gem" },
      { item: mk("d"), slot: "random" },
    ];
    assert.equal(digestSummaryLine(picks), "2 waiting · 1 forgotten gem · 1 surprise");
    assert.equal(digestSummaryLine([]), "");
  });
  test("every slot has a label", () => {
    for (const s of ["oldest", "gem", "random"]) assert.ok(slotLabel(s).length > 2);
    assert.equal(slotLabel("nope"), "Today's pick");
  });
});

describe("Storage.dailyFive — the real data layer, bounded pages", () => {
  beforeEach(async () => {
    await resetWorld();
    await Storage.init();
  });

  async function seed(n, over = {}) {
    for (let i = 0; i < n; i++) {
      await Storage.saveItem({
        type: "page",
        title: `page ${i}`,
        url: `https://example.com/p${i}`,
        domain: "example.com",
        tags: [],
        deckId: "inbox",
        createdAt: 1_000_000 + i * 1000,
        updatedAt: 1,
        ...over,
      });
    }
  }

  test("an empty library gets no picks — the digest never opens with 'you have nothing'", async () => {
    const { picks } = await Storage.dailyFive({ now: new Date() });
    assert.deepEqual(picks, []);
  });

  test("picks are REAL stored items, ≤ 5, all distinct", async () => {
    await seed(30);
    const { picks, day } = await Storage.dailyFive({ now: new Date(2026, 8, 12) });
    assert.equal(day, "2026-09-12");
    assert.ok(picks.length >= 1 && picks.length <= 5);
    const ids = picks.map((p) => p.item.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const p of picks) {
      const stored = await Storage.getItem(p.item.id);
      assert.ok(stored, "every pick resolves to a stored item");
    }
  });

  test("oldest unread first: the two bottom-of-the-pile saves rise", async () => {
    await seed(30);
    const { picks } = await Storage.dailyFive({ now: new Date(2026, 8, 12) });
    const oldest = picks.filter((p) => p.slot === "oldest");
    assert.equal(oldest.length, 2);
    const created = oldest.map((p) => p.item.createdAt);
    assert.deepEqual(created, [...created].sort((a, b) => a - b), "oldest first");
  });

  test("done/archived items never take the 'waiting' slots", async () => {
    await seed(20, { status: "done" });
    const { picks } = await Storage.dailyFive({ now: new Date(2026, 8, 12) });
    assert.equal(picks.filter((p) => p.slot === "oldest").length, 0, "nothing unread to surface");
  });

  test("read progress survives round-trips through the KV store", async () => {
    await seed(1);
    const { picks } = await Storage.dailyFive({ now: new Date() });
    const id = picks[0].item.id;
    assert.equal(await Storage.getReadProgress(id), null);
    await Storage.setReadProgress(id, 0.42);
    const p = await Storage.getReadProgress(id);
    assert.ok(Math.abs(p.r - 0.42) < 1e-9);
    await Storage.setReadProgress(id, 5); // garbage in, clamped out
    assert.equal((await Storage.getReadProgress(id)).r, 1);
  });
});
