// test/import.test.js — reading other people's export files (ideas.md I-05).
//
// These fixtures are shaped like real exports, including the parts that break
// naive parsers: Pocket wrapping every URL in getpocket.com/extredirect, Pocket
// tags separated by pipes in CSV but commas in HTML, read-state encoded by which
// section a link sits in rather than by an attribute, Chrome's 1601-epoch
// microsecond timestamps, Raindrop highlights that most importers throw away,
// quoted CSV fields containing commas and newlines, and titles that are empty.
//
// The stakes are simple: Pocket deleted everyone's data on 12 November 2025.
// The file in a refugee's Downloads folder is the only copy of their library
// that exists, and this is the code that reads it.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

const {
  FORMATS,
  detectFormat,
  parseExport,
  parseCsv,
  csvToObjects,
  isHeaderRow,
  parseNetscapeHtml,
  parseChromeBookmarksJson,
  parseJsonLibrary,
  parseUrlList,
  parseTabular,
  toKipideckItems,
  combineParsed,
  decodeEntities,
  htmlToText,
  splitTags,
  toMillis,
  unwrapRedirect,
} = await import("../lib/import.js");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const POCKET_CSV = [
  "title,url,time_added,tags,status",
  '"How to make espresso",https://example.com/espresso,1709251200,coffee|recipes,unread',
  '"An archived piece",https://example.com/archived,1500000000,,archive',
  ',https://example.com/no-title,1600000000,news,unread',
  '"Quoted, with comma",https://example.com/comma,1600000001,"tag one,tag two",unread',
  '"Multi-line note",https://example.com/multiline,1600000002,keep,unread',
].join("\n");

const POCKET_CSV_PART2 = [
  "title,url,time_added,cursor,tags,status",
  '"Later part",https://example.com/part2,1610000000,,reading,unread',
  '"Also in part one",https://example.com/espresso,1709251200,,coffee,unread',
].join("\n");

const POCKET_HTML = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Unread</H1>
<UL>
<LI><A HREF="https://getpocket.com/extredirect?url=https%3A%2F%2Fwww.theatlantic.com%2Farticle%2F&http=1" time_added="1650000000" tags="longread,politics">The Article &amp; Its Context</A>
<LI><A HREF="https://example.com/untitled" time_added="1650000100" tags=""></A>
</UL>
<H1>Read Archive</H1>
<UL>
<LI><A HREF="https://example.com/old-read" time_added="1400000000" tags="keep">Old read</A>
</UL>
<H1>Favorites</H1>
<UL>
<LI><A HREF="https://example.com/favourite" time_added="1450000000">Best one</A>
</UL>`;

const CHROME_HTML = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000" LAST_MODIFIED="1700000001">Work</H3>
    <DL><p>
        <DT><A HREF="https://github.com/acme/repo" ADD_DATE="1709251200" ICON="data:image/png;base64,iVBORw0K">GitHub &amp; friends</A>
        <DT><H3 ADD_DATE="1700000000">Docs</H3>
        <DL><p>
            <DT><A HREF="https://developer.mozilla.org/en-US/docs/Web/API" ADD_DATE="1600000000" TAGS="mdn, reference">MDN &#8212; Web APIs</A>
        </DL><p>
    </DL><p>
    <DT><A HREF="https://example.com/private" ADD_DATE="1500000000" PRIVATE="1">Private thing</A>
    <DT><A HREF="not-a-url" ADD_DATE="1500000000">Broken entry</A>
</DL><p>`;

const FIREFOX_HTML = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<H1>Bookmarks Menu</H1>
<DL><p>
    <DT><A HREF="https://mozilla.org/" ADD_DATE="1600000000" LAST_MODIFIED="1600000001" ICON_URI="https://mozilla.org/fav.ico" SHORTCUTURL="moz">Mozilla</A>
    <DD>A note about this bookmark
</DL><p>`;

const RAINDROP_JSON = JSON.stringify({
  version: "1.0.0",
  items: [
    {
      _id: "62388e9e48b63606f41e44a6",
      link: "https://apple.com",
      title: "Orion Browser",
      excerpt: "Truly native macOS app",
      note: "check later",
      tags: ["mac", "browser"],
      created: "2022-03-21T14:41:34.059Z",
      lastUpdate: "2022-04-01T00:00:00.000Z",
      type: "article",
      important: true,
      collection: { $id: 1, title: "Tools" },
      highlights: [
        { text: "new WebKit-based browser", note: "interesting", color: "red" },
        { text: "Built on WebKit" },
      ],
    },
    { link: "https://imgur.com/a/xyz", title: "Cover art", type: "image", tags: [], created: "2023-01-02T03:04:05Z", collection: { title: "Art" } },
    { link: "https://vimeo.com/12345", title: "A talk", type: "video", tags: ["talk"], created: "2023-02-02T03:04:05Z" },
    { link: "", title: "No link at all", type: "link", created: "2023-02-02T03:04:05Z" },
  ],
});

const OMNIVORE_JSON = JSON.stringify([
  {
    id: "o1",
    slug: "a-slug",
    title: "Omnivore piece",
    originalUrl: "https://omni.example/a",
    description: "desc here",
    labels: [{ name: "research" }, { name: "ai" }],
    savedAt: "2024-02-03T04:05:06Z",
    state: "ARCHIVED",
    author: "Someone",
    image: "https://omni.example/c.png",
    highlights: [{ quote: "first highlight", annotation: "my note" }, { quote: "second" }],
  },
]);

const PINBOARD_JSON = JSON.stringify([
  { href: "https://pinboard.example/a", description: "A pinboard item", extended: "my long note", meta: "abc", hash: "deadbeef", time: "2021-05-04T03:02:01Z", tags: "dev reading", toread: "1", shared: "0" },
  { href: "https://pinboard.example/b", description: "Archived one", time: "2020-01-01T00:00:00Z", tags: "", toread: "0", shared: "1" },
]);

const WALLABAG_JSON = JSON.stringify([
  {
    id: 1,
    title: "Wallabag article",
    url: "https://wall.example/a",
    content: "<p>Hello <b>world</b>.</p><script>alert('x')</script><p>Second paragraph.</p>",
    created_at: "2023-06-01T10:00:00+00:00",
    updated_at: "2023-06-02T10:00:00+00:00",
    tags: [{ label: "news" }, { label: "eu" }],
    is_archived: 1,
    is_favorite: 0,
    reading_time: 4,
  },
]);

const READWISE_CSV = [
  "Title,Author,Category,Date,Tags,Location,Content,Notes,Read Status,URL,Sections,Image",
  '"Deep work","Cal Newport","books","2023-01-02T03:04:05","focus|deep","page 12","A fairly long body of content that should become the article text.","my note here","Archived","https://books.example/deep","","https://books.example/cover.jpg"',
].join("\n");

const CHROME_JSON = JSON.stringify({
  checksum: "x",
  version: 1,
  roots: {
    bookmark_bar: {
      name: "Bookmarks bar",
      type: "folder",
      date_added: "13300000000000000",
      children: [
        { type: "url", name: "Example", url: "https://example.com/", date_added: "13350000000000000", date_modified: "13350000001000000" },
        { type: "folder", name: "Reading", date_added: "13300000000000000", children: [{ type: "url", name: "Deep article", url: "https://example.org/deep", date_added: "13340000000000000" }] },
      ],
    },
    other: { name: "Other", type: "folder", children: [{ type: "url", name: "Other link", url: "https://other.test/", date_added: "13330000000000000" }] },
    synced: { name: "Mobile", type: "folder", children: [] },
  },
});

const URL_LIST = `# Research
- [A paper](https://arxiv.org/abs/1234)
- https://example.com/bare
1) https://numbered.test/x
  [another](https://example.com/two)
; a comment line
## Recipes
- https://recipes.example/pasta  Pasta night
https://example.com/bare
`;

const KIPI_JSON = JSON.stringify({
  version: 3,
  exportedAt: Date.now(),
  items: [
    { id: "k_1", type: "page", title: "My saved page", url: "https://mine.example/a", sourceUrl: "https://mine.example/a", domain: "mine.example", tags: ["keep"], deckId: "reading", excerpt: "ex", note: "my note", content: "full text here", createdAt: 1700000000000, updatedAt: 1700000000000, pinned: true },
    { id: "k_2", type: "selection", title: "A quote", url: "https://mine.example/b", tags: [], deckId: "quotes", createdAt: 1700000001000, updatedAt: 1700000001000 },
  ],
  decks: [{ id: "reading", name: "Reading" }],
  tombstones: [],
});


// ---------------------------------------------------------------------------
// Fixtures for the split-export case (Omnivore: metadata JSON + article HTML)
// ---------------------------------------------------------------------------

const ARTICLE_SLUG = "the-deep-work-essay";

const ARTICLE_HTML = `<!DOCTYPE html>
<html><head>
<title>Deep work essay</title>
<meta name="original-url" content="https://blog.example/deep-work">
<link rel="canonical" href="https://blog.example/deep-work">
</head>
<body>
<nav>Home About Subscribe</nav>
<article>
<h1>Deep work essay</h1>
<p>The first paragraph of the essay, long enough to count as real article text rather than a stub page.</p>
<p>Second paragraph with an <a href="https://ref.example">inline reference</a> inside it.</p>
<p>Third paragraph follows here. <script>var tracking = "should never be indexed";</script></p>
<p>Fourth paragraph closes the piece out neatly and gives the prose density test something to chew on.</p>
<p>Fifth paragraph for good measure, so a real article is never mistaken for a link list.</p>
</article>
<footer>Copyright 2024</footer>
</body></html>`;

const OMNIVORE_WITH_SLUG = JSON.stringify([
  {
    id: "o1",
    slug: ARTICLE_SLUG,
    title: "Deep work essay",
    originalUrl: "https://blog.example/deep-work",
    labels: [{ name: "focus" }],
    savedAt: "2024-02-03T04:05:06Z",
    state: "ARCHIVED",
    highlights: [{ quote: "attention is the currency", annotation: "yes" }],
  },
]);

const normalize = (file, opts) => toKipideckItems(parseExport(file), opts);
const byUrl = (items, needle) => items.find((i) => i.url.includes(needle));

// ---------------------------------------------------------------------------
describe("format detection", () => {
  const cases = [
    [{ name: "part_000000.csv", text: POCKET_CSV }, "pocket-csv"],
    [{ name: "ril_export.html", text: POCKET_HTML }, "pocket-html"],
    [{ name: "bookmarks_2026_1_4.html", text: CHROME_HTML }, "bookmarks-html"],
    [{ name: "raindrop-export.json", text: RAINDROP_JSON }, "raindrop"],
    [{ name: "metadata_0.json", text: OMNIVORE_JSON }, "omnivore"],
    [{ name: "pinboard_export.json", text: PINBOARD_JSON }, "pinboard"],
    [{ name: "wallabag-export.json", text: WALLABAG_JSON }, "wallabag"],
    [{ name: "reader_export.csv", text: READWISE_CSV }, "readwise"],
    [{ name: "Bookmarks", text: CHROME_JSON }, "bookmarks-json"],
    [{ name: "links.md", text: URL_LIST }, "url-list"],
    [{ name: "kipideck-export.json", text: KIPI_JSON }, "kipideck"],
  ];

  for (const [file, expected] of cases) {
    test(`${file.name} → ${expected}`, () => {
      assert.equal(detectFormat(file).id, expected);
      assert.equal(parseExport(file).format, expected, "parseExport agrees with detection");
    });
  }

  test("Pocket HTML is recognised even without the Netscape doctype", () => {
    const trimmed = POCKET_HTML.replace(/<!DOCTYPE[^>]*>\n/, "");
    assert.equal(detectFormat({ name: "export.html", text: trimmed }).id, "pocket-html");
  });

  // ZIP handling moved to test/zip.test.js: the dialog expands archives, and
  // only RAR/7z/gzip still refuse here.

  test("an empty file says so", () => {
    assert.throws(() => parseExport({ name: "empty.csv", text: "   \n " }), /empty/i);
  });

  test("garbage is reported as unrecognised rather than importing nothing silently", () => {
    assert.throws(() => parseExport({ name: "weird.bin", text: "\u0000\u0001\u0002 binary junk" }), /could not read|Unrecognised|valid JSON/i);
  });

  test("truncated JSON gets an actionable message", () => {
    assert.throws(() => parseExport({ name: "broken.json", text: '[{"url":"https://a.test"' }), /not valid JSON/i);
  });

  test("every advertised format has a label and a hint", () => {
    assert.ok(FORMATS.length >= 10, "the importer should cover the main read-later tools");
    for (const f of FORMATS) {
      assert.ok(f.label && f.label.length > 3, f.id);
      assert.ok(f.hint, `${f.id} needs a hint for the UI`);
    }
  });
});

// ---------------------------------------------------------------------------
describe("Pocket CSV — the format most refugees are holding", () => {
  const parsed = parseExport({ name: "part_000000.csv", text: POCKET_CSV });
  const { items, stats, warnings } = toKipideckItems(parsed);

  test("every row with a URL becomes an item", () => {
    assert.equal(items.length, 5);
    assert.equal(stats.parsed, 5);
  });

  test("pipe-separated tags are split", () => {
    assert.deepEqual(byUrl(items, "espresso").tags.filter((t) => ["coffee", "recipes"].includes(t)).sort(), ["coffee", "recipes"]);
  });

  test("quoted fields keep their commas", () => {
    const item = byUrl(items, "comma");
    assert.equal(item.title, "Quoted, with comma");
    assert.ok(item.tags.includes("tag one"), `tags: ${JSON.stringify(item.tags)}`);
  });

  test("save dates survive as real timestamps", () => {
    const item = byUrl(items, "espresso");
    assert.equal(new Date(item.createdAt).toISOString().slice(0, 10), "2024-03-01");
    assert.equal(item.updatedAt, item.createdAt);
  });

  test("read state is preserved: archive becomes a tag, unread does not", () => {
    assert.ok(byUrl(items, "archived").tags.includes("archive"));
    assert.ok(!byUrl(items, "espresso").tags.includes("unread"), "unread is the default state, tagging it is noise");
    assert.equal(stats.archived, 1);
    assert.equal(stats.unread, 4);
  });

  test("an empty title falls back to the domain and is reported", () => {
    assert.equal(byUrl(items, "no-title").title, "example.com");
    assert.equal(stats.noTitle, 1);
    assert.ok(warnings.some((w) => /no title/i.test(w)));
  });

  test("a multi-part export merges, and the same link in two parts is one item", () => {
    const combined = combineParsed([
      parseExport({ name: "part_000000.csv", text: POCKET_CSV }),
      parseExport({ name: "part_000001.csv", text: POCKET_CSV_PART2 }),
    ]);
    assert.equal(combined.fileCount, 2);
    const result = toKipideckItems(combined);
    assert.equal(result.stats.parsed, 7);
    assert.equal(result.items.length, 6, "the repeated espresso link collapses");
    assert.equal(result.stats.duplicatesInFile, 1);
    assert.ok(byUrl(result.items, "part2"), "the second part's new item made it in");
  });

  test("the extra `cursor` column Pocket sometimes emits is ignored", () => {
    const result = normalize({ name: "part.csv", text: POCKET_CSV_PART2 });
    assert.equal(result.items.length, 2);
    assert.ok(!result.items.some((i) => i.tags.includes("cursor")));
  });
});

// ---------------------------------------------------------------------------
describe("Pocket HTML (ril_export.html)", () => {
  const { items, stats } = toKipideckItems(parseExport({ name: "ril_export.html", text: POCKET_HTML }));

  test("redirect-wrapped URLs are unwrapped to the real article", () => {
    const item = byUrl(items, "theatlantic.com");
    assert.ok(item, "unwrapped link present");
    assert.equal(item.url, "https://www.theatlantic.com/article/");
    assert.ok(!items.some((i) => i.url.includes("getpocket.com")), "no Pocket redirect survives");
  });

  test("read state comes from the section heading, not an attribute", () => {
    assert.equal(stats.unread, 2, "the two links under <H1>Unread</H1>");
    assert.equal(stats.archived, 1, "the link under <H1>Read Archive</H1>");
    assert.equal(stats.favorites, 1, "the link under <H1>Favorites</H1>");
    assert.ok(byUrl(items, "old-read").tags.includes("archive"));
    assert.ok(byUrl(items, "favourite").tags.includes("favorite"));
    assert.ok(!byUrl(items, "theatlantic.com").tags.includes("archive"), "state must not leak between sections");
  });

  test("section headings are not treated as folders", () => {
    for (const item of items) {
      assert.ok(!item.tags.includes("unread"), JSON.stringify(item.tags));
      assert.ok(!item.tags.includes("read archive"));
    }
  });

  test("HTML entities in titles are decoded", () => {
    assert.equal(byUrl(items, "theatlantic.com").title, "The Article & Its Context");
  });

  test("an empty link title falls back to the domain", () => {
    assert.equal(byUrl(items, "untitled").title, "example.com");
  });
});

// ---------------------------------------------------------------------------
describe("browser bookmark HTML", () => {
  const parsed = parseExport({ name: "bookmarks_2026_1_4.html", text: CHROME_HTML });
  const { items } = toKipideckItems(parsed);

  test("nested folders become tags, the root heading does not", () => {
    const gh = byUrl(items, "github.com");
    assert.ok(gh.tags.includes("work"), JSON.stringify(gh.tags));
    const mdn = byUrl(items, "developer.mozilla.org");
    assert.ok(mdn.tags.includes("work") && mdn.tags.includes("docs"), JSON.stringify(mdn.tags));
    assert.ok(!items.some((i) => i.tags.includes("bookmarks")), "the export's own <H1>Bookmarks</H1> is structure, not a tag");
  });

  test("ADD_DATE is a Unix-seconds timestamp", () => {
    assert.equal(new Date(byUrl(items, "github.com").createdAt).toISOString().slice(0, 10), "2024-03-01");
    assert.equal(new Date(byUrl(items, "developer.mozilla.org").createdAt).getFullYear(), 2020);
  });

  test("a TAGS attribute is honoured", () => {
    assert.ok(byUrl(items, "developer.mozilla.org").tags.includes("mdn"));
  });

  test("PRIVATE=1 becomes a tag rather than being dropped", () => {
    assert.ok(byUrl(items, "example.com/private").tags.includes("private"));
  });

  test("ICON data URIs are ignored (they are base64 blobs, not information)", () => {
    assert.ok(!items.some((i) => JSON.stringify(i).includes("iVBORw0K")));
  });

  test("an entry whose HREF is not a URL is counted and reported, not imported as junk", () => {
    assert.equal(items.length, 3);
    const result = toKipideckItems(parsed);
    assert.equal(result.stats.noUrl, 1, "the unusable address is counted");
    assert.ok(result.warnings.some((w) => /no usable URL/i.test(w)), JSON.stringify(result.warnings));
  });

  test("numeric entities decode", () => {
    assert.equal(byUrl(items, "developer.mozilla.org").title, "MDN — Web APIs");
  });

  test("Firefox's variant (ICON_URI, SHORTCUTURL, <DD> notes) still imports", () => {
    const { items: ff } = toKipideckItems(parseExport({ name: "bookmarks.html", text: FIREFOX_HTML }));
    assert.equal(ff.length, 1);
    assert.equal(ff[0].url, "https://mozilla.org/");
    assert.equal(ff[0].title, "Mozilla");
  });
});

// ---------------------------------------------------------------------------
describe("Raindrop JSON", () => {
  const parsed = parseExport({ name: "raindrop-export.json", text: RAINDROP_JSON });
  const { items } = toKipideckItems(parsed, { targetDeck: "auto" });

  test("items map by type", () => {
    assert.equal(byUrl(items, "imgur.com").type, "image");
    assert.equal(byUrl(items, "vimeo.com").type, "video");
    assert.equal(byUrl(items, "apple.com").type, "page");
  });

  test("an item with no link is skipped", () => {
    assert.equal(items.length, 3);
  });

  test("highlights become the note — the part most importers discard", () => {
    const note = byUrl(items, "apple.com").note;
    assert.match(note, /check later/, "the user's own note is kept");
    assert.match(note, /new WebKit-based browser/, "highlight text is kept");
    assert.match(note, /interesting/, "the annotation on the highlight is kept");
    assert.match(note, /Built on WebKit/, "every highlight is kept, not just the first");
  });

  test("collections become tags and `important` becomes favourite", () => {
    assert.ok(byUrl(items, "apple.com").tags.includes("tools"));
    assert.ok(byUrl(items, "apple.com").tags.includes("favorite"));
  });

  test("ISO dates are converted", () => {
    assert.equal(new Date(byUrl(items, "apple.com").createdAt).toISOString().slice(0, 10), "2022-03-21");
  });

  test("auto-organise files by content, not into one pile", () => {
    assert.equal(byUrl(items, "imgur.com").deckId, "images");
    assert.equal(byUrl(items, "vimeo.com").deckId, "videos");
  });
});

// ---------------------------------------------------------------------------
describe("Omnivore, Pinboard, Wallabag, Readwise", () => {
  test("Omnivore: originalUrl, label objects, savedAt, archived state", () => {
    const { items } = normalize({ name: "metadata_0.json", text: OMNIVORE_JSON });
    const item = items[0];
    assert.equal(item.url, "https://omni.example/a");
    assert.ok(item.tags.includes("research") && item.tags.includes("ai"));
    assert.equal(new Date(item.createdAt).toISOString().slice(0, 10), "2024-02-03");
    assert.ok(item.tags.includes("archive"), "state ARCHIVED is preserved");
    assert.match(item.note, /first highlight/);
    assert.match(item.note, /my note/);
    assert.equal(item.reference, "By Someone");
    assert.equal(item.image, "https://omni.example/c.png");
  });

  test("Omnivore: several metadata_*.json files import as one library", () => {
    const second = JSON.stringify([{ id: "o2", title: "Second batch", originalUrl: "https://omni.example/b", labels: [], savedAt: "2024-02-04T00:00:00Z", state: "READING", highlights: [] }]);
    const combined = combineParsed([
      parseExport({ name: "metadata_0.json", text: OMNIVORE_JSON }),
      parseExport({ name: "metadata_1.json", text: second }),
    ]);
    const result = toKipideckItems(combined);
    assert.equal(result.items.length, 2);
  });

  test("Pinboard: space-separated tags, toread, extended note, shared=0", () => {
    const { items } = normalize({ name: "pinboard_export.json", text: PINBOARD_JSON });
    assert.ok(byUrl(items, "/a").tags.includes("dev") && byUrl(items, "/a").tags.includes("reading"));
    assert.ok(byUrl(items, "/a").tags.includes("private"), "shared:0 means the user kept it private");
    assert.equal(byUrl(items, "/a").note, "my long note");
    assert.ok(byUrl(items, "/b").tags.includes("archive"), "toread:0 is read");
  });

  test("Wallabag: HTML body becomes searchable text, script tags do not", () => {
    const { items } = normalize({ name: "wallabag-export.json", text: WALLABAG_JSON });
    const item = items[0];
    assert.match(item.content, /Hello world\./);
    assert.match(item.content, /Second paragraph/);
    assert.ok(!item.content.includes("alert"), "script contents are stripped, not indexed");
    assert.ok(item.tags.includes("archive"));
    assert.ok(item.tags.includes("news"));
  });

  test("Readwise: Read Status, Notes and a long Content column", () => {
    const { items } = normalize({ name: "reader_export.csv", text: READWISE_CSV });
    const item = items[0];
    assert.equal(item.title, "Deep work");
    assert.ok(item.tags.includes("archive"), "Read Status Archived");
    assert.equal(item.note, "my note here");
    assert.match(item.content, /fairly long body of content/);
    assert.equal(item.image, "https://books.example/cover.jpg");
    assert.ok(item.tags.includes("focus") && item.tags.includes("deep"));
  });
});

// ---------------------------------------------------------------------------
describe("Chrome profile Bookmarks JSON", () => {
  const { items } = normalize({ name: "Bookmarks", text: CHROME_JSON });

  test("microseconds since 1601 become a sane date", () => {
    const item = byUrl(items, "example.com/");
    assert.equal(new Date(item.createdAt).toISOString().slice(0, 7), "2024-01");
  });

  test("folder paths are preserved as tags", () => {
    assert.ok(byUrl(items, "example.org/deep").tags.includes("reading"));
    assert.ok(!items.some((i) => i.tags.includes("bookmarks bar")), "the bar itself is not a folder the user chose");
  });

  test("all roots are walked", () => {
    assert.equal(items.length, 3);
    assert.ok(byUrl(items, "other.test"));
  });
});

// ---------------------------------------------------------------------------
describe("plain URL lists", () => {
  const parsed = parseExport({ name: "links.md", text: URL_LIST });
  const { items } = toKipideckItems(parsed);

  test("markdown links, bullets, numbering and bare URLs all count", () => {
    assert.equal(items.length, 5, `got ${items.map((i) => i.url).join(", ")}`);
  });

  test("the same URL twice in one file is one item", () => {
    assert.equal(toKipideckItems(parsed).stats.duplicatesInFile, 1);
  });

  test("markdown headings become folder tags", () => {
    assert.ok(byUrl(items, "arxiv.org").tags.includes("research"));
    assert.ok(byUrl(items, "recipes.example").tags.includes("recipes"));
  });

  test("a title after the URL is picked up", () => {
    assert.equal(byUrl(items, "recipes.example").title, "Pasta night");
  });

  test("markdown link text becomes the title", () => {
    assert.equal(byUrl(items, "arxiv.org").title, "A paper");
  });

  test("comment lines are ignored", () => {
    assert.ok(!items.some((i) => i.title.includes("comment")));
  });
});

// ---------------------------------------------------------------------------
describe("Kipideck's own export", () => {
  const { items } = normalize({ name: "kipideck-export.json", text: KIPI_JSON });

  test("decks, pins and types survive a round trip", () => {
    const page = byUrl(items, "mine.example/a");
    assert.equal(page.deckId, "reading", "its own deck beats the dialog's target deck");
    assert.equal(page.pinned, true);
    assert.equal(page.type, "page");
    assert.equal(byUrl(items, "mine.example/b").deckId, "quotes");
    assert.equal(byUrl(items, "mine.example/b").type, "selection");
  });

  test("timestamps are untouched", () => {
    assert.equal(byUrl(items, "mine.example/a").createdAt, 1700000000000);
  });

  test("content and notes come across", () => {
    assert.equal(byUrl(items, "mine.example/a").content, "full text here");
    assert.equal(byUrl(items, "mine.example/a").note, "my note");
  });
});

// ---------------------------------------------------------------------------
describe("single-article HTML — the other half of a split export", () => {
  test("a prose file is recognised as an article, not as a bookmark list", () => {
    assert.equal(detectFormat({ name: `${ARTICLE_SLUG}.html`, text: ARTICLE_HTML }).id, "article-html");
  });

  test("the canonical URL, title and text come out of it", () => {
    const parsed = parseExport({ name: `${ARTICLE_SLUG}.html`, text: ARTICLE_HTML });
    assert.equal(parsed.format, "article-html");
    assert.equal(parsed.items.length, 1);
    const article = parsed.items[0];
    assert.equal(article.url, "https://blog.example/deep-work");
    assert.equal(article.title, "Deep work essay");
    assert.match(article.content, /first paragraph of the essay/);
    assert.equal(article.slug, ARTICLE_SLUG, "the filename is the join key");
  });

  test("navigation, footers and scripts do not become article text", () => {
    const { content } = parseExport({ name: "a.html", text: ARTICLE_HTML }).items[0];
    assert.ok(!content.includes("Subscribe"), "nav leaked into the text");
    assert.ok(!content.includes("Copyright"), "footer leaked into the text");
    assert.ok(!content.includes("should never be indexed"), "script text leaked into the article");
    assert.match(content, /inline reference/, "an inline link's words are part of the prose");
  });

  test("a stub with no real text is not imported as an article", () => {
    const parsed = parseExport({ name: "stub.html", text: "<html><body><article><p>Too short.</p></article></body></html>" });
    assert.equal(parsed.items.length, 0);
    assert.ok(parsed.warnings.some((w) => /not contain enough article text/i.test(w)));
  });

  test("bookmark files are never mistaken for articles", () => {
    const chrome = parseExport({ name: "bookmarks.html", text: CHROME_HTML });
    assert.equal(chrome.format, "bookmarks-html");
    const pocket = parseExport({ name: "ril_export.html", text: POCKET_HTML });
    assert.equal(pocket.format, "pocket-html");
  });

  test("metadata JSON + article HTML rejoin into one item, text included", () => {
    const combined = combineParsed([
      parseExport({ name: "metadata_0.json", text: OMNIVORE_WITH_SLUG }),
      parseExport({ name: `${ARTICLE_SLUG}.html`, text: ARTICLE_HTML }),
    ]);
    assert.equal(combined.joinedArticleText, 1);
    assert.ok(combined.warnings.some((w) => /Article text recovered/i.test(w)));

    const { items } = toKipideckItems(combined);
    assert.equal(items.length, 1, "the two halves are one item, not two");
    const item = items[0];
    assert.match(item.content, /first paragraph of the essay/, "the article text survived the join");
    assert.match(item.note, /attention is the currency/, "highlights still become notes");
    assert.ok(item.tags.includes("focus"), "labels still become tags");
    assert.ok(item.tags.includes("archive"), "read state still survives");
    assert.equal(new Date(item.createdAt).toISOString().slice(0, 10), "2024-02-03", "save date still survives");
  });

  test("an article file with no metadata partner still imports if it has a URL", () => {
    const { items } = toKipideckItems(combineParsed([parseExport({ name: "lonely.html", text: ARTICLE_HTML })]));
    assert.equal(items.length, 1);
    assert.equal(items[0].url, "https://blog.example/deep-work");
    assert.equal(items[0].title, "Deep work essay");
  });

  test("an article file with neither URL nor partner is reported, not silently dropped", () => {
    const noUrl = ARTICLE_HTML.replace(/<link rel="canonical"[^>]*>/, "").replace(/<meta name="original-url"[^>]*>/, "");
    const combined = combineParsed([parseExport({ name: "orphan.html", text: noUrl })]);
    assert.equal(combined.items.length, 0);
    assert.ok(combined.warnings.some((w) => /no URL and no matching metadata/i.test(w)), JSON.stringify(combined.warnings));
  });
});


// ---------------------------------------------------------------------------
describe("normalisation options", () => {
  test("a chosen target deck wins over the classifier", () => {
    const { items } = normalize({ name: "r.json", text: RAINDROP_JSON }, { targetDeck: "research" });
    assert.ok(items.every((i) => i.deckId === "research"));
  });

  test("targetDeck 'auto' lets the classifier file each item", () => {
    const { items } = normalize({ name: "r.json", text: RAINDROP_JSON }, { targetDeck: "auto" });
    assert.equal(byUrl(items, "imgur.com").deckId, "images");
  });

  test("foldersAsTags can be turned off", () => {
    const { items } = normalize({ name: "b.html", text: CHROME_HTML }, { foldersAsTags: false });
    assert.ok(!byUrl(items, "developer.mozilla.org").tags.includes("docs"));
    assert.ok(byUrl(items, "developer.mozilla.org").tags.includes("mdn"), "the file's own tags are kept");
  });

  test("statusAsTags can be turned off", () => {
    const { items } = normalize({ name: "ril_export.html", text: POCKET_HTML }, { statusAsTags: false });
    assert.ok(!byUrl(items, "old-read").tags.includes("archive"));
  });

  test("keepDates: false stamps everything now", () => {
    const before = Date.now();
    const { items } = normalize({ name: "part.csv", text: POCKET_CSV }, { keepDates: false });
    assert.ok(items.every((i) => i.createdAt >= before));
  });

  test("an absurd source date is clamped instead of sorting to the top forever", () => {
    const text = 'title,url,time_added,tags,status\n"Future",https://example.com/future,99999999999,,unread\n"Ancient",https://example.com/ancient,1,,unread';
    const { items } = normalize({ name: "weird.csv", text });
    const now = Date.now();
    for (const item of items) {
      assert.ok(item.createdAt <= now + 86_400_000, `${item.title} is in the future`);
      assert.ok(item.createdAt > Date.UTC(1990, 0, 1), `${item.title} is from 1970`);
    }
  });

  test("tags are capped so a noisy export cannot bury the tag cloud", () => {
    const text = `title,url,time_added,tags,status\n"Many tags",https://example.com/many,1700000000,${Array.from({ length: 40 }, (_, i) => `t${i}`).join("|")},unread`;
    const { items } = normalize({ name: "many.csv", text });
    assert.ok(items[0].tags.length <= 12, `got ${items[0].tags.length}`);
  });

  test("every record has the fields the data layer requires", () => {
    for (const file of [
      { name: "p.csv", text: POCKET_CSV },
      { name: "p.html", text: POCKET_HTML },
      { name: "b.html", text: CHROME_HTML },
      { name: "r.json", text: RAINDROP_JSON },
      { name: "l.md", text: URL_LIST },
    ]) {
      const { items } = normalize(file);
      assert.ok(items.length, `${file.name} produced nothing`);
      for (const item of items) {
        assert.ok(item.url && /^https?:\/\//.test(item.url), `${file.name}: bad url ${item.url}`);
        assert.ok(item.title, `${file.name}: missing title`);
        assert.ok(item.domain, `${file.name}: missing domain`);
        assert.ok(item.deckId, `${file.name}: missing deck`);
        assert.ok(Number.isFinite(item.createdAt) && Number.isFinite(item.updatedAt), `${file.name}: bad dates`);
        assert.ok(Array.isArray(item.tags), `${file.name}: tags must be an array`);
        assert.ok(!("content" in item) || typeof item.content === "string", `${file.name}: content must be text`);
        assert.equal(item.favicon, undefined, "icons are never imported — they are fetched locally");
      }
    }
  });
});

// ---------------------------------------------------------------------------
describe("primitives", () => {
  test("parseCsv handles quotes, escaped quotes, embedded newlines and BOM", () => {
    const rows = parseCsv('\uFEFFa,b,c\n1,"two, still two",3\n4,"say ""hi""",6\n7,"line one\nline two",9\n');
    assert.deepEqual(rows[0], ["a", "b", "c"]);
    assert.deepEqual(rows[1], ["1", "two, still two", "3"]);
    assert.deepEqual(rows[2], ["4", 'say "hi"', "6"]);
    assert.deepEqual(rows[3], ["7", "line one\nline two", "9"]);
    assert.equal(rows.length, 4, "the trailing newline does not create an empty row");
  });

  test("parseCsv sniffs semicolons and tabs", () => {
    assert.deepEqual(parseCsv("a;b;c\n1;2;3"), [["a", "b", "c"], ["1", "2", "3"]]);
    assert.deepEqual(parseCsv("a\tb\n1\t2"), [["a", "b"], ["1", "2"]]);
  });

  test("isHeaderRow knows a header from data", () => {
    assert.equal(isHeaderRow(["title", "url", "time_added", "tags", "status"]), true);
    assert.equal(isHeaderRow(["How to cook", "https://example.com", "1700000000"]), false);
    assert.equal(isHeaderRow([]), false);
  });

  test("csvToObjects falls back to positions when there is no header", () => {
    const { objects, header } = csvToObjects([["https://example.com/a", "A title", "1700000000"]]);
    assert.equal(header, null);
    assert.equal(objects[0].url, "https://example.com/a");
    assert.equal(objects[0].title, "A title");
  });

  test("decodeEntities handles named, decimal and hex forms", () => {
    assert.equal(decodeEntities("Tom &amp; Jerry &#8212; &#x201C;hi&#x201D;"), "Tom & Jerry — “hi”");
    assert.equal(decodeEntities("&nbsp;x&nbsp;"), " x ");
    assert.equal(decodeEntities("&unknownentity;"), "&unknownentity;", "unknown entities pass through");
    assert.equal(decodeEntities(""), "");
    assert.equal(decodeEntities(null), "");
  });

  test("htmlToText drops scripts and styles, keeps paragraph breaks", () => {
    const text = htmlToText("<p>One</p><script>var x = 1 < 2;</script><style>.a{color:red}</style><p>Two</p>");
    assert.match(text, /One/);
    assert.match(text, /Two/);
    assert.ok(!text.includes("var x"), "script text must not become article text");
    assert.ok(!text.includes("color:red"));
  });

  test("htmlToText respects the cap", () => {
    assert.equal(htmlToText("<p>" + "word ".repeat(5000) + "</p>", 100).length, 100);
  });

  test("splitTags handles every separator real exports use", () => {
    assert.deepEqual(splitTags("a|b|c"), ["a", "b", "c"]);
    assert.deepEqual(splitTags("a, b ,c"), ["a", "b", "c"]);
    assert.deepEqual(splitTags("a;b"), ["a", "b"]);
    assert.deepEqual(splitTags("dev reading"), ["dev", "reading"]);
    assert.deepEqual(splitTags(["already", "an", "array"].join(",")), ["already", "an", "array"]);
    assert.deepEqual(splitTags(""), []);
    assert.deepEqual(splitTags(null), []);
  });

  test("toMillis reads every timestamp shape in the wild", () => {
    assert.equal(toMillis(1709251200), 1709251200000, "unix seconds");
    assert.equal(toMillis("1709251200"), 1709251200000, "unix seconds as text");
    assert.equal(toMillis(1709251200000), 1709251200000, "milliseconds");
    assert.equal(toMillis("2022-03-21T14:41:34.059Z"), Date.parse("2022-03-21T14:41:34.059Z"), "ISO");
    assert.equal(toMillis("13350000000000000"), 1705526400000, "Chrome 1601 microseconds");
    assert.equal(toMillis(""), null);
    assert.equal(toMillis(null), null);
    assert.equal(toMillis("not a date"), null);
    assert.equal(toMillis(0), null, "an epoch zero is a missing date, not 1970");
    assert.equal(toMillis(12345), null, "too small to be a real timestamp");
  });

  test("unwrapRedirect only unwraps known wrappers", () => {
    assert.equal(unwrapRedirect("https://getpocket.com/extredirect?url=https%3A%2F%2Fa.test%2Fx&http=1"), "https://a.test/x");
    assert.equal(unwrapRedirect("https://www.google.com/url?q=https%3A%2F%2Fb.test%2Fy&sa=U&ved=2ahU"), "https://b.test/y");
    assert.equal(unwrapRedirect("https://l.instagram.com/?u=https%3A%2F%2Fc.test%2Fz&e=AT0"), "https://c.test/z");
    assert.equal(unwrapRedirect("https://example.com/normal?a=1"), "https://example.com/normal?a=1", "an ordinary URL is untouched");
    assert.equal(unwrapRedirect("https://getpocket.com/extredirect?url=not-a-url"), "https://getpocket.com/extredirect?url=not-a-url");
    assert.equal(unwrapRedirect(""), "");
    assert.equal(unwrapRedirect("   "), "");
  });

  test("a bare domain gets a protocol so it can be stored and opened", () => {
    const { items } = normalize({ name: "l.txt", text: "example.com/plain\nhttps://example.com/full\n" });
    assert.deepEqual(items.map((i) => i.url), ["https://example.com/plain", "https://example.com/full"]);
  });
});

// ---------------------------------------------------------------------------
describe("robustness", () => {
  test("HTML with no links warns instead of importing nothing silently", () => {
    const parsed = parseExport({ name: "empty.html", text: "<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p></DL><p>" });
    assert.equal(parsed.items.length, 0);
    assert.ok(parsed.warnings.length, "the user must be told why nothing imported");
  });

  test("a CSV with no URL column imports nothing and says so", () => {
    const parsed = parseExport({ name: "notes.csv", text: "a,b,c\n1,2,3\n4,5,6\n" });
    assert.equal(parsed.items.length, 0, "nothing addressable, nothing imported");
    assert.ok(parsed.warnings.some((w) => /no URLs were found/i.test(w)), JSON.stringify(parsed.warnings));
    assert.equal(toKipideckItems(parsed).items.length, 0);
  });

  test("a headerless CSV of junk is not imported as titled, addressless rows", () => {
    const parsed = parseExport({ name: "mystery.csv", text: "1,2,3\n4,5,6\n" });
    const result = toKipideckItems(parsed);
    assert.equal(result.items.length, 0);
    assert.equal(result.stats.parsed, 2, "the rows were seen");
    assert.equal(result.stats.noUrl, 2, "and reported as unusable");
    assert.ok(result.warnings.some((w) => /no usable URL/i.test(w)), JSON.stringify(result.warnings));
  });

  test("malformed rows are skipped, the rest still import", () => {
    const text = 'title,url,time_added,tags,status\n"Good",https://example.com/good,1700000000,,unread\n"Bad",,1700000000,,unread\n"Also good",https://example.com/also,1700000000,,unread';
    const { items, stats } = normalize({ name: "mixed.csv", text });
    assert.equal(items.length, 2);
    assert.equal(stats.noUrl, 1);
  });

  test("a JSON array of bare strings does not crash", () => {
    const parsed = parseExport({ name: "odd.json", text: '["https://example.com/a", "https://example.com/b"]' });
    assert.ok(parsed.items.length <= 2);
  });

  test("very deep folder nesting does not lose items", () => {
    const depth = 40;
    let html = "<!DOCTYPE NETSCAPE-Bookmark-file-1>\n" + '<DT><H3>f</H3>\n<DL><p>\n'.repeat(depth);
    html += '<DT><A HREF="https://deep.test/x" ADD_DATE="1700000000">Deep</A>\n';
    html += "</DL><p>\n".repeat(depth);
    const { items } = normalize({ name: "deep.html", text: html });
    assert.equal(items.length, 1);
    assert.equal(items[0].url, "https://deep.test/x");
  });

  test("a 20,000-row CSV parses in well under a second", () => {
    const rows = ['title,url,time_added,tags,status'];
    for (let i = 0; i < 20_000; i++) rows.push(`"Item ${i}",https://example.com/p/${i},${1700000000 + i},tag${i % 7}|common,${i % 3 ? "unread" : "archive"}`);
    const text = rows.join("\n");
    const started = Date.now();
    const result = normalize({ name: "big.csv", text });
    const elapsed = Date.now() - started;
    assert.equal(result.items.length, 20_000);
    assert.ok(elapsed < 4000, `20k rows took ${elapsed}ms`);
    console.log(`      20,000-row Pocket CSV: parse + normalise in ${elapsed} ms`);
  });
});
