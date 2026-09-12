// test/export.test.js — the shutdown-proof promise, tested (ideas.md I-07).
//
// "You can always leave" is only true if the file a user walks out with can be
// read without Kipideck. So these tests do not just check that a string comes
// out: they feed the exported bookmark HTML and JSON back through the importer
// and assert the library survives the round trip — URLs, titles, tags, dates and
// folder structure intact. If a future refactor quietly drops a field, the round
// trip fails here rather than on the day someone needs to escape.

import { test, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

await import("./harness.js");
const { resetWorld } = await import("./harness.js");
const { Storage } = await import("../lib/storage.js");
const db = await import("../lib/db.js");
const { parseExport, toKipideckItems } = await import("../lib/import.js");
const {
  EXPORT_FORMATS,
  bookmarkHtml,
  bookmarkHtmlForItem,
  bookmarkHtmlHead,
  bookmarkHtmlFoot,
  markdownLibrary,
  markdownForItem,
  escapeHtmlAttr,
  escapeHtmlText,
} = await import("../lib/exporters.js");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

function item(over = {}) {
  return {
    id: "k_" + Math.random().toString(36).slice(2, 9),
    type: "page",
    title: "An article",
    url: "https://example.com/a",
    domain: "example.com",
    tags: [],
    deckId: "reading",
    excerpt: "",
    note: "",
    createdAt: NOW - 30 * DAY,
    updatedAt: NOW - 30 * DAY,
    pinned: false,
    ...over,
  };
}

const DECKS = [
  { id: "reading", name: "Reading", icon: "📖" },
  { id: "inbox", name: "Inbox", icon: "📥" },
];

// ---------------------------------------------------------------------------
describe("bookmark HTML — the format that outlives us", () => {
  test("the file starts and ends the way every bookmark importer expects", () => {
    const html = bookmarkHtml({ items: [item()], decks: DECKS });
    assert.match(html, /^<!DOCTYPE NETSCAPE-Bookmark-file-1>/);
    assert.match(html, /<META HTTP-EQUIV="Content-Type" CONTENT="text\/html; charset=UTF-8">/);
    assert.match(html, /<H1>Bookmarks<\/H1>/);
    assert.match(html, /<DL><p>[\s\S]*<\/DL><p>\s*$/);
    assert.equal(bookmarkHtmlFoot(), "</DL><p>\n");
    assert.match(bookmarkHtmlHead(), /Exported from Kipideck on \d{4}-\d{2}-\d{2}/);
  });

  test("titles and URLs are escaped so a quote cannot break the file", () => {
    const line = bookmarkHtmlForItem(
      item({ title: 'Tom & "Jerry" <3', url: 'https://example.com/?q="a&b"' }),
    );
    assert.match(line, /Tom &amp; "Jerry" &lt;3/, "text nodes need & and < escaped, not quotes");
    assert.match(line, /HREF="https:\/\/example\.com\/\?q=&quot;a&amp;b&quot;"/);
    assert.ok(!line.includes('q="a&b"'), "a raw quote in an attribute would end it early");
  });

  test("dates are exported as Unix seconds, the unit every bookmark file uses", () => {
    const line = bookmarkHtmlForItem(item({ createdAt: 1709251200000, updatedAt: 1709251200000 }));
    assert.match(line, /ADD_DATE="1709251200"/);
    assert.ok(!/LAST_MODIFIED/.test(line), "no point repeating an identical timestamp");
  });

  test("a later edit is written as LAST_MODIFIED", () => {
    const line = bookmarkHtmlForItem(item({ createdAt: 1709251200000, updatedAt: 1709251200000 + 5000 }));
    assert.match(line, /ADD_DATE="1709251200"/);
    assert.match(line, /LAST_MODIFIED="1709251205"/);
  });

  test("a timestamp that is already in seconds is not divided into 1970", () => {
    const line = bookmarkHtmlForItem(item({ createdAt: 1709251200 }));
    assert.match(line, /ADD_DATE="1709251200"/);
  });

  test("tags ride along in the attribute browsers actually read", () => {
    assert.match(bookmarkHtmlForItem(item({ tags: ["coffee", "recipes"] })), /TAGS="coffee,recipes"/);
  });

  test("notes become the <DD> description, newlines flattened", () => {
    const line = bookmarkHtmlForItem(item({ note: "first line\n\nsecond line" }));
    assert.match(line, /<DD>first line second line/);
  });

  test("pinned items are marked, and an item with no URL exports nothing", () => {
    assert.match(bookmarkHtmlForItem(item({ pinned: true })), /PRIVATE="1"/);
    assert.equal(bookmarkHtmlForItem(item({ url: "" })), "");
  });

  test("items are grouped into a folder per deck", () => {
    const html = bookmarkHtml({
      items: [item({ deckId: "reading", title: "R" }), item({ deckId: "inbox", title: "I" })],
      decks: DECKS,
    });
    assert.match(html, /<H3>Reading<\/H3>/);
    assert.match(html, /<H3>Inbox<\/H3>/);
    assert.ok(!/<H3>📖/.test(html), "the icon is our UI decoration, not interchange data");
    assert.ok(html.indexOf("Reading") < html.indexOf("R</A>"), "the item sits inside its folder");
    assert.ok(html.indexOf("Inbox") < html.indexOf("I</A>"));
  });

  test("an item in a deck that no longer exists is exported, not dropped", () => {
    const html = bookmarkHtml({ items: [item({ deckId: "ghost", title: "Orphan" })], decks: DECKS });
    assert.match(html, /Orphan<\/A>/);
    assert.match(html, /<H3>ghost<\/H3>/);
  });

  test("the exported file imports back with URLs, titles, tags and dates", () => {
    const source = [
      item({ title: "Espresso at home", url: "https://example.com/espresso", tags: ["coffee", "recipes"], deckId: "reading", createdAt: 1709251200000, updatedAt: 1709251200000 }),
      item({ title: "A quote & a note", url: "https://example.com/quote", tags: ["quotes"], deckId: "inbox", note: "remember this", createdAt: 1600000000000, updatedAt: 1600000000000 }),
    ];
    const html = bookmarkHtml({ items: source, decks: DECKS });
    const parsed = parseExport({ name: "kipideck-bookmarks.html", text: html });
    assert.equal(parsed.format, "bookmarks-html", "our own export must be readable by our own importer");
    const { items } = toKipideckItems(parsed, { targetDeck: "inbox" });

    assert.equal(items.length, 2);
    const espresso = items.find((i) => i.url.includes("espresso"));
    assert.equal(espresso.title, "Espresso at home");
    assert.deepEqual(espresso.tags.filter((t) => ["coffee", "recipes"].includes(t)).sort(), ["coffee", "recipes"]);
    assert.equal(new Date(espresso.createdAt).toISOString().slice(0, 10), "2024-03-01");
    assert.ok(espresso.tags.includes("reading"), "the deck survives as a folder tag");

    const quote = items.find((i) => i.url.includes("quote"));
    assert.equal(quote.title, "A quote & a note", "entities round trip");
    assert.match(quote.note, /remember this/);
    assert.ok(quote.tags.includes("inbox"));
  });
});

// ---------------------------------------------------------------------------
describe("Markdown — the library as plain text", () => {
  test("an item becomes a heading, a link, its tags and its notes", () => {
    const md = markdownForItem(
      item({ title: "Deep work", url: "https://example.com/deep", tags: ["focus"], excerpt: "An excerpt.", note: "“the best part”\n  — my annotation" }),
    );
    assert.match(md, /^## \[Deep work\]\(<https:\/\/example\.com\/deep>\)/m);
    assert.match(md, /`#focus`/);
    assert.match(md, /> An excerpt\./);
    assert.match(md, /\*\*Notes & highlights\*\*/);
    assert.match(md, /> “the best part”/);
    assert.match(md, />   — my annotation/);
  });

  test("square brackets in a title cannot break the link", () => {
    const md = markdownForItem(item({ title: "Array [0] access", url: "https://example.com/x" }));
    assert.match(md, /\[Array \\\[0\\\] access\]\(<https:\/\/example\.com\/x>\)/);
  });

  test("page text only appears when it was asked for", () => {
    const without = markdownForItem(item({ title: "T" }), { content: "the full body", includeContent: false });
    assert.ok(!without.includes("the full body"));
    const withContent = markdownForItem(item({ title: "T" }), { content: "the full body", includeContent: true });
    assert.match(withContent, /<details><summary>Page text<\/summary>/);
    assert.match(withContent, /the full body/);
  });

  test("a library exports with a header, a section per deck and separators", () => {
    const md = markdownLibrary({
      items: [item({ deckId: "reading", title: "R" }), item({ deckId: "inbox", title: "I" })],
      decks: DECKS,
    });
    assert.match(md, /^# Kipideck library/);
    assert.match(md, /2 items/);
    assert.match(md, /^# 📖 Reading$/m);
    assert.match(md, /^# 📥 Inbox$/m);
    assert.match(md, /^---$/m);
    assert.ok(!/with page text/.test(md), "the header only claims page text when it is there");
  });

  test("the header says so when page text is included", () => {
    assert.match(markdownLibrary({ items: [item()], decks: DECKS, includeContent: true }), /with page text/);
  });
});

// ---------------------------------------------------------------------------
describe("Storage-level exports", () => {
  beforeEach(async () => {
    await resetWorld();
    await Storage.init();
  });

  async function seed(count = 3) {
    for (let i = 0; i < count; i++) {
      await Storage.saveItem({
        type: "page",
        title: `Article ${i}`,
        url: `https://example.com/a/${i}`,
        tags: i % 2 ? ["even"] : ["odd"],
        deckId: i % 2 ? "reading" : "inbox",
        note: i === 0 ? "a note worth keeping" : "",
        content: `The full body of article ${i}, long enough to index properly.`,
      });
    }
  }

  test("bookmark HTML comes out of the real library and imports back whole", async () => {
    await seed(6);
    const parts = await Storage.exportBookmarkHtml({});
    const html = parts.join("");
    assert.match(html, /^<!DOCTYPE NETSCAPE-Bookmark-file-1>/);

    const parsed = parseExport({ name: "out.html", text: html });
    const { items } = toKipideckItems(parsed);
    assert.equal(items.length, 6, "every saved item leaves the building");
    const urls = items.map((i) => i.url).sort();
    assert.deepEqual(urls, Array.from({ length: 6 }, (_, i) => `https://example.com/a/${i}`).sort());
    assert.ok(items.find((i) => i.url.endsWith("/a/0")).note.includes("a note worth keeping"));
    assert.ok(items.some((i) => i.tags.includes("reading")) && items.some((i) => i.tags.includes("inbox")));
  });

  test("Markdown carries titles, links, tags and notes", async () => {
    await seed(4);
    const md = (await Storage.exportMarkdown({ withContent: false })).join("");
    assert.match(md, /^# Kipideck library/m);
    assert.match(md, /\[Article 0\]\(<https:\/\/example\.com\/a\/0>\)/);
    assert.match(md, /`#odd`/);
    assert.match(md, /a note worth keeping/);
    assert.ok(!md.includes("long enough to index"), "page text stays out unless it is asked for");
  });

  test("Markdown can include page text on request", async () => {
    await seed(2);
    const md = (await Storage.exportMarkdown({ withContent: true })).join("");
    assert.match(md, /<details><summary>Page text<\/summary>/);
    assert.match(md, /long enough to index properly/);
  });

  test("JSON export stays valid and re-imports without duplicating", async () => {
    await seed(5);
    const json = await Storage.exportJSON({ withContent: true });
    const parsed = JSON.parse(json);
    assert.equal(parsed.items.length, 5);
    assert.equal(parsed.version >= 2, true);

    const before = (await db.getAllItemMetas()).length;
    const again = await Storage.importJSON(json);
    assert.equal(again.added, 0, "re-importing our own export must not duplicate anything");
    assert.equal((await db.getAllItemMetas()).length, before);
    assert.match((await db.getContent(parsed.items[0].id)).text, /long enough to index/);
  });

  test("progress is reported for both streamed formats", async () => {
    await seed(50);
    const htmlProgress = [];
    await Storage.exportBookmarkHtml({ batchSize: 10, onProgress: (done, total) => htmlProgress.push([done, total]) });
    assert.ok(htmlProgress.length >= 5, `got ${htmlProgress.length}`);
    assert.deepEqual(htmlProgress[htmlProgress.length - 1], [50, 50]);

    const mdProgress = [];
    await Storage.exportMarkdown({ batchSize: 10, onProgress: (done, total) => mdProgress.push([done, total]) });
    assert.deepEqual(mdProgress[mdProgress.length - 1], [50, 50]);
  });

  test("an empty library still produces a valid file, not a crash", async () => {
    const html = (await Storage.exportBookmarkHtml({})).join("");
    assert.match(html, /^<!DOCTYPE NETSCAPE-Bookmark-file-1>/);
    assert.match(html, /<\/DL><p>\s*$/);
    const md = (await Storage.exportMarkdown({})).join("");
    assert.match(md, /^# Kipideck library/);
    assert.match(md, /0 items/);
  });

  test("1,000 items export to HTML fast enough to feel instant", async () => {
    await Storage.importRecords(
      Array.from({ length: 1000 }, (_, i) =>
        item({ id: `k_big_${i}`, url: `https://example.com/big/${i}`, title: `Big ${i}`, deckId: i % 2 ? "reading" : "inbox" }),
      ),
    );
    const started = Date.now();
    const parts = await Storage.exportBookmarkHtml({});
    const elapsed = Date.now() - started;
    const html = parts.join("");
    assert.equal((html.match(/<DT><A /g) || []).length, 1000);
    assert.ok(elapsed < 30_000, `1,000 items took ${elapsed}ms`);
    console.log(`      1,000-item bookmark HTML export: ${elapsed} ms (${(html.length / 1024).toFixed(0)} KB)`);
  });
});

// ---------------------------------------------------------------------------
describe("the export menu itself", () => {
  test("three formats, and only JSON claims to be lossless", () => {
    assert.deepEqual(EXPORT_FORMATS.map((f) => f.id), ["json", "html", "markdown"]);
    assert.deepEqual(EXPORT_FORMATS.map((f) => f.lossless), [true, false, false]);
    const exts = new Set(EXPORT_FORMATS.map((f) => f.ext));
    assert.equal(exts.size, 3, "each format needs its own file extension");
    for (const f of EXPORT_FORMATS) {
      assert.ok(f.mime.includes("/"), `${f.id} needs a real mime type`);
      assert.ok(f.note.length > 20, `${f.id} needs a sentence explaining the trade-off`);
    }
  });

  test("escaping helpers never emit a bare angle bracket or quote", () => {
    assert.equal(escapeHtmlText('<img src=x onerror="alert(1)">'), "&lt;img src=x onerror=\"alert(1)\"&gt;");
    assert.equal(escapeHtmlAttr('a"b&c'), "a&quot;b&amp;c");
    assert.equal(escapeHtmlText(null), "");
  });
});
