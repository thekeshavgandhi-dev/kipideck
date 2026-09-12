// Shared website → extension bridge helpers (client-side only).
// The Kipideck content script (shipped inside the extension) sets
// window.__KIPIDECK_INSTALLED__ + a DOM marker on EVERY page — including this
// Vercel site — and answers window.postMessage pings. That is how we detect a
// real install and ask the extension to open the USER'S OWN deck
// (their local items + their Google Drive synced items). The website itself
// can never read extension data — it only sends "please open" requests.

// Two packages, because one manifest cannot serve both engines (see
// docs/STORE_SUBMISSION.md §7): the Chromium package declares
// background.service_worker, Firefox runs an event page declared with
// background.scripts and ignores service_worker entirely — shipping Firefox the
// Chromium package gives it an extension whose background never runs.
export const DOWNLOADS = {
  chromium: {
    url: "/downloads/kipideck-extension.zip",
    filename: "kipideck-extension.zip",
    label: "it's free",
  },
  firefox: {
    url: "/downloads/kipideck-extension-firefox.zip",
    filename: "kipideck-extension-firefox.zip",
    label: "it's free",
  },
};

export const DOWNLOAD_URL = DOWNLOADS.chromium.url;
export const DOWNLOAD_FILENAME = DOWNLOADS.chromium.filename;

/** Client-side only: the server has no idea which browser is asking. */
export function downloadTarget() {
  const isFirefox =
    typeof navigator !== "undefined" && /firefox|fxios|iceweasel/i.test(navigator.userAgent);
  return isFirefox ? DOWNLOADS.firefox : DOWNLOADS.chromium;
}

function snapDetected() {
  if (typeof window === "undefined") return false;
  return (
    window.__KIPIDECK_INSTALLED__ === true ||
    document.documentElement.hasAttribute("data-kipideck-installed")
  );
}

// Resolves { installed: boolean, version: string }. Waits up to `timeoutMs`
// for the content script to answer, so slow-injecting pages still detect.
export function detectExtension(timeoutMs = 1500) {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve({ installed: false, version: "" });
      return;
    }
    let done = false;
    const finish = (installed, version = "") => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMessage);
      window.removeEventListener("kipideck:ready", onReady);
      resolve({ installed, version });
    };
    const onMessage = (event) => {
      const d = event.data;
      if (d && d.source === "kipideck-extension" && d.type === "KIPIDECK_PONG") {
        finish(true, d.version || "");
      }
    };
    const onReady = (event) => finish(true, event?.detail?.version || "");

    window.addEventListener("message", onMessage);
    window.addEventListener("kipideck:ready", onReady);

    // Fast path — content script already ran.
    if (snapDetected()) {
      // Still ping once so we learn the version, but resolve fast.
      window.postMessage({ source: "kipideck-website", type: "KIPIDECK_PING" }, "*");
      setTimeout(() => finish(true), 250);
      return;
    }

    // Slow path — ping a few times while the content script injects.
    window.postMessage({ source: "kipideck-website", type: "KIPIDECK_PING" }, "*");
    const iv = setInterval(() => {
      if (done) {
        clearInterval(iv);
        return;
      }
      if (snapDetected()) {
        clearInterval(iv);
        finish(true);
        return;
      }
      window.postMessage({ source: "kipideck-website", type: "KIPIDECK_PING" }, "*");
    }, 300);

    setTimeout(() => {
      clearInterval(iv);
      finish(snapDetected());
    }, timeoutMs);
  });
}

// Ask the installed extension to open the user's library in a new tab.
// Returns immediately; the extension confirms via a KIPIDECK_OPENING message.
export function requestOpenLibrary() {
  if (typeof window === "undefined") return false;
  window.postMessage({ source: "kipideck-website", type: "KIPIDECK_OPEN_LIBRARY" }, "*");
  return true;
}

// Ask the extension how many items the user has saved. Resolves a number.
export function requestItemCount(timeoutMs = 1500) {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve(0);
      return;
    }
    let done = false;
    const onMessage = (event) => {
      const d = event.data;
      if (d && d.source === "kipideck-extension" && d.type === "KIPIDECK_COUNT") {
        if (!done) {
          done = true;
          window.removeEventListener("message", onMessage);
          resolve(typeof d.count === "number" ? d.count : 0);
        }
      }
    };
    window.addEventListener("message", onMessage);
    window.postMessage({ source: "kipideck-website", type: "KIPIDECK_GET_COUNT" }, "*");
    setTimeout(() => {
      if (!done) {
        done = true;
        window.removeEventListener("message", onMessage);
        resolve(0);
      }
    }, timeoutMs);
  });
}

// Start the extension .zip download (same-origin, so the download attribute works).
// Picks the package for the browser that is actually asking.
export function startDownload() {
  if (typeof window === "undefined") return;
  const target = downloadTarget();
  const a = document.createElement("a");
  a.href = target.url;
  a.download = target.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
