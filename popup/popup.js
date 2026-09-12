// popup/popup.js — toolbar popup
// Quick save, quick note, recent items, search. Everything here reads the
// paginated IndexedDB layer (lib/db.js via Storage), so opening the popup on a
// 50,000-item library costs the same as on an empty one: one page of records,
// never the whole corpus.

import { ext } from "../lib/compat.js";
import { Storage } from "../lib/storage.js";
import { searchItems } from "../lib/search.js";
import { faviconMap, iconFromMap } from "../lib/favicons.js";
import { isSavableTabUrl } from "../lib/sessions.js";

const els = {
  savePageBtn: document.getElementById("savePageBtn"),
  savePageLabel: document.getElementById("savePageLabel"),
  saveTabsBtn: document.getElementById("saveTabsBtn"),
  tabsDeckSelect: document.getElementById("tabsDeckSelect"),
  noteInput: document.getElementById("noteInput"),
  searchRow: document.getElementById("searchRow"),
  searchInput: document.getElementById("searchInput"),
  itemsList: document.getElementById("itemsList"),
  emptyState: document.getElementById("emptyState"),
  itemCount: document.getElementById("itemCount"),
  openLibraryBtn: document.getElementById("openLibraryBtn"),
  openLibraryLink: document.getElementById("openLibraryLink"),
  setupRow: document.getElementById("setupRow"),
  setupLink: document.getElementById("setupLink"),
};

const PAGE_SIZE = 40;

let state = { total: 0, decks: [], query: "", icons: new Map(), items: [], tabCount: 0, tabsDeck: "inbox" };
let searchTimer = null;
let searchSeq = 0; // ignore out-of-order results from fast typing

function openLibrary() {
  ext.tabs.create({ url: ext.runtime.getURL("library/library.html") });
}
els.openLibraryBtn.addEventListener("click", openLibrary);
els.openLibraryLink.addEventListener("click", (e) => {
  e.preventDefault();
  openLibrary();
});

// ---- Save this page ----------------------------------------------------
let restoreTimer = null;
els.savePageBtn.addEventListener("click", async () => {
  if (els.savePageBtn.disabled) return;
  els.savePageBtn.disabled = true;
  els.savePageLabel.textContent = "Saving…";
  let ok = false;
  try {
    const res = await ext.runtime.sendMessage({ type: "KIPI_SAVE_PAGE" });
    ok = !!res?.ok;
    if (ok) await refresh();
    else if (res?.skipped) els.savePageLabel.textContent = "Already saved ✓";
  } catch {
    ok = false;
  }
  els.savePageLabel.textContent = ok ? "Saved ✓" : els.savePageLabel.textContent;
  if (!ok && els.savePageLabel.textContent === "Saving…") els.savePageLabel.textContent = "Save this page";
  els.savePageBtn.disabled = false;
  if (restoreTimer) clearTimeout(restoreTimer);
  restoreTimer = setTimeout(() => {
    els.savePageLabel.textContent = "Save this page";
    els.savePageBtn.disabled = false;
  }, 1300);
});

// ---- Save all tabs as one session -----------------------------------------
// One click keeps the whole window's research trail as a single searchable
// card. The count is computed up front so the button never promises more
// than it saves (pinned tabs, chrome pages and duplicates are skipped).
async function countSavableTabs() {
  try {
    const wins = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
    const win = wins.find((w) => w.focused) || wins[0];
    if (!win) return 0;
    return (win.tabs || []).filter((t) => isSavableTabUrl(t.url)).length;
  } catch {
    return 0;
  }
}

function paintTabsButton() {
  const n = state.tabCount;
  els.saveTabsBtn.innerHTML = n > 0 ? `📑 Save all <b>${n}</b> tabs` : `📑 Save all tabs`;
  els.saveTabsBtn.disabled = n === 0;
  els.saveTabsBtn.title =
    n > 0
      ? `Save ${n} open tab${n === 1 ? "" : "s"} as one searchable session`
      : "No savable tabs in this window";
}

els.saveTabsBtn.addEventListener("click", async () => {
  els.saveTabsBtn.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({
      type: "KIPI_SAVE_TABS",
      deckId: els.tabsDeckSelect.value || state.tabsDeck || "inbox",
      name: "",
    });
    if (res?.ok) {
      await refresh();
      window.close();
    } else {
      alert("Kipideck: " + (res?.error || res?.message || "could not save tabs."));
      paintTabsButton();
    }
  } catch (err) {
    alert("Kipideck: " + (err?.message || err));
    paintTabsButton();
  }
});

els.tabsDeckSelect.addEventListener("change", (e) => {
  state.tabsDeck = e.target.value;
});

// ---- Quick note (Enter to save, no extra buttons) ----------------------
const NOTE_PLACEHOLDER = "Quick note — press Enter to save";
els.noteInput.addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;
  const text = els.noteInput.value.trim();
  if (!text) return;
  els.noteInput.value = "";
  els.noteInput.placeholder = "Saved ✓";
  try {
    const res = await ext.runtime.sendMessage({ type: "KIPI_SAVE_NOTE", text });
    if (res?.ok) await refresh();
  } catch {
    /* background busy — note will be lost only if the popup closes */
  }
  setTimeout(() => (els.noteInput.placeholder = NOTE_PLACEHOLDER), 1400);
});

// ---- Search --------------------------------------------------------------
els.searchInput.addEventListener("input", (e) => {
  state.query = e.target.value;
  // Debounced: at scale a query is cheap but not free, and nobody reads the
  // intermediate results of the first three characters.
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => render(), 120);
});

// ---- Helpers --------------------------------------------------------------
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

function typeEmoji(type) {
  return { page: "📄", link: "🔗", image: "🖼️", video: "🎬", selection: "✍️", note: "🗒️", session: "📑" }[type] || "📄";
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function deckById(id) {
  return state.decks.find((d) => d.id === id);
}

// ---- Render ----------------------------------------------------------------
function render() {
  const seq = ++searchSeq;
  const q = state.query.trim();

  const work = q
    ? searchItems({ query: q, limit: PAGE_SIZE, sort: "relevance" })
    : Storage.queryItems({ sort: "new", limit: PAGE_SIZE });

  Promise.resolve(work)
    .then((res) => {
      if (seq !== searchSeq) return; // a newer keystroke already superseded this
      state.items = res.items || [];
      paint(q);
    })
    .catch(() => {
      if (seq !== searchSeq) return;
      state.items = [];
      paint(q);
    });
}

function paint(q) {
  els.itemCount.textContent = `${state.total.toLocaleString()} saved`;
  els.searchRow.hidden = state.total === 0;
  els.setupRow.hidden = state.onboardingDone !== false;

  els.itemsList.innerHTML = "";
  if (state.items.length === 0) {
    els.emptyState.querySelector(".empty-title").textContent =
      q && state.total > 0 ? "No matches" : "Nothing saved yet";
    els.itemsList.appendChild(els.emptyState);
    return;
  }

  for (const it of state.items) {
    const deck = deckById(it.deckId);
    const card = document.createElement("div");
    card.className = "item-card";
    // Icons come from the local cache or a locally drawn letter avatar — never
    // from a third-party favicon service.
    const icon = iconFromMap(state.icons, it.domain, it.title);
    const thumb = it.image
      ? `<img src="${escapeHtml(it.image)}" alt="" onerror="this.parentElement.textContent='${typeEmoji(it.type)}'" />`
      : `<img src="${icon}" alt="" />`;
    card.innerHTML = `
      <div class="item-thumb">${thumb}</div>
      <div class="item-body">
        <div class="item-title">${escapeHtml(it.title || it.url || "Untitled")}</div>
        <div class="item-meta">
          <span class="deck">${deck ? deck.icon + " " + escapeHtml(deck.name) : "📥 Inbox"}</span>
          <span>·</span>
          <span>${timeAgo(it.createdAt)}</span>
        </div>
      </div>
    `;
    card.addEventListener("click", () => {
      const url = it.sourceUrl || it.url;
      if (url) ext.tabs.create({ url });
    });
    els.itemsList.appendChild(card);
  }
}

async function refresh() {
  const [counts, decks, icons, settings, tabCount] = await Promise.all([
    Storage.getCounts(),
    Storage.getDecks(),
    faviconMap(),
    Storage.getSettings(),
    countSavableTabs(),
  ]);
  state.total = counts.total;
  state.decks = decks;
  state.icons = icons;
  state.onboardingDone = settings.onboardingDone !== false;
  state.tabCount = tabCount;
  els.tabsDeckSelect.innerHTML = decks
    .map((d) => `<option value="${d.id}">${d.icon || "📥"} ${d.name}</option>`)
    .join("");
  els.tabsDeckSelect.value = state.tabsDeck;
  if (!els.tabsDeckSelect.value && decks.length) {
    els.tabsDeckSelect.value = decks[0].id;
    state.tabsDeck = decks[0].id;
  }
  paintTabsButton();
  render();
}

if (els.setupLink) {
  els.setupLink.addEventListener("click", (e) => {
    e.preventDefault();
    ext.tabs.create({ url: ext.runtime.getURL("onboarding/onboarding.html") });
  });
}

ext.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "KIPI_ITEM_SAVED" || msg?.type === "KIPI_SYNCED") refresh();
});

refresh();
