// lib/favicons.js — site icons with no third party involved.
//
// v1.3 fell back to `https://www.google.com/s2/favicons?domain=X` for every
// saved item. That meant the Library and popup each sent every domain in the
// user's library to Google on render, it failed offline, and it contradicted
// the "no tracking" promise — plus, under the Chrome Web Store disclosure rules
// enforced since 1 August 2026, an undisclosed remote transmission like that is
// a removal risk.
//
// Replacement: the icon is fetched ONCE at save time by the service worker
// (from the tab's own favicon URL, else the site's /favicon.ico), stored locally
// as a data: URL, and rendered from that cache. When there is no icon — offline,
// blocked, or a site that has none — a locally generated letter avatar is used.
// Nothing is ever requested at render time.

import * as db from "./db.js";

const MAX_ICON_BYTES = 64 * 1024; // refuse to stuff a 2 MB "icon" into local storage
const FETCH_TIMEOUT_MS = 4000;

/** Stable 0-359 hue from a string, so a site keeps the same colour forever. */
function hueOf(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

/**
 * Locally generated letter avatar as a data: URL. No network, no canvas (so it
 * works in the service worker too), and it renders identically everywhere.
 */
export function letterAvatar(seed, label) {
  const text = String(seed || label || "?").replace(/^www\./, "");
  const letter = (text[0] || "?").toUpperCase();
  const hue = hueOf(text.toLowerCase());
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="hsl(${hue},52%,46%)"/>` +
    `<text x="32" y="33" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="30" ` +
    `font-weight="600" fill="#fff" text-anchor="middle" dominant-baseline="central">${escapeXml(letter)}</text>` +
    `</svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
}

/** Uint8Array → base64 without blowing the call stack on large inputs. */
function toBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Every cached icon, as a Map — the Library and popup load this once per render
 * instead of doing an async lookup per card. */
export async function faviconMap() {
  const rows = await db.getAllFavicons();
  return new Map(rows.map((r) => [r.domain, r.dataUrl]));
}

/** The best local icon for a domain: cached data URL, else a letter avatar.
 * Synchronous apart from the cache read, and never touches the network. */
export async function iconFor(domain, label) {
  const cached = domain ? await db.getFavicon(domain) : null;
  return cached || letterAvatar(domain || label || "?", label);
}

/** Synchronous render-time helper: cache map in, icon out. */
export function iconFromMap(map, domain, label) {
  return (domain && map.get(domain)) || letterAvatar(domain || label || "?", label);
}

async function fetchAsDataUrl(url) {
  if (!/^https?:\/\//i.test(url || "")) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, credentials: "omit", redirect: "follow" });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") || "").toLowerCase();
    if (type && !type.startsWith("image/")) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_ICON_BYTES) return null;
    const mime = type.startsWith("image/") ? type.split(";")[0] : "image/x-icon";
    return `data:${mime};base64,${toBase64(buf)}`;
  } catch {
    return null; // offline, blocked, timeout — the letter avatar takes over
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Best-effort: fetch and cache a domain's icon once. Called from the background
 * service worker AFTER a save has already been committed, so a slow or failing
 * fetch can never delay or break saving.
 *
 * @param {string} domain       host to cache for
 * @param {string} preferredUrl the tab's own favIconUrl, when the browser had one
 */
export async function cacheFaviconFor(domain, preferredUrl) {
  if (!domain) return null;
  const existing = await db.getFavicon(domain);
  if (existing) return existing;

  const candidates = [preferredUrl, `https://${domain}/favicon.ico`].filter(Boolean);
  for (const url of candidates) {
    const dataUrl = await fetchAsDataUrl(url);
    if (dataUrl) {
      await db.putFavicon(domain, dataUrl);
      return dataUrl;
    }
  }
  return null;
}
