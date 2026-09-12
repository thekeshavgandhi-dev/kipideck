// content/content.js — Kipideck content script
//
//  - Auto-save: the moment you finish selecting text on a page, the selection
//    is saved together with the page it came from as its reference. This is
//    SILENT CAPTURE, so it never happens before the first-run disclosure has
//    been accepted, never happens on a site the user muted, and always says so
//    on screen with a toast that offers "Open" and "Never on this site".
//  - Quick-save: press Space, then K. Skipped on sites where Space/K are real
//    shortcuts (YouTube, Gmail, most players) — see SHORTCUT_BLOCKED_HOSTS in
//    lib/storage.js — and switchable off entirely in Settings.
//  - Toasts: one compact confirmation when a save lands, clickable.
//  - Website bridge: lets the marketing site detect the extension and open the
//    visitor's own library.
//
// This is a CLASSIC script (not a module — see manifest.content_scripts.js), so
// it cannot `import`. Everything policy-related is therefore asked of the
// background script, which owns the single source of truth (settings, mute list,
// shortcut blocklist, onboarding state). Uses the Promise-based `browser.*` API,
// never callbacks.

(function () {
  if (window.__kipiContentLoaded) return;
  window.__kipiContentLoaded = true;

  // ---------------------------------------------------------------------------
  // Capture policy (fetched from the background, refreshed when settings change)
  // ---------------------------------------------------------------------------
  let policy = {
    autoSaveSelection: false,
    spaceKQuickSave: false,
    showToast: true,
    muted: false,
    onboardingDone: false,
  };

  function refreshPolicy() {
    return browser.runtime
      .sendMessage({ type: "KIPI_GET_CAPTURE_POLICY", host: location.host })
      .then((res) => {
        if (res) policy = res;
      })
      .catch(() => {
        /* background asleep or extension reloaded — keep the last known policy,
           which defaults to capturing nothing silently */
      });
  }

  refreshPolicy();
  browser.storage?.onChanged?.addListener((changes) => {
    if (changes.kipi_settings) refreshPolicy();
  });

  // ---------------------------------------------------------------------------
  // Toast — the on-screen record that something was captured, and the way out
  // ---------------------------------------------------------------------------
  let toastEl = null;
  let toastHideTimer = null;
  let toastLeaveTimer = null;

  /**
   * @param {string} title
   * @param {string} [sub]
   * @param {{label: string, onClick: Function}[]} [actions]
   */
  function showToast(title, sub, actions) {
    if (!policy.showToast) return null;
    if (toastHideTimer) clearTimeout(toastHideTimer);
    if (toastLeaveTimer) clearTimeout(toastLeaveTimer);
    if (toastEl) toastEl.remove();

    const el = document.createElement("div");
    el.className = "kipi-toast" + (actions && actions.length ? " kipi-toast-actions" : "");

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

    for (const action of actions || []) {
      const btn = document.createElement("button");
      btn.className = "kipi-toast-btn";
      btn.type = "button";
      btn.textContent = action.label;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          action.onClick();
        } catch {
          /* a toast action must never break the host page */
        }
        dismiss();
      });
      el.appendChild(btn);
    }

    function dismiss() {
      el.classList.add("leaving");
      toastLeaveTimer = setTimeout(() => {
        el.remove();
        if (toastEl === el) toastEl = null;
      }, 280);
    }

    el.addEventListener("click", () => dismiss());
    document.documentElement.appendChild(el);
    toastEl = el;

    const duration = actions && actions.length ? 5200 : 2400;
    toastHideTimer = setTimeout(dismiss, duration);
    return el;
  }

  function openItem(itemId) {
    browser.runtime.sendMessage({ type: "KIPI_OPEN_ITEM", itemId }).catch(() => {});
  }

  /** "Never capture on this site" — the point-of-collection off switch. */
  function muteThisSite() {
    browser.runtime
      .sendMessage({ type: "KIPI_MUTE_SITE", host: location.host })
      .then(() => {
        policy.autoSaveSelection = false;
        policy.muted = true;
        showToast("Kipideck will stay quiet here", location.host + " · undo in Library → Settings");
      })
      .catch(() => {});
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
      // Silent capture requires an accepted disclosure and a site that is not
      // muted. The background decides both; the default here is "capture nothing".
      if (!policy.autoSaveSelection) return;
      const text = currentSelectionText();
      if (!text) return;
      const key = location.host + "|" + text.replace(/\s+/g, " ").toLowerCase();
      const now = Date.now();
      const last = recentSaves.get(key);
      if (last && now - last < REPEAT_WINDOW_MS) return; // same text again — skip
      if (recentSaves.size > 200) recentSaves.clear();
      recentSaves.set(key, now);
      saveSelection(text).then((res) => {
        if (res?.ok) {
          showToast("Auto-saved to Kipideck", res.item?.title, [
            { label: "Open", onClick: () => openItem(res.item?.id) },
            { label: "Never here", onClick: muteThisSite },
          ]);
        }
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
    browser.runtime
      .sendMessage({ type: "KIPI_SAVE_PAGE" })
      .then((res) => {
        if (res?.ok) {
          showToast("Saved page to Kipideck", res.item?.title, [
            { label: "Open", onClick: () => openItem(res.item?.id) },
          ]);
        } else if (res?.skipped) {
          showToast("Already in your Kipideck", "", [
            res.existingId ? { label: "Open", onClick: () => openItem(res.existingId) } : null,
          ].filter(Boolean));
        }
      })
      .catch(() => {});
  }

  function quickSaveSelection() {
    const text = currentSelectionText();
    if (!text) return false;
    saveSelection(text).then((res) => {
      if (res?.ok) {
        showToast("Saved selection to Kipideck", res.item?.title, [
          { label: "Open", onClick: () => openItem(res.item?.id) },
        ]);
      }
    });
    return true;
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
        // Only arm on sites where Space isn't a real shortcut (players, Gmail,
        // YouTube). Without this, pausing a video and pressing K caused
        // surprise saves on every video watched.
        spaceArmedAt = policy.spaceKQuickSave ? now : 0;
        return;
      }
      if (
        (e.key === "k" || e.key === "K") &&
        spaceArmedAt &&
        now - spaceArmedAt <= SPACE_K_WINDOW_MS
      ) {
        spaceArmedAt = 0;
        // With auto-save switched off, Space+K is also the one-key way to
        // capture a live selection — use it for that if one exists.
        if (!policy.autoSaveSelection && quickSaveSelection()) return;
        quickSave();
        return;
      }
      spaceArmedAt = 0;
    },
    true
  );

  // Toasts forwarded from the background (e.g. "already in your Kipideck").
  browser.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "KIPI_TOAST") {
      showToast(msg.text, msg.sub, msg.action?.itemId ? [{ label: msg.action.label || "Open", onClick: () => openItem(msg.action.itemId) }] : undefined);
    } else if (msg?.type === "KIPI_POLICY_CHANGED") {
      refreshPolicy();
    }
  });

  // ---------------------------------------------------------------------------
  // Kipideck website bridge — lets the hosted marketing site detect that the
  // extension is installed and ask it to open the user's own library (local
  // items + Google Drive synced items). The website itself can never read
  // extension data directly (different origin / storage) — it just sends a
  // window message, this content script forwards it to the background script,
  // and the background opens library/library.html in a new tab.
  //
  // QA/security pass (2026-09-12): this content script runs on EVERY page, so
  // without an origin gate any site the user visits could ask it "do you have
  // Kipideck and how many saves?" (a fingerprint + a small leak of usage),
  // learn the exact extension version (an "is this install vulnerable?" map),
  // or summon a library tab on top of whatever they are doing. The bridge is
  // for OUR site; answer only OUR site (plus loopback, so `next dev` can be
  // developed against). Everything else gets silence.
  // ---------------------------------------------------------------------------
  function isBridgeOrigin(origin) {
    if (origin === "https://kipideck.vercel.app") return true;
    // Development: any http(s) localhost port is the site being worked on.
    // A public page can never pretend to be this origin — browsers set
    // event.origin from the real URL of the calling document.
    return /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
  }
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
        if (!isBridgeOrigin(event.origin)) return; // see the block comment above
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
