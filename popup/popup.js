import { ext } from "../lib/compat.js";
import { Storage } from "../lib/storage.js";
import { search as fullTextSearch } from "../lib/search.js";

const els = {
  savePageBtn: document.getElementById("savePageBtn"),
  savePageLabel: document.getElementById("savePageLabel"),
  noteInput: document.getElementById("noteInput"),
  searchRow: document.getElementById("searchRow"),
  searchInput: document.getElementById("searchInput"),
  itemsList: document.getElementById("itemsList"),
  emptyState: document.getElementById("emptyState"),
  itemCount: document.getElementById("itemCount"),
  openLibraryBtn: document.getElementById("openLibraryBtn"),
  openLibraryLink: document.getElementById("openLibraryLink"),
};

let state = { items: [], decks: [], query: "" };

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
  } catch {
    ok = false;
  }
  els.savePageLabel.textContent = ok ? "Saved ✓" : "Save this page";
  if (!ok) {
    els.savePageBtn.disabled = false;
    return;
  }
  if (restoreTimer) clearTimeout(restoreTimer);
  restoreTimer = setTimeout(() => {
    els.savePageLabel.textContent = "Save this page";
    els.savePageBtn.disabled = false;
  }, 1300);
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
  render();
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
  return { page: "📄", link: "🔗", image: "🖼️", video: "🎬", selection: "✍️", note: "🗒️" }[type] || "📄";
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>\"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function deckById(id) {
  return state.decks.find((d) => d.id === id);
}

// ---- Render ----------------------------------------------------------------
function render() {
  els.itemCount.textContent = `${state.items.length} saved`;
  els.searchRow.hidden = state.items.length === 0;

  const q = state.query.trim();
  const list = (q ? fullTextSearch(state.items, q) : state.items).slice(0, 40);

  els.itemsList.innerHTML = "";
  if (list.length === 0) {
    els.emptyState.querySelector(".empty-title").textContent =
      q && state.items.length > 0 ? "No matches" : "Nothing saved yet";
    els.itemsList.appendChild(els.emptyState);
    return;
  }

  for (const it of list) {
    const deck = deckById(it.deckId);
    const card = document.createElement("div");
    card.className = "item-card";
    const thumb = it.image
      ? `<img src="${it.image}" onerror="this.parentElement.textContent='${typeEmoji(it.type)}'" />`
      : it.favicon
      ? `<img src="${it.favicon}" onerror="this.parentElement.textContent='${typeEmoji(it.type)}'" />`
      : typeEmoji(it.type);
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
  const [items, decks] = await Promise.all([Storage.getItems(), Storage.getDecks()]);
  state.items = items;
  state.decks = decks;
  render();
}

ext.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "KIPI_ITEM_SAVED" || msg?.type === "KIPI_SYNCED") refresh();
});

refresh();
