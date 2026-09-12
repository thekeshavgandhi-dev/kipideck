// tools/screenshots/shim.js
//
// A minimal fake of the WebExtension APIs, so the REAL Library UI can run in an
// ordinary browser tab for the purpose of capturing store screenshots.
//
// Nothing in tools/ ships: the packaging list in
// website/scripts/build-extension-zip.mjs only walks manifest.json, background/,
// content/, lib/, popup/, library/, onboarding/ and icons/. That is the point —
// this shim must never reach a user's browser.
//
// It is deliberately dumb. It does not try to be a browser; it returns the
// minimum shape the real modules ask for, and it fails loudly for the two
// things that genuinely cannot work here (sync and tab capture).

(function () {
  // In-memory backing store. Good enough for a screenshot session; reload the
  // page and you get a freshly seeded library, which is what you want anyway.
  const mem = new Map();

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  globalThis.browser = {
    // browser-polyfill only rebuilds `browser` from `chrome` when
    // `browser.runtime.id` is missing, so setting it here is enough to make the
    // real lib/compat.js proxy work unmodified.
    runtime: {
      id: "kipideck-screenshot-harness",
      getURL: (path) => new URL("../../" + String(path || ""), location.href).href,
      getManifest: () => ({ version: "1.5.0", name: "Kipideck" }),
      sendMessage: () => Promise.resolve(undefined),
      onMessage: { addListener() {}, removeListener() {}, hasListener: () => false },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      lastError: null,
    },

    storage: {
      local: {
        async get(keys) {
          const out = {};
          if (keys == null) {
            for (const [k, v] of mem) out[k] = clone(v);
            return out;
          }
          if (typeof keys === "string") {
            if (mem.has(keys)) out[keys] = clone(mem.get(keys));
            return out;
          }
          if (Array.isArray(keys)) {
            for (const k of keys) if (mem.has(k)) out[k] = clone(mem.get(k));
            return out;
          }
          for (const k of Object.keys(keys)) out[k] = mem.has(k) ? clone(mem.get(k)) : clone(keys[k]);
          return out;
        },
        async set(obj) {
          for (const [k, v] of Object.entries(obj)) mem.set(k, clone(v));
        },
        async remove(keys) {
          for (const k of [].concat(keys)) mem.delete(k);
        },
        async clear() {
          mem.clear();
        },
      },
      onChanged: { addListener() {}, removeListener() {}, hasListener: () => false },
      sync: { get: async () => ({}), set: async () => {} },
    },

    tabs: {
      create: (opts) => {
        if (opts && opts.url) window.open(opts.url, "_blank");
        return Promise.resolve({ id: 1 });
      },
      query: async () => [],
      sendMessage: async () => undefined,
      remove: async () => undefined,
      update: async () => ({}),
    },

    identity: {
      getRedirectURL: (path) => "https://kipideck.invalid/" + String(path || ""),
      launchWebAuthFlow: () =>
        Promise.reject(new Error("Google Drive sync is not available in the screenshot harness")),
    },

    alarms: {
      create() {},
      clear() {},
      get: async () => undefined,
      onAlarm: { addListener() {}, removeListener() {}, hasListener: () => false },
    },

    notifications: {
      create() {},
      clear() {},
      onClicked: { addListener() {} },
    },

    contextMenus: {
      create() {},
      update() {},
      remove() {},
      removeAll() {},
      onClicked: { addListener() {} },
    },

    scripting: {
      executeScript: async () => [{ result: {} }],
      insertCSS: async () => {},
    },

    i18n: { getMessage: (key) => key },
  };

  globalThis.__KIPIDECK_HARNESS__ = true;
})();
