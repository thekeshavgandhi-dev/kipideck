// lib/compat.js
// Cross-browser compatibility shim. Every other module imports `ext` from
// here instead of touching `chrome` or `browser` directly, so the exact same
// codebase runs unmodified on Chrome, Edge, Brave, Opera, Vivaldi, and
// Firefox (and, once wrapped by Apple's converter tool, Safari too).
//
// We use Mozilla's official webextension-polyfill, which:
//  - on Chromium browsers: wraps the callback-based `chrome.*` APIs so they
//    return Promises, exposed as `browser.*`
//  - on Firefox/Safari: is a no-op passthrough, since they already expose a
//    Promise-based `browser.*` namespace natively
//
// Side-effect import: browser-polyfill.js sets `globalThis.browser` and
// doesn't export anything itself, so we just import it for its effect.
import "./browser-polyfill.js";

/** The one true, Promise-based extension API surface. Use this everywhere.
 * Implemented as a Proxy that reads `globalThis.browser` on every access
 * (rather than capturing it once at import time) purely so this module
 * behaves correctly under test harnesses / hot-reload that swap out the
 * global between calls; in a real loaded extension `globalThis.browser` is
 * set once by the polyfill and never changes, so this has no runtime cost
 * beyond one extra property lookup. */
export const ext = new Proxy(
  {},
  {
    get(_target, prop) {
      return globalThis.browser[prop];
    },
  }
);

/** True when running inside Firefox (Gecko), false for Chromium-family browsers. */
export const isFirefox =
  typeof navigator !== "undefined" && /Firefox/i.test(navigator.userAgent || "");

/** True when the background context is a real service worker (Chromium) vs an event page (Firefox). */
export const isServiceWorker =
  typeof ServiceWorkerGlobalScope !== "undefined" &&
  typeof self !== "undefined" &&
  self instanceof ServiceWorkerGlobalScope;
