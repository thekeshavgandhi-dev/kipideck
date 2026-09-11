// content/content.js — Kipideck content script
//
//  - Auto-save: the moment you finish selecting text on a page, the
//    selection is saved to Kipideck together with the page it came from
//    (title, URL, favicon) as its reference. No bubble to click, nothing
//    to confirm. Selecting the same text again within 30 s is ignored, so
//    nudging a selection around doesn't spam the library. Toggle it in
//    Library → Settings.
//  - Quick-save: press Space, then K — saves the current page. A two-key
//    combo on purpose: it can't collide with any browser or site shortcut
//    (Ctrl+K, Alt+K, etc. are taken somewhere).
//  - Toasts: one compact confirmation when a save lands.
//  - Website bridge: lets kipideck.vercel.app detect the extension and
//    open the visitor's own library.
//
// Uses the Promise-based `browser.*` API (polyfilled on Chromium via
// lib/browser-polyfill.js, native on Firefox) — never callbacks.

(function () {
  if (window.__kipiContentLoaded) return;
  window.__kipiContentLoaded = true;

  // ---------------------------------------------------------------------------
  // Settings (cached so we never hit storage on every mouseup/keypress)
  // ---------------------------------------------------------------------------
  let settingsCache = {};

  function autoSaveEnabled() {
    // `autoSaveSelection` is the current key; `showFloatingButton` is the
    // pre-1.3 key for the same behaviour, honored as a fallback so existing
    // installs don't change how they behave on update.
    return settingsCache.autoSaveSelection ?? settingsCache.showFloatingButton ?? true;
  }

  browser.storage?.local?.get("kipi_settings").then((res) => {
    if (res?.kipi_settings) settingsCache = res.kipi_settings;
  });
  browser.storage?.onChanged?.addListener((changes) => {
    if (changes.kipi_settings) settingsCache = changes.kipi_settings.newValue;
  });

  // ---------------------------------------------------------------------------
  // Compact confirmation toast
  // ---------------------------------------------------------------------------
  let toastEl = null;
  let toastHideTimer = null;
  let toastLeaveTimer = null;

  function showToast(title, sub) {
    if (toastHideTimer) clearTimeout(toastHideTimer);
    if (toastLeaveTimer) clearTimeout(toastLeaveTimer);
    if (toastEl) toastEl.remove();

    const el = document.createElement("div");
    el.className = "kipi-toast";

    const mark = document.createElement("span");
    mark.className = "kipi-toast-mark";
    mark.textContent = "✓";

    const text = document.createElement("span");
    text.className = "kipi-toast-text";
    const b = document.createElement("b");
    b.textContent = title;
    text.appendChild(b);
    if (sub) {
      const em = document.createElement("em");
      em.textContent = sub;
      text.appendChild(em);
    }

    el.appendChild(mark);
    el.appendChild(text);
    document.documentElement.appendChild(el);
    toastEl = el;

    toastHideTimer = setTimeout(() => {
      el.classList.add("leaving");
      toastLeaveTimer = setTimeout(() => {
        el.remove();
        if (toastEl === el) toastEl = null;
      }, 280);
    }, 2400);
  }

  function saveSelection(text) {
    return browser.runtime
      .sendMessage({ type: "KIPI_SAVE_SELECTION", text })
      .then((res) => res || null)
      .catch(() => null);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function inEditable(node) {
    let el = node && node.nodeType === 1 ? node : node && node.parentElement;
    while (el) {
      if (el.isContentEditable) return true;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      el = el.parentElement;
    }
    return false;
  }

  /** The current on-page selection, or null if empty/too short/inside a form field. */
  function currentSelectionText() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const text = sel.toString().trim();
    if (text.length < 3) return null;
    if (inEditable(sel.getRangeAt(0).startContainer)) return null;
    return text;
  }

  // ---------------------------------------------------------------------------
  // Auto-save on text selection
  // ---------------------------------------------------------------------------
  let autoSaveTimer = null;
  const recentSaves = new Map(); // "host|normalized-text" -> timestamp
  const REPEAT_WINDOW_MS = 30 * 1000;

  function queueAutoSave() {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      autoSaveTimer = null;
      if (!autoSaveEnabled()) return;
      const text = currentSelectionText();
      if (!text) return;
      const key = location.host + "|" + text.replace(/\s+/g, " ").toLowerCase();
      const now = Date.now();
      const last = recentSaves.get(key);
      if (last && now - last < REPEAT_WINDOW_MS) return; // same text again — skip
      if (recentSaves.size > 200) recentSaves.clear();
      recentSaves.set(key, now);
      saveSelection(text).then((res) => {
        if (res?.ok) showToast("Auto-saved to Kipideck", res.item?.title);
      });
    }, 250);
  }

  document.addEventListener("mouseup", queueAutoSave, true);
  document.addEventListener(
    "keyup",
    (e) => {
      // Shift+arrow selections end on the arrow's keyup.
      if (e.key === "Shift" || e.key.indexOf("Arrow") === 0) queueAutoSave();
    },
    true
  );

  // ---------------------------------------------------------------------------
  // Space → K quick-save
  // ---------------------------------------------------------------------------
  let spaceArmedAt = 0;
  const SPACE_K_WINDOW_MS = 1200;

  function quickSave() {
    // With auto-save switched off, Space+K is also the one-key way to
    // capture a live selection — use it for that if one exists.
    if (!autoSaveEnabled()) {
      const text = currentSelectionText();
      if (text) {
        saveSelection(text).then((res) => {
          if (res?.ok) showToast("Saved selection to Kipideck", res.item?.title);
        });
        return;
      }
    }
    browser.runtime
      .sendMessage({ type: "KIPI_SAVE_PAGE" })
      .then((res) => {
        if (res?.ok) showToast("Saved page to Kipideck", res.item?.title);
      })
      .catch(() => {});
  }

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) {
        spaceArmedAt = 0;
        return;
      }
      if (inEditable(e.target)) {
        spaceArmedAt = 0; // typing, not shortcutting
        return;
      }
      const now = Date.now();
      if (e.key === " ") {
        spaceArmedAt = now;
        return;
      }
      if (
        (e.key === "k" || e.key === "K") &&
        spaceArmedAt &&
        now - spaceArmedAt <= SPACE_K_WINDOW_MS
      ) {
        spaceArmedAt = 0;
        quickSave();
        return;
      }
      spaceArmedAt = 0;
    },
    true
  );

  // Toasts forwarded from the background.
  browser.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "KIPI_TOAST") showToast(msg.text);
  });

  // ---------------------------------------------------------------------------
  // Kipideck website bridge — lets the Vercel-hosted marketing site
  // (kipideck.vercel.app) detect that the extension is installed and ask it to
  // open the user's own library (local items + Google Drive synced items).
  // The website itself can never read extension data directly (different
  // origin / storage) — it just sends a window message, this content script
  // forwards it to the background script, and the background opens
  // library/library.html in a new tab. No GitHub or server involved.
  // ---------------------------------------------------------------------------
  try {
    const FLAG = "__KIPIDECK_INSTALLED__";
    if (!window[FLAG]) {
      window[FLAG] = true;
      document.documentElement.setAttribute("data-kipideck-installed", "true");
      let extVersion = "";
      try {
        extVersion = browser.runtime.getManifest ? browser.runtime.getManifest().version : "";
      } catch {
        /* getManifest may be unavailable in some contexts */
      }
      window.dispatchEvent(
        new CustomEvent("kipideck:ready", { detail: { version: extVersion } })
      );

      window.addEventListener("message", (event) => {
        if (event.source !== window) return;
        const msg = event.data;
        if (!msg || msg.source !== "kipideck-website") return;

        if (msg.type === "KIPIDECK_PING") {
          window.postMessage(
            { source: "kipideck-extension", type: "KIPIDECK_PONG", version: extVersion },
            "*"
          );
        } else if (msg.type === "KIPIDECK_OPEN_LIBRARY") {
          browser.runtime.sendMessage({ type: "KIPI_OPEN_LIBRARY" }).catch(() => {});
          window.postMessage(
            { source: "kipideck-extension", type: "KIPIDECK_OPENING" },
            "*"
          );
        } else if (msg.type === "KIPIDECK_GET_COUNT") {
          browser.runtime
            .sendMessage({ type: "KIPI_GET_COUNT" })
            .then((res) => {
              window.postMessage(
                {
                  source: "kipideck-extension",
                  type: "KIPIDECK_COUNT",
                  count: res?.count ?? 0,
                },
                "*"
              );
            })
            .catch(() => {
              window.postMessage(
                { source: "kipideck-extension", type: "KIPIDECK_COUNT", count: 0 },
                "*"
              );
            });
        }
      });
    }
  } catch {
    /* website bridge is best-effort — never break saving */
  }
})();
