// lib/db.js — Kipideck's IndexedDB core.
//
// WHY THIS EXISTS
// Up to v1.3 the whole library lived in one `storage.local` key (`kipi_items`)
// and the search index was rebuilt from scratch on *every keystroke*. That was
// measured at ~2.2 s of frozen UI for a 10-char query at just 500 items and
// ~21 s at 5,000 items. This module replaces both halves with a design that is
// engineered for 50,000+ items:
//
//   • item METADATA and item CONTENT are stored separately, so listing,
//     counting and scoring never deserialize 20 KB of page text per item;
//   • a persistent INVERTED INDEX (term dictionary + chunked postings) is
//     updated incrementally on write, so a query reads a handful of small
//     records instead of the whole corpus;
//   • numeric item ids keep postings compact, and postings are chunked so a
//     single write never rewrites a multi-megabyte record;
//   • every query path is bounded (prefix expansion caps, resolution caps) so
//     a pathological query degrades instead of hanging.
//
// It is deliberately dependency-free and uses only the standard `indexedDB`
// global, so the same file runs in the MV3 service worker, the popup, the
// library page, Firefox's event page — and under `fake-indexeddb` in node for
// the test suite in `test/`.
//
// TRANSACTION RULE (important): inside `tx()` callbacks only await IndexedDB
// requests and pure computation. Awaiting a macrotask (fetch, setTimeout) lets
// the browser auto-commit the transaction mid-flight.

import { analyzeFields } from "./text.js";
import { canonicalUrl, fingerprint, isSafeWebUrl, isSafeImageUrl } from "./canon.js";

/**
 * The write-time URL gate (QA/security pass 2026-09-12).
 *
 * Every stored record eventually renders its url as a clickable <a href>, a
 * window.open, or a tabs.create — from an EXTENSION page, where an injected
 * `javascript:` URL would run with the extension's own permissions. Importers
 * already filter at parse time and importRecords gates on canonicalUrl, but a
 * hand-crafted JSON restore, a context-menu "Save link" on a fake link, or a
 * sync bucket written by another (older or compromised) client could still land
 * one in the database. This is the one place ALL writes pass through, so the
 * allow-list lives here: unsafe `url`/`sourceUrl` become "", unsafe `image`
 * becomes "". The record survives — its text, tags and searchability survive —
 * the executable payload does not.
 *
 * `favicon` is deliberately NOT filtered here: it only ever carries locally
 * generated data: URLs (lib/favicons.js), never a remote or clickable value.
 */
export function sanitizeUrls(item) {
  if (!item || typeof item !== "object") return item;
  const out = { ...item };
  if (out.url && !isSafeWebUrl(out.url)) out.url = "";
  if (out.sourceUrl && !isSafeWebUrl(out.sourceUrl)) out.sourceUrl = "";
  if (out.image && !isSafeImageUrl(out.image)) out.image = "";
  if (Array.isArray(out.tabs)) {
    // Sessions keep clickable links per tab; strip any that are not http(s).
    out.tabs = out.tabs.map((t) => (t && typeof t === "object" && t.url && !isSafeWebUrl(t.url) ? { ...t, url: "" } : t));
  }
  return out;
}
import { normalizeStatus, statusOf, isStatus, STATUSES } from "./status.js";

export const DB_NAME = "kipideck";
// v2 (1.6.0): per-item save-state (`status`) with its own indexes, so the
// Library can filter Unread → Reading → Done → Archived without scanning.
// The v1→v2 upgrade backfills `status: "unread"` onto every existing record.
export const DB_VERSION = 2;

export const S = {
  ITEMS: "items", // metadata only (never contains `content`)
  CONTENTS: "contents", // { id, text, wordCount, terms[] } — loaded lazily
  TERMS: "termdict", // { term, df } — small, prefix-scannable
  POSTINGS: "postings", // keyPath [term, chunk] → { term, chunk, p:number[] }
  IDMAP: "idmap", // { n, id } — dense numeric ids keep postings compact
  KV: "kv", // { k, v } — counters, schema version, index health
  FAVICONS: "favicons", // { domain, dataUrl, updatedAt } — local cache, no third parties
  DIRTY: "dirty", // { id, kind, rev } — delta-sync queue
};

/** Numeric ids per postings record. Bounds the read-modify-write cost of an
 * index update: a hot term spread across 50k items is ~100 small records
 * instead of one 5 MB record rewritten on every save. */
export const POSTING_CHUNK = 512;
/** Max terms indexed per item from the small fields (title/tags/excerpt/note/domain). */
export const SMALL_TERM_CAP = 200;
/** Max terms indexed per item from full page text — the main index-size lever. */
export const CONTENT_TERM_CAP = 250;
/** How many dictionary records one prefix may scan. */
export const PREFIX_SCAN_CAP = 400;
/** How many prefix expansions are actually scored per query term. */
export const PREFIX_TERM_LIMIT = 24;
/** Safety valve: max posting triples scored per query. */
export const MAX_POSTINGS_PER_QUERY = 400_000;
/** How many scored candidates get their metadata resolved per query. */
export const RESOLVE_CAP = 2000;
/** Items indexed per transaction during bulk import / reindex. */
export const BULK_BATCH = 150;

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

/** Save-state indexes (schema v2, ideas.md I-12). The compounds exist so a
 * filtered browse — "unread in Reading, newest first" — is one ranged index
 * walk with an exact native count, not a scan with an in-memory filter. A
 * ["tags","status",…] compound is impossible (multiEntry + sequence keyPath is
 * rejected), so tag+status views filter the tag's records in memory instead —
 * see listItems(). */
const STATUS_INDEX_DEFS = [
  ["status", "status"],
  ["byStatusCreated", ["status", "createdAt"]],
  ["byStatusTitle", ["status", "title"]],
  ["byDeckStatusCreated", ["deckId", "status", "createdAt"]],
  ["byDeckStatusTitle", ["deckId", "status", "title"]],
];

let dbPromise = null;

/** Open (or create/upgrade) the database. Memoized per JS context. */
export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const oldVersion = event?.oldVersion ?? 0;

      if (!db.objectStoreNames.contains(S.ITEMS)) {
        const items = db.createObjectStore(S.ITEMS, { keyPath: "id" });
        items.createIndex("createdAt", "createdAt");
        items.createIndex("updatedAt", "updatedAt");
        items.createIndex("title", "title");
        // Booleans are not valid IDB keys, so an index on `pinned` would
        // silently index nothing. `pf` is the numeric mirror (1 = pinned).
        items.createIndex("pf", "pf");
        // Duplicate detection ("you saved this 3 months ago — open it?").
        items.createIndex("canon", "canon");
        items.createIndex("fp", "fp");
        items.createIndex("deckId", "deckId");
        items.createIndex("byDeckCreated", ["deckId", "createdAt"]);
        items.createIndex("byDeckTitle", ["deckId", "title"]);
        // Tag lookups use this multiEntry index. A compound
        // ["tags","createdAt"] index is NOT allowed (the IndexedDB spec throws
        // InvalidAccessError for multiEntry + sequence keyPath), so tag views
        // sort in memory — see the note in listItems().
        items.createIndex("tags", "tags", { multiEntry: true });
        for (const [indexName, keyPath] of STATUS_INDEX_DEFS) items.createIndex(indexName, keyPath);
      }
      if (!db.objectStoreNames.contains(S.CONTENTS)) {
        db.createObjectStore(S.CONTENTS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(S.TERMS)) {
        db.createObjectStore(S.TERMS, { keyPath: "term" });
      }
      if (!db.objectStoreNames.contains(S.POSTINGS)) {
        db.createObjectStore(S.POSTINGS, { keyPath: ["term", "chunk"] });
      }
      if (!db.objectStoreNames.contains(S.IDMAP)) {
        const idmap = db.createObjectStore(S.IDMAP, { keyPath: "n" });
        idmap.createIndex("byId", "id", { unique: true });
      }
      if (!db.objectStoreNames.contains(S.KV)) {
        db.createObjectStore(S.KV, { keyPath: "k" });
      }
      if (!db.objectStoreNames.contains(S.FAVICONS)) {
        db.createObjectStore(S.FAVICONS, { keyPath: "domain" });
      }
      if (!db.objectStoreNames.contains(S.DIRTY)) {
        const dirty = db.createObjectStore(S.DIRTY, { keyPath: "id" });
        dirty.createIndex("rev", "rev");
      }

      // v1 → v2: add the save-state indexes to the existing store and backfill
      // every record that predates the field. Without the backfill, old records
      // (which have no `status` key at all) would be invisible to the status
      // index and silently vanish from filtered views and sidebar counts.
      if (oldVersion > 0 && oldVersion < 2) {
        const items = req.transaction.objectStore(S.ITEMS);
        for (const [indexName, keyPath] of STATUS_INDEX_DEFS) {
          if (!items.indexNames.contains(indexName)) items.createIndex(indexName, keyPath);
        }
        const cursorReq = items.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) return;
          const next = () => {
            try {
              cursor.continue();
            } catch {
              /* transaction finishing — nothing left to visit */
            }
          };
          const rec = cursor.value;
          // A straggler that fails to update still reads as unread through
          // statusOf(), so the upgrade can never strand a record.
          if (rec && !isStatus(rec.status)) {
            const updateReq = cursor.update({ ...rec, status: "unread" });
            updateReq.onsuccess = next;
            updateReq.onerror = next;
          } else {
            next();
          }
        };
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB upgrade blocked by another open tab"));
  });
  return dbPromise;
}

/** Drop the memoized connection (used by tests and by an upgrade-blocked retry).
 * Resolves once the connection is actually closed, so callers can delete or
 * re-open the database without hitting a blocked upgrade. */
export function closeDB() {
  const pending = dbPromise;
  dbPromise = null;
  idCache = null;
  filterCache = { gen: -1, key: "", value: null };
  if (!pending) return Promise.resolve();
  return pending.then((db) => db.close()).catch(() => {});
}

function reqP(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Run `fn(transaction)` inside a single IndexedDB transaction and resolve with
 * its return value when the transaction commits. */
export function tx(storeNames, mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(storeNames, mode);
        let out;
        let settled = false;
        t.oncomplete = () => {
          settled = true;
          writeGen++;
          resolve(out);
        };
        t.onerror = () => {
          if (!settled) reject(t.error);
        };
        t.onabort = () => {
          if (!settled) reject(t.error || new Error("IndexedDB transaction aborted"));
        };
        Promise.resolve()
          .then(() => fn(t))
          .then((r) => {
            out = r;
          })
          .catch((err) => {
            try {
              t.abort();
            } catch {
              /* already finished */
            }
            if (!settled) reject(err);
          });
      })
  );
}

/** Bumped after every committed write so in-context caches can invalidate. */
let writeGen = 0;
export const getWriteGen = () => writeGen;

const ALL_STORES = Object.values(S);

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const chunkOf = (n) => Math.floor(n / POSTING_CHUNK);

/** Postings arrays are flat `[numId, fieldMask, count, ...]` triples. */
function indexOfNum(p, n) {
  for (let i = 0; i < p.length; i += 3) if (p[i] === n) return i;
  return -1;
}

function upsertTriple(p, n, mask, count) {
  const i = indexOfNum(p, n);
  if (i === -1) return p.concat([n, mask, count]);
  const out = p.slice();
  out[i + 1] = mask;
  out[i + 2] = count;
  return out;
}

function removeTriple(p, n) {
  const i = indexOfNum(p, n);
  if (i === -1) return { p, removed: false };
  return { p: p.slice(0, i).concat(p.slice(i + 3)), removed: true };
}

// ---------------------------------------------------------------------------
// Numeric ids
// ---------------------------------------------------------------------------

async function ensureNum(t, id) {
  const existing = await reqP(t.objectStore(S.IDMAP).index("byId").get(id));
  if (existing) return existing.n;
  const counter = (await reqP(t.objectStore(S.KV).get("nextNum"))) || { k: "nextNum", v: 0 };
  const n = counter.v + 1;
  await reqP(t.objectStore(S.KV).put({ k: "nextNum", v: n }));
  await reqP(t.objectStore(S.IDMAP).put({ n, id }));
  idCache = null;
  return n;
}

let idCache = null; // { gen, numById: Map, idByNum: Map }

/** Both directions of the id map, loaded once per write-generation. */
async function loadIdMap() {
  if (idCache && idCache.gen === writeGen) return idCache;
  const rows = await reqP((await openDB()).transaction([S.IDMAP], "readonly").objectStore(S.IDMAP).getAll());
  const numById = new Map();
  const idByNum = new Map();
  for (const r of rows) {
    numById.set(r.id, r.n);
    idByNum.set(r.n, r.id);
  }
  idCache = { gen: writeGen, numById, idByNum };
  return idCache;
}

export async function numById(id) {
  const { numById } = await loadIdMap();
  return numById.get(id);
}

/** Positions are preserved (missing ids come back as `null`) because callers
 * zip this array against the numeric-id list they passed in — filtering here
 * would silently mis-align scores with the wrong items. */
export async function idsByNums(nums) {
  const { idByNum } = await loadIdMap();
  return nums.map((n) => idByNum.get(n) ?? null);
}

// ---------------------------------------------------------------------------
// Tag counters (the sidebar tag cloud must stay O(1) at 50k items)
// ---------------------------------------------------------------------------

async function adjustTagCounts(t, prevTags, nextTags) {
  const store = t.objectStore(S.KV);
  const rec = (await reqP(store.get("tagCounts"))) || { k: "tagCounts", v: {} };
  const counts = rec.v || {};
  const before = new Set((prevTags || []).map((x) => String(x).toLowerCase()));
  const after = new Set((nextTags || []).map((x) => String(x).toLowerCase()));
  let changed = false;
  for (const tag of before) {
    if (after.has(tag)) continue;
    counts[tag] = (counts[tag] || 0) - 1;
    if (counts[tag] <= 0) delete counts[tag];
    else changed = true;
    changed = true;
  }
  for (const tag of after) {
    if (before.has(tag)) continue;
    counts[tag] = (counts[tag] || 0) + 1;
    changed = true;
  }
  if (changed) await reqP(store.put({ k: "tagCounts", v: counts }));
}

export async function getTagCounts() {
  const rec = await reqP((await openDB()).transaction([S.KV], "readonly").objectStore(S.KV).get("tagCounts"));
  return rec?.v || {};
}

// ---------------------------------------------------------------------------
// Delta-sync queue
// ---------------------------------------------------------------------------

async function markDirtyIn(t, id, kind) {
  const counter = (await reqP(t.objectStore(S.KV).get("rev"))) || { k: "rev", v: 0 };
  const rev = counter.v + 1;
  await reqP(t.objectStore(S.KV).put({ k: "rev", v: rev }));
  await reqP(t.objectStore(S.DIRTY).put({ id, kind, rev, at: Date.now() }));
}

export async function markDirty(id, kind = "item") {
  return tx([S.DIRTY, S.KV], "readwrite", (t) => markDirtyIn(t, id, kind));
}

export async function getDirty() {
  return reqP((await openDB()).transaction([S.DIRTY], "readonly").objectStore(S.DIRTY).getAll());
}

export async function clearDirty(ids) {
  const set = new Set(ids);
  return tx([S.DIRTY], "readwrite", async (t) => {
    const store = t.objectStore(S.DIRTY);
    for (const id of set) await reqP(store.delete(id));
  });
}

export async function getRev() {
  const rec = await reqP((await openDB()).transaction([S.KV], "readonly").objectStore(S.KV).get("rev"));
  return rec?.v || 0;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getItemMeta(id) {
  return (await reqP((await openDB()).transaction([S.ITEMS], "readonly").objectStore(S.ITEMS).get(id))) || null;
}

export async function getItemMetas(ids) {
  if (!ids.length) return [];
  return tx([S.ITEMS], "readonly", async (t) => {
    const store = t.objectStore(S.ITEMS);
    const out = [];
    for (const id of ids) {
      const rec = await reqP(store.get(id));
      if (rec) out.push(rec);
    }
    return out;
  });
}

export async function getContent(id) {
  const rec = await reqP((await openDB()).transaction([S.CONTENTS], "readonly").objectStore(S.CONTENTS).get(id));
  return rec ? { text: rec.text || "", wordCount: rec.wordCount || 0 } : { text: "", wordCount: 0 };
}

export async function getContents(ids) {
  if (!ids.length) return new Map();
  return tx([S.CONTENTS], "readonly", async (t) => {
    const store = t.objectStore(S.CONTENTS);
    const out = new Map();
    for (const id of ids) {
      const rec = await reqP(store.get(id));
      if (rec) out.set(id, { text: rec.text || "", wordCount: rec.wordCount || 0 });
    }
    return out;
  });
}

export async function countItems() {
  return reqP((await openDB()).transaction([S.ITEMS], "readonly").objectStore(S.ITEMS).count());
}

export async function countByDeck(deckId) {
  return reqP(
    (await openDB()).transaction([S.ITEMS], "readonly").objectStore(S.ITEMS).index("deckId").count(deckId)
  );
}

export async function countPinned() {
  return reqP(
    (await openDB()).transaction([S.ITEMS], "readonly").objectStore(S.ITEMS).index("pf").count(1)
  );
}

/**
 * Sidebar numbers in one pass, computed with native `count()` queries so they
 * stay O(log n) at 50k items. Deliberately avoids `IDBIndex.getAllKeys()`,
 * whose return value (index keys vs primary keys) is implemented differently
 * across engines — a discrepancy that would silently corrupt the sidebar.
 */
export async function countsForDecks(deckIds = []) {
  const db = await openDB();
  const byDeck = {};
  const byStatus = {};
  let total = 0;
  let pinned = 0;
  await tx([S.ITEMS], "readonly", async (t) => {
    const store = t.objectStore(S.ITEMS);
    total = await reqP(store.count());
    pinned = await reqP(store.index("pf").count(1));
    for (const deckId of deckIds) {
      byDeck[deckId] = await reqP(store.index("deckId").count(deckId));
    }
    // Sidebar status chips: four native counts, still O(log n) at 50k items.
    for (const s of STATUSES) {
      byStatus[s] = await reqP(store.index("status").count(s));
    }
  });
  void db;
  return { total, pinned, byDeck, byStatus };
}

/** All metadata (no content). Heavy by design — used by export and by the
 * migration path, never by the per-keystroke UI. Prefer `listItems()`. */
export async function getAllItemMetas() {
  return reqP((await openDB()).transaction([S.ITEMS], "readonly").objectStore(S.ITEMS).getAll());
}

/**
 * Paginated browse without a text query — the path the Library grid uses when
 * the search box is empty. Uses compound indexes so a 50k-item deck pages in
 * milliseconds instead of deserializing everything.
 *
 * `excludeIds` lets the Library render pinned items first on page 0 and then
 * skip them on later pages without ever loading the full corpus.
 * @returns {Promise<{items: object[], total: number}>}
 */
export async function listItems({
  deckId = null,
  tag = null,
  pinned = false,
  status = null,
  sort = "new",
  limit = 60,
  offset = 0,
  excludeIds = null,
} = {}) {
  const byTitle = sort === "az";
  // An unrecognised status filters to nothing rather than to "unread": callers
  // pass user-typed filter values here, and silently reinterpreting garbage as
  // a real state would hide the library.
  const statusFilter = isStatus(status) ? String(status).toLowerCase() : null;
  const inStatus = (rec) => !statusFilter || statusOf(rec) === statusFilter;

  // The 📌 Pinned view is small by nature and has no useful compound index, so
  // it is fetched whole, sorted in memory, then paginated. Correct at any size
  // a human would actually pin, and it cannot silently mis-order a page.
  if (pinned && !tag && !deckId) {
    const db = await openDB();
    const all = await reqP(
      db.transaction([S.ITEMS], "readonly").objectStore(S.ITEMS).index("pf").getAll(IDBKeyRange.only(1))
    );
    const scoped = statusFilter ? all.filter(inStatus) : all;
    sortRecords(scoped, sort);
    return { items: scoped.slice(offset, offset + limit), total: scoped.length };
  }

  // Tag views have no usable compound index (see schema note), so the matching
  // metadata is collected and sorted in memory. Tags are human-applied and stay
  // small in practice; every other view is fully index-driven. A status filter
  // narrows the same in-memory list — the tag bounds the work, not the corpus.
  if (tag) {
    const db = await openDB();
    const matches = await reqP(
      db.transaction([S.ITEMS], "readonly").objectStore(S.ITEMS).index("tags").getAll(IDBKeyRange.only(tag))
    );
    const scoped = statusFilter ? matches.filter(inStatus) : matches;
    sortRecords(scoped, sort);
    const visible = excludeIds ? scoped.filter((r) => !excludeIds.has(r.id)) : scoped;
    return { items: visible.slice(offset, offset + limit), total: scoped.length };
  }

  return tx([S.ITEMS], "readonly", async (t) => {
    const store = t.objectStore(S.ITEMS);
    let source;
    let range = null;

    if (deckId && statusFilter) {
      source = store.index(byTitle ? "byDeckStatusTitle" : "byDeckStatusCreated");
      range = byTitle
        ? IDBKeyRange.bound([deckId, statusFilter, ""], [deckId, statusFilter, "\uffff"])
        : IDBKeyRange.bound([deckId, statusFilter, 0], [deckId, statusFilter, Number.MAX_SAFE_INTEGER]);
    } else if (deckId) {
      source = store.index(byTitle ? "byDeckTitle" : "byDeckCreated");
      range = byTitle
        ? IDBKeyRange.bound([deckId, ""], [deckId, "\uffff"])
        : IDBKeyRange.bound([deckId, 0], [deckId, Number.MAX_SAFE_INTEGER]);
    } else if (statusFilter) {
      source = store.index(byTitle ? "byStatusTitle" : "byStatusCreated");
      range = byTitle
        ? IDBKeyRange.bound([statusFilter, ""], [statusFilter, "\uffff"])
        : IDBKeyRange.bound([statusFilter, 0], [statusFilter, Number.MAX_SAFE_INTEGER]);
    } else if (byTitle) {
      source = store.index("title");
    } else {
      source = store.index("createdAt");
    }

    const dir = sort === "old" || byTitle ? "next" : "prev";
    const total = await reqP(source.count(range));
    const items = [];
    if (total === 0) return { items, total };

    let skipped = 0;
    let done = false;
    await new Promise((resolve, reject) => {
      const request = source.openCursor(range, dir);
      request.onsuccess = () => {
        if (done) return resolve();
        const cursor = request.result;
        if (!cursor || items.length >= limit) {
          done = true;
          return resolve();
        }
        if (skipped < offset) {
          const jump = Math.min(offset - skipped, limit);
          skipped += jump;
          done = true;
          try {
            cursor.advance(jump);
          } catch {
            return resolve();
          }
          done = false;
          return;
        }
        if (!(excludeIds && excludeIds.has(cursor.value.id))) items.push(cursor.value);
        try {
          cursor.continue();
        } catch {
          done = true;
          resolve();
        }
      };
      request.onerror = () => {
        done = true;
        reject(request.error);
      };
    });

    return { items, total };
  });
}

/**
 * Index-driven pagination over a SET of already-scored items.
 *
 * Search needs "the newest 60 of these 4,000 matches". Resolving 4,000 records
 * to find them measured ~10 s under fake-indexeddb (one `get` per id); walking
 * the relevant index and testing set membership instead is exact, ordered, and
 * costs only the records it actually looks at.
 *
 * @param {Set<number>} nums allowed numeric ids (already deck/tag-scoped)
 */
export async function listItemsMatching({ nums, sort = "new", deckId = null, tag = null, pinned = false, limit = 60, offset = 0 }) {
  if (!nums || nums.size === 0) return { items: [], total: 0 };
  const byTitle = sort === "az";

  // Tag scope has no compound index: collect the tag's records, keep the scored
  // ones, sort in memory. Bounded by how many items carry one tag.
  if (tag) {
    const db = await openDB();
    const matches = await reqP(
      db.transaction([S.ITEMS], "readonly").objectStore(S.ITEMS).index("tags").getAll(IDBKeyRange.only(tag))
    );
    const kept = matches.filter((r) => nums.has(r.n));
    sortRecords(kept, sort);
    return { items: kept.slice(offset, offset + limit), total: kept.length };
  }

  const total = nums.size;
  const items = [];
  await tx([S.ITEMS], "readonly", async (t) => {
    const store = t.objectStore(S.ITEMS);
    let source;
    let range = null;
    if (pinned) {
      source = store.index("pf");
      range = IDBKeyRange.only(1);
    } else if (deckId) {
      source = store.index(byTitle ? "byDeckTitle" : "byDeckCreated");
      range = byTitle
        ? IDBKeyRange.bound([deckId, ""], [deckId, "\uffff"])
        : IDBKeyRange.bound([deckId, 0], [deckId, Number.MAX_SAFE_INTEGER]);
    } else if (byTitle) {
      source = store.index("title");
    } else {
      source = store.index("createdAt");
    }
    const dir = sort === "old" || byTitle ? "next" : "prev";

    let matched = 0;
    let done = false;
    await new Promise((resolve, reject) => {
      const request = source.openCursor(range, dir);
      request.onsuccess = () => {
        if (done) return resolve();
        const cursor = request.result;
        if (!cursor || items.length >= limit) {
          done = true;
          return resolve();
        }
        if (nums.has(cursor.value.n)) {
          matched++;
          if (matched > offset) items.push(cursor.value);
        }
        try {
          cursor.continue();
        } catch {
          done = true;
          resolve();
        }
      };
      request.onerror = () => {
        done = true;
        reject(request.error);
      };
    });
  });
  return { items, total };
}

/** Fetch the (bounded) pinned subset of a filtered view so the grid can keep
 * floating pins to the top without loading every item. */
export async function pinnedInScope({ deckId = null, tag = null, status = null, sort = "new", cap = 200 } = {}) {
  const db = await openDB();
  const all = await reqP(
    db.transaction([S.ITEMS], "readonly").objectStore(S.ITEMS).index("pf").getAll(IDBKeyRange.only(1))
  );
  const statusFilter = isStatus(status) ? String(status).toLowerCase() : null;
  const scoped = all.filter(
    (r) =>
      (!deckId || r.deckId === deckId) &&
      (!tag || (r.tags || []).includes(tag)) &&
      (!statusFilter || statusOf(r) === statusFilter)
  );
  sortRecords(scoped, sort);
  return scoped.slice(0, cap);
}

function sortRecords(list, sort) {
  if (sort === "old") list.sort((a, b) => a.createdAt - b.createdAt);
  else if (sort === "az") list.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  else list.sort((a, b) => b.createdAt - a.createdAt);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function indexTerms(t, n, byTerm) {
  const terms = t.objectStore(S.TERMS);
  const postings = t.objectStore(S.POSTINGS);
  const chunk = chunkOf(n);
  for (const [term, info] of byTerm) {
    const key = [term, chunk];
    const rec = await reqP(postings.get(key));
    const existed = rec ? indexOfNum(rec.p, n) !== -1 : false;
    const p = rec ? upsertTriple(rec.p, n, info.mask, info.count) : [n, info.mask, info.count];
    await reqP(postings.put({ term, chunk, p }));
    if (!existed) {
      const dict = await reqP(terms.get(term));
      await reqP(terms.put({ term, df: (dict?.df || 0) + 1 }));
    }
  }
}

async function unindexTerms(t, n, termList) {
  if (!termList || !termList.length) return;
  const terms = t.objectStore(S.TERMS);
  const postings = t.objectStore(S.POSTINGS);
  const chunk = chunkOf(n);
  for (const term of termList) {
    const key = [term, chunk];
    const rec = await reqP(postings.get(key));
    if (!rec) continue;
    const { p, removed } = removeTriple(rec.p, n);
    if (!removed) continue;
    if (p.length === 0) await reqP(postings.delete(key));
    else await reqP(postings.put({ term, chunk, p }));
    const dict = await reqP(terms.get(term));
    if (dict) {
      const df = (dict.df || 1) - 1;
      if (df <= 0) await reqP(terms.delete(term));
      else await reqP(terms.put({ term, df }));
    }
  }
}

function analyze(item, text) {
  return analyzeFields(
    {
      title: item.title,
      tags: (item.tags || []).join(" "),
      excerpt: item.excerpt,
      note: item.note,
      domain: item.domain,
      content: text,
    },
    { small: SMALL_TERM_CAP, content: CONTENT_TERM_CAP }
  );
}

/**
 * Insert or update one item atomically: metadata, content, inverted index,
 * tag counters and the delta-sync queue all commit together or not at all.
 * `text` is the full page/selection text; it is NEVER stored on the metadata
 * record. Passing an item that already carries `content` also works (the
 * content is split out), which is what the v1 migration relies on.
 */
export async function writeItem(item, text) {
  return tx(
    [S.ITEMS, S.CONTENTS, S.TERMS, S.POSTINGS, S.IDMAP, S.KV, S.DIRTY],
    "readwrite",
    async (t) => {
      const items = t.objectStore(S.ITEMS);
      const contents = t.objectStore(S.CONTENTS);

      const prev = await reqP(items.get(item.id));
      const n = prev?.n ?? (await ensureNum(t, item.id));

      if (prev) {
        await unindexTerms(t, n, prev.idx);
        const prevContent = await reqP(contents.get(item.id));
        if (prevContent) await unindexTerms(t, n, prevContent.terms);
      }

  const { content, ...meta } = sanitizeUrls(item);
  const textValue = (text ?? content ?? "") || "";
  const analysis = analyze(meta, textValue);
  await indexTerms(t, n, analysis.byTerm);

      const record = {
        ...meta,
        n,
        idx: analysis.smallTerms,
        pinned: !!meta.pinned,
        status: normalizeStatus(meta.status),
        pf: meta.pinned ? 1 : 0,
        tags: meta.tags || [],
        canon: canonicalUrl(meta.url || meta.sourceUrl || ""),
        // NOTE: fingerprint needs the text, which has already been split off the
        // metadata record — passing `meta` alone would make every selection and
        // note fingerprint on its URL instead of its content.
        fp: fingerprint({ ...meta, content: textValue }),
      };
      await reqP(items.put(record));

      if (textValue) {
        await reqP(
          contents.put({
            id: item.id,
            text: textValue,
            wordCount: meta.wordCount || textValue.split(/\s+/).length,
            terms: analysis.contentTerms,
          })
        );
      } else {
        await reqP(contents.delete(item.id));
      }

      await adjustTagCounts(t, prev?.tags || [], record.tags);
      await markDirtyIn(t, item.id, "item");
      return record;
    }
  );
}

/** Delete one item: removes metadata, content, every index posting it owned,
 * tag counters, and records a `delete` in the sync queue. */
export async function removeItem(id) {
  return tx([S.ITEMS, S.CONTENTS, S.TERMS, S.POSTINGS, S.IDMAP, S.KV, S.DIRTY], "readwrite", async (t) => {
    const items = t.objectStore(S.ITEMS);
    const contents = t.objectStore(S.CONTENTS);
    const prev = await reqP(items.get(id));
    if (!prev) return false;
    const prevContent = await reqP(contents.get(id));
    await unindexTerms(t, prev.n, prev.idx);
    if (prevContent) await unindexTerms(t, prev.n, prevContent.terms);
    await reqP(items.delete(id));
    await reqP(contents.delete(id));
    await adjustTagCounts(t, prev.tags || [], []);
    await markDirtyIn(t, id, "delete");
    return true;
  });
}

/**
 * Bulk write used by import, migration and reindex. Postings are aggregated in
 * memory first so each touched record is written ONCE for the whole batch —
 * without this, importing 5,000 items would do ~2M read-modify-writes.
 */
export async function writeItemsBulk(entries) {
  let written = 0;
  for (let i = 0; i < entries.length; i += BULK_BATCH) {
    const batch = entries.slice(i, i + BULK_BATCH);
    await tx(
      [S.ITEMS, S.CONTENTS, S.TERMS, S.POSTINGS, S.IDMAP, S.KV, S.DIRTY],
      "readwrite",
      async (t) => {
        const items = t.objectStore(S.ITEMS);
        const contents = t.objectStore(S.CONTENTS);
        const terms = t.objectStore(S.TERMS);
        const postings = t.objectStore(S.POSTINGS);

        // Pass 1: assign ids, drop stale postings, analyze.
        const pending = [];
        for (const entry of batch) {
          const item = entry.item;
          const prev = await reqP(items.get(item.id));
          const n = prev?.n ?? (await ensureNum(t, item.id));
          if (prev) {
            await unindexTerms(t, n, prev.idx);
            const prevContent = await reqP(contents.get(item.id));
            if (prevContent) await unindexTerms(t, n, prevContent.terms);
          }
          const { content, ...meta } = sanitizeUrls(item);
          const textValue = (entry.text ?? content ?? "") || "";
          const analysis = analyze(meta, textValue);
          pending.push({ meta, n, analysis, textValue, prevTags: prev?.tags || [] });
        }

        // Pass 2: aggregate postings per [term, chunk].
        const buckets = new Map(); // "term\u0000chunk" → { term, chunk, p }
        const dfDelta = new Map(); // term → +n new items
        for (const { meta, n, analysis } of pending) {
          const chunk = chunkOf(n);
          for (const [term, info] of analysis.byTerm) {
            const key = term + "\u0000" + chunk;
            let bucket = buckets.get(key);
            if (!bucket) {
              const rec = await reqP(postings.get([term, chunk]));
              bucket = { term, chunk, p: rec ? rec.p.slice() : [], isNewRecord: !rec };
              buckets.set(key, bucket);
            }
            const existed = indexOfNum(bucket.p, n) !== -1;
            bucket.p = upsertTriple(bucket.p, n, info.mask, info.count);
            if (!existed) dfDelta.set(term, (dfDelta.get(term) || 0) + 1);
          }
        }

        // Pass 3: commit everything.
        for (const bucket of buckets.values()) {
          await reqP(postings.put({ term: bucket.term, chunk: bucket.chunk, p: bucket.p }));
        }
        for (const [term, delta] of dfDelta) {
          const dict = await reqP(terms.get(term));
          await reqP(terms.put({ term, df: (dict?.df || 0) + delta }));
        }
        for (const { meta, n, analysis, textValue, prevTags } of pending) {
          const record = {
            ...meta,
            n,
            idx: analysis.smallTerms,
            pinned: !!meta.pinned,
            pf: meta.pinned ? 1 : 0,
            tags: meta.tags || [],
            status: normalizeStatus(meta.status),
            canon: canonicalUrl(meta.url || meta.sourceUrl || ""),
            fp: fingerprint({ ...meta, content: textValue }),
          };
          await reqP(items.put(record));
          if (textValue) {
            await reqP(
              contents.put({
                id: meta.id,
                text: textValue,
                wordCount: meta.wordCount || textValue.split(/\s+/).length,
                terms: analysis.contentTerms,
              })
            );
          } else {
            await reqP(contents.delete(meta.id));
          }
          await adjustTagCounts(t, prevTags, record.tags);
          await markDirtyIn(t, meta.id, "item");
        }
        written += pending.length;
      }
    );
  }
  return written;
}

// ---------------------------------------------------------------------------
// Query primitives (used by lib/search.js)
// ---------------------------------------------------------------------------

/** Terms starting with `prefix`, highest document frequency first. */
export async function termsWithPrefix(prefix, { scanCap = PREFIX_SCAN_CAP, limit = PREFIX_TERM_LIMIT } = {}) {
  if (!prefix) return [];
  const range = IDBKeyRange.bound(prefix, prefix + "\uffff");
  const found = [];
  await tx([S.TERMS], "readonly", async (t) => {
    const store = t.objectStore(S.TERMS);
    await new Promise((resolve, reject) => {
      const request = store.openCursor(range);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || found.length >= scanCap) return resolve();
        found.push(cursor.value);
        try {
          cursor.continue();
        } catch {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  });
  found.sort((a, b) => b.df - a.df || (a.term < b.term ? -1 : 1));
  return found.slice(0, limit).map((r) => ({ term: r.term, df: r.df }));
}

/** Flat postings array for one exact term: `[numId, mask, count, ...]`. */
export async function postingsForTerm(term) {
  const range = IDBKeyRange.bound([term, 0], [term, Number.MAX_SAFE_INTEGER]);
  let out = [];
  await tx([S.POSTINGS], "readonly", async (t) => {
    const store = t.objectStore(S.POSTINGS);
    await new Promise((resolve, reject) => {
      const request = store.openCursor(range);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return resolve();
        out = out.concat(cursor.value.p);
        try {
          cursor.continue();
        } catch {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  });
  return out;
}

/** Numeric ids of everything matching a deck/tag/pinned filter — cached per
 * write-generation so typing in the search box never re-scans the corpus. */
let filterCache = { gen: -1, key: "", value: null };
export async function filterNums({ deckId = null, tag = null, pinned = false, status = null } = {}) {
  const statusFilter = isStatus(status) ? String(status).toLowerCase() : null;
  if (!deckId && !tag && !pinned && !statusFilter) return null; // null == "no filter"
  const key = `${deckId || ""}|${tag || ""}|${pinned ? 1 : 0}|${statusFilter || ""}`;
  if (filterCache.gen === writeGen && filterCache.key === key) return filterCache.value;

  // One `getAll` on the index rather than a cursor: a cursor costs one round
  // trip per record, which measured ~10 s for a 4,000-item deck, while a single
  // ranged getAll is one request. The result is cached per write-generation, so
  // typing in the search box never pays it twice.
  const db = await openDB();
  const store = db.transaction([S.ITEMS], "readonly").objectStore(S.ITEMS);
  const numsOf = (rows) => {
    const out = new Set();
    for (const row of rows) if (typeof row?.n === "number") out.add(row.n);
    return out;
  };

  let set = null;
  if (tag || deckId || pinned) {
    let source = store;
    let range = null;
    if (tag) {
      source = store.index("tags");
      range = IDBKeyRange.only(tag);
    } else if (deckId) {
      source = store.index("deckId");
      range = IDBKeyRange.only(deckId);
    } else if (pinned) {
      source = store.index("pf");
      range = IDBKeyRange.only(1);
    }
    set = numsOf(await reqP(source.getAll(range)));
  }

  // A status scope intersects the base scope: "unread in Reading" is the set
  // both include. The status side comes from the v2 index, so no scan.
  if (statusFilter) {
    const statusSet = numsOf(await reqP(store.index("status").getAll(IDBKeyRange.only(statusFilter))));
    set = set ? new Set([...set].filter((n) => statusSet.has(n))) : statusSet;
  }

  filterCache = { gen: writeGen, key, value: set };
  return set;
}

/** Rebuild the whole inverted index from stored items + contents. Needed after
 * a migration, after changing the term caps, or to recover from any
 * inconsistency. Runs in batches so the service worker is never blocked long. */
export async function reindexAll({ onProgress } = {}) {
  const metas = await getAllItemMetas();
  await tx([S.TERMS, S.POSTINGS], "readwrite", async (t) => {
    await reqP(t.objectStore(S.TERMS).clear());
    await reqP(t.objectStore(S.POSTINGS).clear());
  });

  for (let i = 0; i < metas.length; i += BULK_BATCH) {
    const batch = metas.slice(i, i + BULK_BATCH);
    const contentMap = await getContents(batch.map((m) => m.id));
    const entries = batch.map((meta) => {
      const { idx, ...clean } = meta; // idx is regenerated by the indexer
      return { item: clean, text: contentMap.get(meta.id)?.text || "" };
    });
    await writeItemsBulk(entries);
    if (onProgress) onProgress(Math.min(i + BULK_BATCH, metas.length), metas.length);
  }
  await kvSet("lastReindex", Date.now());
  return metas.length;
}

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

/**
 * Look up an item that is "the same save" as the one about to be written:
 * same canonical URL (tracking params, hash and trailing slash ignored), or for
 * text captures the same source + same text. Returns the newest match, or null.
 */
export async function findDuplicate({ url, sourceUrl, title, content, type }, { excludeId = null, withinMs = 0 } = {}) {
  const fp = fingerprint({ url, sourceUrl, title, content, type });
  if (!fp) return null;
  const db = await openDB();
  const matches = await reqP(
    db.transaction([S.ITEMS], "readonly").objectStore(S.ITEMS).index("fp").getAll(IDBKeyRange.only(fp))
  );
  const candidates = matches
    .filter((m) => m.id !== excludeId)
    .filter((m) => !withinMs || Date.now() - (m.createdAt || 0) <= withinMs)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return candidates[0] || null;
}

/** How many times this URL is already in the library — used for the
 * "saved 3 times" nudge. */
export async function countCanonical(url) {
  const canon = canonicalUrl(url);
  if (!canon) return 0;
  const db = await openDB();
  return reqP(
    db.transaction([S.ITEMS], "readonly").objectStore(S.ITEMS).index("canon").count(IDBKeyRange.only(canon))
  );
}

// ---------------------------------------------------------------------------
// KV, favicons, diagnostics
// ---------------------------------------------------------------------------

export async function kvGet(k, fallback = null) {
  const rec = await reqP((await openDB()).transaction([S.KV], "readonly").objectStore(S.KV).get(k));
  return rec ? rec.v : fallback;
}

export async function kvSet(k, v) {
  return tx([S.KV], "readwrite", (t) => reqP(t.objectStore(S.KV).put({ k, v })));
}

export async function getFavicon(domain) {
  const rec = await reqP(
    (await openDB()).transaction([S.FAVICONS], "readonly").objectStore(S.FAVICONS).get(domain)
  );
  return rec?.dataUrl || null;
}

export async function getAllFavicons() {
  const db = await openDB();
  return reqP(db.transaction([S.FAVICONS], "readonly").objectStore(S.FAVICONS).getAll());
}

export async function putFavicon(domain, dataUrl) {
  if (!domain || !dataUrl) return;
  return tx([S.FAVICONS], "readwrite", (t) =>
    reqP(t.objectStore(S.FAVICONS).put({ domain, dataUrl, updatedAt: Date.now() }))
  );
}

/** Everything the Settings → Diagnostics row shows, plus what support needs. */
export async function getStats() {
  const counts = await tx([S.ITEMS, S.TERMS, S.POSTINGS, S.CONTENTS, S.DIRTY], "readonly", async (t) => ({
    items: await reqP(t.objectStore(S.ITEMS).count()),
    contents: await reqP(t.objectStore(S.CONTENTS).count()),
    terms: await reqP(t.objectStore(S.TERMS).count()),
    postings: await reqP(t.objectStore(S.POSTINGS).count()),
    dirty: await reqP(t.objectStore(S.DIRTY).count()),
  }));
  const estimate = await kvGet("indexBytesEstimate", null);
  return { ...counts, lastReindex: await kvGet("lastReindex", null), estimate };
}

/** Nuke everything (Library → Settings → "Delete all items & reset decks"). */
export async function clearAllData() {
  return tx(ALL_STORES, "readwrite", async (t) => {
    for (const name of ALL_STORES) await reqP(t.objectStore(name).clear());
    idCache = null;
    filterCache = { gen: -1, key: "", value: null };
  });
}

export const DbStores = S;
