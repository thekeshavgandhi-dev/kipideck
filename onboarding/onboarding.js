// onboarding/onboarding.js — the first-run disclosure page.
//
// This page exists because of a real policy and a real trust problem, not
// because it is a nice-to-have:
//
//   • Chrome Web Store rules (updated July 2026, enforced from August 2026)
//     require that every kind of data an extension collects be disclosed
//     prominently, and that collection be limited to the single stated purpose.
//     "Silently saves the text you select on every page" is exactly the kind of
//     behaviour that has to be shown to the user before it happens.
//   • Kipideck's whole pitch is "your data never leaves your machine". A user
//     who discovers auto-capture by accident will not believe that pitch, no
//     matter how true it is.
//
// So: nothing is captured silently until `settings.onboardingDone` is true, and
// the only thing that sets it is a click on this page. background.js and
// content.js both refuse auto-capture while it is false.

import { ext } from "../lib/compat.js";
import { Storage } from "../lib/storage.js";
import { seedSamples, countSamples, removeSamples, SAMPLE_TAG } from "../lib/samples.js";

const els = {
  pageTitle: document.getElementById("pageTitle"),
  pageLede: document.getElementById("pageLede"),
  autoSaveToggle: document.getElementById("autoSaveToggle"),
  spaceKToggle: document.getElementById("spaceKToggle"),
  toastToggle: document.getElementById("toastToggle"),
  finishBtn: document.getElementById("finishBtn"),
  quietBtn: document.getElementById("quietBtn"),
  statusLine: document.getElementById("statusLine"),
  // "Try it before you finish" (ideas.md I-03) — the first 60 seconds.
  saveDemoBtn: document.getElementById("saveDemoBtn"),
  samplesBtn: document.getElementById("samplesBtn"),
  samplesBtnLabel: document.getElementById("samplesBtnLabel"),
  removeSamplesBtn: document.getElementById("removeSamplesBtn"),
  importShortcutBtn: document.getElementById("importShortcutBtn"),
  startStatus: document.getElementById("startStatus"),
  deckTour: document.getElementById("deckTour"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Status line for the "try it" card — separate from the consent status line so
 *  a demo action never overwrites the message about the disclosure itself. */
function setStartStatus(text, kind = "") {
  if (!els.startStatus) return;
  els.startStatus.textContent = text;
  els.startStatus.className = "fineprint" + (kind ? ` ${kind}` : "");
}

/** Opened from Library → Settings? Then go back there instead of stacking tabs. */
const cameFromLibrary = /(?:^|[#&])from=library(?:[&#]|$)/.test(location.hash);

let alreadyDone = false;

function setStatus(text, kind = "") {
  if (!els.statusLine) return;
  els.statusLine.textContent = text;
  els.statusLine.className = "fineprint" + (kind ? ` ${kind}` : "");
}

async function load() {
  let settings = {};
  try {
    await Storage.init();
    settings = await Storage.getSettings();
  } catch {
    // If storage is unavailable we still show the disclosure; the buttons fall
    // back to messaging the background, which owns the authoritative copy.
  }

  // Defaults match lib/storage.js DEFAULT_SETTINGS: the convenient behaviour is
  // on, but only ever after it has been disclosed here.
  els.autoSaveToggle.checked = settings.autoSaveSelection !== false;
  els.spaceKToggle.checked = settings.spaceKQuickSave !== false;
  els.toastToggle.checked = settings.showToast !== false;

  alreadyDone = settings.onboardingDone === true;
  if (alreadyDone) {
    els.pageTitle.textContent = "What Kipideck captures";
    els.pageLede.textContent =
      "These are the choices you already made. Change anything here and it takes effect immediately — including on pages you already have open.";
    els.finishBtn.textContent = "Save changes";
    els.quietBtn.hidden = true;
    setStatus("Saved choices are shown above.");
  }

  renderDeckTour();
  await refreshSampleState();
}

function currentChoices() {
  return {
    autoSaveSelection: els.autoSaveToggle.checked,
    spaceKQuickSave: els.spaceKToggle.checked,
    showToast: els.toastToggle.checked,
  };
}

async function persist(choices) {
  // Prefer the background: it owns the settings copy used by content scripts and
  // broadcasts the change to open tabs. Fall back to writing directly if the
  // service worker is unreachable (it is the same storage either way).
  try {
    await ext.runtime.sendMessage({ type: "KIPI_ONBOARDING_DONE", ...choices });
    return true;
  } catch {
    try {
      await Storage.updateSettings({ onboardingDone: true, ...choices });
      return true;
    } catch (e) {
      setStatus(`Could not save your choices: ${e?.message || e}`, "error");
      return false;
    }
  }
}

async function openLibrary() {
  if (cameFromLibrary) return; // the Library tab that sent us here is still open
  try {
    await ext.tabs.create({ url: ext.runtime.getURL("library/library.html") });
  } catch {
    /* if we cannot open a tab, the toolbar icon still gets them there */
  }
}

async function finish(choices, { openLibraryAfter = true } = {}) {
  els.finishBtn.disabled = true;
  els.quietBtn.disabled = true;
  setStatus("Saving…");
  const ok = await persist(choices);
  if (!ok) {
    els.finishBtn.disabled = false;
    els.quietBtn.disabled = false;
    return;
  }
  setStatus("Saved. Kipideck is ready.", "ok");
  if (openLibraryAfter) await openLibrary();
  // Close this tab if the browser lets us (it can only close tabs it opened).
  setTimeout(() => {
    try {
      window.close();
    } catch {
      /* stay put — the status line already confirms the save */
    }
  }, 250);
}

// ---------------------------------------------------------------------------
// "Try it before you finish" — ideas.md I-03.
//
// Every action here is explicit: the user pressed a button, which is exactly
// what the disclosure says is required. None of them flips `onboardingDone`,
// because the gate in lib/policy.js must be opened by the consent buttons at
// the bottom of this page and by nothing else.
// ---------------------------------------------------------------------------

async function saveDemoPage() {
  setStartStatus("Saving…");
  try {
    await Storage.init();
    await Storage.saveItem({
      type: "page",
      title: document.title || "Kipideck — what it saves",
      url: location.href,
      domain: location.host || "",
      deckId: "links",
      tags: [],
      excerpt: "The Kipideck first-run page, saved as a demo item.",
      content: String(document.body?.innerText || "").slice(0, 20000),
    });
    setStartStatus(
      "Saved. Open the Library and look in your Links deck — that is a real item, made the same way a right-click makes one.",
      "ok"
    );
  } catch (e) {
    setStartStatus(`Could not save: ${e?.message || e}`, "error");
  }
}

async function addSamples() {
  setStartStatus("Adding…");
  try {
    const r = await seedSamples();
    setStartStatus(
      r.added
        ? `Added ${r.added} sample item${r.added === 1 ? "" : "s"}, tagged “${SAMPLE_TAG}”. Search, decks and pins now have something to show.`
        : "The samples are already in your library.",
      "ok"
    );
  } catch (e) {
    setStartStatus(`Could not add samples: ${e?.message || e}`, "error");
  }
  await refreshSampleState();
}

async function clearSamples() {
  setStartStatus("Removing…");
  try {
    const n = await removeSamples();
    setStartStatus(
      n ? `Removed ${n} sample item${n === 1 ? "" : "s"}.` : "There were no sample items to remove.",
      "ok"
    );
  } catch (e) {
    setStartStatus(`Could not remove samples: ${e?.message || e}`, "error");
  }
  await refreshSampleState();
}

/** Show the remove button only when there is something to remove, so the card
 *  never promises an action that would do nothing. */
async function refreshSampleState() {
  try {
    const n = await countSamples();
    if (els.removeSamplesBtn) els.removeSamplesBtn.hidden = n === 0;
    if (els.samplesBtnLabel) {
      els.samplesBtnLabel.textContent = n ? "Add the sample items again" : "Add 3 sample items";
    }
  } catch {
    /* leave the buttons in their default state */
  }
}

/**
 * Open the Library with the importer ready, so someone arriving from a dead
 * read-later app never has to hunt for the ⬆ button.
 *
 * A new tab on purpose: this page stays open, so the disclosure choices below
 * can still be made and the import shortcut cannot become a way to skip them.
 */
async function goToImport() {
  setStartStatus("Opening your library…");
  const url = ext.runtime.getURL("library/library.html") + "#import=1";
  try {
    await ext.tabs.create({ url });
    setStartStatus(
      "Your library opened in a new tab with the importer ready. Come back here to finish setting up.",
      "ok"
    );
  } catch {
    // No tabs API (or not running as a tab) — navigating is the honest
    // fallback, because there is no other route to the Library.
    location.href = url;
  }
}

function renderDeckTour() {
  if (!els.deckTour) return;
  els.deckTour.innerHTML = "";
  for (const deck of Storage.DEFAULT_DECKS || []) {
    const li = document.createElement("li");
    li.innerHTML =
      `<span class="deck-ico">${escapeHtml(deck.icon)}</span>` +
      `<span class="deck-name">${escapeHtml(deck.name)}</span>`;
    els.deckTour.appendChild(li);
  }
}

els.saveDemoBtn?.addEventListener("click", saveDemoPage);
els.samplesBtn?.addEventListener("click", addSamples);
els.removeSamplesBtn?.addEventListener("click", clearSamples);
els.importShortcutBtn?.addEventListener("click", goToImport);

els.finishBtn.addEventListener("click", () => finish(currentChoices()));

els.quietBtn.addEventListener("click", () =>
  finish({ ...currentChoices(), autoSaveSelection: false }, { openLibraryAfter: !alreadyDone })
);

// Keyboard users should not have to reach for the mouse on a page whose whole
// job is one decision.
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    finish(currentChoices());
  }
});

load();
