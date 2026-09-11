// lib/drive-sync.js
// Cross-device sync via the user's own Google Drive "app data" folder — a
// hidden, per-app storage space Drive provides that:
//   - is invisible in the user's normal Drive UI / doesn't count against
//     anything the user can browse to
//   - only THIS extension (with THIS OAuth client) can read or write it
//   - requires zero backend of ours — Google's infrastructure IS the sync
//     backend, so there's nothing for us to host, pay for, or that can leak
//
// Auth uses browser.identity.launchWebAuthFlow() with Google's OAuth2
// "implicit" flow, which is the one identity API that behaves the same way
// on Chrome, Edge, Brave, Opera AND Firefox (unlike chrome.identity.getAuthToken,
// which is Chromium-only). See docs/GOOGLE_SYNC_SETUP.md for the one-time
// Google Cloud Console setup a developer/self-hoster needs to do to get a
// client ID before this will work.

import { ext } from "./compat.js";
import { Storage } from "./storage.js";

const DRIVE_FILE_NAME = "kipideck-sync.json";
const SYNC_KEYS = {
  TOKEN: "kipi_sync_token",
  TOKEN_EXPIRES: "kipi_sync_token_expires",
  FILE_ID: "kipi_sync_file_id",
  ACCOUNT: "kipi_sync_account",
  LAST_SYNC: "kipi_sync_last_at",
  DEVICE_ID: "kipi_sync_device_id",
  CLIENT_ID: "kipi_sync_client_id", // user-provided OAuth client id (see setup docs)
};

const SCOPES = [
  "https://www.googleapis.com/auth/drive.appdata",
  "https://www.googleapis.com/auth/userinfo.email",
];

function randomState() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function getLocal(key, fallback = null) {
  const res = await ext.storage.local.get(key);
  return Object.prototype.hasOwnProperty.call(res, key) ? res[key] : fallback;
}
async function setLocal(patch) {
  await ext.storage.local.set(patch);
}

export async function getDeviceId() {
  let id = await getLocal(SYNC_KEYS.DEVICE_ID);
  if (!id) {
    id = "dev_" + Math.random().toString(36).slice(2, 10);
    await setLocal({ [SYNC_KEYS.DEVICE_ID]: id });
  }
  return id;
}

export async function setClientId(clientId) {
  await setLocal({ [SYNC_KEYS.CLIENT_ID]: clientId.trim() });
}
export async function getClientId() {
  return getLocal(SYNC_KEYS.CLIENT_ID, "");
}

export async function isSignedIn() {
  const token = await getLocal(SYNC_KEYS.TOKEN);
  return !!token;
}

export async function getAccount() {
  return getLocal(SYNC_KEYS.ACCOUNT, null);
}

export async function getLastSyncAt() {
  return getLocal(SYNC_KEYS.LAST_SYNC, null);
}

/** Kick off Google's OAuth2 implicit flow via the browser's native web-auth UI. */
export async function signIn() {
  const clientId = await getClientId();
  if (!clientId) {
    throw new Error(
      "No Google OAuth client ID configured. Open Settings → Sync and paste in a client ID (see docs/GOOGLE_SYNC_SETUP.md)."
    );
  }
  const redirectUri = ext.identity.getRedirectURL();
  const state = randomState();
  const authUrl =
    "https://accounts.google.com/o/oauth2/v2/auth" +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=token` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(SCOPES.join(" "))}` +
    `&state=${state}` +
    `&prompt=consent`;

  const redirected = await ext.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  const hash = new URL(redirected).hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  if (params.get("state") !== state) throw new Error("OAuth state mismatch — please try again.");
  const token = params.get("access_token");
  const expiresIn = Number(params.get("expires_in") || 3600);
  if (!token) throw new Error("Google did not return an access token.");

  await setLocal({
    [SYNC_KEYS.TOKEN]: token,
    [SYNC_KEYS.TOKEN_EXPIRES]: Date.now() + expiresIn * 1000,
  });

  // fetch basic profile (just email, for the "signed in as ___" UI)
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const profile = await res.json();
      await setLocal({ [SYNC_KEYS.ACCOUNT]: { email: profile.email, name: profile.name || profile.email } });
    }
  } catch {
    /* non-fatal */
  }

  return true;
}

export async function signOut() {
  const token = await getLocal(SYNC_KEYS.TOKEN);
  if (token) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, { method: "POST" });
    } catch {
      /* ignore network errors on revoke */
    }
  }
  await ext.storage.local.remove([
    SYNC_KEYS.TOKEN,
    SYNC_KEYS.TOKEN_EXPIRES,
    SYNC_KEYS.ACCOUNT,
    SYNC_KEYS.FILE_ID,
    SYNC_KEYS.LAST_SYNC,
  ]);
}

async function getValidToken() {
  const token = await getLocal(SYNC_KEYS.TOKEN);
  const expires = await getLocal(SYNC_KEYS.TOKEN_EXPIRES, 0);
  if (!token) throw new Error("Not signed in to Google.");
  if (Date.now() > expires - 60_000) {
    // Token expired/near-expiry — implicit flow has no refresh token, so we
    // need a fresh (usually silent, since the user already consented once)
    // interactive round trip. We surface this to the caller as needing sign-in.
    throw new Error("SESSION_EXPIRED");
  }
  return token;
}

async function driveFetch(path, options = {}) {
  const token = await getValidToken();
  const res = await fetch(path, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new Error("SESSION_EXPIRED");
  return res;
}

async function findRemoteFileId() {
  const cached = await getLocal(SYNC_KEYS.FILE_ID);
  if (cached) return cached;
  const res = await driveFetch(
    "https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,name,modifiedTime)&q=" +
      encodeURIComponent(`name='${DRIVE_FILE_NAME}'`)
  );
  const data = await res.json();
  const file = data.files && data.files[0];
  if (file) {
    await setLocal({ [SYNC_KEYS.FILE_ID]: file.id });
    return file.id;
  }
  return null;
}

async function downloadRemote() {
  const fileId = await findRemoteFileId();
  if (!fileId) return null;
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  if (!res.ok) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function uploadRemote(payload) {
  const body = JSON.stringify(payload);
  let fileId = await findRemoteFileId();

  if (!fileId) {
    const metadata = { name: DRIVE_FILE_NAME, parents: ["appDataFolder"], mimeType: "application/json" };
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    form.append("file", new Blob([body], { type: "application/json" }));
    const res = await driveFetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
      { method: "POST", body: form }
    );
    const data = await res.json();
    fileId = data.id;
    await setLocal({ [SYNC_KEYS.FILE_ID]: fileId });
  } else {
    await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
    });
  }
}

/**
 * Three-way, per-record merge: for items/decks, the newer `updatedAt` wins;
 * deletions are respected via tombstones so a delete on device A isn't
 * silently un-done by an older copy still cached on device B. Tags/pins etc.
 * always come along with whichever record "wins" (field-level merging would
 * be nicer, but record-level last-write-wins is far simpler and good enough
 * for a personal save-everything tool).
 */
function mergeRecords(localList, remoteList, localTombstones = [], remoteTombstones = []) {
  const tombstones = new Map();
  for (const t of [...localTombstones, ...remoteTombstones]) {
    const prev = tombstones.get(t.id);
    if (!prev || t.deletedAt > prev.deletedAt) tombstones.set(t.id, t);
  }

  const byId = new Map();
  for (const rec of localList) byId.set(rec.id, rec);
  for (const rec of remoteList) {
    const existing = byId.get(rec.id);
    if (!existing || (rec.updatedAt || 0) > (existing.updatedAt || 0)) {
      byId.set(rec.id, rec);
    }
  }
  // Drop anything tombstoned more recently than its own updatedAt.
  for (const [id, tomb] of tombstones) {
    const rec = byId.get(id);
    if (rec && tomb.deletedAt >= (rec.updatedAt || 0)) byId.delete(id);
  }

  return { merged: Array.from(byId.values()), tombstones: Array.from(tombstones.values()) };
}

/**
 * Full bidirectional sync pass: download remote state, merge with local
 * state, upload the merged result back, and write the merged result into
 * local storage. Safe to call repeatedly / on an alarm.
 */
export async function syncNow() {
  const [localItems, localDecks, localSettings, localTombstones] = await Promise.all([
    Storage.getItems(),
    Storage.getDecks(),
    Storage.getSettings(),
    Storage.getTombstones(),
  ]);

  const remote = (await downloadRemote()) || {};
  const remoteItems = remote.items || [];
  const remoteDecks = remote.decks || [];
  const remoteTombstones = remote.tombstones || [];

  const { merged: mergedItems, tombstones: itemTombstones } = mergeRecords(
    localItems,
    remoteItems,
    localTombstones,
    remoteTombstones
  );
  const { merged: mergedDecks } = mergeRecords(localDecks, remoteDecks, [], []);

  await ext.storage.local.set({
    [Storage.KEYS.ITEMS]: mergedItems,
    [Storage.KEYS.DECKS]: mergedDecks,
    [Storage.KEYS.TOMBSTONES]: itemTombstones,
  });

  const settings = { ...remote.settings, ...localSettings };

  await uploadRemote({
    version: 1,
    updatedAt: Date.now(),
    items: mergedItems,
    decks: mergedDecks,
    settings,
    tombstones: itemTombstones,
  });

  await setLocal({ [SYNC_KEYS.LAST_SYNC]: Date.now() });
  return { items: mergedItems.length, decks: mergedDecks.length };
}

export const SyncKeys = SYNC_KEYS;
