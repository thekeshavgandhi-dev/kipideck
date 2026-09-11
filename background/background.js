// background/background.js — Kipideck service worker
// Owns the right-click context menus, keyboard shortcuts, and the actual
// "capture + classify + store" pipeline. This is the heart of "save to kipi".

import { Storage } from "../lib/storage.js";
import { classify, excerptFromText } from "../lib/classify.js";

const MENU = {
  ROOT: "kipi_root",
  SAVE_PAGE: "kipi_save_page",
  SAVE_LINK: "kipi_save_link",
  SAVE_SELECTION: "kipi_save_selection",
  SAVE_IMAGE: "kipi_save_image",
  SAVE_VIDEO: "kipi_save_video",
  OPEN_LIBRARY: "kipi_open_library",
};

chrome.runtime.onInstalled.addListener(async () => {
  await Storage.init();
  buildContextMenus();
});

chrome.runtime.onStartup.addListener(async () => {
  await Storage.init();
});

function buildContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU.ROOT,
      title: "Save to Kipi",
      contexts: ["page", "selection", "link", "image", "video"],
    });
    chrome.contextMenus.create({
      id: MENU.SAVE_SELECTION,
      parentId: MENU.ROOT,
      title: 'Save selection: "%s"',
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: MENU.SAVE_LINK,
      parentId: MENU.ROOT,
      title: "Save this link",
      contexts: ["link"],
    });
    chrome.contextMenus.create({
      id: MENU.SAVE_IMAGE,
      parentId: MENU.ROOT,
      title: "Save this image",
      contexts: ["image"],
    });
    chrome.contextMenus.create({
      id: MENU.SAVE_VIDEO,
      parentId: MENU.ROOT,
      title: "Save this video",
      contexts: ["video"],
    });
    chrome.contextMenus.create({
      id: MENU.SAVE_PAGE,
      parentId: MENU.ROOT,
      title: "Save this page",
      contexts: ["page", "image", "video", "link", "selection"],
    });
    chrome.contextMenus.create({
      id: "kipi_sep",
      parentId: MENU.ROOT,
      type: "separator",
      contexts: ["page", "selection", "link", "image", "video"],
    });
    chrome.contextMenus.create({
      id: MENU.OPEN_LIBRARY,
      parentId: MENU.ROOT,
      title: "Open Kipideck library",
      contexts: ["page", "selection", "link", "image", "video"],
    });
  });
}

async function getPageMeta(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
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
    chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title,
      message,
      priority: 1,
    });
  } catch (e) {
    /* notifications may be unavailable in some contexts */
  }
}

async function captureAndSave({ type, tab, info }) {
  const meta = tab?.id != null ? await getPageMeta(tab.id) : {};
  const pageUrl = info?.pageUrl || tab?.url || meta.url || "";
  const domain = hostnameOf(pageUrl);

  let item = {
    type,
    url: pageUrl,
    sourceUrl: pageUrl,
    domain,
    favicon: tab?.favIconUrl || `https://www.google.com/s2/favicons?sz=64&domain=${domain}`,
    title: meta.title || tab?.title || pageUrl,
    excerpt: excerptFromText(meta.description || ""),
    image: meta.image || "",
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
    // full page
    item.reference = pageUrl;
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

  // Tell any open popup/library to refresh live.
  chrome.runtime.sendMessage({ type: "KIPI_ITEM_SAVED", item: saved }).catch(() => {});
  return saved;
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === MENU.OPEN_LIBRARY) {
    chrome.tabs.create({ url: chrome.runtime.getURL("library/library.html") });
    return;
  }
  const map = {
    [MENU.SAVE_PAGE]: "page",
    [MENU.SAVE_LINK]: "link",
    [MENU.SAVE_SELECTION]: "selection",
    [MENU.SAVE_IMAGE]: "image",
    [MENU.SAVE_VIDEO]: "video",
  };
  const type = map[info.menuItemId];
  if (!type) return;
  await captureAndSave({ type, tab, info });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "open-library") {
    chrome.tabs.create({ url: chrome.runtime.getURL("library/library.html") });
    return;
  }
  if (command === "quick-save") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) await captureAndSave({ type: "page", tab, info: {} });
  }
});

// Messages from content script (floating "Save to Kipi" button) or popup.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === "KIPI_SAVE_PAGE") {
      const tab = sender.tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      const saved = await captureAndSave({ type: "page", tab, info: {} });
      sendResponse({ ok: true, item: saved });
    } else if (msg?.type === "KIPI_SAVE_SELECTION") {
      const tab = sender.tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      const saved = await captureAndSave({
        type: "selection",
        tab,
        info: { selectionText: msg.text, pageUrl: tab?.url },
      });
      sendResponse({ ok: true, item: saved });
    } else if (msg?.type === "KIPI_SAVE_NOTE") {
      const tab = sender.tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
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
      sendResponse({ ok: true, item: saved });
    } else if (msg?.type === "KIPI_GET_COUNT") {
      const items = await Storage.getItems();
      sendResponse({ count: items.length });
    }
  })();
  return true; // keep the message channel open for async sendResponse
});
