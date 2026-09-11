// background/background.js — Kipideck background script
// Owns the one-item "Save to Kipi" right-click menu, keyboard shortcuts,
// the capture + classify + store pipeline, and the periodic Google Drive
// sync tick.
// Uses `ext` (see lib/compat.js) everywhere instead of raw chrome.* / browser.*
// so this exact file runs unmodified on Chrome, Edge, Brave, Opera, and
// Firefox. Declared with "type": "module" AND listed in manifest.background.scripts
// so Firefox (which needs `scripts`, not `service_worker`) loads it too.

import { ext } from "../lib/compat.js";
import { Storage } from "../lib/storage.js";
import { classify, excerptFromText } from "../lib/classify.js";
import { extractPageText } from "../lib/extract.js";
import * as DriveSync from "../lib/drive-sync.js";

const MENU = {
  // One single menu item — no sub-menus, no "what do you want to save?".
  // Whatever the user right-clicked gets saved in that one click; the right
  // context is detected in the onClicked listener below.
  SAVE: "kipi_save",
};

const SYNC_ALARM = "kipi-periodic-sync";

ext.runtime.onInstalled.addListener(async () => {
  await Storage.init();
  buildContextMenus();
  trySchedulePeriodicSync();
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

if (ext.alarms?.onAlarm) {
  ext.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== SYNC_ALARM) return;
    const signedIn = await DriveSync.isSignedIn();
    if (!signedIn) return;
    try {
      await DriveSync.syncNow();
      ext.runtime.sendMessage({ type: "KIPI_SYNCED" }).catch(() => {});
    } catch (e) {
      // SESSION_EXPIRED etc. — silently skip; user can re-sign-in from Settings.
    }
  });
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

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function notify(title, message) {
  const settings = await Storage.getSettings();
  if (!settings.showToast) return;
  try {
    ext.notifications.create({
      type: "basic",
      iconUrl: ext.runtime.getURL("icons/icon128.png"),
      title,
      message,
      priority: 1,
    });
  } catch (e) {
    /* notifications may be unavailable in some contexts */
  }
}

async function maybeSyncAfterSave() {
  try {
    if (await DriveSync.isSignedIn()) await DriveSync.syncNow();
  } catch {
    /* best-effort — a failed background sync should never block a save */
  }
}

function normalizeSelectionText(text) {
  return (text || "").replace(/\s+/g, " ").trim().toLowerCase();
}

async function captureAndSave({ type, tab, info }) {
  const meta = tab?.id != null ? await getPageMeta(tab.id) : {};
  const pageUrl = info?.pageUrl || tab?.url || meta.url || "";
  const domain = hostnameOf(pageUrl);

  // Selections auto-save the moment you finish highlighting them, so a
  // right-click "Save to Kipi" on the very same text seconds later is a
  // double-save — skip it (checked only for selections; page saves stay
  // always allowed on purpose).
  if (type === "selection") {
    const selText = info?.selectionText || meta.selectionText || "";
    const norm = normalizeSelectionText(selText);
    if (norm) {
      const items = await Storage.getItems();
      const dup = items
        .slice(0, 100)
        .find(
          (i) =>
            i.type === "selection" &&
            i.sourceUrl === pageUrl &&
            normalizeSelectionText(i.content) === norm &&
            Date.now() - i.createdAt < 60 * 1000
        );
      if (dup) return { saved: null, skipped: true };
    }
  }

  let item = {
    type,
    url: pageUrl,
    sourceUrl: pageUrl,
    domain,
    favicon: tab?.favIconUrl || `https://www.google.com/s2/favicons?sz=64&domain=${domain}`,
    title: meta.title || tab?.title || pageUrl,
    excerpt: excerptFromText(meta.description || ""),
    image: meta.image || "",
    content: "",
  };

  if (type === "selection") {
    const text = info?.selectionText || meta.selectionText || "";
    item.content = text;
    item.excerpt = excerptFromText(text, 400);
    item.title = excerptFromText(text, 80) || item.title;
  } else if (type === "link") {
    item.url = info.linkUrl;
    item.sourceUrl = pageUrl;
    item.domain = hostnameOf(info.linkUrl);
    item.title = info.linkUrl;
    item.reference = `Found on: ${meta.title || pageUrl}`;
  } else if (type === "image") {
    item.image = info.srcUrl;
    item.url = info.srcUrl;
    item.sourceUrl = pageUrl;
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
      const { text, wordCount } = await getFullPageText(tab.id);
      item.content = text;
      item.wordCount = wordCount;
      if (!item.excerpt) item.excerpt = excerptFromText(text, 280);
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

  const decks = await Storage.getDecks();
  const deck = decks.find((d) => d.id === deckId);
  await notify(
    "Saved to Kipideck ✅",
    `${item.title?.slice(0, 60) || "Item"}\n→ ${deck ? deck.icon + " " + deck.name : "Inbox"}`
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
      .sendMessage(tab.id, { type: "KIPI_TOAST", text: "Already in your Kipideck" })
      .catch(() => {});
  }
});

ext.commands.onCommand.addListener(async (command) => {
  if (command === "open-library") {
    ext.tabs.create({ url: ext.runtime.getURL("library/library.html") });
    return;
  }
  if (command === "quick-save") {
    const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
    if (tab) await captureAndSave({ type: "page", tab, info: {} });
  }
});

// Messages from content script / popup / library.
ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === "KIPI_SAVE_PAGE") {
      const tab = sender.tab || (await ext.tabs.query({ active: true, currentWindow: true }))[0];
      const res = await captureAndSave({ type: "page", tab, info: {} });
      sendResponse({ ok: !res?.skipped, skipped: !!res?.skipped, item: res?.saved || null });
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
      const domain = hostnameOf(tab?.url || "");
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
      ext.runtime.sendMessage({ type: "KIPI_ITEM_SAVED", item: saved }).catch(() => {});
      maybeSyncAfterSave();
      sendResponse({ ok: true, item: saved });
    } else if (msg?.type === "KIPI_GET_COUNT") {
      const items = await Storage.getItems();
      sendResponse({ count: items.length });
    } else if (msg?.type === "KIPI_OPEN_LIBRARY") {
      // Sent by the content-script website bridge when the user clicks
      // "Open My Deck" on the Vercel site — opens THEIR library with
      // THEIR local + Drive-synced items.
      ext.tabs.create({ url: ext.runtime.getURL("library/library.html") });
      sendResponse({ ok: true });
    } else if (msg?.type === "KIPI_SYNC_NOW") {
      try {
        const result = await DriveSync.syncNow();
        sendResponse({ ok: true, result });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    }
  })();
  return true; // keep the message channel open for async sendResponse
});
