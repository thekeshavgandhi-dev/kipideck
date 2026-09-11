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

  chrome.storage?.local?.get("kipi_settings").then((res) => {
    if (res?.kipi_settings) settingsCache = res.kipi_settings;
  });
  chrome.storage?.onChanged?.addListener((changes) => {
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
      chrome.runtime.sendMessage({ type: "KIPI_SAVE_SELECTION", text }, (res) => {
        if (res?.ok) showToast("Saved selection to Kipideck");
      });
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

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "KIPI_TOAST") showToast(msg.text);
  });
})();
