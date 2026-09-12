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

const els = {
  pageTitle: document.getElementById("pageTitle"),
  pageLede: document.getElementById("pageLede"),
  autoSaveToggle: document.getElementById("autoSaveToggle"),
  spaceKToggle: document.getElementById("spaceKToggle"),
  toastToggle: document.getElementById("toastToggle"),
  finishBtn: document.getElementById("finishBtn"),
  quietBtn: document.getElementById("quietBtn"),
  statusLine: document.getElementById("statusLine"),
};

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
