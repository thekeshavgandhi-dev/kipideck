// test/reader.test.js — the reader's pure helpers (ideas.md I-08 / I-10).
//
// The reader promises: your saved copy, set like a page — and read aloud in
// chunks the speech engine can swallow. Both halves run on text Kipideck
// cannot control (any article, any importer's HTML-to-text, 20 KB caps), so
// the splitting logic is where bugs would hurt: swallowed paragraphs, a
// 4,000-word utterance that "freezes" TTS, or a progress bar that overflows.
// These functions are pure for exactly this test — lib/reader.js never touches
// the DOM.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

const {
  toParagraphs,
  splitSentences,
  readingMinutes,
  scrollProgress,
  speechQueue,
  READER_PARAGRAPH_TARGET,
  SPEECH_CHUNK_CHARS,
} = await import("../lib/reader.js");

describe("splitSentences", () => {
  test("splits on . ! ? and quotes after them survive", () => {
    const s = splitSentences('He said "stop." Then she ran! Really? Yes.');
    assert.equal(s.length, 4);
    assert.ok(s[0].endsWith('."'));
    assert.ok(s[1].endsWith("!"));
  });

  test("a trailing fragment without punctuation is still a sentence", () => {
    assert.deepEqual(splitSentences("one two. three four"), ["one two.", "three four"]);
  });

  test("over-long sentence with no boundary is hard-split, not dropped", () => {
    const monster = "x".repeat(5000); // no . ! ? , or space at all — the worst case
    const parts = splitSentences(monster);
    assert.ok(parts.length >= 4, "must chunk, not pass the monster through");
    assert.ok(parts.every((p) => p.length <= 500));
    assert.equal(parts.join(""), monster, "hard-splitting must lose and invent nothing");
  });

  test("empty in, empty out", () => {
    assert.deepEqual(splitSentences(""), []);
    assert.deepEqual(splitSentences(null), []);
  });
});

describe("toParagraphs", () => {
  test("blank lines win — imported exports that keep paragraphs are respected", () => {
    const paras = toParagraphs("first block a. first block b.\n\nsecond block.");
    assert.equal(paras.length, 2);
    assert.equal(paras[1], "second block.");
  });

  test("one flat blob is grouped into readable chunks, capped near the target", () => {
    const flat = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} explains the topic of this article well.`).join(" ");
    const paras = toParagraphs(flat);
    assert.ok(paras.length > 1, "must not return one 5k wall");
    for (const p of paras) {
      assert.ok(p.length <= READER_PARAGRAPH_TARGET + 260, `paragraph overflowed its budget: ${p.length}`);
      assert.ok(/[.!?]$/.test(p), "paragraphs end on a sentence boundary");
    }
    // Nothing lost: every sentence survives exactly once.
    assert.equal(paras.join(" ").split("Sentence").length - 1, 60);
  });

  test("multi-line blocks of short lines stay separate (lists, heading stacks)", () => {
    const paras = toParagraphs("Ingredients\nFlour\nWater\nSalt\n\nMix it all. Bake it hot.");
    assert.ok(paras.includes("Ingredients"));
    assert.ok(paras.includes("Flour"));
    assert.ok(paras.some((p) => p.includes("Mix it all.")));
  });

  test("empty text is not an error", () => {
    assert.deepEqual(toParagraphs(""), []);
    assert.deepEqual(toParagraphs("   \n  "), []);
  });
});

describe("readingMinutes + scrollProgress", () => {
  test("time estimates never go below a minute, and use a calm wpm", () => {
    assert.equal(readingMinutes(0), 1);
    assert.equal(readingMinutes(220), 1);
    assert.equal(readingMinutes(3000), 14);
  });
  test("progress is clamped where UIs can use it", () => {
    assert.equal(scrollProgress(0, 1000, 500), 0);
    assert.equal(scrollProgress(500, 1000, 500), 1);
    assert.equal(scrollProgress(9999, 1000, 500), 1);
    assert.equal(scrollProgress(10, 0, 0), 1, "nothing to scroll = fully read");
  });
});

describe("speechQueue — the chunks speechSynthesis can swallow", () => {
  test("each chunk is bounded, tagged with its paragraph, and covers all text", () => {
    const paras = toParagraphs(
      Array.from({ length: 30 }, (_, i) => `Line ${i} carries meaning and quite a few words to force the split.`).join(" ")
    );
    const q = speechQueue(paras);
    assert.ok(q.length > paras.length, "long paragraphs must split");
    for (const c of q) {
      assert.ok(c.text.length <= SPEECH_CHUNK_CHARS, `chunk of ${c.text.length} chars exceeds the cap`);
      assert.ok(Number.isInteger(c.para) && c.para >= 0 && c.para < paras.length, "chunk knows its paragraph");
    }
    const joined = q.map((c) => c.text).join(" ");
    assert.ok(joined.includes("Line 0") && joined.includes("Line 29"), "first and last sentences survive");
  });

  test("one-sentence short paragraphs are one chunk each", () => {
    const q = speechQueue(["Alpha bravo charlie.", "Delta echo."]);
    assert.deepEqual(q.map((c) => c.para), [0, 1]);
    assert.equal(q.length, 2);
  });

  test("empty input yields an empty queue", () => {
    assert.deepEqual(speechQueue([]), []);
    assert.deepEqual(speechQueue(null), []);
  });

  test("a single 3,000-char sentence still becomes bounded chunks", () => {
    const q = speechQueue(["word ".repeat(600) + "!"]);
    assert.ok(q.length > 5);
    assert.ok(q.every((c) => c.text.length <= SPEECH_CHUNK_CHARS + 1));
  });
});
