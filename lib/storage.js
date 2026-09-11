// lib/storage.js
// Shared data-access layer for Kipideck. Works from the background service
// worker, the popup, and the library page (all import this same module).
// Everything lives in browser.storage.local by default — fully private, no
// server required — with an optional opt-in sync layer (see lib/sync.js)
// that mirrors the same data to a self-hosted Kipideck Sync server so your
// decks follow you across every browser/device you're signed into.
import { ext } from "./compat.js";


const KEYS = {
  ITEMS: "kipi_items",
  DECKS: "kipi_decks",
  SETTINGS: "kipi_settings",
  TOMBSTONES: "kipi_tombstones",
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
  // reference). Toggled in Library → Settings.
  autoSaveSelection: true,
  // Legacy pre-1.3 key for the same behaviour — content.js falls back to it
  // for installs that saved settings before autoSaveSelection existed.
  showFloatingButton: true,
  theme: "system",
};

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

export const Storage = {
  KEYS,
  uid,

  async init() {
    const decks = await getAll(KEYS.DECKS, null);
    if (!decks) await setAll(KEYS.DECKS, DEFAULT_DECKS);
    const items = await getAll(KEYS.ITEMS, null);
    if (!items) await setAll(KEYS.ITEMS, []);
    const settings = await getAll(KEYS.SETTINGS, null);
    if (!settings) await setAll(KEYS.SETTINGS, DEFAULT_SETTINGS);
  },

  async getSettings() {
    return getAll(KEYS.SETTINGS, DEFAULT_SETTINGS);
  },

  async updateSettings(patch) {
    const cur = await this.getSettings();
    const next = { ...cur, ...patch };
    await setAll(KEYS.SETTINGS, next);
    return next;
  },

  async getDecks() {
    return getAll(KEYS.DECKS, DEFAULT_DECKS);
  },

  async addDeck(name, icon = "🗂️", color = "#7C5CFC") {
    const decks = await this.getDecks();
    const deck = { id: uid(), name, icon, color, smart: false, builtin: false };
    decks.push(deck);
    await setAll(KEYS.DECKS, decks);
    return deck;
  },

  async renameDeck(id, name) {
    const decks = await this.getDecks();
    const d = decks.find((x) => x.id === id);
    if (d) d.name = name;
    await setAll(KEYS.DECKS, decks);
    return d;
  },

  async deleteDeck(id) {
    let decks = await this.getDecks();
    decks = decks.filter((d) => d.id !== id);
    await setAll(KEYS.DECKS, decks);
    // move orphaned items to inbox
    const items = await this.getItems();
    let changed = false;
    for (const it of items) {
      if (it.deckId === id) {
        it.deckId = "inbox";
        changed = true;
      }
    }
    if (changed) await setAll(KEYS.ITEMS, items);
  },

  async getItems() {
    return getAll(KEYS.ITEMS, []);
  },

  async getItem(id) {
    const items = await this.getItems();
    return items.find((i) => i.id === id) || null;
  },

  async saveItem(item) {
    const items = await this.getItems();
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
      content: "",
      note: "",
      tags: [],
      deckId: "inbox",
      reference: "",
      createdAt: now,
      updatedAt: now,
      pinned: false,
      ...item,
    };
    items.unshift(full);
    await setAll(KEYS.ITEMS, items);
    return full;
  },

  async updateItem(id, patch) {
    const items = await this.getItems();
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return null;
    items[idx] = { ...items[idx], ...patch, updatedAt: Date.now() };
    await setAll(KEYS.ITEMS, items);
    return items[idx];
  },

  async deleteItem(id) {
    let items = await this.getItems();
    items = items.filter((i) => i.id !== id);
    await setAll(KEYS.ITEMS, items);
    await this._recordTombstones([id]);
  },

  async deleteMany(ids) {
    let items = await this.getItems();
    const set = new Set(ids);
    items = items.filter((i) => !set.has(i.id));
    await setAll(KEYS.ITEMS, items);
    await this._recordTombstones(ids);
  },

  // Deletion tombstones (id + deletedAt) so the sync layer (lib/drive-sync.js)
  // can tell "deleted on another device" apart from "just never synced yet"
  // and won't resurrect something you deleted on your phone the moment your
  // laptop syncs an older cached copy.
  async _recordTombstones(ids) {
    const tombstones = await getAll(KEYS.TOMBSTONES, []);
    const now = Date.now();
    for (const id of ids) tombstones.push({ id, deletedAt: now });
    await setAll(KEYS.TOMBSTONES, tombstones);
  },

  async getTombstones() {
    return getAll(KEYS.TOMBSTONES, []);
  },

  async clearAll() {
    await setAll(KEYS.ITEMS, []);
    await setAll(KEYS.DECKS, DEFAULT_DECKS);
  },

  async exportJSON() {
    const [items, decks, settings] = await Promise.all([
      this.getItems(),
      this.getDecks(),
      this.getSettings(),
    ]);
    return JSON.stringify(
      { version: 1, exportedAt: new Date().toISOString(), items, decks, settings },
      null,
      2
    );
  },

  async importJSON(json) {
    const data = typeof json === "string" ? JSON.parse(json) : json;
    if (data.decks) await setAll(KEYS.DECKS, data.decks);
    if (data.items) await setAll(KEYS.ITEMS, data.items);
    if (data.settings) await setAll(KEYS.SETTINGS, data.settings);
    return true;
  },
};
