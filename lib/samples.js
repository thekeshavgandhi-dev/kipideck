// lib/samples.js — the sample items the first-run page can seed.
//
// ideas.md I-03: an empty library gives a new user nothing to look at, so the
// deck sidebar, search, pins and the detail view all feel broken on day one.
// Three deliberately chosen items make the Library demo itself:
//
//   • an article WITH stored page text, so full-text search has something to hit
//   • a docs link in a different deck, so deck filtering is visible
//   • a pinned quote, so pins and the detail view are visible
//
// Every sample carries the `sample` tag. That is the whole mechanism: it makes
// them findable as one group and removable as one group. A sample you cannot
// delete is not a sample, it is litter — so `removeSamples()` is a first-class
// function, not an afterthought.
//
// Two rules this module must never break:
//
//   1. Seeding is idempotent. Running it twice adds nothing, for the same
//      reason an import run twice adds nothing: matching is on the canonical
//      URL.
//   2. Seeding is an EXPLICIT user action. It never happens automatically on
//      install, and it never flips `onboardingDone` — the disclosure gate in
//      lib/policy.js is untouched by anything here.

import { Storage } from "./storage.js";
import { canonicalUrl } from "./canon.js";

/** The tag every seeded item carries, and the tag `removeSamples` deletes by. */
export const SAMPLE_TAG = "sample";

export const SAMPLE_ITEMS = [
  {
    type: "page",
    title: "The Case for Local-First Software",
    url: "https://www.inkandswitch.com/local-first/",
    domain: "inkandswitch.com",
    deckId: "reading",
    tags: [SAMPLE_TAG, "local-first"],
    excerpt:
      "Why software that keeps your data on your own device is more durable than software that keeps it in someone else's cloud.",
    note: "A sample item — delete it whenever you like.",
    content:
      "Local-first software is a set of principles for software that enables both collaboration and ownership for users. Data is stored on the user's own device, available offline, and the network is an optional enhancement rather than a requirement. The practical consequence is durability: a service can be switched off, but a file on your own disk cannot be taken away by someone else's business decision. This article is stored as a sample item so you can try searching inside a saved page rather than only by its title.",
  },
  {
    type: "link",
    title: "MDN — IndexedDB API",
    url: "https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API",
    domain: "developer.mozilla.org",
    deckId: "dev",
    tags: [SAMPLE_TAG, "reference"],
    excerpt:
      "IndexedDB is a low-level API for client-side storage of significant amounts of structured data.",
    note: "A sample item in a second deck, so you can see deck filtering work.",
    content: "",
  },
  {
    type: "quote",
    title: "Attention is the rarest and purest form of generosity.",
    url: "https://example.com/quotes/attention",
    domain: "example.com",
    deckId: "quotes",
    tags: [SAMPLE_TAG],
    pinned: true,
    excerpt: "Simone Weil, on attention.",
    note: "A pinned sample, so you can see what a saved quote looks like.",
    content:
      "Attention is the rarest and purest form of generosity. — Simone Weil. Saved as a sample item so the pinned view and the quote deck are not empty on your first visit.",
  },
];

/**
 * Add any sample that is not already in the library.
 * Idempotent: matched on the canonical URL, so a second call adds nothing.
 *
 * @returns {Promise<{added:number, skipped:number, total:number}>}
 */
export async function seedSamples() {
  await Storage.init();
  const existing = new Set();
  for (const item of SAMPLE_ITEMS) {
    const canon = canonicalUrl(item.url);
    if (canon && (await Storage.countCanonical(item.url)) > 0) existing.add(canon);
  }

  let added = 0;
  let skipped = 0;
  for (const item of SAMPLE_ITEMS) {
    const canon = canonicalUrl(item.url);
    if (canon && existing.has(canon)) {
      skipped++;
      continue;
    }
    await Storage.saveItem({ ...item });
    added++;
  }
  return { added, skipped, total: SAMPLE_ITEMS.length };
}

/** How many sample items are currently in the library. */
export async function countSamples() {
  await Storage.init();
  const res = await Storage.queryItems({ tag: SAMPLE_TAG, limit: 0 });
  return res?.total ?? 0;
}

/**
 * Delete every sample item. Uses the same tombstone-recording delete path as
 * the Library, so removing samples also survives a later import or sync.
 *
 * @returns {Promise<number>} how many were deleted
 */
export async function removeSamples() {
  await Storage.init();
  const res = await Storage.queryItems({ tag: SAMPLE_TAG, limit: 0 });
  const total = res?.total ?? 0;
  if (!total) return 0;

  // Walk in pages rather than trusting one unbounded read.
  const ids = [];
  const PAGE = 200;
  for (let offset = 0; offset < total; offset += PAGE) {
    const page = await Storage.queryItems({ tag: SAMPLE_TAG, limit: PAGE, offset });
    for (const it of page?.items || []) ids.push(it.id);
  }
  if (!ids.length) return 0;
  await Storage.deleteMany(ids);
  return ids.length;
}
