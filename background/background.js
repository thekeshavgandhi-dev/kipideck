// background/background.js — Kipideck background script
// Owns the one-item "Save to Kipi" right-click menu, keyboard shortcuts, the
// capture + classify + store pipeline, the first-run disclosure, and the
// periodic Google Drive sync tick.
//
// Uses `ext` (see lib/compat.js) everywhere instead of raw chrome.* / browser.*
// so this exact file runs unmodified on Chrome, Edge, Brave, Opera, and Firefox.
//
// One file, two manifests: Chromium loads it as "background": { "service_worker" }
// and Firefox as "background": { "scripts" } — see tools/firefox-manifest-overlay.json
// for why the two cannot be declared in the same manifest any more. Both declare
// "type": "module", which is what lets the static imports below work.
//
// Three things changed here in Phase 0, all of them trust/compliance fixes:
//   1. no third-party favicon requests (see lib/favicons.js)
//   2. silent auto-capture is gated behind the first-run disclosure
//   3. sync failures are surfaced instead of swallowed — a sync that quietly
//      stops working is worse than one that tells you it stopped

import { ext } from "../lib/compat.js";
import { Storage } from "../lib/storage.js";
import { classify, excerptFromText } from "../lib/classify.js";
import { extractPageText } from "../lib/extract.js";
import { hostOf } from "../lib/canon.js";
import { capturePolicyFor } from "../lib/policy.js";
import { cacheFaviconFor } from "../lib/favicons.js";
import * as DriveSync from "../lib/drive-sync.js";

const MENU = {
  // One single menu item — no sub-menus, no "what do you want to save?".
  // Whatever the user right-clicked gets saved in that one click; the right
  // context is detected in the onClicked listener below.
  SAVE: "kipi_save",
};

const SYNC_ALARM = "kipi-periodic-sync";
/** One-shot follow-up alarm: a sync pass is capped, so big libraries need several. */
const SYNC_CONTINUE_ALARM = "kipi-sync-continue";
/** Re-save of the very same selected text within this window is a double-save. */
const SELECTION_DEDUPE_WINDOW_MS = 60 * 1000;

ext.runtime.onInstalled.addListener(async (details) => {
  await Storage.init();
  buildContextMenus();
  trySchedulePeriodicSync();

  // First run: open the disclosure/onboarding page. Nothing is captured
  // silently until the user has seen it (content.js checks `onboardingDone`).
  if (details?.reason === "install") {
    try {
      ext.tabs.create({ url: ext.runtime.getURL("onboarding/onboarding.html") });
    } catch {
      /* opening a tab can fail in odd contexts; the Library links to it too */
    }
  }
});

ext.runtime.onStartup.addListener(async () => {
  await Storage.init();
  trySchedulePeriodicSync();
});

function trySchedulePeriodicSync() {
  try {
    ext.alarms.create(SYNC_ALARM, { periodInMinutes: 10 });
  } catch {
    /* alarms permission may be unavailable in some contexts; sync still works on-demand */
  }
}

/**
 * One capped sync pass. A 50k-item library cannot move in a single pass (Drive
 * quota + service-worker lifetime), so syncNow() reports what it deferred and we
 * schedule a short follow-up alarm until the device is fully caught up.
 */
async function runSyncPass() {
  const result = await DriveSync.syncNow();
  await clearSyncFailures();
  if (result && (result.deferred || result.caughtUp === false)) {
    try {
      ext.alarms.create(SYNC_CONTINUE_ALARM, { delayInMinutes: 0.5 });
    } catch {
      /* periodic alarm will pick it up within 10 minutes anyway */
    }
  } else {
    try {
      ext.alarms.clear(SYNC_CONTINUE_ALARM);
    } catch {
      /* ignore */
    }
  }
  return result;
}

if (ext.alarms?.onAlarm) {
  ext.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== SYNC_ALARM && alarm.name !== SYNC_CONTINUE_ALARM) return;
    const signedIn = await DriveSync.isSignedIn();
    if (!signedIn) return;
    try {
      const result = await runSyncPass();
      // Only announce once the backlog is drained — otherwise a first sync of a
      // large library would fire a "Synced" event every 30 seconds.
      if (result && !result.deferred && result.caughtUp !== false) {
        ext.runtime.sendMessage({ type: "KIPI_SYNCED" }).catch(() => {});
      }
    } catch (e) {
      await recordSyncFailure(e);
    }
  });
}

// ---------------------------------------------------------------------------
// Sync health: failures become visible instead of silent
// ---------------------------------------------------------------------------

async function recordSyncFailure(err) {
  try {
    const count = await DriveSync.recordFailure(err);
    ext.runtime.sendMessage({ type: "KIPI_SYNC_FAILED", error: err?.message || "unknown", count }).catch(() => {});

    const expired = /SESSION_EXPIRED|Not signed in|invalid_grant/i.test(err?.message || "");
    if (expired && count >= 2 && (await DriveSync.shouldNudge())) {
      notify(
        "Kipideck sync is paused",
        "Your Google session expired. Open Library → Settings → Sync to reconnect — your saves are all still safe on this device.",
        "kipi_sync_nudge"
      );
    }
  } catch {
    /* diagnostics must never break saving */
  }
}

async function clearSyncFailures() {
  try {
    await DriveSync.clearFailures();
  } catch {
    /* ignore */
  }
}

// NOTE: `ext` is the Promise-based browser.* API (native on Firefox, via the
// webextension-polyfill on Chromium) — it does NOT accept Chrome-style
// callbacks. So this must await removeAll()/create(), never pass a callback
// (a callback would silently never fire and no menus would be created).
async function buildContextMenus() {
  try {
    await ext.contextMenus.removeAll();
  } catch {
    /* ignore — e.g. nothing to remove yet on first install */
  }
  const menus = [
    {
      id: MENU.SAVE,
      title: "Save to Kipi",
      contexts: ["page", "selection", "link", "image", "video"],
    },
  ];
  for (const props of menus) {
    try {
      await ext.contextMenus.create(props);
    } catch (e) {
      console.warn("[kipideck] contextMenus.create failed:", props.id, e);
    }
  }
}

async function getPageMeta(tabId) {
  try {
    const [{ result }] = await ext.scripting.executeScript({
      target: { tabId },
      func: () => {
        function metaContent(name) {
          const el =
            document.querySelector(`meta[name="${name}"]`) ||
            document.querySelector(`meta[property="${name}"]`);
          return el ? el.getAttribute("content") : "";
        }
        const sel = window.getSelection ? window.getSelection().toString() : "";
        return {
          title: document.title || "",
          description: metaContent("description") || metaContent("og:description") || "",
          image: metaContent("og:image") || "",
          siteName: metaContent("og:site_name") || "",
          selectionText: sel,
          url: location.href,
        };
      },
    });
    return result || {};
  } catch (e) {
    return {};
  }
}

async function getFullPageText(tabId) {
  try {
    const [{ result }] = await ext.scripting.executeScript({ target: { tabId }, func: extractPageText });
    return result || { text: "", wordCount: 0 };
  } catch (e) {
    return { text: "", wordCount: 0 };
  }
}

async function notify(title, message, id) {
  const settings = await Storage.getSettings();
  if (!settings.showToast) return;
  const options = {
    type: "basic",
    iconUrl: ext.runtime.getURL("icons/icon128.png"),
    title,
    message,
    priority: 1,
  };
  try {
    // `ext` is the Promise-based polyfill API: it takes (id?, options) and
    // rejects Chrome-style callbacks. Reusing an id replaces that notification.
    if (id) await ext.notifications.create(id, options);
    else await ext.notifications.create(options);
  } catch (e) {
    /* notifications may be unavailable in some contexts */
  }
}

// Clicking the sync nudge opens Settings → Sync straight away.
if (ext.notifications?.onClicked) {
  ext.notifications.onClicked.addListener((id) => {
    if (id === "kipi_sync_nudge") {
      ext.tabs.create({ url: ext.runtime.getURL("library/library.html#settings=sync") });
      ext.notifications.clear(id).catch(() => {});
    }
  });
}

async function maybeSyncAfterSave() {
  try {
    if (await DriveSync.isSignedIn()) {
      await runSyncPass();
    }
  } catch (e) {
    // Best-effort: a failed background sync must never block or fail a save,
    // but it is now counted and surfaced (see recordSyncFailure).
    await recordSyncFailure(e);
  }
}

/** Fire-and-forget icon caching. Runs AFTER the save committed, so a slow or
 * blocked fetch can never delay capturing — and no third party is ever asked
 * for an icon at render time. */
function warmFaviconCache(domain, preferredUrl) {
  if (!domain) return;
  cacheFaviconFor(domain, preferredUrl).catch(() => {});
}

function openLibraryAt(itemId) {
  ext.tabs.create({ url: ext.runtime.getURL("library/library.html") + (itemId ? `#item=${itemId}` : "") });
}

// The capture policy itself lives in lib/policy.js so it can be unit-tested;
// content scripts are classic (non-module) scripts and cannot import it, so
// KIPI_GET_CAPTURE_POLICY below is how they ask.
/**
 * Push a "re-read your policy" nudge to every open tab. Without this, a choice
 * made in Settings or on the first-run page only takes effect after a reload —
 * which reads as "the toggle did nothing".
 */
async function broadcastPolicy() {
  try {
    const tabs = await ext.tabs.query({});
    for (const tab of tabs || []) {
      if (!tab?.id) continue;
      if (!/^(https?|file):/i.test(tab.url || "")) continue;
      ext.tabs.sendMessage(tab.id, { type: "KIPI_POLICY_CHANGED" }).catch(() => {});
    }
  } catch {
    /* tabs.query can fail in odd contexts; the next page load picks the policy up anyway */
  }
}

async function captureAndSave({ type, tab, info }) {
  const meta = tab?.id != null ? await getPageMeta(tab.id) : {};
  const pageUrl = info?.pageUrl || tab?.url || meta.url || "";
  const domain = hostOf(pageUrl);

  const targetUrl =
    type === "link" ? info?.linkUrl || pageUrl
    : type === "image" || type === "video" ? info?.srcUrl || pageUrl
    : pageUrl;
  const text = type === "selection" ? info?.selectionText || meta.selectionText || "" : "";

  // "You already saved this" — the duplicate check v1.3 never had. Tracking
  // params, hashes, trailing slashes and www are all normalised away first, so
  // a newsletter link and the plain link are recognised as the same article.
  const duplicate = await Storage.findDuplicate(
    { type, url: targetUrl, sourceUrl: pageUrl, title: meta.title || "", content: text },
    // Selections only dedupe inside a short window: re-quoting the same line
    // later is a deliberate act, not an accident.
    { withinMs: type === "selection" ? SELECTION_DEDUPE_WINDOW_MS : 0 }
  );
  if (duplicate) {
    return { saved: null, skipped: true, existing: duplicate };
  }

  let item = {
    type,
    url: pageUrl,
    sourceUrl: pageUrl,
    domain,
    // Deliberately empty: icons come from the local cache (lib/favicons.js) or a
    // locally drawn letter avatar. v1.3 pointed this at google.com/s2/favicons,
    // which leaked every saved domain to a third party and failed offline.
    favicon: "",
    title: meta.title || tab?.title || pageUrl,
    excerpt: excerptFromText(meta.description || ""),
    image: meta.image || "",
    content: "",
  };

  if (type === "selection") {
    item.content = text;
    item.excerpt = excerptFromText(text, 400);
    item.title = excerptFromText(text, 80) || item.title;
  } else if (type === "link") {
    item.url = info.linkUrl;
    item.sourceUrl = pageUrl;
    item.domain = hostOf(info.linkUrl);
    item.title = info.linkUrl;
    item.reference = `Found on: ${meta.title || pageUrl}`;
  } else if (type === "image") {
    item.image = info.srcUrl;
    item.url = info.srcUrl;
    item.sourceUrl = pageUrl;
    item.domain = hostOf(info.srcUrl) || domain;
    item.title = meta.title ? `Image from ${meta.title}` : info.srcUrl;
    item.reference = `Found on: ${meta.title || pageUrl} (${pageUrl})`;
  } else if (type === "video") {
    item.url = info.srcUrl || pageUrl;
    item.sourceUrl = pageUrl;
    item.title = meta.title ? `Video from ${meta.title}` : pageUrl;
    item.reference = `Found on: ${meta.title || pageUrl} (${pageUrl})`;
    item.type = "video";
  } else {
    // full page — grab full readable text for full-text search
    item.reference = pageUrl;
    if (tab?.id != null) {
      const { text: pageText, wordCount } = await getFullPageText(tab.id);
      item.content = pageText;
      item.wordCount = wordCount;
      if (!item.excerpt) item.excerpt = excerptFromText(pageText, 280);
    }
  }

  if (!item.reference) item.reference = pageUrl;

  const settings = await Storage.getSettings();
  const { deckId, tags } = settings.autoOrganize
    ? classify(item)
    : { deckId: "inbox", tags: [] };
  item.deckId = deckId;
  item.tags = tags;

  const saved = await Storage.saveItem(item);

  // Cache this site's icon in the background — after the save, never before.
  warmFaviconCache(item.domain || domain, tab?.favIconUrl);

  const decks = await Storage.getDecks();
  const deck = decks.find((d) => d.id === deckId);
  await notify(
    "Saved to Kipideck ✅",
    `${saved.title?.slice(0, 60) || "Item"}\n→ ${deck ? deck.icon + " " + deck.name : "Inbox"}`
  );

  ext.runtime.sendMessage({ type: "KIPI_ITEM_SAVED", item: saved }).catch(() => {});
  maybeSyncAfterSave();
  return { saved, skipped: false };
}

ext.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU.SAVE) return;
  // No menu to pick from — just save whatever was right-clicked. Image,
  // video and link targets win over a lingering selection; anything else
  // saves the whole page. Selections/images/links always keep the page
  // they were found on as their reference (see captureAndSave).
  const ctx = info.contexts || [];
  let type;
  if (ctx.includes("image")) type = "image";
  else if (ctx.includes("video")) type = "video";
  else if (ctx.includes("link")) type = "link";
  else if (ctx.includes("selection")) type = "selection";
  else type = "page";

  const res = await captureAndSave({ type, tab, info });
  if (res?.skipped && tab?.id != null) {
    ext.tabs
      .sendMessage(tab.id, {
        type: "KIPI_TOAST",
        text: "Already in your Kipideck",
        sub: res.existing?.title || "",
        action: { label: "Open", itemId: res.existing?.id },
      })
      .catch(() => {});
  }
});

ext.commands.onCommand.addListener(async (command) => {
  if (command === "open-library") {
    openLibraryAt(null);
    return;
  }
  if (command === "quick-save") {
    const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
    if (tab) await captureAndSave({ type: "page", tab, info: {} });
  }
});

// Messages from content script / popup / library / website bridge.
ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const senderHost = sender?.tab?.url ? hostOf(sender.tab.url) : "";

    if (msg?.type === "KIPI_SAVE_PAGE") {
      const tab = sender.tab || (await ext.tabs.query({ active: true, currentWindow: true }))[0];
      const res = await captureAndSave({ type: "page", tab, info: {} });
      sendResponse({
        ok: !res?.skipped,
        skipped: !!res?.skipped,
        item: res?.saved || null,
        existingId: res?.existing?.id || null,
      });
    } else if (msg?.type === "KIPI_SAVE_SELECTION") {
      const tab = sender.tab || (await ext.tabs.query({ active: true, currentWindow: true }))[0];
      const res = await captureAndSave({
        type: "selection",
        tab,
        info: { selectionText: msg.text, pageUrl: tab?.url },
      });
      sendResponse({ ok: !res?.skipped, skipped: !!res?.skipped, item: res?.saved || null });
    } else if (msg?.type === "KIPI_SAVE_NOTE") {
      const tab = sender.tab || (await ext.tabs.query({ active: true, currentWindow: true }))[0];
      const domain = hostOf(tab?.url || "");
      const item = {
        type: "note",
        url: tab?.url || "",
        sourceUrl: tab?.url || "",
        domain,
        title: excerptFromText(msg.text, 80),
        content: msg.text,
        excerpt: excerptFromText(msg.text, 400),
        reference: tab?.url || "",
        deckId: "quotes",
        tags: ["note"],
      };
      const saved = await Storage.saveItem(item);
      warmFaviconCache(domain, tab?.favIconUrl);
      ext.runtime.sendMessage({ type: "KIPI_ITEM_SAVED", item: saved }).catch(() => {});
      maybeSyncAfterSave();
      sendResponse({ ok: true, item: saved });
    } else if (msg?.type === "KIPI_GET_COUNT") {
      const counts = await Storage.getCounts();
      sendResponse({ count: counts.total });
    } else if (msg?.type === "KIPI_GET_CAPTURE_POLICY") {
      sendResponse(await capturePolicyFor(msg.host || senderHost));
    } else if (msg?.type === "KIPI_ONBOARDING_DONE") {
      const settings = await Storage.updateSettings({
        onboardingDone: true,
        ...(typeof msg.autoSaveSelection === "boolean" ? { autoSaveSelection: msg.autoSaveSelection } : {}),
        ...(typeof msg.spaceKQuickSave === "boolean" ? { spaceKQuickSave: msg.spaceKQuickSave } : {}),
        ...(typeof msg.showToast === "boolean" ? { showToast: msg.showToast } : {}),
      });
      broadcastPolicy();
      sendResponse({ ok: true, settings });
    } else if (msg?.type === "KIPI_SETTINGS_CHANGED") {
      // Sent by the Library after it writes capture settings directly.
      broadcastPolicy();
      sendResponse({ ok: true });
    } else if (msg?.type === "KIPI_MUTE_SITE") {
      const settings = await Storage.getSettings();
      const host = hostOf(msg.host || senderHost || "");
      const mutedHosts = [...new Set([...(settings.mutedHosts || []), host].filter(Boolean))];
      await Storage.updateSettings({ mutedHosts });
      broadcastPolicy();
      sendResponse({ ok: true, mutedHosts });
    } else if (msg?.type === "KIPI_UNMUTE_SITE") {
      const settings = await Storage.getSettings();
      const host = hostOf(msg.host || senderHost || "");
      const mutedHosts = (settings.mutedHosts || []).filter((h) => !hostMatches(h, host));
      await Storage.updateSettings({ mutedHosts });
      broadcastPolicy();
      sendResponse({ ok: true, mutedHosts });
    } else if (msg?.type === "KIPI_OPEN_LIBRARY") {
      // Sent by the content-script website bridge when the user clicks
      // "Open My Deck" on the site — opens THEIR library with THEIR local +
      // Drive-synced items.
      openLibraryAt(msg.itemId || null);
      sendResponse({ ok: true });
    } else if (msg?.type === "KIPI_OPEN_ITEM") {
      openLibraryAt(msg.itemId || null);
      sendResponse({ ok: true });
    } else if (msg?.type === "KIPI_SYNC_NOW") {
      try {
        const result = await runSyncPass();
        sendResponse({ ok: true, result });
      } catch (e) {
        await recordSyncFailure(e);
        sendResponse({ ok: false, error: e.message });
      }
    } else if (msg?.type === "KIPI_SYNC_STATUS") {
      sendResponse(await DriveSync.getHealth());
    }
  })();
  return true; // keep the message channel open for async sendResponse
});
