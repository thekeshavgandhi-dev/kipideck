// test/zip.test.js — ZIP archives open in the browser (ideas.md I-05, Phase 2).
//
// The archives below are built by hand in this file — raw local headers plus a
// central directory, DEFLATE via node:zlib (stdlib) — and NEVER by fflate,
// which is the code under test on the read side. The builder's output was
// cross-checked against Python's zipfile (healthy, CRC-valid) before these
// tests were written, so when both agree, the format handling is right.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import {
  expandZip,
  isZipBytes,
  isZipName,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_FILES,
  MAX_ZIP_FILE_BYTES,
  MAX_ZIP_TOTAL_BYTES,
} from "../lib/unzip.js";
import { combineParsed, detectFormat, parseExport, toKipideckItems } from "../lib/import.js";

// ---------------------------------------------------------------------------
// Independent ZIP builder (test-only)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// entries: [{ name, data, method?: "stored" (default: deflated), rawMethod?: n }]
// Directories are names ending in "/". rawMethod writes a dishonest method in
// the headers (for the unsupported-compression test).
function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const dosTime = (10 << 11) | (30 << 5); // 2026-09-12 10:30:00
  const dosDate = ((2026 - 1980) << 9) | (9 << 5) | 12;
  for (const e of entries) {
    const nameU8 = new TextEncoder().encode(e.name);
    const raw = typeof e.data === "string" ? new TextEncoder().encode(e.data) : new Uint8Array(e.data);
    const method = e.method === "stored" || e.name.endsWith("/") ? 0 : 8;
    const comp = method === 8 ? deflateRawSync(raw) : raw;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true); // UTF-8 names
    lh.setUint16(8, e.rawMethod ?? method, true);
    lh.setUint16(10, dosTime, true);
    lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc32(raw), true);
    lh.setUint32(18, comp.length, true);
    lh.setUint32(22, raw.length, true);
    lh.setUint16(26, nameU8.length, true);
    lh.setUint16(28, 0, true);
    locals.push(Buffer.from(lh.buffer), Buffer.from(nameU8), Buffer.from(comp));
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 63, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, e.rawMethod ?? method, true);
    ch.setUint16(12, dosTime, true);
    ch.setUint16(14, dosDate, true);
    ch.setUint32(16, crc32(raw), true);
    ch.setUint32(20, comp.length, true);
    ch.setUint32(24, raw.length, true);
    ch.setUint16(28, nameU8.length, true);
    ch.setUint32(42, offset, true);
    centrals.push(Buffer.from(ch.buffer), Buffer.from(nameU8));
    offset += 30 + nameU8.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cd.length, true);
  end.setUint32(16, offset, true);
  return new Uint8Array(Buffer.concat([...locals, cd, Buffer.from(end.buffer)]));
}

// ---------------------------------------------------------------------------
// Fixtures shaped like the real refugee exports
// ---------------------------------------------------------------------------

const POCKET_PART_0 = [
  "title,url,time_added,tags,status",
  '"How to make espresso",https://example.com/espresso,1709251200,coffee|recipes,unread',
  '"An archived piece",https://example.com/archived,1500000000,,archive',
].join("\n");

const POCKET_PART_1 = [
  "title,url,time_added,cursor,tags,status",
  '"Later part",https://example.com/part2,1610000000,,reading,unread',
  '"Also in part zero",https://example.com/espresso,1709251200,,coffee,unread',
].join("\n");

const OMNI_SLUG = "the-deep-work-essay";
const OMNI_META = JSON.stringify([
  {
    id: "o1",
    slug: OMNI_SLUG,
    title: "Deep work essay",
    originalUrl: "https://blog.example/deep-work",
    labels: [{ name: "focus" }],
    savedAt: "2024-02-03T04:05:06Z",
    state: "ARCHIVED",
    highlights: [{ quote: "attention is the currency", annotation: "yes" }],
  },
]);
const OMNI_HTML = `<!DOCTYPE html>
<html><head>
<title>Deep work essay</title>
<meta name="original-url" content="https://blog.example/deep-work">
<link rel="canonical" href="https://blog.example/deep-work">
</head>
<body>
<article>
<h1>Deep work essay</h1>
<p>The first paragraph of the essay, long enough to count as real article text rather than a stub page that gets skipped.</p>
<p>A second paragraph, because one paragraph is barely an essay and the test wants prose.</p>
</article>
</body></html>`;

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

describe("zip detection", () => {
  test("names: .zip in any case, padded or not", () => {
    assert.equal(isZipName("pocket-export.zip"), true);
    assert.equal(isZipName("Pocket Export.ZIP"), true);
    assert.equal(isZipName("  x.zip  "), true);
    assert.equal(isZipName("x.rar"), false);
    assert.equal(isZipName("part_000000.csv"), false);
    assert.equal(isZipName("zip"), false);
    assert.equal(isZipName(""), false);
  });

  test("magic bytes: local headers, empty archives, and not-a-zip", () => {
    assert.equal(isZipBytes(buildZip([{ name: "a.csv", data: "x" }])), true);
    assert.equal(isZipBytes(buildZip([])), true); // PK..05..06 end record
    assert.equal(isZipBytes(new TextEncoder().encode("title,url\n")), false);
    assert.equal(isZipBytes(new Uint8Array([0x50, 0x4b])), false); // "PK", truncated
    assert.equal(isZipBytes(new Uint8Array([])), false);
  });
});

// ---------------------------------------------------------------------------
// Expansion
// ---------------------------------------------------------------------------

describe("expandZip basics", () => {
  test("stored entries come out byte-identical", () => {
    const out = expandZip(
      buildZip([{ name: "part_000000.csv", data: POCKET_PART_0, method: "stored" }]),
      { outerName: "pocket.zip" }
    );
    assert.equal(out.files.length, 1);
    assert.equal(out.files[0].name, "part_000000.csv");
    assert.equal(out.files[0].text, POCKET_PART_0);
  });

  test("deflated entries inflate (node:zlib wrote them, fflate reads them)", () => {
    const out = expandZip(buildZip([{ name: "a/b/c.json", data: '{"k":"v"}' }]), { outerName: "x.zip" });
    assert.equal(out.files.length, 1);
    assert.equal(out.files[0].name, "a/b/c.json");
    assert.equal(out.files[0].text, '{"k":"v"}');
  });

  test("mixed methods, folders and UTF-8 text in one archive", () => {
    const out = expandZip(
      buildZip([
        { name: "hindi.txt", data: "नमस्ते दुनिया\nsecond line\n" },
        { name: "nested/deep.md", data: "# hi\n", method: "stored" },
      ]),
      { outerName: "mixed.zip" }
    );
    assert.deepEqual(
      out.files.map((f) => f.name),
      ["hindi.txt", "nested/deep.md"]
    );
    assert.ok(out.files[0].text.includes("नमस्ते"), "non-ASCII survives the round trip");
  });

  test("junk stays inside: macOS forks, dotfiles, binaries, dirs, extensionless", () => {
    const out = expandZip(
      buildZip([
        { name: "keep.csv", data: "title,url\na,https://a.example\n" },
        { name: "__MACOSX/._keep.csv", data: "junk" },
        { name: ".DS_Store", data: "junk" },
        { name: "cover.png", data: "PNGDATA" },
        { name: "inner.zip", data: "PK\x03\x04junk" },
        { name: "README", data: "no extension" },
        { name: "a-folder/", data: "" },
      ]),
      { outerName: "junk.zip" }
    );
    assert.deepEqual(out.files.map((f) => f.name), ["keep.csv"]);
    assert.equal(out.scanned, 7);
    assert.equal(out.skipped, 6);
  });

  test("backslash paths are normalised to forward slashes", () => {
    const out = expandZip(buildZip([{ name: "contents\\slug-1.html", data: "<html>hi</html>" }]), {
      outerName: "win.zip",
    });
    assert.equal(out.files[0].name, "contents/slug-1.html");
  });

  test("duplicate inner names both come out — dedupe is the importer's job", () => {
    const out = expandZip(
      buildZip([
        { name: "a.csv", data: "title,url\nA,https://a.example\n" },
        { name: "a.csv", data: "title,url\nB,https://b.example\n" },
      ]),
      { outerName: "dup.zip" }
    );
    assert.equal(out.files.length, 2);
  });
});

describe("expandZip failures read like help, not stack traces", () => {
  test("an empty archive says so", () => {
    assert.throws(() => expandZip(buildZip([]), { outerName: "empty.zip" }), /empty\.zip” is empty or damaged/);
  });

  test("no importable files says what was wanted", () => {
    assert.throws(
      () => expandZip(buildZip([{ name: "photo.png", data: "xx" }]), { outerName: "pics.zip" }),
      /pics\.zip” holds no files Kipideck can import — it needs CSV, JSON, HTML, Markdown or plain text/
    );
  });

  test("non-zip bytes are refused, with the RAR hint", () => {
    assert.throws(() => expandZip(new TextEncoder().encode("title,url\n"), { outerName: "x.zip" }), /not a ZIP archive/);
  });

  test("a truncation names the archive, not an offset", () => {
    const full = buildZip([{ name: "big.csv", data: "title,url\n" + "a,https://a.example/abcdefghijklmnopqrstuvwxyz0123456789\n".repeat(50) }]);
    assert.throws(() => expandZip(full.slice(0, 100), { outerName: "cut.zip" }), /cut\.zip/);
  });

  test("an unsupported compression names the entry", () => {
    assert.throws(
      () => expandZip(buildZip([{ name: "weird.csv", data: "title,url\n", rawMethod: 12 }]), { outerName: "weird.zip" }),
      /weird\.csv/
    );
  });

  test("a split (spanned) archive is recognised and declined", () => {
    const spanning = buildZip([{ name: "a.csv", data: "title,url\n" }]);
    spanning[2] = 0x07;
    spanning[3] = 0x08;
    assert.ok(isZipBytes(spanning), "still recognised as zip-family bytes");
    assert.throws(() => expandZip(spanning, { outerName: "split.zip" }), /split.*spanned/i);
  });
});

describe("zip-bomb caps", () => {
  test("entry-count, file-count and byte caps trip on small overrides", () => {
    const three = buildZip([
      { name: "a.csv", data: "1".repeat(40) },
      { name: "b.csv", data: "2".repeat(40) },
      { name: "c.csv", data: "3".repeat(40) },
    ]);
    assert.throws(() => expandZip(three, { outerName: "t.zip", maxEntries: 2 }), /more than 2 entries/);
    assert.throws(() => expandZip(three, { outerName: "t.zip", maxFiles: 2 }), /more than 2 importable/);
    assert.throws(() => expandZip(three, { outerName: "t.zip", maxFileBytes: 20 }), /larger than 0 MB/);
    assert.throws(() => expandZip(three, { outerName: "t.zip", maxTotalBytes: 100 }), /more than 0 MB/);
  });

  test("the production defaults stay generous", () => {
    assert.equal(MAX_ZIP_ENTRIES, 2000);
    assert.equal(MAX_ZIP_FILES, 500);
    assert.equal(MAX_ZIP_FILE_BYTES, 50 * 1024 * 1024);
    assert.equal(MAX_ZIP_TOTAL_BYTES, 256 * 1024 * 1024);
  });
});

// ---------------------------------------------------------------------------
// The refugee paths, end to end: bytes → records
// ---------------------------------------------------------------------------

function expandAndParse(u8, outerName) {
  return expandZip(u8, { outerName }).files.map((f) => parseExport({ name: f.name, text: f.text }));
}

describe("a Pocket ZIP imports as one merged library", () => {
  test("parts merge, duplicates collapse, read-state survives", () => {
    const zip = buildZip([
      { name: "part_000000.csv", data: POCKET_PART_0 },
      { name: "part_000001.csv", data: POCKET_PART_1 },
    ]);
    const parsed = expandAndParse(zip, "pocket-export.zip");
    assert.deepEqual(parsed.map((p) => p.format), ["pocket-csv", "pocket-csv"]);

    const { items } = toKipideckItems(combineParsed(parsed));
    const urls = items.map((i) => i.url);
    assert.equal(urls.filter((u) => u.includes("espresso")).length, 1, "the URL in both parts imports once");
    assert.ok(urls.some((u) => u.includes("archived")), "part zero's second row is here");
    assert.ok(urls.some((u) => u.includes("part2")), "part one's row is here");
    const archived = items.find((i) => i.url.includes("archived"));
    assert.ok(archived.tags.includes("archive"), "Pocket's archive state becomes a tag");
  });
});

describe("an Omnivore ZIP rejoins metadata to article text", () => {
  test("contents/<slug>.html meets metadata by slug — the folder prefix must not leak into it", () => {
    const zip = buildZip([
      { name: "metadata_0.json", data: OMNI_META },
      { name: `contents/${OMNI_SLUG}.html`, data: OMNI_HTML },
      { name: "__MACOSX/._junk", data: "x" },
    ]);
    const combined = combineParsed(expandAndParse(zip, "omnivore.zip"));
    assert.equal(combined.joinedArticleText, 1);
    assert.ok(combined.warnings.some((w) => /Article text recovered/i.test(w)));

    const { items } = toKipideckItems(combined);
    assert.equal(items.length, 1, "the two halves are one item, not two");
    assert.match(items[0].content, /first paragraph of the essay/, "the article text survived the join");
    assert.ok(items[0].tags.includes("focus"), "labels still become tags");
  });

  test("metadata without its contents still imports as links", () => {
    const zip = buildZip([{ name: "metadata_0.json", data: OMNI_META }]);
    const { items } = toKipideckItems(combineParsed(expandAndParse(zip, "meta-only.zip")));
    assert.equal(items.length, 1);
    assert.equal(items[0].url, "https://blog.example/deep-work");
    assert.equal(items[0].content, "", "no article half, no article text — but no crash either");
  });
});

describe("archives the dialog still refuses", () => {
  for (const ext of ["rar", "7z", "gz"]) {
    test(`.${ext} keeps the honest "unzip first" instruction`, () => {
      const d = detectFormat({ name: `export.${ext}`, text: "" });
      assert.equal(d.id, "zip");
      assert.match(d.reason, /RAR, 7z or gzip/);
      assert.throws(() => parseExport({ name: `export.${ext}`, text: "binary" }), /RAR, 7z or gzip/);
    });
  }

  test("ZIP bytes reaching the text parser are rerouted to the dialog", () => {
    assert.throws(() => parseExport({ name: "pocket-export.zip", text: "PK\u0003\u0004binary" }), /pick it in the import dialog/);
  });
});
