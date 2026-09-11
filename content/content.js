// content/content.js — Kipideck content script
// Shows a small floating "Save to Kipi" bubble when the user selects text,
// as a fast alternative to the right-click menu. Also shows a toast when a
// save completes, and listens for a "Q" quick-save keyboard shortcut inside
// the bubble.

(function () {
  if (window.__kipiContentLoaded) return;
  window.__kipiContentLoaded = true;

  let btn = null;
  let lastSelectionText = "";
  let settingsCache = { showFloatingButton: true };

  browser.storage?.local?.get("kipi_settings").then((res) => {
    if (res?.kipi_settings) settingsCache = res.kipi_settings;
  });
  browser.storage?.onChanged?.addListener((changes) => {
    if (changes.kipi_settings) settingsCache = changes.kipi_settings.newValue;
  });

  function removeBtn() {
    if (btn) {
      btn.remove();
      btn = null;
    }
  }

  function showToast(text) {
    const el = document.createElement("div");
    el.className = "kipi-toast";
    el.innerHTML = `<span style="font-size:16px">✅</span><span>${text}</span>`;
    document.documentElement.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  function createBtn(x, y) {
    removeBtn();
    btn = document.createElement("button");
    btn.className = "kipi-float-btn";
    btn.innerHTML = `<span class="kipi-emoji">📌</span><span>Save to Kipi</span>`;
    btn.style.left = `${x}px`;
    btn.style.top = `${y}px`;
    btn.addEventListener("mousedown", (e) => e.preventDefault()); // don't clear selection
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const text = lastSelectionText;
      // Note: browser.runtime.sendMessage is Promise-based everywhere (native
      // on Firefox/Safari, polyfilled on Chromium) — never pass a callback,
      // it won't be invoked on Firefox.
      browser.runtime
        .sendMessage({ type: "KIPI_SAVE_SELECTION", text })
        .then((res) => {
          if (res?.ok) showToast("Saved selection to Kipideck");
        })
        .catch(() => {});
      removeBtn();
    });
    document.documentElement.appendChild(btn);
  }

  document.addEventListener("mouseup", (e) => {
    if (btn && btn.contains(e.target)) return;
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : "";
      if (!settingsCache.showFloatingButton) {
        removeBtn();
        return;
      }
      if (text && text.length > 2) {
        lastSelectionText = text;
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const x = rect.left + window.scrollX + Math.max(0, rect.width / 2 - 60);
        const y = rect.top + window.scrollY - 42;
        createBtn(x, y);
      } else {
        removeBtn();
      }
    }, 10);
  });

  document.addEventListener("mousedown", (e) => {
    if (btn && !btn.contains(e.target)) removeBtn();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") removeBtn();
  });
  window.addEventListener("scroll", () => removeBtn(), true);

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
    /* website bridge is best-effort — never break the save bubble */
  }
})();
