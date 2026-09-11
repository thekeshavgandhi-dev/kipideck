import { Storage } from "../lib/storage.js";

const els = {
  savePageBtn: document.getElementById("savePageBtn"),
  saveNoteBtn: document.getElementById("saveNoteBtn"),
  noteBox: document.getElementById("noteBox"),
  noteInput: document.getElementById("noteInput"),
  noteSaveBtn: document.getElementById("noteSaveBtn"),
  noteCancelBtn: document.getElementById("noteCancelBtn"),
  searchInput: document.getElementById("searchInput"),
  deckChips: document.getElementById("deckChips"),
  itemsList: document.getElementById("itemsList"),
  emptyState: document.getElementById("emptyState"),
  itemCount: document.getElementById("itemCount"),
  openLibraryBtn: document.getElementById("openLibraryBtn"),
  openLibraryLink: document.getElementById("openLibraryLink"),
};

let state = { items: [], decks: [], activeDeck: "all", query: "" };

function openLibrary() {
  chrome.tabs.create({ url: chrome.runtime.getURL("library/library.html") });
}
els.openLibraryBtn.addEventListener("click", openLibrary);
els.openLibraryLink.addEventListener("click", (e) => {
  e.preventDefault();
  openLibrary();
});

els.savePageBtn.addEventListener("click", async () => {
  els.savePageBtn.disabled = true;
  els.savePageBtn.innerHTML = `<span class="ico">⏳</span> Saving…`;
  chrome.runtime.sendMessage({ type: "KIPI_SAVE_PAGE" }, async (res) => {
    els.savePageBtn.disabled = false;
    els.savePageBtn.innerHTML = `<span class="ico">📌</span> Save this page`;
    if (res?.ok) {
      await refresh();
    }
  });
});

els.saveNoteBtn.addEventListener("click", () => {
  els.noteBox.classList.remove("hidden");
  els.noteInput.focus();
});
els.noteCancelBtn.addEventListener("click", () => {
  els.noteBox.classList.add("hidden");
  els.noteInput.value = "";
});
els.noteSaveBtn.addEventListener("click", () => {
  const text = els.noteInput.value.trim();
  if (!text) return;
  chrome.runtime.sendMessage({ type: "KIPI_SAVE_NOTE", text }, async (res) => {
    if (res?.ok) {
      els.noteInput.value = "";
      els.noteBox.classList.add("hidden");
      await refresh();
    }
  });
});

els.searchInput.addEventListener("input", (e) => {
  state.query = e.target.value.toLowerCase();
  render();
});

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

function renderDeckChips() {
  const counts = {};
  for (const it of state.items) counts[it.deckId] = (counts[it.deckId] || 0) + 1;
  const usedDecks = state.decks.filter((d) => counts[d.id]);
  els.deckChips.innerHTML = "";
  const allChip = document.createElement("button");
  allChip.className = "chip" + (state.activeDeck === "all" ? " active" : "");
  allChip.textContent = `All (${state.items.length})`;
  allChip.onclick = () => {
    state.activeDeck = "all";
    render();
  };
  els.deckChips.appendChild(allChip);
  for (const d of usedDecks) {
    const chip = document.createElement("button");
    chip.className = "chip" + (state.activeDeck === d.id ? " active" : "");
    chip.textContent = `${d.icon} ${d.name} (${counts[d.id]})`;
    chip.onclick = () => {
      state.activeDeck = d.id;
      render();
    };
    els.deckChips.appendChild(chip);
  }
}

function filteredItems() {
  return state.items.filter((it) => {
    if (state.activeDeck !== "all" && it.deckId !== state.activeDeck) return false;
    if (state.query) {
      const hay = `${it.title} ${it.excerpt} ${it.content} ${it.tags?.join(" ")} ${it.domain}`.toLowerCase();
      if (!hay.includes(state.query)) return false;
    }
    return true;
  });
}

function deckById(id) {
  return state.decks.find((d) => d.id === id);
}

function renderItems() {
  const items = filteredItems().slice(0, 40);
  els.itemsList.innerHTML = "";
  if (items.length === 0) {
    els.emptyState.style.display = "block";
    els.itemsList.appendChild(els.emptyState);
    return;
  }
  els.emptyState.style.display = "none";
  for (const it of items) {
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
          <span class="item-deck-badge">${deck ? deck.icon + " " + deck.name : "Inbox"}</span>
          <span>${timeAgo(it.createdAt)}</span>
        </div>
      </div>`;
    card.addEventListener("click", () => {
      const url = it.sourceUrl || it.url;
      if (url) chrome.tabs.create({ url });
    });
    els.itemsList.appendChild(card);
  }
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function render() {
  renderDeckChips();
  renderItems();
  els.itemCount.textContent = `${state.items.length} item${state.items.length === 1 ? "" : "s"} saved`;
}

async function refresh() {
  const [items, decks] = await Promise.all([Storage.getItems(), Storage.getDecks()]);
  state.items = items;
  state.decks = decks;
  render();
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "KIPI_ITEM_SAVED") refresh();
});

refresh();
