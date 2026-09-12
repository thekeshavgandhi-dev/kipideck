// test/scale.bench.js — does the new data layer actually hold up at the size we
// are engineering for? Run with `npm run test:scale`.
//
// This is a benchmark, not a test: it is excluded from `node --test` on purpose
// (it allocates hundreds of MB). Numbers come from `fake-indexeddb`, which is a
// pure-JS simulation and therefore SLOWER than a browser's real IndexedDB —
// treat every figure here as a pessimistic upper bound.
//
// Reference: the v1.3 engine (index rebuilt inside every search call, invoked
// twice per keystroke by the Library) measured on the same machine:
//     500 items  → 2.2 s to type a 10-char query
//   2,000 items  → 8.5 s
//   5,000 items  → 21 s
//  10,000 items  → 45 s

import "./harness.js";

const ITEMS = Number(process.env.ITEMS || 20_000);
const CONTENT_CHARS = Number(process.env.CONTENT || 4000);

const db = await import("../lib/db.js");
const { searchItems } = await import("../lib/search.js");
const { Storage } = await import("../lib/storage.js");

const WORDS = (
  "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore " +
  "et dolore magna aliqua javascript react typescript node sql python api design tutorial guide recipe " +
  "ingredients travel hotel flight career interview resume productivity bookmarks reading research paper " +
  "github stackoverflow documentation framework library component render state hook effect fermentation " +
  "hydration guanciale pecorino espresso pressure extraction"
).split(" ");

function makeItem(i) {
  let content = "";
  while (content.length < CONTENT_CHARS) content += WORDS[(Math.random() * WORDS.length) | 0] + " ";
  // A rare term in 5% of items, so the AND query below has a meaningful answer
  // instead of matching the whole synthetic corpus.
  if (i % 20 === 0) content += " kipideckrare ";
  return {
    item: {
      id: `k_bench_${i}`,
      type: i % 9 === 0 ? "selection" : "page",
      title: `Article ${i} about ${WORDS[i % WORDS.length]} and ${WORDS[(i * 7) % WORDS.length]}`,
      url: `https://site${i % 400}.com/post/${i}`,
      domain: `site${i % 400}.com`,
      tags: [`topic${i % 60}`, `batch${i % 7}`],
      deckId: ["reading", "dev", "research", "shopping", "videos"][i % 5],
      excerpt: content.slice(0, 280),
      note: i % 20 === 0 ? "revisit this later" : "",
      createdAt: Date.now() - i * 1000,
      updatedAt: Date.now() - i * 1000,
      pinned: i % 500 === 0,
    },
    text: content,
  };
}

const START = process.hrtime.bigint();
const ms = (t) => Number(process.hrtime.bigint() - t) / 1e6;
const mb = (bytes) => (bytes / 1048576).toFixed(1);
const line = (label, value) => console.log(`  ${label.padEnd(46)} ${String(value).padStart(12)}`);

console.log(`\nKipideck scale benchmark — ${ITEMS.toLocaleString()} items × ${CONTENT_CHARS.toLocaleString()} chars of page text`);
console.log(`(fake-indexeddb, i.e. slower than a real browser)\n`);

await Storage.init();

// ---- bulk import -----------------------------------------------------------
let t = process.hrtime.bigint();
for (let i = 0; i < ITEMS; i += 5000) {
  const batch = Array.from({ length: Math.min(5000, ITEMS - i) }, (_, k) => makeItem(i + k));
  await db.writeItemsBulk(batch);
  const done = Math.min(i + 5000, ITEMS);
  process.stdout.write(`\r  importing… ${done.toLocaleString()}/${ITEMS.toLocaleString()} (${ms(t).toFixed(0)} ms)`);
}
const importMs = ms(t);
console.log(`\r  imported ${ITEMS.toLocaleString()} items + built the index      ${(importMs / 1000).toFixed(1).padStart(9)} s`);
line("throughput", `${Math.round(ITEMS / (importMs / 1000)).toLocaleString()} items/s`);

// ---- library state ---------------------------------------------------------
const stats = await db.getStats();
console.log("\nLibrary state");
line("items", stats.items.toLocaleString());
line("content records", stats.contents.toLocaleString());
line("distinct index terms", stats.terms.toLocaleString());
line("postings records", stats.postings.toLocaleString());

// ---- search: the number that used to be 21 seconds -------------------------
console.log("\nSearch (the path that froze the UI in v1.3)");
const query = "react hooks";
t = process.hrtime.bigint();
for (let k = 1; k <= query.length; k++) await searchItems({ query: query.slice(0, k), limit: 60 });
const typingMs = ms(t);
line(`typing "${query}" (11 keystrokes, 1 page each)`, `${typingMs.toFixed(0)} ms total`);
line("→ per keystroke", `${(typingMs / query.length).toFixed(1)} ms`);

t = process.hrtime.bigint();
const res = await searchItems({ query: "kipideckrare hydration", limit: 60 });
line("2-word AND query (cold)", `${ms(t).toFixed(0)} ms`);
line("→ matches", `${res.total.toLocaleString()} of ${ITEMS.toLocaleString()} (returned ${res.items.length})`);

t = process.hrtime.bigint();
await searchItems({ query: "produc", limit: 60 }); // prefix expansion
line("prefix query \"produc\"", `${ms(t).toFixed(0)} ms`);

t = process.hrtime.bigint();
const scoped = await searchItems({ query: "espresso", deckId: "research", limit: 60 });
line("scoped to one deck (cold filter build)", `${ms(t).toFixed(0)} ms`);
t = process.hrtime.bigint();
await searchItems({ query: "espresso extraction", deckId: "research", limit: 60 });
line("same deck again (warm filter cache)", `${ms(t).toFixed(0)} ms`);
line("→ matches in that deck", scoped.total.toLocaleString());

t = process.hrtime.bigint();
await searchItems({ query: "guanciale tag:topic3", limit: 60 });
line("with tag: operator", `${ms(t).toFixed(0)} ms`);

// ---- browse / sidebar ------------------------------------------------------
console.log("\nBrowse (Library grid + sidebar)");
t = process.hrtime.bigint();
const page = await db.listItems({ sort: "new", limit: 60, offset: 0 });
line("first page of 60", `${ms(t).toFixed(1)} ms`);
t = process.hrtime.bigint();
await db.listItems({ sort: "new", limit: 60, offset: 10_000 });
line("page at offset 10,000", `${ms(t).toFixed(1)} ms`);
t = process.hrtime.bigint();
await db.listItems({ deckId: "dev", sort: "new", limit: 60 });
line("one deck, first page", `${ms(t).toFixed(1)} ms`);
t = process.hrtime.bigint();
const counts = await Storage.getCounts();
line("sidebar counts (all decks + pinned)", `${ms(t).toFixed(1)} ms`);
line("→ total / pinned", `${counts.total.toLocaleString()} / ${counts.pinned.toLocaleString()}`);
t = process.hrtime.bigint();
const tags = await Storage.getTagCounts();
line("tag cloud", `${ms(t).toFixed(1)} ms (${Object.keys(tags).length} tags)`);

// ---- single interactive save ----------------------------------------------
console.log("\nInteractive save (one item, indexed on write)");
t = process.hrtime.bigint();
await Storage.saveItem({
  type: "page",
  title: "A brand new save about sourdough",
  url: "https://newsite.com/sourdough",
  domain: "newsite.com",
  deckId: "reading",
  tags: ["recipe"],
  content: makeItem(0).text,
});
line("save + index + counters + sync queue", `${ms(t).toFixed(0)} ms`);

// ---- what sync has to move -------------------------------------------------
console.log("\nSync payload (why content must be split from metadata)");
const metas = await db.getAllItemMetas();
const metaBytes = JSON.stringify(metas.map(({ idx, n, ...m }) => m)).length;
line("all metadata as JSON", `${mb(metaBytes)} MB`);
line("→ a delta sync uploads only what changed", `${mb(JSON.stringify(metas.slice(0, 50).map(({ idx, n, ...m }) => m)).length)} MB for 50 items`);
const oneContent = await db.getContent(metas[0].id);
line(`content for all items (≈${mb(oneContent.text.length * ITEMS)} MB)`, "never re-uploaded wholesale");
line("v1.3 uploaded ONE blob of both, every save", `${mb(metaBytes + oneContent.text.length * ITEMS)} MB`);
line("Drive simple/multipart upload limit", "5 MB");

console.log(`\nTotal wall clock: ${(ms(START) / 1000).toFixed(1)} s (bulk import dominates)\n`);
process.exit(0);
