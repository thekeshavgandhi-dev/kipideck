// tools/screenshots/harness.js
//
// Boots the real Library UI in a plain browser tab so the store screenshots can
// be captured honestly — real markup, real CSS, real storage code, real data.
//
// It does NOT copy library.html. It fetches it and injects its <body>, then
// imports the real library.js. That matters: a hand-copied snapshot of the
// markup would drift, and a screenshot of a UI that no longer exists is worse
// than no screenshot.
//
// Usage: see README.md in this folder.

// ---------------------------------------------------------------------------
// 1 · Seed a realistic library
// ---------------------------------------------------------------------------

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

/** A believable library: enough items to fill the grid, spread across decks,
 *  with tags, some pins, and real page text so search has something to hit. */
const SEED = [
  ["The Case for Local-First Software", "https://www.inkandswitch.com/local-first/", "reading", ["local-first", "architecture"], "Local-first software is a set of principles for software that enables both collaboration and ownership for users. Your data is stored on your own device…", 12],
  ["How Pocket died, and what it teaches", "https://blog.mozilla.org/en/mozilla/pocket/", "reading", ["shutdown", "read-later"], "Mozilla is discontinuing Pocket. Here is what happens to your saves, and when…", 3],
  ["Readability: A Moonshot into Reader Mode", "https://medium.com/readability", "reading", ["design"], "Reading on the web is broken. Ads, popovers, and autoplaying video fight the text…", 40],
  ["Against Productivity Apps", "https://www.newyorker.com/against-productivity", "reading", ["essay"], "Every tool that promises to organise your attention ends up taxing it…", 8],
  ["The gardener and the library", "https://example.com/gardener-library", "reading", ["essay"], "A library is not a warehouse. It is a garden you have to keep walking through…", 55],
  ["Why SQLite is everywhere", "https://www.sqlite.org/whentouse.html", "dev", ["databases"], "SQLite is the most widely deployed database engine in the world…", 21],
  ["MDN — IndexedDB API", "https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API", "dev", ["reference", "web"], "IndexedDB is a low-level API for client-side storage of significant amounts of structured data, including files and blobs…", 6],
  ["WebExtensions API — cross-browser", "https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions", "dev", ["reference", "web"], "The WebExtensions API is a cross-browser system for developing browser extensions…", 17],
  ["You might not need a bundler", "https://example.com/no-bundler", "dev", ["javascript"], "Native ES modules are fast enough for most projects, and the browser is very good at caching…", 30],
  ["Writing a tokenizer in 60 lines", "https://example.com/tokenizer", "dev", ["javascript", "search"], "Tokenising is the unglamorous half of search. Get it wrong and nothing downstream can save you…", 44],
  ["Stemming, stopwords and why search feels dumb", "https://example.com/stemming", "dev", ["search"], "A user types 'running'. Your index stored 'run'. Bridging that gap is the whole trick…", 61],
  ["Chrome Web Store review times in 2026", "https://example.com/cws-review", "dev", ["extensions"], "Manifest V3 changed the review pipeline. Here is what actually gets flagged…", 2],
  ["Rust for JavaScript developers", "https://doc.rust-lang.org/book/", "dev", ["rust"], "Ownership is Rust's most unique feature, and it enables memory safety guarantees…", 90],
  ["Designing for offline first", "https://example.com/offline-first", "dev", ["architecture"], "Assume the network is a lie. Design every interaction so it succeeds without one…", 25],
  ["The Two General's Problem", "https://en.wikipedia.org/wiki/Two_Generals%27_Problem", "dev", ["distributed"], "Two generals must agree on a time to attack, but their messengers may be captured…", 70],
  ["Stop using JSON for everything", "https://example.com/json-alternatives", "dev", ["formats"], "JSON won because it was easy, not because it was good. Here is where it hurts…", 33],
  ["Accessibility is not a feature", "https://example.com/a11y", "dev", ["a11y"], "If a keyboard user cannot reach it, it does not exist. Start there, not at the end…", 48],
  ["A short history of the bookmark", "https://example.com/history-bookmarks", "reading", ["history"], "The bookmark predates the web. It is the oldest surviving idea in personal computing…", 80],
  ["How we built on-device search for 50k items", "https://example.com/on-device-search", "dev", ["search", "performance"], "Persistent inverted indexes in IndexedDB beat a full scan by two orders of magnitude…", 5],
  ["Introducing Kipideck", "https://kipideck.vercel.app/", "links", ["kipideck"], "Save anything you find on the web, and keep it — no account, no server, no subscription…", 1],

  ["Kipideck — moving from Pocket", "https://kipideck.vercel.app/pocket-alternative", "links", ["kipideck", "migration"], "Mozilla deleted every Pocket library on 12 November 2025. If you exported in time, here is how to rescue the file…", 1],
  ["Kipideck — moving from Omnivore", "https://kipideck.vercel.app/omnivore-alternative", "links", ["kipideck", "migration"], "Omnivore was open source and it still died. Your export does not have to…", 1],
  ["Kipideck — the shutdown-proof pledge", "https://kipideck.vercel.app/shutdown-proof", "links", ["kipideck"], "Structural facts, not promises — including the things we cannot promise…", 1],
  ["Netscape bookmark file format", "https://developer.mozilla.org/en-US/docs/Mozilla/Tech/Places", "dev", ["reference"], "The Netscape bookmark format is still, decades later, the thing every browser imports…", 120],

  ["Solid carbon frame — is it worth it?", "https://example.com/bikes/carbon", "shopping", ["bikes"], "Carbon is lighter and stiffer, but the failure mode is different. Here is what to check…", 14],
  ["Best mechanical keyboards under $100", "https://example.com/keyboards", "shopping", ["keyboards", "desk"], "Switches matter more than the board. Start there and work outwards…", 9],
  ["Standing desks: the honest review", "https://example.com/standing-desks", "shopping", ["desk"], "A standing desk will not fix your back. It will, however, stop you sitting for nine hours…", 37],
  ["Espresso machines, ranked by repairability", "https://example.com/espresso", "shopping", ["coffee"], "The best machine is the one you can still get parts for in ten years…", 52],

  ["Building a reading habit that survives travel", "https://example.com/reading-habit", "reading", ["habits"], "The trick is not discipline. It is making the next book easier to reach than the phone…", 19],
  ["On keeping a common-place book", "https://example.com/commonplace", "reading", ["notes", "habits"], "A common-place book is a scrapbook with an index. It is also the oldest form of personal knowledge management…", 66],
  ["The slow web", "https://example.com/slow-web", "reading", ["essay"], "What if the web were smaller, slower, and mostly text? It used to be…", 130],
  ["Why your save-for-later pile never shrinks", "https://example.com/pile", "reading", ["read-later"], "You are not lazy. The pile has no exit, so nothing can leave it…", 4],

  ["Attention is the rarest and purest form of generosity.", "https://example.com/quotes/attention", "quotes", ["quote"], "Simone Weil.", 200],
  ["A library is not a warehouse.", "https://example.com/quotes/library", "quotes", ["quote"], "On keeping things you will actually return to.", 150],
  ["The tool should disappear.", "https://example.com/quotes/tools", "quotes", ["quote"], "Good software gets out of the way and lets you get on with it.", 175],

  ["How to tune a guitar by ear", "https://www.youtube.com/watch?v=example1", "videos", ["music", "howto"], "A short walkthrough of relative tuning, no tuner required…", 11],
  ["The unreasonable effectiveness of SQLite", "https://www.youtube.com/watch?v=example2", "videos", ["databases"], "A conference talk on why the smallest database won…", 27],
  ["Restoring a 1980s typewriter", "https://vimeo.com/example3", "videos", ["restoration"], "Three hours, one seized carriage, and a great deal of patience…", 63],
  ["Why books have deckle edges", "https://www.youtube.com/watch?v=example4", "videos", ["books"], "A two-minute explanation of a detail most readers never notice…", 88],

  ["Sunrise over the ridge — 6:12am", "https://example.com/photos/ridge", "images", ["photography"], "Shot on a 35mm lens, handheld, no filter.", 22],
  ["Desk setup, autumn", "https://example.com/photos/desk", "images", ["desk", "photography"], "The ninth revision of a desk that keeps changing.", 7],
];

async function seedLibrary(Storage) {
  const urls = new Set();
  let written = 0;
  let featuredId = null;
  let searchableId = null;

  for (const [title, url, deckId, tags, body, daysAgo] of SEED) {
    if (urls.has(url)) continue;
    urls.add(url);
    const createdAt = NOW - daysAgo * DAY;
    const type =
      deckId === "videos" ? "video" : deckId === "images" ? "image" : deckId === "quotes" ? "quote" : "page";
    const item = await Storage.saveItem({
      type,
      title,
      url,
      sourceUrl: "",
      domain: new URL(url).hostname,
      deckId,
      tags,
      excerpt: body.slice(0, 180),
      note: deckId === "quotes" ? "— saved because it was worth keeping." : "",
      content: body,
      createdAt,
      updatedAt: createdAt,
    });
    written++;
    // The detail-view screenshot wants a rich item; the search screenshot wants
    // one whose text we can search for.
    if (!featuredId && deckId === "reading") featuredId = item.id;
    if (!searchableId && tags.includes("search")) searchableId = item.id;
  }

  // A couple of pins so the pinned view is not empty.
  const pins = await Storage.queryItems({ limit: 3 });
  for (const it of pins.items || []) await Storage.updateItem(it.id, { pinned: true });

  return { written, featuredId, searchableId };
}

// ---------------------------------------------------------------------------
// 2 · Inject the real markup, then boot the real UI
// ---------------------------------------------------------------------------

const params = new URLSearchParams(location.search);
const scene = params.get("scene") || "grid";

const status = document.getElementById("harness-status");
const say = (msg) => {
  if (status) status.textContent = msg;
};

(async function boot() {
  say("Seeding…");
  const { Storage } = await import("../../lib/storage.js");
  await Storage.init();
  const seeded = await seedLibrary(Storage);
  say(`Seeded ${seeded.written} items — loading the Library…`);

  // Scenes that library.js reads from the hash at startup must be set BEFORE
  // it is imported, because its boot sequence applies the hash once.
  if (scene === "detail" && seeded.featuredId) location.hash = "#item=" + seeded.featuredId;
  else if (scene === "import") location.hash = "#import=1";
  else if (scene === "settings") location.hash = "#settings=sync";

  // Real stylesheet.
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "../../library/library.css";
  document.head.appendChild(link);

  // Real markup, fetched rather than copied so it cannot drift.
  const html = await (await fetch("../../library/library.html")).text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  // Strip its <script>: we import the module ourselves, after the DOM exists.
  doc.body.querySelectorAll("script").forEach((s) => s.remove());
  document.body.innerHTML = doc.body.innerHTML;
  document.title = "Kipideck — screenshot harness (" + scene + ")";

  await import("../../library/library.js");
  say(`Ready — ${seeded.written} items, scene "${scene}".`);

  // Scenes that need a post-load interaction.
  if (scene === "search") {
    const input = document.getElementById("searchInput");
    if (input) {
      input.value = "search";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  } else if (scene === "export") {
    document.getElementById("exportBtn")?.click();
  } else if (scene === "import2") {
    document.getElementById("importBtn")?.click();
  }

  document.body.dataset.ready = "1";
})().catch((err) => {
  say("Harness failed: " + (err && err.message ? err.message : err));
  console.error(err);
});
