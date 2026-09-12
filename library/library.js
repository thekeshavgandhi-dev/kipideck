// library/library.js — the full dashboard.
//
// Phase 0 rewrote the data path here. It used to load EVERY item into memory,
// run a full-text search twice per keystroke (once for the list, once for the
// "N items" label) and render every result as a DOM node. At 500 items that was
// already a 2.2-second freeze per query.
//
// Now: counts come from native index queries, pages of 60 cards are fetched on
// demand (infinite scroll), search is debounced and answered from the persistent
// index, full page text is fetched only for the cards on screen (for snippets)
// and for the item you open, and the view label reuses the total the query
// already returned instead of re-running it.

import { ext } from "../lib/compat.js";
import { Storage } from "../lib/storage.js";
import { searchItems, snippet as searchSnippet } from "../lib/search.js";
import { faviconMap, iconFromMap } from "../lib/favicons.js";
import * as DriveSync from "../lib/drive-sync.js";
import * as Import from "../lib/import.js";
import * as Exporters from "../lib/exporters.js";
import { expandZip, isZipName } from "../lib/unzip.js";
import { STATUSES, STATUS_META, statusOf } from "../lib/status.js";
import { sessionTabs, sessionAsUrlList } from "../lib/sessions.js";

const PAGE_SIZE = 60;
const PINNED_FIRST_CAP = 200;

const state = {
  decks: [],
  settings: {},
  counts: { total: 0, pinned: 0, byDeck: {} },
  tagCounts: {},
  icons: new Map(),
  view: "all", // 'all' | 'pinned' | deckId
  activeTag: null,
  activeStatus: null, // one of STATUSES, or null for "everything"
  query: "",
  sort: "new",
  layout: "grid",
  selected: new Set(),
  // paging
  rendered: 0,
  total: 0,
  loading: false,
  exhausted: false,
  seq: 0,
  pinnedFirstIds: new Set(),
  degraded: false,
  contentCache: new Map(),
};

const el = (id) => document.getElementById(id);
const els = {
  deckList: el("deckList"),
  tagsSection: el("tagsSection"),
  tagCloud: el("tagCloud"),
  countAll: el("countAll"),
  countPinned: el("countPinned"),
  viewTitle: el("viewTitle"),
  viewSub: el("viewSub"),
  searchInput: el("searchInput"),
  sortSelect: el("sortSelect"),
  itemsGrid: el("itemsGrid"),
  gridSentinel: el("gridSentinel"),
  emptyState: el("emptyState"),
  setupBanner: el("setupBanner"),
  setupBannerBtn: el("setupBannerBtn"),
  bulkBar: el("bulkBar"),
  bulkCount: el("bulkCount"),
  bulkMoveSelect: el("bulkMoveSelect"),
  bulkStatusSelect: el("bulkStatusSelect"),
  statusChips: el("statusChips"),
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
  exportModalOverlay: el("exportModalOverlay"),
  exportModalBody: el("exportModalBody"),
  exportModalCancel: el("exportModalCancel"),
  importBtn: el("importBtn"),
  importBanner: el("importBanner"),
  importBannerBtn: el("importBannerBtn"),
  importFile: el("importFile"),
  importModalOverlay: el("importModalOverlay"),
  importModalBody: el("importModalBody"),
  importModalCancel: el("importModalCancel"),
  settingsBtn: el("settingsBtn"),
  settingsModalOverlay: el("settingsModalOverlay"),
  settingsModalClose: el("settingsModalClose"),
  autoOrganizeToggle: el("autoOrganizeToggle"),
  autoSaveToggle: el("autoSaveToggle"),
  toastToggle: el("toastToggle"),
  spaceKToggle: el("spaceKToggle"),
  autoDoneToggle: el("autoDoneToggle"),
  mutedSites: el("mutedSites"),
  diagBody: el("diagBody"),
  reindexBtn: el("reindexBtn"),
  syncWarning: el("syncWarning"),
  clearAllBtn: el("clearAllBtn"),
  syncStatus: el("syncStatus"),
  syncClientSecretInput: el("syncClientSecretInput"),
  syncClearSecretBtn: el("syncClearSecretBtn"),
  syncSetupMsg: el("syncSetupMsg"),
  syncStatusIcon: el("syncStatusIcon"),
  syncStatusText: el("syncStatusText"),
  syncSignedOut: el("syncSignedOut"),
  syncSignedIn: el("syncSignedIn"),
  syncClientIdInput: el("syncClientIdInput"),
  syncSaveClientIdBtn: el("syncSaveClientIdBtn"),
  syncSignInBtn: el("syncSignInBtn"),
  syncSignOutBtn: el("syncSignOutBtn"),
  syncNowBtn: el("syncNowBtn"),
  syncAccountEmail: el("syncAccountEmail"),
  syncLastAt: el("syncLastAt"),
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function typeEmoji(type) {
  return { page: "📄", link: "🔗", image: "🖼️", video: "🎬", selection: "✍️", note: "🗒️", session: "📑" }[type] || "📄";
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
/** "#7C5CFC" + alpha -> "rgba(124,92,252,0.14)" (soft deck-color tints). */
function hexToRgba(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return `rgba(136,149,167,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** The deck/tag/pinned scope the current view implies. */
function scope() {
  return {
    deckId: state.view !== "all" && state.view !== "pinned" ? state.view : null,
    tag: state.activeTag,
    pinned: state.view === "pinned",
    status: state.activeStatus,
  };
}

// ---------------------------------------------------------------------------
// Sidebar (counts come from native index queries, never from loading everything)
// ---------------------------------------------------------------------------
async function renderSidebar() {
  const [counts, tagCounts] = await Promise.all([Storage.getCounts(), Storage.getTagCounts()]);
  state.counts = counts;
  state.tagCounts = tagCounts;

  els.countAll.textContent = counts.total ? counts.total.toLocaleString() : "";
  els.countPinned.textContent = counts.pinned ? counts.pinned.toLocaleString() : "";

  els.deckList.innerHTML = "";
  for (const d of state.decks) {
    const row = document.createElement("div");
    row.className = "nav-item" + (state.view === d.id ? " active" : "");
    row.dataset.deck = d.id;
    const count = counts.byDeck[d.id] || 0;
    row.innerHTML = `
      <span class="nav-ico">${d.icon}</span>
      <span class="nav-label">${escapeHtml(d.name)}</span>
      <span class="nav-count">${count ? count.toLocaleString() : ""}</span>
      ${!d.builtin ? `<span class="nav-del" title="Delete deck">🗑️</span>` : ""}
    `;
    row.addEventListener("click", (e) => {
      if (e.target.classList.contains("nav-del")) {
        e.stopPropagation();
        deleteDeck(d);
        return;
      }
      state.view = d.id;
      state.activeTag = null;
      updateActiveNav();
      renderGrid({ reset: true });
    });
    els.deckList.appendChild(row);
  }

  const tags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 20);
  els.tagsSection.classList.toggle("hidden", tags.length === 0);
  els.tagCloud.innerHTML = "";
  for (const [tag, count] of tags) {
    const pill = document.createElement("button");
    pill.className = "tag-pill" + (state.activeTag === tag ? " active" : "");
    pill.textContent = `#${tag} ${count}`;
    pill.addEventListener("click", () => {
      state.activeTag = state.activeTag === tag ? null : tag;
      renderGrid({ reset: true });
      renderSidebar();
    });
    els.tagCloud.appendChild(pill);
  }

  // Save-state chips (ideas.md I-12): a single-select triage filter with live
  // counts. Unlike the deck/tag nav it is never cleared by switching views —
  // triaging "unread" while hopping between decks is the whole workflow.
  const byStatus = counts.byStatus || {};
  els.statusChips.innerHTML = "";
  for (const s of STATUSES) {
    const meta = STATUS_META[s];
    const pill = document.createElement("button");
    pill.className = "tag-pill" + (state.activeStatus === s ? " active" : "");
    pill.title = meta.hint;
    pill.textContent = `${meta.icon} ${meta.label} ${byStatus[s] || 0}`;
    pill.addEventListener("click", () => {
      state.activeStatus = state.activeStatus === s ? null : s;
      renderGrid({ reset: true });
      renderSidebar();
    });
    els.statusChips.appendChild(pill);
  }

  els.bulkMoveSelect.innerHTML =
    `<option value="">Move to deck…</option>` +
    state.decks.map((d) => `<option value="${d.id}">${d.icon} ${escapeHtml(d.name)}</option>`).join("");
  els.bulkStatusSelect.innerHTML =
    `<option value="">Set status…</option>` +
    STATUSES.map((s) => `<option value="${s}">${STATUS_META[s].icon} ${STATUS_META[s].label}</option>`).join("");
}

async function deleteDeck(d) {
  const count = state.counts.byDeck[d.id] || 0;
  if (!confirm(`Delete the deck “${d.name}”?${count ? ` Its ${count} item(s) move to Inbox — nothing is deleted.` : ""}`)) return;
  await Storage.deleteDeck(d.id);
  await reload();
}

function updateActiveNav() {
  document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
  const target = document.querySelector(`.nav-item[data-deck="${state.view}"]`);
  if (target) target.classList.add("active");
  els.viewTitle.textContent =
    state.view === "all" ? "All items" : state.view === "pinned" ? "Pinned" : deckById(state.view)?.name || "Items";
}

document.querySelectorAll(".nav-item[data-deck='all'], .nav-item[data-deck='pinned']").forEach((n) => {
  n.addEventListener("click", () => {
    state.view = n.dataset.deck;
    state.activeTag = null;
    updateActiveNav();
    renderGrid({ reset: true });
  });
});

// ---------------------------------------------------------------------------
// Grid: one query per page, appended as you scroll
// ---------------------------------------------------------------------------
function viewSubText() {
  let sub = `${state.total.toLocaleString()} item${state.total === 1 ? "" : "s"}`;
  if (state.activeTag) sub += ` · #${state.activeTag}`;
  if (state.activeStatus) sub += ` · ${STATUS_META[state.activeStatus]?.label || state.activeStatus}`;
  if (state.query.trim()) sub += ` · “${state.query.trim()}”`;
  if (state.degraded) sub += " · showing closest matches";
  if (state.rendered < state.total) sub += ` · ${state.rendered.toLocaleString()} shown`;
  return sub;
}

async function fetchPage(offset, limit) {
  const { deckId, tag, pinned, status } = scope();
  const q = state.query.trim();
  const opts = {
    deckId,
    tag,
    pinned,
    status,
    limit,
    offset,
    excludeIds: state.pinnedFirstIds.size ? state.pinnedFirstIds : null,
  };
  if (q) return searchItems({ ...opts, query: q, sort: "relevance" });
  return Storage.queryItems({ ...opts, sort: state.sort });
}

/**
 * Load and append the next page. `reset` clears the grid first (view change,
 * new query, sort change) and floats pinned items to the top like v1.3 did —
 * without ever loading the whole corpus to do it.
 */
async function renderGrid({ reset = false } = {}) {
  const seq = ++state.seq;
  if (reset) {
    state.rendered = 0;
    state.total = 0;
    state.exhausted = false;
    state.pinnedFirstIds = new Set();
    state.contentCache = new Map();
    els.itemsGrid.innerHTML = "";
    updateActiveNav();
  }
  if (state.loading || state.exhausted) return;
  state.loading = true;

  try {
    const { deckId, tag, pinned, status } = scope();
    let cards = [];

    // Pinned-first only applies to a fresh, non-pinned view.
    if (reset && !pinned) {
      const pins = await Storage.pinnedInScope({ deckId, tag, status, sort: state.sort, cap: PINNED_FIRST_CAP });
      if (pins.length) {
        state.pinnedFirstIds = new Set(pins.map((p) => p.id));
        cards = pins;
      }
    }

    const res = await fetchPage(state.rendered, PAGE_SIZE);
    if (seq !== state.seq) return; // a newer view/query superseded this page

    state.total = res.total ?? 0;
    state.degraded = !!res.degraded;
    cards = cards.concat(res.items || []);
    state.rendered += (res.items || []).length;
    if (!res.items || res.items.length < PAGE_SIZE) state.exhausted = true;

    for (const it of cards) els.itemsGrid.appendChild(cardFor(it));

    const onScreen = els.itemsGrid.children.length;
    els.emptyState.classList.toggle("hidden", onScreen > 0);

    els.viewSub.textContent = viewSubText();
    if (els.gridSentinel) els.gridSentinel.classList.toggle("hidden", state.exhausted);

    // Snippets need page text, which is stored separately — fetch it in ONE
    // batch for just the cards that are on screen.
    if (state.query.trim()) fillSnippets(cards.map((c) => c.id));
  } catch (err) {
    console.error("[kipideck] render failed", err);
    if (state.rendered === 0) {
      els.viewSub.textContent = "Could not load items — try Settings → Diagnostics → Rebuild search index.";
    }
  } finally {
    state.loading = false;
  }
}

async function fillSnippets(ids) {
  if (!ids.length) return;
  const missing = ids.filter((id) => !state.contentCache.has(id));
  if (missing.length) {
    const contents = await Storage.getContentsFor(missing);
    for (const id of missing) state.contentCache.set(id, contents.get(id)?.text || "");
  }
  for (const id of ids) {
    const node = els.itemsGrid.querySelector(`.item-card[data-id="${CSS.escape(id)}"] .item-excerpt`);
    if (!node) continue;
    const text = state.contentCache.get(id) || "";
    const it = { excerpt: node.dataset.excerpt || "", content: text };
    node.textContent = excerptFor(it);
  }
}

function excerptFor(it) {
  if (state.query.trim() && it.content) {
    const snip = searchSnippet(it.content, state.query);
    if (snip) return snip;
  }
  return it.excerpt || it.content || "";
}

function cardFor(it) {
  const deck = deckById(it.deckId);
  const color = deck?.color || "#8895A7";
  const card = document.createElement("div");
  card.className = "item-card";
  card.dataset.id = it.id;
  card.style.animationDelay = `${Math.min(state.rendered * 8, 240)}ms`;

  // Icons come from the local cache, or a locally drawn letter avatar. There is
  // no third-party favicon service anywhere in Kipideck.
  const icon = iconFromMap(state.icons, it.domain, it.title);
  const thumbContent = it.image
    ? `<img src="${escapeHtml(it.image)}" alt="" loading="lazy" onerror="this.parentElement.textContent='${typeEmoji(it.type)}'" />`
    : it.type === "page" || it.type === "link"
    ? `<img src="${icon}" alt="" loading="lazy" onerror="this.parentElement.textContent='${typeEmoji(it.type)}'" />`
    : typeEmoji(it.type);
  const thumbTint = it.image
    ? ""
    : `style="background:linear-gradient(135deg, ${hexToRgba(color, 0.16)}, ${hexToRgba(color, 0.05)})"`;

  // "Unread" shows no badge — it is the default state, and a badge on every card
  // would be noise. Anything else earned its label by being triaged.
  const itemStatus = statusOf(it);
  const statusBadge =
    itemStatus === "unread"
      ? ""
      : `<span class="status-badge status-${itemStatus}">${STATUS_META[itemStatus].icon} ${STATUS_META[itemStatus].label}</span>`;
  const tabs = it.type === "session" ? sessionTabs(it) : [];
  const sessionBadge =
    it.type === "session" && tabs.length
      ? `<span class="session-count">📑 ${tabs.length} tab${tabs.length === 1 ? "" : "s"}</span>`
      : "";

  card.innerHTML = `
    <div class="item-thumb-wrap" ${thumbTint}>
      <input type="checkbox" class="item-check" title="Select" ${state.selected.has(it.id) ? "checked" : ""} />
      <button class="pin-btn ${it.pinned ? "pinned" : ""}" title="${it.pinned ? "Unpin" : "Pin"}">📍</button>
      ${it.type === "session" ? `<button class="restore-btn" title="Restore all tabs">⤢</button>` : ""}
      ${thumbContent}
    </div>
    <div class="item-info">
      <div class="item-title">${escapeHtml(it.title || it.url || "Untitled")}</div>
      <div class="item-excerpt" data-excerpt="${escapeHtml(it.excerpt || "")}">${escapeHtml(it.excerpt || "")}</div>
      <div class="item-footer">
        <span class="deck-badge" style="background:${hexToRgba(color, 0.12)}; color:${color}">${deck?.icon || "📥"} ${escapeHtml(deck?.name || "Inbox")}</span>
        ${statusBadge}${sessionBadge}
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
    await reload();
  });
  const restoreBtn = card.querySelector(".restore-btn");
  if (restoreBtn) {
    restoreBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await restoreSession(it);
    });
  }
  card.addEventListener("click", () => openDetail(it.id));
  return card;
}

// Sessions restore the way a person reopens a desk: the first tab takes
// focus, the rest load quietly in the background. Above RESTORE_CONFIRM_AT
// tabs we ask first, because twenty windows appearing at once is how
// laptops learn to fly.
const RESTORE_CONFIRM_AT = 20;

async function restoreSession(it) {
  const tabs = sessionTabs(it);
  if (!tabs.length) return;
  if (tabs.length > RESTORE_CONFIRM_AT) {
    const ok = confirm(
      `Restore ${tabs.length} tabs from “${it.title || "session"}”? The first opens in front, the rest in the background.`
    );
    if (!ok) return;
  }
  let failed = 0;
  for (let i = 0; i < tabs.length; i++) {
    try {
      await ext.tabs.create({ url: tabs[i].url, active: i === 0 });
    } catch {
      failed++;
    }
  }
  toast(
    failed === 0
      ? `Restored ${tabs.length} tab${tabs.length === 1 ? "" : "s"} 📑`
      : `Restored ${tabs.length - failed} of ${tabs.length} tabs (${failed} blocked by the browser)`
  );
}

// Infinite scroll: fetch the next page when the sentinel comes into view.
if (els.gridSentinel && "IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting) && !state.loading && !state.exhausted) {
        renderGrid({ reset: false });
      }
    },
    { rootMargin: "600px" }
  );
  io.observe(els.gridSentinel);
} else if (els.gridSentinel) {
  els.gridSentinel.addEventListener("click", () => renderGrid({ reset: false }));
}

function renderBulkBar() {
  const n = state.selected.size;
  els.bulkBar.classList.toggle("hidden", n === 0);
  els.bulkCount.textContent = `${n} selected`;
  els.itemsGrid.classList.toggle("selecting", n > 0);
}

els.bulkClearBtn.addEventListener("click", () => {
  state.selected.clear();
  renderBulkBar();
  renderGrid({ reset: true });
});
els.bulkDeleteBtn.addEventListener("click", async () => {
  if (!confirm(`Delete ${state.selected.size} item(s)?`)) return;
  await Storage.deleteMany([...state.selected]);
  state.selected.clear();
  renderBulkBar();
  await reload();
});
els.bulkMoveSelect.addEventListener("change", async (e) => {
  const deckId = e.target.value;
  if (!deckId) return;
  for (const id of state.selected) await Storage.updateItem(id, { deckId });
  state.selected.clear();
  renderBulkBar();
  await reload();
});
els.bulkStatusSelect.addEventListener("change", async (e) => {
  const status = e.target.value;
  if (!status) return;
  for (const id of state.selected) await Storage.updateItem(id, { status });
  state.selected.clear();
  renderBulkBar();
  await reload();
});

// ---------------------------------------------------------------------------
// Search / sort / view toggles
// ---------------------------------------------------------------------------
let searchTimer = null;
els.searchInput.addEventListener("input", (e) => {
  state.query = e.target.value;
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => renderGrid({ reset: true }), 120);
});
els.sortSelect.addEventListener("change", () => {
  state.sort = els.sortSelect.value;
  renderGrid({ reset: true });
});
els.gridViewBtn = el("gridViewBtn");
els.listViewBtn = el("listViewBtn");
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

// ---------------------------------------------------------------------------
// Item detail
// ---------------------------------------------------------------------------
async function openDetail(id) {
  const it = await Storage.getItem(id);
  if (!it) return;
  const { text } = await Storage.getItemContent(id); // lazy: only what you opened
  const deck = deckById(it.deckId);
  const color = deck?.color || "#8895A7";
  const hero = it.type === "image" && it.image ? `<img class="detail-hero" src="${escapeHtml(it.image)}" alt="" />` : "";
  const thumb = it.image ? `<img src="${escapeHtml(it.image)}" alt="" />` : `<img src="${iconFromMap(state.icons, it.domain, it.title)}" alt="" />`;
  const thumbTint = it.image ? "" : `style="background:linear-gradient(135deg, ${hexToRgba(color, 0.16)}, ${hexToRgba(color, 0.05)})"`;
  // Sessions show their tab list instead of a source link; every item shows
  // its save-state pills.
  const isSession = it.type === "session";
  const detailTabs = isSession ? sessionTabs(it) : [];
  const detailStatus = statusOf(it);

  els.modalBody.innerHTML = `
    ${hero}
    <div class="detail-header">
      <div class="detail-thumb" ${thumbTint}>${thumb}</div>
      <div style="flex:1; min-width:0;">
        <input class="detail-title-input" id="dTitle" value="${escapeHtml(it.title || "")}" />
        <div class="detail-meta">
          ${it.url ? `<a href="${escapeHtml(it.url)}" target="_blank" rel="noopener">${escapeHtml(it.url)}</a>` : ""}
          <div>${timeAgo(it.createdAt)}${it.domain ? ` · ${escapeHtml(it.domain)}` : ""}</div>
        </div>
      </div>
    </div>

    <div class="detail-section-title">Deck</div>
    <select id="dDeck">
      ${state.decks.map((d) => `<option value="${d.id}" ${d.id === it.deckId ? "selected" : ""}>${d.icon} ${escapeHtml(d.name)}</option>`).join("")}
    </select>

    <div class="detail-section-title">Status</div>
    <div class="status-pills" id="dStatusRow">
      ${STATUSES.map(
        (s) =>
          `<button class="status-pill${detailStatus === s ? " active" : ""}" data-status="${s}" title="${STATUS_META[s].hint}">${STATUS_META[s].icon} ${STATUS_META[s].label}</button>`
      ).join("")}
    </div>

    <div class="detail-section-title">Tags</div>
    <div class="tag-editor" id="dTags">
      ${(it.tags || []).map((t) => `<span class="tag-chip" data-tag="${escapeHtml(t)}">#${escapeHtml(t)} <button>✕</button></span>`).join("")}
      <input id="dTagInput" placeholder="add tag + Enter" />
    </div>

    ${
      isSession && detailTabs.length
        ? `<div class="detail-section-title">Tabs in this window (${detailTabs.length})</div>
    <div class="session-tabs" id="dSessionTabs">
      ${detailTabs
        .map(
          (t, i) =>
            `<button class="session-tab" data-idx="${i}" title="${escapeHtml(t.url)}"><span class="session-tab-title">${escapeHtml(t.title)}</span><span class="session-tab-url">${escapeHtml(t.url)}</span></button>`
        )
        .join("")}
    </div>`
        : ""
    }

    ${text ? `<div class="detail-section-title">Saved content</div><div class="detail-body-text">${escapeHtml(text)}</div>` : ""}
    ${it.excerpt && !text ? `<div class="detail-section-title">Excerpt</div><div class="detail-body-text">${escapeHtml(it.excerpt)}</div>` : ""}

    ${
      isSession
        ? ""
        : `<div class="detail-section-title">Reference / source</div>
    <div class="detail-body-text" style="max-height:60px">${escapeHtml(it.reference || it.sourceUrl || it.url || "—")}</div>`
    }

    <div class="detail-section-title">Your note</div>
    <textarea id="dNote" rows="2" class="detail-note" placeholder="Add a personal note…">${escapeHtml(it.note || "")}</textarea>

    <div class="detail-actions">
      ${it.url ? `<button id="dOpen">🔗 Open source</button>` : ""}
      ${isSession && detailTabs.length ? `<button id="dRestore">⤢ Restore all ${detailTabs.length}</button><button id="dCopyTabs">📋 Copy links</button>` : ""}
      <button id="dPin">${it.pinned ? "📍 Unpin" : "📌 Pin"}</button>
      <button id="dCopy">📋 Copy reference</button>
      <button id="dDelete" class="danger-btn">Delete</button>
      <button id="dSave" class="primary">💾 Save changes</button>
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

  // Status pills apply immediately — triage is one click per item, not one click
  // plus a save button. The grid behind reloads; the modal stays open.
  const statusRow = document.getElementById("dStatusRow");
  if (statusRow) {
    statusRow.querySelectorAll(".status-pill").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const next = btn.dataset.status;
        await Storage.updateItem(it.id, { status: next });
        statusRow
          .querySelectorAll(".status-pill")
          .forEach((b) => b.classList.toggle("active", b.dataset.status === next));
        await reload();
      });
    });
  }

  // One tab at a time, the whole window at once, or all links to the clipboard.
  const sessionWrap = document.getElementById("dSessionTabs");
  if (sessionWrap) {
    sessionWrap.querySelectorAll(".session-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        const t = detailTabs[Number(btn.dataset.idx)];
        if (t?.url) window.open(t.url, "_blank");
      });
    });
  }
  const dRestoreBtn = document.getElementById("dRestore");
  if (dRestoreBtn) dRestoreBtn.addEventListener("click", () => restoreSession(it));
  const dCopyTabsBtn = document.getElementById("dCopyTabs");
  if (dCopyTabsBtn) {
    dCopyTabsBtn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(sessionAsUrlList(it));
      dCopyTabsBtn.textContent = "✅ Copied";
      setTimeout(() => (dCopyTabsBtn.textContent = "📋 Copy links"), 1200);
    });
  }

  if (it.url) {
    document.getElementById("dOpen").addEventListener("click", async () => {
      window.open(it.url, "_blank");
      // Optional triage automation (Settings): opening the source finishes the
      // item — but only out of Unread/Reading, never out of Archived.
      if (state.settings.autoDoneOnOpen === true) {
        const cur = statusOf(it);
        if (cur === "unread" || cur === "reading") {
          await Storage.updateItem(it.id, { status: "done" });
          await reload();
        }
      }
    });
  }
  document.getElementById("dPin").addEventListener("click", async () => {
    await Storage.updateItem(it.id, { pinned: !it.pinned });
    closeModal();
    await reload();
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
    await reload();
  });
  document.getElementById("dSave").addEventListener("click", async () => {
    await Storage.updateItem(it.id, {
      title: document.getElementById("dTitle").value.trim(),
      deckId: document.getElementById("dDeck").value,
      note: document.getElementById("dNote").value,
      tags: Array.from(tags),
    });
    closeModal();
    await reload();
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

// ---------------------------------------------------------------------------
// New deck
// ---------------------------------------------------------------------------
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
  await reload();
});

// ---------------------------------------------------------------------------
// Export / import
// ---------------------------------------------------------------------------
els.exportBtn.addEventListener("click", () => openExportDialog());
els.exportModalCancel.addEventListener("click", () => els.exportModalOverlay.classList.add("hidden"));

/**
 * Three ways out of Kipideck (ideas.md I-07). JSON is the lossless one and the
 * default; bookmark HTML is the format that survives us, since every browser and
 * read-later app still reads it; Markdown is for people who want their library
 * as text they can read without any software at all.
 */
function openExportDialog() {
  const total = state.counts?.total ?? 0;
  els.exportModalBody.innerHTML = `
    <h3>Export your library</h3>
    <p class="muted small-text">
      ${total.toLocaleString()} item${total === 1 ? "" : "s"}. Every format is readable without Kipideck —
      there is no proprietary file and nothing is held hostage.
    </p>
    <div class="export-formats">
      ${Exporters.EXPORT_FORMATS.map(
        (f) => `<button class="export-format" data-format="${f.id}">
            <span class="export-format-label">${escapeHtml(f.label)}<code>.${f.ext}</code></span>
            <span class="export-format-note">${escapeHtml(f.note)}</span>
          </button>`,
      ).join("")}
    </div>
    <label class="import-check" style="margin-top:12px">
      <input type="checkbox" id="exportWithContent" checked />
      <span>Include full page text (JSON and Markdown). Untick for a much smaller file — links, titles, tags and notes still export.</span>
    </label>
    <div id="exportProgress" class="import-progress hidden"></div>
  `;
  els.exportModalOverlay.classList.remove("hidden");

  const withContentBox = el("exportWithContent");
  for (const btn of els.exportModalBody.querySelectorAll(".export-format")) {
    btn.onclick = () => runExport(btn.dataset.format, withContentBox?.checked !== false);
  }
}

async function runExport(format, withContent) {
  const stamp = new Date().toISOString().slice(0, 10);
  const buttons = [...els.exportModalBody.querySelectorAll(".export-format")];
  for (const b of buttons) b.disabled = true;
  const progress = el("exportProgress");
  const paint = (done, total) => {
    if (!progress) return;
    const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
    progress.classList.remove("hidden");
    progress.innerHTML = `
      <div class="import-progress-bar"><div class="import-progress-fill" style="width:${pct}%"></div></div>
      <div class="import-progress-note">Writing ${done.toLocaleString()} of ${total.toLocaleString()} items…</div>
    `;
  };

  try {
    let parts;
    let filename;
    let mime;
    if (format === "html") {
      parts = await Storage.exportBookmarkHtml({ onProgress: paint });
      filename = `kipideck-bookmarks-${stamp}.html`;
      mime = "text/html";
    } else if (format === "markdown") {
      parts = await Storage.exportMarkdown({ withContent, onProgress: paint });
      filename = `kipideck-library-${stamp}.md`;
      mime = "text/markdown";
    } else {
      // Streamed as chunks: a huge library never has to become one giant string.
      parts = await Storage.exportChunks({ withContent, onProgress: paint });
      filename = `kipideck-export-${stamp}.json`;
      mime = "application/json";
    }
    const url = URL.createObjectURL(new Blob(parts, { type: mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    els.exportModalOverlay.classList.add("hidden");
  } catch (err) {
    alert("Export failed: " + ((err && err.message) || err));
  } finally {
    for (const b of buttons) b.disabled = false;
    if (progress) progress.classList.add("hidden");
  }
}

/**
 * Import — the refugee path (ideas.md I-05).
 *
 * Someone arrives holding a Pocket ZIP full of part_*.csv files, an Omnivore
 * export ZIP (both opened right here — no unzipping by hand), a folder of
 * metadata_*.json, a browser bookmarks.html, or a plain list of URLs
 * they kept in a note. So the dialog takes several files at once, works out what
 * each one is, shows exactly what will land in the library BEFORE writing
 * anything, and can be run twice without duplicating a single item.
 */
let importSession = null;
let importRecomputeTimer = 0;

els.importBtn.addEventListener("click", () => els.importFile.click());

// `library.html#import=1` — opened from the first-run page's "Import from…"
// shortcut. The file picker is opened by a real click (a dialog not triggered
// by a user gesture is blocked), so the banner exists to give that click
// somewhere obvious to land.
els.importBannerBtn?.addEventListener("click", () => {
  els.importBanner?.classList.add("hidden");
  els.importFile.click();
});

els.importFile.addEventListener("change", async (e) => {
  const files = [...(e.target.files || [])];
  els.importFile.value = "";
  if (!files.length) return;
  await openImportDialog(files);
});

async function openImportDialog(files) {
  importSession = {
    entries: [],
    options: { targetDeck: "inbox", foldersAsTags: true, statusAsTags: true, keepDates: true },
    normalized: null,
    preview: null,
    busy: false,
    fatal: "",
    done: null,
  };
  els.importModalBody.innerHTML = `
    <h3>Import your library</h3>
    <p class="muted small-text">Reading ${files.length.toLocaleString()} file${files.length === 1 ? "" : "s"}…</p>
  `;
  els.importModalOverlay.classList.remove("hidden");
  const confirmBtn = el("importModalConfirm");
  confirmBtn.disabled = true;
  confirmBtn.textContent = "Import";
  els.importModalCancel.onclick = closeImportDialog;

  // Archives expand into their inner files BEFORE the read loop, so everything
  // downstream — detection, preview, dry-run — sees plain files and never
  // learns that some of them arrived inside a ZIP.
  const units = [];
  for (const file of files) {
    if (!isZipName(file.name)) {
      units.push({ file });
      continue;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const zip = expandZip(bytes, { outerName: file.name });
      for (const inner of zip.files) {
        units.push({ name: inner.name, size: inner.bytes, text: inner.text, archive: file.name });
      }
    } catch (err) {
      units.push({ name: file.name, size: file.size || 0, error: (err && err.message) || String(err) });
    }
  }

  for (const unit of units) {
    if (unit.error) {
      importSession.entries.push({ name: unit.name, size: unit.size, text: "", parsed: null, error: unit.error });
      renderImportDialog();
      continue;
    }
    const entry = {
      name: unit.name || unit.file.name,
      size: unit.size ?? unit.file.size ?? 0,
      text: "",
      parsed: null,
      error: "",
      archive: unit.archive || "",
    };
    try {
      entry.text = unit.text ?? (await unit.file.text());
      entry.parsed = Import.parseExport({ name: entry.name, text: entry.text });
    } catch (err) {
      entry.error = (err && err.message) || String(err);
    }
    importSession.entries.push(entry);
    renderImportDialog(); // each file appears as soon as it has been read
  }
  await recomputeImport();
}

function closeImportDialog() {
  importSession = null;
  clearTimeout(importRecomputeTimer);
  els.importModalOverlay.classList.add("hidden");
  const confirmBtn = el("importModalConfirm");
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Import";
  }
}

/**
 * Normalise with the current options, then dry-run the write so the numbers on
 * screen are the numbers the confirm button will produce. Both steps are pure
 * reads: a preview can never touch the library.
 */
async function recomputeImport() {
  const s = importSession;
  if (!s) return;
  s.busy = true;
  renderImportDialog();
  try {
    const foreign = s.entries.filter((e) => e.parsed && e.parsed.format !== "kipideck");
    const native = s.entries.filter((e) => e.parsed && e.parsed.format === "kipideck");
    const preview = { added: 0, updated: 0, duplicates: 0, deleted: 0, invalid: 0, total: 0 };

    if (foreign.length) {
      const combined = Import.combineParsed(foreign.map((e) => e.parsed));
      s.normalized = Import.toKipideckItems(combined, s.options);
      Object.assign(preview, await Storage.importRecords(s.normalized.items, { dryRun: true }));
    } else {
      s.normalized = null;
    }

    // Our own export keeps its decks and tombstones, so it goes through the
    // format-aware path rather than being flattened into generic records.
    for (const entry of native) {
      const p = await Storage.importJSON(entry.text, { dryRun: true });
      preview.added += p.added || 0;
      preview.updated += p.updated || 0;
      preview.duplicates += p.unchanged || 0;
    }

    s.preview = preview;
    s.fatal = "";
  } catch (err) {
    s.preview = null;
    s.fatal = (err && err.message) || String(err);
  } finally {
    s.busy = false;
    renderImportDialog();
  }
}

function scheduleRecompute() {
  clearTimeout(importRecomputeTimer);
  importRecomputeTimer = setTimeout(() => recomputeImport(), 120);
}

function importSourceLabels(s) {
  return [...new Set(s.entries.map((e) => e.parsed?.label).filter(Boolean))].join(", ") || "your files";
}

function renderImportDialog() {
  const s = importSession;
  if (!s) return;
  if (s.done) {
    renderImportCelebration();
    return;
  }

  const confirmBtn = el("importModalConfirm");
  const preview = s.preview;
  const ready = preview ? preview.added + preview.updated : 0;
  const stats = s.normalized?.stats || null;

  const fileRows = s.entries
    .map((entry) => {
      if (entry.error) {
        return `<div class="import-file bad">
          <span class="import-file-name">${entry.archive ? escapeHtml(entry.archive) + " › " : ""}${escapeHtml(entry.name)}</span>
          <span class="import-file-note">${escapeHtml(entry.error)}</span>
        </div>`;
      }
      const count = (entry.parsed?.items || []).length;
      return `<div class="import-file">
        <span class="import-file-name">${entry.archive ? escapeHtml(entry.archive) + " › " : ""}${escapeHtml(entry.name)}</span>
        <span class="import-file-note">${escapeHtml(entry.parsed?.label || "")} · ${count.toLocaleString()} found</span>
      </div>`;
    })
    .join("");

  const warnings = [
    ...new Set([...s.entries.flatMap((e) => e.parsed?.warnings || []), ...(s.normalized?.warnings || [])]),
  ];

  const deckOptions = [
    `<option value="auto" ${s.options.targetDeck === "auto" ? "selected" : ""}>✨ Auto-organise by type</option>`,
    ...state.decks.map(
      (d) => `<option value="${d.id}" ${d.id === s.options.targetDeck ? "selected" : ""}>${d.icon} ${escapeHtml(d.name)}</option>`,
    ),
  ].join("");

  els.importModalBody.innerHTML = `
    <h3>Import your library</h3>
    <p class="muted small-text">
      ${s.entries.length.toLocaleString()} file${s.entries.length === 1 ? "" : "s"} read
      ${stats ? `· ${stats.parsed.toLocaleString()} link${stats.parsed === 1 ? "" : "s"} found` : ""}
    </p>

    <div class="import-files">${fileRows}</div>

    ${s.fatal ? `<div class="import-warnings"><b>${escapeHtml(s.fatal)}</b></div>` : ""}

    <div class="import-summary">
      <div><b>${ready.toLocaleString()}</b><span>ready to import</span></div>
      <div><b>${(preview?.duplicates || 0).toLocaleString()}</b><span>already here</span></div>
      <div><b>${((preview?.updated || 0)).toLocaleString()}</b><span>newer elsewhere</span></div>
      <div><b>${((preview?.invalid || 0) + (preview?.deleted || 0)).toLocaleString()}</b><span>skipped</span></div>
    </div>

    <div class="import-options">
      <div class="import-option-row">
        <label for="importDeckSelect">Put imported items in</label>
        <select id="importDeckSelect">${deckOptions}</select>
      </div>
      <label class="import-check">
        <input type="checkbox" id="importFoldersToggle" ${s.options.foldersAsTags ? "checked" : ""} />
        <span>Turn source folders and collections into tags</span>
      </label>
      <label class="import-check">
        <input type="checkbox" id="importStatusToggle" ${s.options.statusAsTags ? "checked" : ""} />
        <span>Keep archived / favourite status as tags</span>
      </label>
      <label class="import-check">
        <input type="checkbox" id="importDatesToggle" ${s.options.keepDates ? "checked" : ""} />
        <span>Keep original save dates (untick to date everything today)</span>
      </label>
    </div>

    ${warnings.length ? `<div class="import-warnings"><b>Worth knowing</b><ul>${warnings
      .slice(0, 6)
      .map((w) => `<li>${escapeHtml(w)}</li>`)
      .join("")}</ul></div>` : ""}

    <p class="muted small-text" style="margin-top:12px">
      Importing never deletes anything you already have. When the same item exists
      on both sides the more recently edited copy wins, items you deleted here
      stay deleted, and running this twice adds nothing the second time.
    </p>

    <div id="importProgress" class="import-progress hidden"></div>
  `;

  const deckSelect = el("importDeckSelect");
  if (deckSelect) {
    deckSelect.onchange = () => {
      s.options.targetDeck = deckSelect.value;
      scheduleRecompute();
    };
  }
  const toggles = [
    ["importFoldersToggle", "foldersAsTags"],
    ["importStatusToggle", "statusAsTags"],
    ["importDatesToggle", "keepDates"],
  ];
  for (const [id, key] of toggles) {
    const box = el(id);
    if (box) {
      box.onchange = () => {
        s.options[key] = box.checked;
        scheduleRecompute();
      };
    }
  }

  confirmBtn.textContent = s.busy
    ? "Checking…"
    : ready
      ? `Import ${ready.toLocaleString()} item${ready === 1 ? "" : "s"}`
      : "Nothing to import";
  confirmBtn.disabled = s.busy || !ready;
  confirmBtn.onclick = runImport;
}

function paintImportProgress(done, total) {
  const box = el("importProgress");
  if (!box) return;
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  box.classList.remove("hidden");
  box.innerHTML = `
    <div class="import-progress-bar"><div class="import-progress-fill" style="width:${pct}%"></div></div>
    <div class="import-progress-note">Writing ${done.toLocaleString()} of ${total.toLocaleString()} items…</div>
  `;
}

async function runImport() {
  const s = importSession;
  if (!s) return;
  const confirmBtn = el("importModalConfirm");
  confirmBtn.disabled = true;
  confirmBtn.textContent = "Importing…";
  els.importModalCancel.onclick = null; // not cancellable mid-write

  const totals = { added: 0, updated: 0, duplicates: 0 };
  try {
    if (s.normalized?.items?.length) {
      const result = await Storage.importRecords(s.normalized.items, {
        batchSize: 400,
        onProgress: ({ done, total }) => paintImportProgress(done, total),
      });
      totals.added += result.added || 0;
      totals.updated += result.updated || 0;
      totals.duplicates += result.duplicates || 0;
    }
    for (const entry of s.entries.filter((e) => e.parsed?.format === "kipideck")) {
      const r = await Storage.importJSON(entry.text);
      totals.added += r.added || 0;
      totals.updated += r.updated || 0;
      totals.duplicates += r.unchanged || 0;
    }
    s.done = { ...totals, sources: importSourceLabels(s) };
    await reload();
    renderImportCelebration();
  } catch (err) {
    alert("Import failed: " + ((err && err.message) || err));
    confirmBtn.disabled = false;
    confirmBtn.textContent = "Try again";
    els.importModalCancel.onclick = closeImportDialog;
  }
}

function renderImportCelebration() {
  const s = importSession;
  if (!s?.done) return;
  const d = s.done;
  const rescued = d.added + d.updated;
  els.importModalBody.innerHTML = `
    <div class="import-done">
      <div class="import-done-icon">🎉</div>
      <h3>${rescued.toLocaleString()} item${rescued === 1 ? "" : "s"} rescued</h3>
      <p class="muted small-text">
        From ${escapeHtml(d.sources)}. They are in your library now — searchable,
        tagged, and yours whether or not the original service still exists.
      </p>
      ${d.duplicates ? `<p class="muted small-text">${d.duplicates.toLocaleString()} were already here, so nothing was duplicated.</p>` : ""}
    </div>
  `;
  const confirmBtn = el("importModalConfirm");
  confirmBtn.disabled = false;
  confirmBtn.textContent = "Done";
  confirmBtn.onclick = closeImportDialog;
  els.importModalCancel.onclick = closeImportDialog;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
async function openSettings(section) {
  const s = await Storage.getSettings();
  state.settings = s;
  els.autoOrganizeToggle.checked = !!s.autoOrganize;
  els.toastToggle.checked = s.showToast !== false;
  els.autoSaveToggle.checked = s.autoSaveSelection ?? s.showFloatingButton ?? true;
  els.spaceKToggle.checked = s.spaceKQuickSave !== false;
  els.autoDoneToggle.checked = s.autoDoneOnOpen === true;
  renderMutedSites(s.mutedHosts || []);
  await refreshDiagnostics();
  await refreshSyncUI();
  els.settingsModalOverlay.classList.remove("hidden");
  if (section === "sync" && els.syncStatus) els.syncStatus.scrollIntoView({ block: "nearest" });
}

function renderMutedSites(hosts) {
  if (!els.mutedSites) return;
  if (!hosts.length) {
    els.mutedSites.innerHTML = `<span class="muted small-text">No muted sites. Choose “Never here” on any save toast to add one.</span>`;
    return;
  }
  els.mutedSites.innerHTML = "";
  for (const host of hosts) {
    const row = document.createElement("div");
    row.className = "muted-site-row";
    row.innerHTML = `<span>${escapeHtml(host)}</span>`;
    const btn = document.createElement("button");
    btn.className = "ghost-link";
    btn.textContent = "Unmute";
    btn.addEventListener("click", async () => {
      await ext.runtime.sendMessage({ type: "KIPI_UNMUTE_SITE", host });
      const s = await Storage.getSettings();
      renderMutedSites(s.mutedHosts || []);
    });
    row.appendChild(btn);
    els.mutedSites.appendChild(row);
  }
}

async function refreshDiagnostics() {
  if (!els.diagBody) return;
  const stats = await Storage.getStats();
  els.diagBody.innerHTML = `
    <span>${stats.items.toLocaleString()} items</span>
    <span>${stats.contents.toLocaleString()} with saved text</span>
    <span>${stats.terms.toLocaleString()} index terms</span>
    <span>${stats.dirty.toLocaleString()} pending sync</span>
  `;
}

if (els.reindexBtn) {
  els.reindexBtn.addEventListener("click", async () => {
    els.reindexBtn.disabled = true;
    els.reindexBtn.textContent = "Rebuilding…";
    try {
      await Storage.reindex((done, total) => {
        els.reindexBtn.textContent = `Rebuilding… ${Math.round((done / Math.max(total, 1)) * 100)}%`;
      });
      await reload();
      els.reindexBtn.textContent = "✅ Rebuilt";
    } catch (err) {
      els.reindexBtn.textContent = "Rebuild failed";
      alert("Rebuild failed: " + err.message);
    } finally {
      setTimeout(() => {
        els.reindexBtn.textContent = "Rebuild search index";
        els.reindexBtn.disabled = false;
      }, 1600);
    }
  });
}

els.settingsBtn.addEventListener("click", () => openSettings());
els.settingsModalClose.addEventListener("click", () => els.settingsModalOverlay.classList.add("hidden"));
els.settingsModalOverlay.addEventListener("click", (e) => {
  if (e.target === els.settingsModalOverlay) els.settingsModalOverlay.classList.add("hidden");
});

async function persistToggles() {
  const patch = {
    autoOrganize: els.autoOrganizeToggle.checked,
    showToast: els.toastToggle.checked,
    autoSaveSelection: els.autoSaveToggle.checked,
    showFloatingButton: els.autoSaveToggle.checked, // legacy key, kept in sync
    spaceKQuickSave: els.spaceKToggle.checked,
    autoDoneOnOpen: els.autoDoneToggle.checked,
  };
  await Storage.updateSettings(patch);
  // The Library writes settings straight to storage, so tell the background to
  // nudge open tabs — otherwise a toggle appears to do nothing until a reload.
  ext.runtime.sendMessage({ type: "KIPI_SETTINGS_CHANGED", settings: patch }).catch(() => {});
}
[els.autoOrganizeToggle, els.autoSaveToggle, els.toastToggle, els.spaceKToggle, els.autoDoneToggle].forEach((t) => {
  if (t) t.addEventListener("change", persistToggles);
});

els.clearAllBtn.addEventListener("click", async () => {
  if (!confirm("This deletes ALL saved items and resets your decks. Continue?")) return;
  if (!confirm("Really delete everything? Export a backup first if you might want it — this cannot be undone.")) return;
  await Storage.clearAll();
  els.settingsModalOverlay.classList.add("hidden");
  await reload();
});

// ---------------------------------------------------------------------------
// First-run banner (silent capture is disclosed before it ever happens)
// ---------------------------------------------------------------------------
if (els.setupBannerBtn) {
  els.setupBannerBtn.addEventListener("click", () => {
    ext.tabs.create({ url: ext.runtime.getURL("onboarding/onboarding.html") + "#from=library" });
  });
}

// ---------------------------------------------------------------------------
// Google Drive sync UI
// ---------------------------------------------------------------------------
function timeAgoShort(ts) {
  if (!ts) return "";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ts).toLocaleString();
}

async function refreshSyncUI() {
  const signedIn = await DriveSync.isSignedIn();
  const account = await DriveSync.getAccount();
  const lastSync = await DriveSync.getLastSyncAt();
  const status = await DriveSync.getHealth();

  els.syncSignedOut.classList.toggle("hidden", signedIn);
  els.syncSignedIn.classList.toggle("hidden", !signedIn);

  if (signedIn) {
    const broken = (status?.failures || 0) >= 2;
    els.syncStatus.className = "sync-status" + (broken ? " broken" : " connected");
    els.syncStatusIcon.textContent = broken ? "⚠️" : "☁️";
    els.syncStatusText.textContent = broken
      ? "Sync paused — reconnect"
      : `Synced ${timeAgoShort(lastSync) || ""}`.trim();
    els.syncAccountEmail.textContent = account?.email ? `Signed in as ${account.email}` : "Signed in";
    els.syncLastAt.textContent = lastSync ? `Last synced: ${timeAgoShort(lastSync)}` : "Not synced yet — click Sync now.";
    if (els.syncWarning) {
      els.syncWarning.classList.toggle("hidden", !broken);
      els.syncWarning.textContent = broken
        ? `Sync has failed ${status.failures}× in a row (${status.lastError || "session expired"}). Your saves are all still on this device — sign in again to resume syncing.`
        : "";
    }
  } else {
    els.syncStatus.className = "sync-status";
    els.syncStatusIcon.textContent = "🔌";
    els.syncStatusText.textContent = "Sync: off";
    if (els.syncWarning) els.syncWarning.classList.add("hidden");
  }

  const clientId = await DriveSync.getClientId();
  if (clientId) els.syncClientIdInput.value = clientId;

  // The secret is never echoed back into the field — it is write-only here.
  const hasSecret = !!(await DriveSync.getClientSecret());
  if (els.syncClientSecretInput) {
    els.syncClientSecretInput.value = "";
    els.syncClientSecretInput.placeholder = hasSecret
      ? "Saved — leave blank to keep it"
      : "leave blank for Chrome Extension clients";
  }
  if (els.syncClearSecretBtn) els.syncClearSecretBtn.classList.toggle("hidden", !hasSecret);
}

function syncSetupMessage(text, kind = "info") {
  if (!els.syncSetupMsg) return;
  els.syncSetupMsg.textContent = text;
  els.syncSetupMsg.className = "sync-setup-msg" + (text ? ` ${kind}` : " hidden");
}

els.syncStatus.addEventListener("click", () => openSettings("sync"));

els.syncSaveClientIdBtn.addEventListener("click", async () => {
  const val = els.syncClientIdInput.value.trim();
  if (!val) {
    syncSetupMessage("Paste your client ID first.", "error");
    return;
  }
  if (!/\.apps\.googleusercontent\.com$/.test(val)) {
    syncSetupMessage("That does not look like a Google OAuth client ID — it should end in .apps.googleusercontent.com.", "error");
    return;
  }
  await DriveSync.setClientId(val);
  const secret = els.syncClientSecretInput?.value.trim() || "";
  if (secret) await DriveSync.setClientSecret(secret);
  syncSetupMessage(secret ? "Saved. Now sign in below." : "Client ID saved. Now sign in below.", "ok");
  await refreshSyncUI();
});

els.syncClearSecretBtn?.addEventListener("click", async () => {
  await DriveSync.setClientSecret("");
  syncSetupMessage("Saved secret removed.", "ok");
  await refreshSyncUI();
});

els.syncSignInBtn.addEventListener("click", async () => {
  els.syncSignInBtn.disabled = true;
  els.syncSignInBtn.textContent = "Connecting…";
  try {
    await DriveSync.signIn();
    await DriveSync.syncNow();
    await refreshSyncUI();
    await reload();
  } catch (e) {
    syncSetupMessage(`Could not sign in: ${e.message}`, "error");
  } finally {
    els.syncSignInBtn.disabled = false;
    els.syncSignInBtn.textContent = "🔐 Sign in with Google & enable sync";
  }
});

els.syncNowBtn.addEventListener("click", async () => {
  els.syncNowBtn.disabled = true;
  els.syncNowBtn.textContent = "Syncing…";
  try {
    const result = await DriveSync.syncNow();
    els.syncNowBtn.textContent = `✅ ${result?.items?.toLocaleString?.() || 0} items in sync`;
    await refreshSyncUI();
    await reload();
  } catch (e) {
    alert("Sync failed: " + e.message + "\n\nTry signing in again from Settings.");
    await refreshSyncUI();
  } finally {
    setTimeout(() => {
      els.syncNowBtn.disabled = false;
      els.syncNowBtn.textContent = "🔄 Sync now";
    }, 1400);
  }
});

els.syncSignOutBtn.addEventListener("click", async () => {
  if (!confirm("Disconnect Google Drive sync? Your local items stay on this device.")) return;
  await DriveSync.signOut();
  await refreshSyncUI();
});

// ---------------------------------------------------------------------------
// Load + live updates
// ---------------------------------------------------------------------------
async function reload() {
  const [decks, settings, icons] = await Promise.all([
    Storage.getDecks(),
    Storage.getSettings(),
    faviconMap(),
  ]);
  state.decks = decks;
  state.settings = settings;
  state.icons = icons;
  if (els.setupBanner) els.setupBanner.classList.toggle("hidden", settings.onboardingDone !== false);
  await renderSidebar();
  await renderGrid({ reset: true });
}

ext.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "KIPI_ITEM_SAVED" || msg?.type === "KIPI_SYNCED" || msg?.type === "KIPI_SYNC_FAILED") {
    reload();
  }
});
// Items live in IndexedDB now, so storage.onChanged only carries decks/settings;
// refresh those, and re-read the grid when the tab regains focus (another window
// or the service worker may have written since).
ext.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes[Storage.KEYS.DECKS] || changes[Storage.KEYS.SETTINGS])) reload();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) reload();
});

/** `library.html#item=<id>` opens that item; `#settings=sync` opens Settings. */
async function applyHash() {
  const hash = (location.hash || "").replace(/^#/, "");
  if (!hash) return;
  const params = new URLSearchParams(hash.includes("=") ? hash : "");
  if (hash.startsWith("item=")) {
    const id = hash.slice(5);
    await reload();
    openDetail(id);
  } else if (params.get("settings")) {
    await reload();
    openSettings(params.get("settings"));
  } else if (params.get("import")) {
    await reload();
    els.importBanner?.classList.remove("hidden");
  }
}

(async function start() {
  await Storage.init();
  await reload();
  await applyHash();
})();
