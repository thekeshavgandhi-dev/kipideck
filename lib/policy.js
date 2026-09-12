// lib/policy.js — the single source of truth for "may Kipideck capture here?"
//
// WHY THIS IS ITS OWN MODULE: this function *is* the privacy promise. The
// first-run page tells the user exactly when Kipideck will act on its own, and
// content.js obeys whatever this returns. It used to live inside the service
// worker, which made the promise untestable — you cannot import background.js
// without a browser. Here it is a pure function of (host, settings) that node
// can run, so `test/policy.test.js` can assert that what the disclosure says
// and what the code does are the same thing.
//
// The rule that matters: NOTHING happens silently until the user has seen the
// first-run disclosure. Explicit saves — right-click menu, toolbar popup,
// Ctrl/Cmd+Shift+K — are never gated by this, because the user initiated them.

import { Storage } from "./storage.js";
import { hostMatches } from "./canon.js";

/**
 * @param {string} host  The page's host (`location.host`), any case, with or without `www.`
 * @param {object} [settings]  Injected by callers that already have them; otherwise read from storage.
 * @returns {Promise<{autoSaveSelection:boolean, spaceKQuickSave:boolean, showToast:boolean,
 *                    muted:boolean, onboardingDone:boolean, blockedShortcut:boolean, host:string}>}
 */
export async function capturePolicyFor(host, settings) {
  const s = settings || (await Storage.getSettings());
  const h = String(host || "").trim().toLowerCase();
  const muted = (s.mutedHosts || []).some((entry) => hostMatches(h, entry));
  const onboarded = !!s.onboardingDone;
  const blockedShortcut = !Storage.quickSaveAllowedOn(h);

  return {
    // Silent capture of selected text: needs the disclosure accepted, the toggle
    // on, and a site the user has not muted.
    autoSaveSelection: !!s.autoSaveSelection && onboarded && !muted,

    // Space→K: same three gates, plus the site must not be one where Space or K
    // already means something (video players, Gmail, Google Docs). Muting a site
    // means "Kipideck stays quiet here" — the words on the toast the user
    // clicked — so it turns the shortcut off too, not just auto-capture.
    spaceKQuickSave: !!s.spaceKQuickSave && onboarded && !muted && !blockedShortcut,

    showToast: s.showToast !== false,
    muted,
    onboardingDone: onboarded,
    blockedShortcut,
    host: h,
  };
}

/** True when Kipideck may do anything at all without a click on this page. */
export async function anySilentCaptureAllowed(host, settings) {
  const policy = await capturePolicyFor(host, settings);
  return policy.autoSaveSelection || policy.spaceKQuickSave;
}
