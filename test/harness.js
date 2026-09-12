// test/harness.js — makes the extension's browser-only modules importable in node.
//
// Two shims, both minimal on purpose:
//   1. `fake-indexeddb/auto` provides the real IndexedDB API surface in-process,
//      so lib/db.js runs unmodified (it never touches chrome.* directly).
//   2. a tiny callback-style `chrome.storage.local` satisfies Mozilla's
//      webextension-polyfill (lib/browser-polyfill.js), which refuses to load
//      without `chrome.runtime.id` and promisifies whatever it finds.
//
// Keeping the shims this small is the point: if a module needs more than
// storage.local to be testable, that module is doing too much.

import "fake-indexeddb/auto";

const mem = new Map();

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeKeys(keys) {
  if (keys === null || keys === undefined) return [];
  if (typeof keys === "string") return [keys];
  if (Array.isArray(keys)) return keys;
  return Object.keys(keys);
}

/** Tests set this to control what the OAuth round trip "returns". */
export const identityBehaviour = {
  redirectUrlFor: () => "https://kipideck-test.chromiumapp.org/?code=test-code&state=test-state",
  calls: [],
};

globalThis.chrome = {
  runtime: {
    id: "kipideck-test",
    getURL: (p) => `chrome-extension://kipideck-test/${p}`,
    getManifest: () => ({ version: "test" }),
    sendMessage: () => Promise.resolve(undefined),
    onMessage: { addListener() {}, removeListener() {}, hasListener: () => false },
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
  },
  identity: {
    // Callback style on purpose: Mozilla's polyfill promisifies it, which is
    // exactly what the extension relies on at runtime.
    getRedirectURL: (path) => `https://kipideck-test.chromiumapp.org/${path || ""}`,
    launchWebAuthFlow: (options, cb) => {
      identityBehaviour.calls.push(options);
      const url = identityBehaviour.redirectUrlFor(options);
      if (url instanceof Error) queueMicrotask(() => cb && cb(undefined));
      else queueMicrotask(() => cb && cb(url));
    },
  },
  storage: {
    local: {
      get(keys, cb) {
        const out = {};
        for (const k of normalizeKeys(keys)) if (mem.has(k)) out[k] = clone(mem.get(k));
        if (typeof keys === "object" && !Array.isArray(keys) && keys !== null) {
          for (const [k, v] of Object.entries(keys)) if (!mem.has(k)) out[k] = clone(v);
        }
        queueMicrotask(() => cb && cb(out));
      },
      set(obj, cb) {
        for (const [k, v] of Object.entries(obj || {})) mem.set(k, clone(v));
        queueMicrotask(() => cb && cb());
      },
      remove(keys, cb) {
        for (const k of normalizeKeys(keys)) mem.delete(k);
        queueMicrotask(() => cb && cb());
      },
      clear(cb) {
        mem.clear();
        queueMicrotask(() => cb && cb());
      },
    },
    onChanged: { addListener() {}, removeListener() {} },
  },
};

/** Reset both stores between test cases. */
export async function resetWorld() {
  mem.clear();
  const { closeDB } = await import("../lib/db.js");
  await closeDB();
  // fake-indexeddb keeps databases in-process; delete ours so each test starts clean.
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase("kipideck");
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

/** Peek at the fake storage.local (test assertions on decks/settings/tombstones). */
export const memoryStore = mem;
