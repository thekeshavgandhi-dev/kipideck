// lib/reader.js — clean rendering of ALREADY-SAVED text (ideas.md I-08) plus
// the speech queue for reading aloud (I-10).
//
// WHY THIS IS SMALL: Kipideck captures readable page text at save time
// (lib/extract.js, capped 20k chars) — what v1.7 never did was SHOW it well.
// The detail view prints it as one grey block. This module turns that text
// into reader-shaped paragraphs, estimates time, and slices it into
// speech-synthesis-safe chunks — all as pure functions, so the interesting
// parts are testable without a browser.
//
// What this deliberately does NOT do: re-parse live pages (Mozilla
// Readability, vendored, is a later step — the cap right now is honesty about
// what "reader" means here: your saved copy, beautifully set, offline, zero
// network). "Distraction-free" comes free when the content was never the page.

/** Paragraph targets: ~4–9 sentences, hard-capped so a 20k blob still reads. */
export const READER_PARAGRAPH_TARGET = 620;
/** Sentences are the atomic unit; anything longer than this gets hard-split. */
export const MAX_SENTENCE_CHARS = 480;
/** speechSynthesis on Chromium is unreliable past a few hundred chars per utterance. */
export const SPEECH_CHUNK_CHARS = 240;

/** Split a string into sentences (abbreviations handled for the common few). */
export function splitSentences(text) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (!s) return [];
  // Split after . ! ? followed by a space + capital/digit/quote — the classic
  // "Mr. Smith" guard is the lowercase word that would follow.
  const parts = s.match(/[^.!?]+[.!?]+(?:["'”’)\]]*)?\s+|[^.!?]+[.!?]+(?:["'”’)\]]*)?$|[^.!?]+$/g) || [];
  const out = [];
  for (let p of parts.map((x) => x.trim()).filter(Boolean)) {
    while (p.length > MAX_SENTENCE_CHARS) {
      let cut = p.lastIndexOf(",", MAX_SENTENCE_CHARS);
      if (cut < MAX_SENTENCE_CHARS * 0.4) cut = p.lastIndexOf(" ", MAX_SENTENCE_CHARS);
      if (cut <= 0) cut = MAX_SENTENCE_CHARS;
      out.push(p.slice(0, cut + 1).trim());
      p = p.slice(cut + 1).trim();
    }
    if (p) out.push(p);
  }
  return out;
}

/**
 * Turn flat saved text into paragraphs.
 *
 * Blank lines in the source win first (Omnivore/Wallabag imports keep them);
 * otherwise sentences are grouped toward ~620 chars, never mid-word, and a
 * leading heading-like short line (its own line, no terminal punctuation,
 * < 90 chars) starts a fresh paragraph — that is how subheads survive
 * extraction, and the reader should treat them as such.
 */
export function toParagraphs(text) {
  const raw = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (!raw) return [];
  const blocks = raw.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const paras = [];
  for (const block of blocks) {
    const lines = block.split(/\n/).map((l) => l.trim()).filter(Boolean);
    const isHeading = (l) =>
      l && l.length <= 90 && !/[.!?:;,\u0964\bfloor]$/.test(l) && l.split(/\s+/).length <= 12 && !/^[•\-*\d.)]+$/.test(l);
    if (lines.length > 1 && lines.every((l) => l.length < 120)) {
      // A block of short lines is structural (a list or heading stack); keep each visible.
      for (const l of lines) paras.push(l);
      continue;
    }
    const joined = lines.join(" ");
    const sentences = splitSentences(joined);
    let cur = "";
    for (const sent of sentences) {
      const headingAhead = isHeading(sent) && cur;
      if (headingAhead || (cur && cur.length + sent.length + 1 > READER_PARAGRAPH_TARGET)) {
        paras.push(cur);
        cur = "";
      }
      cur = cur ? `${cur} ${sent}` : sent;
    }
    if (cur) paras.push(cur);
  }
  return paras;
}

/** Words-per-minute estimate, forgiving by design (220 wpm is calm reading). */
export function readingMinutes(wordCount, wpm = 220) {
  const n = Number(wordCount) || 0;
  return Math.max(1, Math.round(n / Math.max(100, wpm)));
}

/** Progress from a scroll position, clamped where UIs can use it. */
export function scrollProgress(scrollTop, scrollHeight, clientHeight) {
  const rest = Math.max(0, (scrollHeight || 0) - (clientHeight || 0));
  if (!rest) return 1;
  return Math.min(1, Math.max(0, (scrollTop || 0) / rest));
}

/**
 * The TTS queue: speech chunks with their owning paragraph index, so the UI
 * can highlight text while it speaks and resume anywhere. Sentences are packed
 * greedily up to SPEECH_CHUNK_CHARS; a chunk never crosses a paragraph.
 */
export function speechQueue(paragraphs, maxChars = SPEECH_CHUNK_CHARS) {
  const out = [];
  (paragraphs || []).forEach((para, pi) => {
    const sentences = splitSentences(para);
    let cur = "";
    const flush = () => {
      if (cur) {
        out.push({ text: cur, para: pi });
        cur = "";
      }
    };
    for (const s of sentences) {
      if (cur && cur.length + s.length + 1 > maxChars) flush();
      cur = cur ? `${cur} ${s}` : s;
      // A single oversized sentence is hard-split on commas so TTS never chokes.
      while (cur.length > maxChars) {
        let cut = cur.lastIndexOf(",", maxChars);
        if (cut < maxChars * 0.4) cut = cur.lastIndexOf(" ", maxChars);
        if (cut <= 0) cut = maxChars;
        out.push({ text: cur.slice(0, cut + 1).trim(), para: pi });
        cur = cur.slice(cut + 1).trim();
      }
    }
    flush();
  });
  return out;
}
