// Shared website → extension bridge helpers (client-side only).
// The Kipideck content script (shipped inside the extension) sets
// window.__KIPIDECK_INSTALLED__ + a DOM marker on EVERY page — including this
// Vercel site — and answers window.postMessage pings. That is how we detect a
// real install and ask the extension to open the USER'S OWN deck
// (their local items + their Google Drive synced items). The website itself
// can never read extension data — it only sends "please open" requests.

export const DOWNLOAD_URL = "/downloads/kipideck-extension.zip";
export const DOWNLOAD_FILENAME = "kipideck-extension.zip";

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
export function startDownload() {
  if (typeof window === "undefined") return;
  const a = document.createElement("a");
  a.href = DOWNLOAD_URL;
  a.download = DOWNLOAD_FILENAME;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
