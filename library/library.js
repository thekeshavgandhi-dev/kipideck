import { Storage } from "../lib/storage.js";

const state = {
  items: [],
  decks: [],
  view: "all", // 'all' | 'pinned' | deckId
  activeTag: null,
  query: "",
  sort: "new",
  layout: "grid",
  selected: new Set(),
};

const el = (id) => document.getElementById(id);
const els = {
  deckList: el("deckList"),
  tagCloud: el("tagCloud"),
  countAll: el("countAll"),
  countPinned: el("countPinned"),
  viewTitle: el("viewTitle"),
  searchInput: el("searchInput"),
  sortSelect: el("sortSelect"),
  itemsGrid: el("itemsGrid"),
  emptyState: el("emptyState"),
  gridViewBtn: el("gridViewBtn"),
  listViewBtn: el("listViewBtn"),
  bulkBar: el("bulkBar"),
  bulkCount: el("bulkCount"),
  bulkMoveSelect: el("bulkMoveSelect"),
  bulkDeleteBtn: el("bulkDeleteBtn"),
  bulkClearBtn: el("bulkClearBtn"),
  newDeckBtn: el("newDeckBtn"),
  deckModalOverlay: el("deckModalOverlay"),
  deckModalClose: el("deckModalClose"),
  deckIconInput: el("deckIconInput"),
  deckNameInput: el("deckNameInput"),
  deckColorInput: el("deckColorInput"),
  deckSaveBtn: el("deckSaveBtn"),
  modalOverlay: el("modalOverlay"),
  modalBody: el("modalBody"),
  modalClose: el("modalClose"),
  exportBtn: el("exportBtn"),
  importBtn: el("importBtn"),
  importFile: el("importFile"),
  settingsBtn: el("settingsBtn"),
  settingsModalOverlay: el("settingsModalOverlay"),
  settingsModalClose: el("settingsModalClose"),
  autoOrganizeToggle: el("autoOrganizeToggle"),
  toastToggle: el("toastToggle"),
  floatBtnToggle: el("floatBtnToggle"),
  clearAllBtn: el("clearAllBtn"),
};

function typeEmoji(type) {
  return { page: "📄", link: "🔗", image: "🖼️", video: "🎬", selection: "✍️", note: "🗒️" }[type] || "📄";
}
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
function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function deckById(id) {
  return state.decks.find((d) => d.id === id);
}

async function loadAll() {
  const [items, decks, settings] = await Promise.all([
    Storage.getItems(),
    Storage.getDecks(),
    Storage.getSettings(),
  ]);
  state.items = items;
  state.decks = decks;
  state.settings = settings;
  renderSidebar();
  renderGrid();
}

function renderSidebar() {
  els.countAll.textContent = state.items.length || "";
  els.countPinned.textContent = state.items.filter((i) => i.pinned).length || "";

  const counts = {};
  for (const it of state.items) counts[it.deckId] = (counts[it.deckId] || 0) + 1;

  els.deckList.innerHTML = "";
  for (const d of state.decks) {
    const row = document.createElement("div");
    row.className = "nav-item" + (state.view === d.id ? " active" : "");
    row.dataset.deck = d.id;
    row.innerHTML = `
      <span class="nav-ico">${d.icon}</span>
      <span class="nav-label">${escapeHtml(d.name)}</span>
      <span class="nav-count">${counts[d.id] || ""}</span>
      ${!d.builtin ? `<span class="nav-del" title="Delete deck">🗑️</span>` : ""}
    `;
    row.addEventListener("click", (e) => {
      if (e.target.classList.contains("nav-del")) {
        e.stopPropagation();
        if (confirm(`Delete deck "${d.name}"? Items move to Inbox.`)) {
          Storage.deleteDeck(d.id).then(loadAll);
        }
        return;
      }
      state.view = d.id;
      state.activeTag = null;
      updateActiveNav();
      renderGrid();
    });
    els.deckList.appendChild(row);
  }

  // tag cloud from current scope
  const tagCounts = {};
  for (const it of scopedItems(false)) {
    for (const t of it.tags || []) tagCounts[t] = (tagCounts[t] || 0) + 1;
  }
  const tags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 20);
  els.tagCloud.innerHTML = "";
  for (const [tag, count] of tags) {
    const pill = document.createElement("button");
    pill.className = "tag-pill" + (state.activeTag === tag ? " active" : "");
    pill.textContent = `#${tag} ${count}`;
    pill.addEventListener("click", () => {
      state.activeTag = state.activeTag === tag ? null : tag;
      renderGrid();
      renderSidebar();
    });
    els.tagCloud.appendChild(pill);
  }

  // bulk move dropdown options
  els.bulkMoveSelect.innerHTML = `<option value="">Move to deck…</option>` +
    state.decks.map((d) => `<option value="${d.id}">${d.icon} ${d.name}</option>`).join("");
}

function updateActiveNav() {
  document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
  const target = document.querySelector(`.nav-item[data-deck="${state.view}"]`);
  if (target) target.classList.add("active");
  const title = state.view === "all" ? "All items" : state.view === "pinned" ? "Pinned" : deckById(state.view)?.name || "Items";
  els.viewTitle.textContent = title;
}

document.querySelectorAll(".nav-item[data-deck='all'], .nav-item[data-deck='pinned']").forEach((n) => {
  n.addEventListener("click", () => {
    state.view = n.dataset.deck;
    state.activeTag = null;
    updateActiveNav();
    renderGrid();
  });
});

function scopedItems(applyQuery = true) {
  let list = state.items;
  if (state.view === "pinned") list = list.filter((i) => i.pinned);
  else if (state.view !== "all") list = list.filter((i) => i.deckId === state.view);
  if (state.activeTag) list = list.filter((i) => (i.tags || []).includes(state.activeTag));
  if (applyQuery && state.query) {
    const q = state.query;
    list = list.filter((it) => {
      const hay = `${it.title} ${it.excerpt} ${it.content} ${it.note} ${(it.tags || []).join(" ")} ${it.domain}`.toLowerCase();
      return hay.includes(q);
    });
  }
  return list;
}

function sortedItems(list) {
  const arr = [...list];
  if (state.sort === "new") arr.sort((a, b) => b.createdAt - a.createdAt);
  else if (state.sort === "old") arr.sort((a, b) => a.createdAt - b.createdAt);
  else if (state.sort === "az") arr.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  // pinned float to top always
  arr.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  return arr;
}

function renderGrid() {
  updateActiveNav();
  const list = sortedItems(scopedItems(true));
  els.itemsGrid.innerHTML = "";

  if (state.items.length === 0) {
    els.emptyState.classList.remove("hidden");
    els.itemsGrid.style.display = "none";
    return;
  }
  els.itemsGrid.style.display = "";
  if (list.length === 0) {
    els.itemsGrid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-emoji">🔍</div><h3>No matches</h3><p>Try a different search or filter.</p></div>`;
    return;
  }

  for (const it of list) {
    const deck = deckById(it.deckId);
    const card = document.createElement("div");
    card.className = "item-card";
    const thumbContent = it.image
      ? `<img src="${it.image}" onerror="this.parentElement.textContent='${typeEmoji(it.type)}'" />`
      : typeEmoji(it.type);

    card.innerHTML = `
      <input type="checkbox" class="item-check" ${state.selected.has(it.id) ? "checked" : ""} />
      <button class="pin-btn ${it.pinned ? "pinned" : ""}" title="Pin">📍</button>
      <div class="item-thumb-wrap">${thumbContent}</div>
      <div class="item-info">
        <div class="item-title">${escapeHtml(it.title || it.url || "Untitled")}</div>
        <div class="item-excerpt">${escapeHtml(it.excerpt || it.content || "")}</div>
        <div class="tag-row">${(it.tags || []).slice(0, 4).map((t) => `<span class="tag-mini">#${escapeHtml(t)}</span>`).join("")}</div>
        <div class="item-footer">
          <span class="deck-badge" style="background:${deck?.color || "#8895A7"}">${deck?.icon || "📥"} ${deck?.name || "Inbox"}</span>
          <span class="item-domain">${escapeHtml(it.domain || "")}</span>
          <span class="item-time">${timeAgo(it.createdAt)}</span>
        </div>
      </div>
    `;
    card.querySelector(".item-check").addEventListener("click", (e) => {
      e.stopPropagation();
      if (e.target.checked) state.selected.add(it.id);
      else state.selected.delete(it.id);
      renderBulkBar();
    });
    card.querySelector(".pin-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      await Storage.updateItem(it.id, { pinned: !it.pinned });
      await loadAll();
    });
    card.addEventListener("click", () => openDetail(it.id));
    els.itemsGrid.appendChild(card);
  }
}

function renderBulkBar() {
  const n = state.selected.size;
  els.bulkBar.classList.toggle("hidden", n === 0);
  els.bulkCount.textContent = `${n} selected`;
}
els.bulkClearBtn.addEventListener("click", () => {
  state.selected.clear();
  renderBulkBar();
  renderGrid();
});
els.bulkDeleteBtn.addEventListener("click", async () => {
  if (!confirm(`Delete ${state.selected.size} item(s)?`)) return;
  await Storage.deleteMany([...state.selected]);
  state.selected.clear();
  await loadAll();
  renderBulkBar();
});
els.bulkMoveSelect.addEventListener("change", async (e) => {
  const deckId = e.target.value;
  if (!deckId) return;
  for (const id of state.selected) {
    await Storage.updateItem(id, { deckId });
  }
  state.selected.clear();
  e.target.value = "";
  await loadAll();
  renderBulkBar();
});

// Search / sort / view toggle
els.searchInput.addEventListener("input", (e) => {
  state.query = e.target.value.toLowerCase();
  renderGrid();
});
els.sortSelect.addEventListener("change", (e) => {
  state.sort = e.target.value;
  renderGrid();
});
els.gridViewBtn.addEventListener("click", () => {
  state.layout = "grid";
  els.itemsGrid.classList.remove("list-view");
  els.gridViewBtn.classList.add("active");
  els.listViewBtn.classList.remove("active");
});
els.listViewBtn.addEventListener("click", () => {
  state.layout = "list";
  els.itemsGrid.classList.add("list-view");
  els.listViewBtn.classList.add("active");
  els.gridViewBtn.classList.remove("active");
});

// Detail modal
async function openDetail(id) {
  const it = await Storage.getItem(id);
  if (!it) return;
  const deck = deckById(it.deckId);
  const thumb = it.image
    ? `<img src="${it.image}" />`
    : typeEmoji(it.type);

  els.modalBody.innerHTML = `
    <div class="detail-header">
      <div class="detail-thumb">${thumb}</div>
      <div style="flex:1; min-width:0;">
        <input class="detail-title-input" id="dTitle" value="${escapeHtml(it.title || "")}" />
        <div class="detail-meta">
          ${it.url ? `<a href="${it.url}" target="_blank" rel="noopener">${escapeHtml(it.url)}</a>` : ""}
          <div>${timeAgo(it.createdAt)} · ${escapeHtml(it.domain || "")}</div>
        </div>
      </div>
    </div>

    <div class="detail-section-title">Deck</div>
    <select id="dDeck">
      ${state.decks.map((d) => `<option value="${d.id}" ${d.id === it.deckId ? "selected" : ""}>${d.icon} ${d.name}</option>`).join("")}
    </select>

    <div class="detail-section-title">Tags</div>
    <div class="tag-editor" id="dTags">
      ${(it.tags || []).map((t) => `<span class="tag-chip" data-tag="${escapeHtml(t)}">#${escapeHtml(t)} <button>✕</button></span>`).join("")}
      <input id="dTagInput" placeholder="add tag + Enter" />
    </div>

    ${it.content ? `<div class="detail-section-title">Saved content</div><div class="detail-body-text">${escapeHtml(it.content)}</div>` : ""}
    ${it.excerpt && !it.content ? `<div class="detail-section-title">Excerpt</div><div class="detail-body-text">${escapeHtml(it.excerpt)}</div>` : ""}

    <div class="detail-section-title">Reference / source</div>
    <div class="detail-body-text" style="max-height:60px">${escapeHtml(it.reference || it.sourceUrl || it.url || "—")}</div>

    <div class="detail-section-title">Your note</div>
    <textarea id="dNote" rows="2" style="width:100%; border:1px solid var(--border); border-radius:8px; padding:8px; font-family:inherit; font-size:13px;" placeholder="Add a personal note…">${escapeHtml(it.note || "")}</textarea>

    <div class="detail-actions">
      ${it.url ? `<button id="dOpen">🔗 Open source</button>` : ""}
      <button id="dPin">${it.pinned ? "📍 Unpin" : "📌 Pin"}</button>
      <button id="dCopy">📋 Copy reference</button>
      <button id="dSave" style="background:linear-gradient(135deg,#7c5cfc,#4b2fd8); color:#fff; border:none;">💾 Save changes</button>
      <button id="dDelete" class="danger-btn">🗑️ Delete</button>
    </div>
  `;

  const tags = new Set(it.tags || []);
  function renderTagChips() {
    const wrap = document.getElementById("dTags");
    wrap.querySelectorAll(".tag-chip").forEach((c) => c.remove());
    const input = document.getElementById("dTagInput");
    for (const t of tags) {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.innerHTML = `#${escapeHtml(t)} <button>✕</button>`;
      chip.querySelector("button").addEventListener("click", () => {
        tags.delete(t);
        renderTagChips();
      });
      wrap.insertBefore(chip, input);
    }
  }
  document.getElementById("dTagInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.value.trim()) {
      tags.add(e.target.value.trim().toLowerCase().replace(/\s+/g, "-"));
      e.target.value = "";
      renderTagChips();
    }
  });

  if (it.url) {
    document.getElementById("dOpen").addEventListener("click", () => window.open(it.url, "_blank"));
  }
  document.getElementById("dPin").addEventListener("click", async () => {
    await Storage.updateItem(it.id, { pinned: !it.pinned });
    closeModal();
    await loadAll();
  });
  document.getElementById("dCopy").addEventListener("click", async () => {
    await navigator.clipboard.writeText(it.reference || it.url || "");
    const btn = document.getElementById("dCopy");
    btn.textContent = "✅ Copied";
    setTimeout(() => (btn.textContent = "📋 Copy reference"), 1200);
  });
  document.getElementById("dDelete").addEventListener("click", async () => {
    if (!confirm("Delete this item?")) return;
    await Storage.deleteItem(it.id);
    closeModal();
    await loadAll();
  });
  document.getElementById("dSave").addEventListener("click", async () => {
    await Storage.updateItem(it.id, {
      title: document.getElementById("dTitle").value.trim(),
      deckId: document.getElementById("dDeck").value,
      note: document.getElementById("dNote").value,
      tags: Array.from(tags),
    });
    closeModal();
    await loadAll();
  });

  els.modalOverlay.classList.remove("hidden");
}
function closeModal() {
  els.modalOverlay.classList.add("hidden");
}
els.modalClose.addEventListener("click", closeModal);
els.modalOverlay.addEventListener("click", (e) => {
  if (e.target === els.modalOverlay) closeModal();
});

// New deck modal
els.newDeckBtn.addEventListener("click", () => els.deckModalOverlay.classList.remove("hidden"));
els.deckModalClose.addEventListener("click", () => els.deckModalOverlay.classList.add("hidden"));
els.deckModalOverlay.addEventListener("click", (e) => {
  if (e.target === els.deckModalOverlay) els.deckModalOverlay.classList.add("hidden");
});
els.deckSaveBtn.addEventListener("click", async () => {
  const name = els.deckNameInput.value.trim();
  if (!name) return;
  await Storage.addDeck(name, els.deckIconInput.value.trim() || "🗂️", els.deckColorInput.value);
  els.deckNameInput.value = "";
  els.deckModalOverlay.classList.add("hidden");
  await loadAll();
});

// Settings modal
els.settingsBtn.addEventListener("click", async () => {
  const s = await Storage.getSettings();
  els.autoOrganizeToggle.checked = !!s.autoOrganize;
  els.toastToggle.checked = !!s.showToast;
  els.floatBtnToggle.checked = !!s.showFloatingButton;
  els.settingsModalOverlay.classList.remove("hidden");
});
els.settingsModalClose.addEventListener("click", () => els.settingsModalOverlay.classList.add("hidden"));
els.settingsModalOverlay.addEventListener("click", (e) => {
  if (e.target === els.settingsModalOverlay) els.settingsModalOverlay.classList.add("hidden");
});
[els.autoOrganizeToggle, els.toastToggle, els.floatBtnToggle].forEach((t) => {
  t.addEventListener("change", () => {
    Storage.updateSettings({
      autoOrganize: els.autoOrganizeToggle.checked,
      showToast: els.toastToggle.checked,
      showFloatingButton: els.floatBtnToggle.checked,
    });
  });
});
els.clearAllBtn.addEventListener("click", async () => {
  if (!confirm("This deletes ALL saved items and resets your decks. Continue?")) return;
  await Storage.clearAll();
  els.settingsModalOverlay.classList.add("hidden");
  await loadAll();
});

// Export / import
els.exportBtn.addEventListener("click", async () => {
  const json = await Storage.exportJSON();
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `kipideck-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});
els.importBtn.addEventListener("click", () => els.importFile.click());
els.importFile.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  try {
    await Storage.importJSON(text);
    await loadAll();
    alert("Import complete!");
  } catch (err) {
    alert("Could not import file: " + err.message);
  }
  els.importFile.value = "";
});

// live updates from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "KIPI_ITEM_SAVED") loadAll();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes[Storage.KEYS.ITEMS] || changes[Storage.KEYS.DECKS])) {
    loadAll();
  }
});

loadAll();
