// test/sessions.test.js — save-all-tabs as one searchable item (ideas.md I-19).
//
// A saved window is ONE item of type "session" whose content is every tab's
// title and URL. The properties that must hold:
//
//   1. building never throws on a hostile tab list (no urls, duplicates,
//      browser-chrome pages) and always reports what it skipped;
//   2. sessions are searchable by tab title and tab URL from the moment they
//      are saved — that is the feature, not a side effect;
//   3. sessions leave through every export format with their links intact, and
//      come back through our own importer as sessions, not as empty shells.

import { test, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

await import("./harness.js");
const { resetWorld } = await import("./harness.js");
const { Storage } = await import("../lib/storage.js");
const db = await import("../lib/db.js");
const { searchItems } = await import("../lib/search.js");
const { toKipideckItems } = await import("../lib/import.js");
const { bookmarkHtmlForItem, bookmarkHtmlForSession, markdownForItem } = await import(
  "../lib/exporters.js"
);
const {
  buildSessionItem,
  sessionTabs,
  sessionAsUrlList,
  sessionExcerpt,
  isSavableTabUrl,
  defaultSessionName,
  SESSION_TYPE,
  MAX_SESSION_TABS,
} = await import("../lib/sessions.js");

beforeEach(async () => {
  await resetWorld();
  await Storage.init();
});

function tabs(n = 3) {
  return Array.from({ length: n }, (_, i) => ({
    url: `https://example.com/page-${i}`,
    title: `Page ${i} about sourdough`,
  }));
}

describe("which tabs are worth saving", () => {
  test("http and https tabs save; browser chrome never does", () => {
    assert.equal(isSavableTabUrl("https://example.com/"), true);
    assert.equal(isSavableTabUrl("http://example.com/"), true);
    for (const url of [
      "",
      "   ",
      null,
      undefined,
      "chrome://settings/",
      "edge://history/",
      "about:blank",
      "about:newtab",
      "view-source:https://example.com/",
      "devtools://devtools/bundled/inspector.html",
      "chrome-extension://abcdef/options.html",
      "moz-extension://1234/sidebar.html",
      "javascript:alert(1)",
      "data:text/html,hi",
    ]) {
      assert.equal(isSavableTabUrl(url), false, JSON.stringify(url));
    }
  });
});

describe("building a session", () => {
  test("a window becomes one item carrying every tab", () => {
    const { item, content, saved, skipped, duplicates, capped } = buildSessionItem(tabs(3), {
      name: "Research window",
      deckId: "research",
    });
    assert.ok(item);
    assert.equal(item.type, SESSION_TYPE);
    assert.equal(item.title, "Research window");
    assert.equal(item.deckId, "research");
    assert.equal(saved, 3);
    assert.equal(skipped, 0);
    assert.equal(duplicates, 0);
    assert.equal(capped, false);
    assert.equal(item.tabs.length, 3);
    assert.equal(item.tabCount, 3);
    assert.ok(item.tags.includes("session"));
    assert.ok(content.includes("sourdough"), "titles are in the searchable body");
    assert.ok(content.includes("https://example.com/page-1"), "urls are in the searchable body");
  });

  test("the default name says how many tabs and when", () => {
    const name = defaultSessionName(8, new Date("2026-09-12T10:00:00Z").getTime());
    assert.ok(name.startsWith("8 tabs · "), name);
    const { item } = buildSessionItem(tabs(1));
    assert.ok(item.title.startsWith("1 tab · "), item.title);
  });

  test("the excerpt names the first tabs so the card is recognisable", () => {
    assert.equal(sessionExcerpt(tabs(2)), "Page 0 about sourdough · Page 1 about sourdough");
    assert.match(sessionExcerpt(tabs(5)), /\+2 more$/);
    assert.equal(sessionExcerpt([]), "");
  });

  test("unsavable tabs are skipped and reported, never fatal", () => {
    const { item, saved, skipped } = buildSessionItem([
      ...tabs(2),
      { url: "chrome://settings/", title: "Settings" },
      { url: "", title: "Blank" },
      {},
    ]);
    assert.ok(item);
    assert.equal(saved, 2);
    assert.equal(skipped, 3);
    assert.equal(item.tabs.length, 2);
  });

  test("the same page twice — or with tracking noise — restores once", () => {
    const { item, saved, duplicates } = buildSessionItem([
      { url: "https://example.com/a", title: "A" },
      { url: "https://example.com/a", title: "A again" },
      { url: "https://example.com/a?utm_source=newsletter", title: "A tracked" },
    ]);
    assert.equal(saved, 1);
    assert.equal(duplicates, 2);
    assert.equal(item.tabs.length, 1);
  });

  test("a giant window is capped, and says so", () => {
    const big = Array.from({ length: MAX_SESSION_TABS + 25 }, (_, i) => ({
      url: `https://example.com/t-${i}`,
      title: `Tab ${i}`,
    }));
    const { item, saved, capped } = buildSessionItem(big);
    assert.equal(capped, true);
    assert.equal(saved, MAX_SESSION_TABS);
    assert.equal(item.tabs.length, MAX_SESSION_TABS);
  });

  test("custom names, decks and tags are honoured", () => {
    const { item } = buildSessionItem(tabs(2), {
      name: "  Morning reads  ",
      deckId: "reading",
      tags: ["Morning", "news"],
    });
    assert.equal(item.title, "Morning reads");
    assert.equal(item.deckId, "reading");
    assert.deepEqual(item.tags, ["session", "morning", "news"]);
  });

  test("a window with nothing savable builds nothing", () => {
    for (const input of [[], [{ url: "chrome://settings/" }], null, undefined]) {
      const { item, saved } = buildSessionItem(input);
      assert.equal(item, null, JSON.stringify(input));
      assert.equal(saved, 0);
    }
  });
});

describe("reading a session back", () => {
  test("sessionTabs drops what cannot be restored and dedupes the rest", () => {
    const out = sessionTabs({
      type: "session",
      tabs: [
        { url: "https://example.com/a", title: "A" },
        { url: "chrome://settings/", title: "Settings" },
        { url: "", title: "Blank" },
        { url: "https://example.com/a", title: "A again" },
        null,
        "not a tab",
      ],
    });
    assert.deepEqual(out, [{ url: "https://example.com/a", title: "A" }]);
  });

  test("sessionTabs is total: missing and ragged lists restore nothing, never throw", () => {
    assert.deepEqual(sessionTabs(null), []);
    assert.deepEqual(sessionTabs({}), []);
    assert.deepEqual(sessionTabs({ tabs: "nope" }), []);
    assert.deepEqual(sessionTabs({ tabs: [null] }), []);
  });

  test("a tab with no title restores under its url", () => {
    assert.deepEqual(sessionTabs({ tabs: [{ url: "https://example.com/a" }] }), [
      { url: "https://example.com/a", title: "https://example.com/a" },
    ]);
  });

  test("sessionAsUrlList is one url per line", () => {
    const { item } = buildSessionItem(tabs(2));
    assert.equal(sessionAsUrlList(item), "https://example.com/page-0\nhttps://example.com/page-1");
    assert.equal(sessionAsUrlList(null), "");
  });
});

describe("sessions in the library", () => {
  async function saveSession(over = {}) {
    const { item, content } = buildSessionItem(tabs(3), { deckId: "research" });
    return Storage.saveItem({ ...item, content, ...over });
  }

  test("a session is searchable by tab title and by tab url", async () => {
    await saveSession();
    await Storage.saveItem({
      type: "page",
      title: "Unrelated",
      url: "https://other.example/",
      content: "nothing about bread here",
    });
    assert.equal((await searchItems({ query: "sourdough" })).total, 1);
    assert.equal((await searchItems({ query: "example.com/page-2" })).total, 1);
    assert.equal((await searchItems({ query: "sourdough tag:session" })).total, 1);
  });

  test("a session counts, pages and filters like any other item", async () => {
    await saveSession();
    assert.equal((await Storage.getCounts()).total, 1);
    const res = await db.listItems({ deckId: "research", limit: 10 });
    assert.equal(res.total, 1);
    assert.equal(res.items[0].type, "session");
  });

  test("sessions carry a save-state like everything else", async () => {
    await saveSession({ status: "done" });
    assert.equal((await db.listItems({ status: "done", limit: 10 })).total, 1);
  });
});

describe("sessions through export and import", () => {
  async function saveSession() {
    const { item, content } = buildSessionItem(
      [
        { url: "https://example.com/a", title: "Alpha" },
        { url: "https://example.org/b", title: "Beta" },
      ],
      { name: "Two tabs", deckId: "research" }
    );
    return Storage.saveItem({ ...item, content });
  }

  test("JSON export carries the tabs and re-import keeps the window whole", async () => {
    const saved = await saveSession();
    const json = await Storage.exportJSON({ withContent: true });
    assert.ok(json.includes('"type":"session"'), "the type is in the file");
    assert.ok(json.includes("https://example.com/a"), "the tab urls are in the file");

    const before = sessionTabs(await Storage.getItem(saved.id)).length;
    const result = await Storage.importJSON(json);
    assert.equal(result.added, 0, "re-importing our own export adds nothing");
    assert.equal(sessionTabs(await Storage.getItem(saved.id)).length, before);
  });

  test("importRecords accepts sessions despite their empty url", async () => {
    const { item, content } = buildSessionItem(tabs(2), { name: "Imported window" });
    const result = await Storage.importRecords([{ ...item, content }]);
    assert.equal(result.added, 1);
    assert.equal(result.invalid, 0);
    const stored = (await db.listItems({ limit: 10 })).items[0];
    assert.equal(stored.type, "session");
    assert.equal(sessionTabs(stored).length, 2);
  });

  test("normalising keeps sessions: no url required, tabs preserved", () => {
    const { item } = buildSessionItem(tabs(2), { name: "W" });
    const [out] = toKipideckItems(
      { format: "kipideck", items: [{ ...item, url: "", keepDeckId: "research" }] },
      { targetDeck: "inbox" }
    ).items;
    assert.equal(out.type, "session");
    assert.equal(out.tabs.length, 2);
    assert.equal(out.deckId, "research");
  });

  test("bookmark HTML expands a session to one link per tab", async () => {
    const saved = await saveSession();
    const html = bookmarkHtmlForItem(saved, { indent: "" });
    assert.ok(html.includes('HREF="https://example.com/a"'), "first tab exported");
    assert.ok(html.includes('HREF="https://example.org/b"'), "second tab exported");
    assert.ok(html.includes(">Alpha</A>"), "tab titles are kept");
    assert.ok(!html.includes("session"), "no misleading session tag on plain links");
    assert.ok(html.includes(`ADD_DATE="${Math.round(saved.createdAt / 1000)}"`), "the save date rides along");
  });

  test("bookmark export of a session without restorable tabs exports nothing", () => {
    assert.equal(bookmarkHtmlForSession({ type: "session", tabs: [] }), "");
    assert.equal(bookmarkHtmlForSession({ type: "session" }), "");
  });

  test("the real library export expands sessions inline with everything else", async () => {
    await saveSession();
    await Storage.saveItem({ type: "page", title: "Plain", url: "https://example.com/plain" });
    const parts = await Storage.exportBookmarkHtml();
    const html = parts.join("");
    assert.ok(html.includes("https://example.com/a"));
    assert.ok(html.includes("https://example.com/plain"));
  });

  test("Markdown lists the tabs as links", async () => {
    const saved = await saveSession();
    const md = markdownForItem(saved);
    assert.ok(md.includes("**2 tabs**"), "the tab count is stated");
    assert.ok(md.includes("[Alpha](<https://example.com/a>)"), "each tab is a link");
    assert.ok(md.includes("[Beta](<https://example.org/b>)"));
  });
});
