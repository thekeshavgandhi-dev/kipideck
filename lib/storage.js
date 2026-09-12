// lib/storage.js — Kipideck's data layer.
//
// Everything is LOCAL FIRST and there is no Kipideck server anywhere in this
// project: small configuration (decks, settings, deletion tombstones) lives in
// `browser.storage.local`, and the library itself — item metadata, full page
// text, and the search index — lives in IndexedDB via lib/db.js. Optional
// cross-device sync rides on the user's OWN Google Drive app-data folder
// (lib/drive-sync.js); turning it off changes nothing about saving.
//
// Item metadata and item content are stored separately on purpose: the Library
// grid, the sidebar counts and search scoring never need 20 KB of page text per
// item, which is what makes a 50,000-item library feel instant.

import { ext } from "./compat.js";
import * as db from "./db.js";
import { canonicalUrl, hostOf } from "./canon.js";
import { normalizeStatus, isStatus } from "./status.js";
import {
  bookmarkHtmlHead,
  bookmarkHtmlFoot,
  bookmarkFolderOpen,
  bookmarkFolderClose,
  bookmarkHtmlForItem,
  markdownHead,
  markdownDeckHeading,
  markdownForItem,
} from "./exporters.js";

const KEYS = {
  DECKS: "kipi_decks",
  SETTINGS: "kipi_settings",
  TOMBSTONES: "kipi_tombstones",
  // Legacy v1 keys, kept only so the one-time migration can find and preserve
  // them. Nothing reads these on a normal run any more.
  LEGACY_ITEMS: "kipi_items",
  MIGRATION: "kipi_migration_v2",
  LEGACY_BACKUP: "kipi_items_v1_backup",
};

const DEFAULT_DECKS = [
  { id: "reading", name: "Reading", icon: "📖", color: "#7C5CFC", smart: true, builtin: true },
  { id: "images", name: "Images", icon: "🖼️", color: "#2FB6D8", smart: true, builtin: true },
  { id: "videos", name: "Videos", icon: "🎬", color: "#E8546B", smart: true, builtin: true },
  { id: "quotes", name: "Quotes & Notes", icon: "✍️", color: "#F5A623", smart: true, builtin: true },
  { id: "shopping", name: "Shopping", icon: "🛍️", color: "#2FD87F", smart: true, builtin: true },
  { id: "dev", name: "Dev & Docs", icon: "💻", color: "#5C6BFC", smart: true, builtin: true },
  { id: "research", name: "Research", icon: "🔬", color: "#9B59B6", smart: true, builtin: true },
  { id: "links", name: "Links", icon: "🔗", color: "#8895A7", smart: true, builtin: true },
  { id: "inbox", name: "Inbox", icon: "📥", color: "#6B7280", smart: true, builtin: true },
];

const DEFAULT_SETTINGS = {
  autoOrganize: true,
  showToast: true,
  // Highlighting text on a page auto-saves the selection (with the page as
  // reference). ON by default, but only AFTER the first-run disclosure has been
  // accepted — see `onboardingDone` below and onboarding/onboarding.js.
  autoSaveSelection: true,
  // Legacy pre-1.3 key for the same behaviour — content.js falls back to it
  // for installs that saved settings before autoSaveSelection existed.
  showFloatingButton: true,
  // Space→K quick-save. Off on sites where Space/K are real shortcuts
  // (YouTube, Gmail, most video players) — see SHORTCUT_BLOCKED_HOSTS.
  spaceKQuickSave: true,
  theme: "system",
  // Set once the user has seen the first-run page. Auto-capture stays off until
  // then so nothing is ever collected before it has been disclosed.
  onboardingDone: false,
};

/** Sites where Space and/or K are meaningful in-page shortcuts, so the global
 * Space→K quick-save would cause surprise saves. */
export const SHORTCUT_BLOCKED_HOSTS = [
  // Video players: Space is play/pause.
  "youtube.com",
  "netflix.com",
  "primevideo.com",
  "hotstar.com",
  "vimeo.com",
  "twitch.tv",
  "dailymotion.com",
  "disneyplus.com",
  // Audio players: Space is play/pause too.
  "open.spotify.com",
  "soundcloud.com",
  "music.amazon.com",
  // Google apps where Space and single letters are real shortcuts.
  "mail.google.com",
  "docs.google.com",
  "drive.google.com",
  "meet.google.com",
  "keep.google.com",
  "calendar.google.com",
  "spotlight.google",
];

function uid() {
  return "k_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
}

async function getAll(key, fallback) {
  const res = await ext.storage.local.get(key);
  if (res && Object.prototype.hasOwnProperty.call(res, key)) return res[key];
  return fallback;
}

async function setAll(key, value) {
  await ext.storage.local.set({ [key]: value });
  return value;
}

// ---------------------------------------------------------------------------
// Migration from the v1 single-key layout
// ---------------------------------------------------------------------------

/**
 * One-time move of `kipi_items` (a single storage.local array holding metadata
 * AND full page text for every item) into IndexedDB. The old array is renamed
 * to a backup key rather than deleted — a migration that can destroy data is
 * exactly what Kipideck promises it will never do.
 */
async function migrateFromV1() {
  const done = await getAll(KEYS.MIGRATION, null);
  if (done?.ok) return done;

  const legacy = await getAll(KEYS.LEGACY_ITEMS, null);
  if (!Array.isArray(legacy) || legacy.length === 0) {
    const marker = { ok: true, at: Date.now(), migrated: 0, note: "nothing to migrate" };
    await setAll(KEYS.MIGRATION, marker);
    return marker;
  }

  const entries = legacy.map((item) => ({ item, text: item.content || "" }));
  const migrated = await db.writeItemsBulk(entries);

  await ext.storage.local.remove(KEYS.LEGACY_ITEMS);
  await setAll(KEYS.LEGACY_BACKUP, legacy);
  const marker = { ok: true, at: Date.now(), migrated, source: "kipi_items" };
  await setAll(KEYS.MIGRATION, marker);
  return marker;
}

// ---------------------------------------------------------------------------
// Record-level merge (shared by import and sync)
// ---------------------------------------------------------------------------

/**
 * Three-way, per-record merge: newer `updatedAt` wins, and deletions recorded
 * in tombstones are respected so a delete on one device is not silently undone
 * by an older copy arriving from another. Used by BOTH the JSON importer and
 * the Drive sync, so "restore a backup" and "sync from another browser" behave
 * identically.
 */
export function mergeRecords(localList, remoteList, localTombstones = [], remoteTombstones = []) {
  const tombstones = new Map();
  for (const t of [...(localTombstones || []), ...(remoteTombstones || [])]) {
    const prev = tombstones.get(t.id);
    if (!prev || (t.deletedAt || 0) > (prev.deletedAt || 0)) tombstones.set(t.id, t);
  }

  const byId = new Map();
  for (const rec of localList || []) byId.set(rec.id, rec);
  for (const rec of remoteList || []) {
    const existing = byId.get(rec.id);
    if (!existing || (rec.updatedAt || 0) > (existing.updatedAt || 0)) byId.set(rec.id, rec);
  }
  for (const [id, tomb] of tombstones) {
    const rec = byId.get(id);
    if (rec && (tomb.deletedAt || 0) >= (rec.updatedAt || 0)) byId.delete(id);
  }
  return { merged: [...byId.values()], tombstones: [...tombstones.values()] };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const Storage = {
  KEYS,
  DEFAULT_DECKS,
  DEFAULT_SETTINGS,
  uid,
  mergeRecords,

  async init() {
    const decks = await getAll(KEYS.DECKS, null);
    if (!decks) await setAll(KEYS.DECKS, DEFAULT_DECKS);
    const settings = await getAll(KEYS.SETTINGS, null);
    if (!settings) await setAll(KEYS.SETTINGS, DEFAULT_SETTINGS);
    await getAll(KEYS.TOMBSTONES, null).then((t) => {
      if (!t) return setAll(KEYS.TOMBSTONES, []);
    });
    await db.openDB();
    const migration = await migrateFromV1();
    await db.kvSet("indexReady", true);
    return migration;
  },

  // ---- settings -----------------------------------------------------------
  async getSettings() {
    return getAll(KEYS.SETTINGS, DEFAULT_SETTINGS);
  },

  async updateSettings(patch) {
    const cur = await this.getSettings();
    const next = { ...cur, ...patch };
    await setAll(KEYS.SETTINGS, next);
    return next;
  },

  /** True when the Space→K quick-save should fire on this host. */
  quickSaveAllowedOn(host) {
    // Fail closed: an unknown or blank host is not a host we have decided is
    // safe to grab a keystroke on.
    const h = String(host || "").trim().toLowerCase().replace(/^www\./, "");
    if (!h) return false;
    return !SHORTCUT_BLOCKED_HOSTS.some((blocked) => h === blocked || h.endsWith("." + blocked));
  },

  // ---- decks --------------------------------------------------------------
  async getDecks() {
    return getAll(KEYS.DECKS, DEFAULT_DECKS);
  },

  async addDeck(name, icon = "🗂️", color = "#7C5CFC") {
    const decks = await this.getDecks();
    const deck = { id: uid(), name, icon, color, smart: false, builtin: false, updatedAt: Date.now() };
    decks.push(deck);
    await setAll(KEYS.DECKS, decks);
    return deck;
  },

  async renameDeck(id, name) {
    const decks = await this.getDecks();
    const d = decks.find((x) => x.id === id);
    if (d) {
      d.name = name;
      d.updatedAt = Date.now();
    }
    await setAll(KEYS.DECKS, decks);
    return d;
  },

  async deleteDeck(id) {
    let decks = await this.getDecks();
    decks = decks.filter((d) => d.id !== id);
    await setAll(KEYS.DECKS, decks);
    // Move orphaned items to Inbox rather than leaving them pointing at a deck
    // that no longer exists.
    const { items } = await db.listItems({ deckId: id, limit: Number.MAX_SAFE_INTEGER });
    for (const it of items) await db.writeItem({ ...it, deckId: "inbox", updatedAt: Date.now() }, undefined);
  },

  // ---- items --------------------------------------------------------------
  async getItems() {
    return db.getAllItemMetas();
  },

  async getItem(id) {
    return db.getItemMeta(id);
  },

  /** Full saved text for one item — fetched only for the card/detail on screen. */
  async getItemContent(id) {
    return db.getContent(id);
  },

  /** Batch fetch of saved text for the cards actually rendered, so search
   * snippets do not need a round trip per card. */
  async getContentsFor(ids) {
    return db.getContents(ids);
  },

  /** Paginated browse for the Library grid (no text query). */
  async queryItems(opts) {
    return db.listItems(opts);
  },

  async pinnedInScope(opts) {
    return db.pinnedInScope(opts);
  },

  /** Sidebar numbers without touching the corpus — native counts per deck. */
  async getCounts() {
    const decks = await this.getDecks();
    return db.countsForDecks(decks.map((d) => d.id));
  },

  async getTagCounts() {
    return db.getTagCounts();
  },

  async saveItem(item) {
    const now = Date.now();
    const full = {
      id: uid(),
      type: "page",
      title: "",
      url: "",
      sourceUrl: "",
      domain: "",
      favicon: "",
      image: "",
      excerpt: "",
      note: "",
      tags: [],
      deckId: "inbox",
      status: "unread",
      reference: "",
      createdAt: now,
      updatedAt: now,
      pinned: false,
      ...item,
    };
    // A caller passing garbage (or a future status we retired) must not
    // create a record no filter can ever match.
    full.status = normalizeStatus(full.status);
    const { content, ...meta } = full;
    const record = await db.writeItem(meta, content || "");
    return record;
  },

  async updateItem(id, patch) {
    const existing = await db.getItemMeta(id);
    if (!existing) return null;
    const { content, idx, n, ...rest } = patch;
    const next = { ...existing, ...rest, id, updatedAt: Date.now() };
    let text;
    if (typeof content === "string") text = content;
    else text = (await db.getContent(id)).text;
    const record = await db.writeItem(next, text);
    return record;
  },

  async deleteItem(id) {
    const [meta] = await db.getItemMetas([id]);
    const ok = await db.removeItem(id);
    if (ok) await this._recordTombstones([{ id, canon: meta?.canon }]);
    return ok;
  },

  async deleteMany(ids) {
    const list = [...(ids || [])];
    const canonById = new Map((list.length ? await db.getItemMetas(list) : []).map((m) => [m.id, m.canon]));
    for (const id of list) await db.removeItem(id);
    await this._recordTombstones(list.map((id) => ({ id, canon: canonById.get(id) })));
    return list.length;
  },

  /**
   * Deletion tombstones: id + canonical URL + deletedAt, so sync AND import can
   * tell "deleted here" apart from "never seen here".
   *
   * The canon matters for imports specifically. An imported file carries none of
   * our ids, so an id-only tombstone cannot recognise a link the user already
   * deleted — re-importing a Pocket export would quietly resurrect every article
   * they had thrown away. (A tombstone that arrives from another device still
   * only has an id; that is fine, because the item it refers to also arrived
   * with that id.)
   */
  async _recordTombstones(entries) {
    const tombstones = await getAll(KEYS.TOMBSTONES, []);
    const now = Date.now();
    for (const entry of entries) {
      const id = typeof entry === "string" ? entry : entry?.id;
      if (!id) continue;
      const canon = typeof entry === "object" ? entry?.canon || "" : "";
      tombstones.push(canon ? { id, canon, deletedAt: now } : { id, deletedAt: now });
    }
    // Cap the list: at 50k items an unbounded tombstone array becomes the next
    // scaling wall. Deleted ids older than a year can no longer resurrect.
    const cutoff = now - 365 * 24 * 60 * 60 * 1000;
    const trimmed = tombstones.filter((t) => (t.deletedAt || 0) > cutoff);
    await setAll(KEYS.TOMBSTONES, trimmed);
  },

  async getTombstones() {
    return getAll(KEYS.TOMBSTONES, []);
  },

  // ---- duplicate detection -------------------------------------------------
  /** The item this capture would duplicate, or null. Powers the
   * "already in your Kipideck — open it?" prompt instead of silently piling up
   * near-identical cards. */
  async findDuplicate(candidate, opts) {
    return db.findDuplicate(candidate, opts);
  },

  async countCanonical(url) {
    return db.countCanonical(url);
  },

  // ---- export / import ----------------------------------------------------

  /**
   * Export as a list of string chunks so a 50,000-item library can be written
   * to a Blob without ever building one 400 MB string in memory. The caller
   * does `new Blob(parts, { type: "application/json" })`.
   */
  async exportChunks({ withContent = true, batchSize = 200, onProgress } = {}) {
    const [decks, settings, tombstones] = await Promise.all([
      this.getDecks(),
      this.getSettings(),
      this.getTombstones(),
    ]);
    const metas = await db.getAllItemMetas();
    metas.sort((a, b) => a.createdAt - b.createdAt);

    const parts = [
      JSON.stringify(
        {
          version: 2,
          app: "kipideck",
          exportedAt: new Date().toISOString(),
          counts: { items: metas.length, decks: decks.length },
          decks,
          settings,
          tombstones,
        }
      ).replace(/}$/, ","),
      '"items":[',
    ];

    for (let i = 0; i < metas.length; i += batchSize) {
      const batch = metas.slice(i, i + batchSize);
      const contents = withContent ? await db.getContents(batch.map((m) => m.id)) : new Map();
      const json = batch
        .map((m) => {
          const { idx, n, ...clean } = m;
          const text = contents.get(m.id)?.text || "";
          return JSON.stringify(text ? { ...clean, content: text } : clean);
        })
        .join(",");
      parts.push((i > 0 ? "," : "") + json);
      if (onProgress) onProgress(Math.min(i + batchSize, metas.length), metas.length);
    }

    parts.push("]}");
    return parts;
  },

  /** Convenience wrapper for small libraries and tests. */
  async exportJSON(opts) {
    return (await this.exportChunks(opts)).join("");
  },

  /**
   * Group the library by deck, in sidebar order, so both non-JSON exports can
   * stream one folder at a time. Unknown deck ids sort last rather than being
   * dropped — losing items on export is the one thing this file must never do.
   */
  async _groupedByDeck() {
    const decks = await this.getDecks();
    const metas = await db.getAllItemMetas();
    metas.sort((a, b) => a.createdAt - b.createdAt);
    const byId = new Map(decks.map((d) => [d.id, d]));
    const groups = new Map();
    for (const m of metas) {
      const key = m.deckId || "inbox";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    }
    const ordered = [
      ...decks.filter((d) => groups.has(d.id)).map((d) => [d, groups.get(d.id)]),
      ...[...groups.keys()].filter((k) => !byId.has(k)).map((k) => [{ id: k, name: k }, groups.get(k)]),
    ];
    return { decks, metas, ordered };
  },

  /**
   * Netscape bookmark HTML — the shutdown-proof format. Every browser and most
   * read-later apps still import it, so a user can leave Kipideck tomorrow and
   * keep their links, titles, save dates, folders and tags. Page text cannot be
   * represented in the format, which is why the JSON export stays the default.
   */
  async exportBookmarkHtml({ batchSize = 500, onProgress } = {}) {
    const { ordered, metas } = await this._groupedByDeck();
    const parts = [bookmarkHtmlHead()];
    let done = 0;
    for (const [deck, list] of ordered) {
      parts.push(bookmarkFolderOpen(deck));
      for (let i = 0; i < list.length; i += batchSize) {
        const batch = list.slice(i, i + batchSize);
        for (const item of batch) parts.push(bookmarkHtmlForItem(item, { indent: "        " }));
        done += batch.length;
        if (onProgress) onProgress(done, metas.length);
      }
      parts.push(bookmarkFolderClose());
    }
    parts.push(bookmarkHtmlFoot());
    return parts;
  },

  /**
   * Markdown — the library as notes a human can read without any app at all.
   * `withContent` embeds full page text inside <details> blocks, which makes the
   * file enormous at 50k items, so it stays opt-in.
   */
  async exportMarkdown({ withContent = false, batchSize = 100, onProgress } = {}) {
    const { ordered, metas } = await this._groupedByDeck();
    const parts = [markdownHead({ count: metas.length, includeContent: withContent })];
    let done = 0;
    for (const [deck, list] of ordered) {
      parts.push(markdownDeckHeading(deck));
      for (let i = 0; i < list.length; i += batchSize) {
        const batch = list.slice(i, i + batchSize);
        const contents = withContent ? await db.getContents(batch.map((m) => m.id)) : new Map();
        for (const item of batch) {
          const text = withContent ? contents.get(item.id)?.text || "" : "";
          parts.push(markdownForItem(item, { content: text, includeContent: withContent }), "\n---\n\n");
        }
        done += batch.length;
        if (onProgress) onProgress(done, metas.length);
      }
    }
    return parts;
  },

  /**
   * MERGE an exported file into the current library.
   *
   * v1.3 replaced items/decks/settings wholesale here, which meant one click on
   * "Import" could silently destroy everything already saved — the exact
   * failure mode Kipideck's whole promise is built to prevent. Imports now go
   * through the same record-level merge as sync: same id → newer `updatedAt`
   * wins, and tombstoned items stay deleted.
   */
  async importJSON(json, { dryRun = false } = {}) {
    const data = typeof json === "string" ? JSON.parse(json) : json;
    const incoming = Array.isArray(data?.items) ? data.items : [];
    const localMetas = await db.getAllItemMetas();
    const localTombstones = await this.getTombstones();

    const { merged, tombstones } = mergeRecords(
      localMetas,
      incoming,
      localTombstones,
      data.tombstones || []
    );

    const localById = new Map(localMetas.map((m) => [m.id, m]));
    const toWrite = merged.filter((rec) => {
      const local = localById.get(rec.id);
      return !local || (rec.updatedAt || 0) > (local.updatedAt || 0);
    });
    const added = toWrite.filter((rec) => !localById.has(rec.id)).length;
    const updated = toWrite.length - added;

    if (dryRun) {
      return { added, updated, unchanged: merged.length - toWrite.length, total: merged.length, written: 0 };
    }

    if (toWrite.length) {
      await db.writeItemsBulk(toWrite.map((item) => ({ item, text: item.content || "" })));
    }

    // Decks: add any unknown ones, never clobber a deck the user renamed.
    if (Array.isArray(data.decks) && data.decks.length) {
      const decks = await this.getDecks();
      const known = new Map(decks.map((d) => [d.id, d]));
      let changed = false;
      for (const d of data.decks) {
        if (!d || !d.id) continue;
        if (!known.has(d.id)) {
          decks.push(d);
          changed = true;
        }
      }
      if (changed) await setAll(KEYS.DECKS, decks);
    }

    await setAll(KEYS.TOMBSTONES, tombstones);
    return { added, updated, unchanged: merged.length - toWrite.length, total: merged.length, written: toWrite.length };
  },

  /**
   * Bulk-write records produced by lib/import.js (or any normalised list).
   *
   * This is the path every external import takes — Pocket CSV, Raindrop JSON,
   * browser bookmarks, a URL list. It differs from importJSON in one important
   * way: it dedupes by CANONICAL URL as well as by id, because an imported file
   * has none of our ids. That is what makes re-importing the same export a
   * no-op instead of 40,000 duplicates, and what stops a Pocket library that
   * lists the same article under both "Unread" and "Archive" from doubling.
   *
   * Never overwrites a newer local edit, never resurrects a deleted item.
   */
  async importRecords(records, { dryRun = false, batchSize = 250, onProgress } = {}) {
    const incoming = Array.isArray(records) ? records.filter((r) => r && typeof r === "object") : [];
    if (!incoming.length) {
      return { added: 0, updated: 0, duplicates: 0, deleted: 0, invalid: 0, total: 0, written: 0 };
    }

    const [local, tombstones] = await Promise.all([db.getAllItemMetas(), this.getTombstones()]);
    const byId = new Map(local.map((m) => [m.id, m]));
    const byCanon = new Map();
    for (const m of local) if (m.canon) byCanon.set(m.canon, m);
    const tombIds = new Set(tombstones.map((t) => (t && typeof t === "object" ? t.id : t)).filter(Boolean));
    const tombCanons = new Set(tombstones.map((t) => t && typeof t === "object" && t.canon).filter(Boolean));

    const toWrite = [];
    const counts = { added: 0, updated: 0, duplicates: 0, deleted: 0, invalid: 0 };
    const seenCanon = new Set();

    for (const raw of incoming) {
      const item = { ...raw };
      const url = String(item.url || item.sourceUrl || "").trim();
      const canon = canonicalUrl(url);
      // A saved window carries its links in `tabs`, not in `url` — no canon is
      // expected, and matching one against the library would be meaningless.
      const isSession = item.type === "session" && Array.isArray(item.tabs);
      if (!canon && !isSession) {
        counts.invalid++;
        continue;
      }
      item.url = url;
      item.sourceUrl = item.sourceUrl || url;
      item.domain = item.domain || hostOf(url);
      // Foreign files predate save-states; ours carry them. Either way the
      // stored record ends up canonical, never a foreign spelling.
      if (!isStatus(item.status)) item.status = "unread";

      if (canon) {
        if (seenCanon.has(canon)) { counts.duplicates++; continue; }
        seenCanon.add(canon);
        if (tombCanons.has(canon)) { counts.deleted++; continue; }
      }

      const existing = (item.id && byId.get(item.id)) || (canon && byCanon.get(canon)) || null;
      if (existing) {
        if (tombIds.has(existing.id)) { counts.deleted++; continue; }
        // Newest edit wins, exactly like cross-device sync.
        if ((item.updatedAt || 0) > (existing.updatedAt || 0)) {
          item.id = existing.id;
          counts.updated++;
          toWrite.push(item);
        } else {
          counts.duplicates++;
        }
        continue;
      }

      item.id = item.id || uid();
      counts.added++;
      toWrite.push(item);
    }

    if (dryRun) {
      return { ...counts, total: incoming.length, written: 0, sample: toWrite.slice(0, 8) };
    }

    for (let i = 0; i < toWrite.length; i += batchSize) {
      const batch = toWrite.slice(i, i + batchSize);
      await db.writeItemsBulk(batch.map((item) => ({ item, text: item.content || "" })));
      if (onProgress) onProgress({ done: Math.min(i + batchSize, toWrite.length), total: toWrite.length });
    }

    return { ...counts, total: incoming.length, written: toWrite.length };
  },

  async clearAll() {
    await db.clearAllData();
    await setAll(KEYS.DECKS, DEFAULT_DECKS);
    await setAll(KEYS.TOMBSTONES, []);
  },

  // ---- diagnostics --------------------------------------------------------
  async getStats() {
    return db.getStats();
  },

  async reindex(onProgress) {
    return db.reindexAll({ onProgress });
  },

  /** Local favicon cache — replaces the v1.3 `google.com/s2/favicons` fallback,
   * which sent every saved domain to a third party and failed offline. */
  async getCachedFavicon(domain) {
    return db.getFavicon(domain);
  },

  async cacheFavicon(domain, dataUrl) {
    return db.putFavicon(domain, dataUrl);
  },
};

export { db };
