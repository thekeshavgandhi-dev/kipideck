// lib/drive-sync.js — cross-device sync through the user's OWN Google Drive
// "app data" folder.
//
// There is no Kipideck server anywhere in this flow. The app-data folder is a
// hidden, per-app space Drive provides: it never appears in the user's normal
// Drive UI, and only this OAuth client can read or write it. Google's
// infrastructure IS the sync backend — nothing for us to host, pay for, or leak.
//
// WHAT CHANGED IN PHASE 0 (both were correctness walls, not preferences):
//
//   1. AUTH. v1.3 used the OAuth2 *implicit* flow (`response_type=token`),
//      which cannot issue a refresh token, so the session died every hour and
//      surfaced as `SESSION_EXPIRED` — with the error swallowed, so sync just
//      quietly stopped. Implicit is also deprecated in OAuth 2.1. This now uses
//      Authorization Code + PKCE via `identity.launchWebAuthFlow()` (the one
//      identity API that behaves the same on Chrome, Edge, Brave, Opera AND
//      Firefox), exchanges the code for a REFRESH TOKEN, and refreshes silently
//      forever after. Still BYO client ID — no first-party secret of ours is
//      embedded, so the "no Kipideck server, no Kipideck account" promise holds.
//
//   2. SHAPE. v1.3 uploaded the ENTIRE library — metadata plus up to 20 KB of
//      page text per item — as one JSON blob on every save and every 10-minute
//      tick. Measured: 4.1 MB at 500 items, 19.6 MB at 1,000, 218.9 MB at
//      50,000, against Drive's documented 5 MB limit for simple/multipart
//      uploads (resumable is required above that). Sync now stores stable,
//      hash-tracked SHARDS: only shards that actually changed are uploaded,
//      anything over the limit uses a resumable upload, and content shards are
//      bucketed more finely than metadata shards because they are ~8× bigger.

import { ext } from "./compat.js";
import { Storage, mergeRecords } from "./storage.js";
import * as db from "./db.js";

const STATE_FILE = "kipideck-state.json";
const LEGACY_FILE = "kipideck-sync.json"; // v1.x single-blob snapshot
const META_PREFIX = "kipideck-meta-";
const CONTENT_PREFIX = "kipideck-content-";
const SCHEMA_VERSION = 3;

/** Bucket counts. Chosen so a 50,000-item library keeps every shard well under
 * Drive's 5 MB simple-upload limit: ~780 metadata records per shard (≈0.4 MB)
 * and ~195 content records per shard (≈0.8 MB at 4 KB of text each). */
const META_BUCKETS = 64;
const CONTENT_BUCKETS = 256;
/** Byte size above which a resumable upload is used instead of simple/multipart.
 * Drive documents simple/multipart for ≤5 MB; we switch below that to leave
 * headroom for multipart framing. Overridable so the test suite can exercise the
 * resumable path without building a 4 MB fixture. */
let resumableThreshold = 4 * 1024 * 1024;
export function _setResumableThreshold(bytes) {
  resumableThreshold = bytes;
}
/** Bound the work in one pass; the next alarm tick continues where this stopped. */
const MAX_UPLOADS_PER_PASS = 40;
const MAX_DOWNLOADS_PER_PASS = 40;

const KEYS = {
  TOKEN: "kipi_sync_token",
  REFRESH: "kipi_sync_refresh_token",
  TOKEN_EXPIRES: "kipi_sync_token_expires",
  ACCOUNT: "kipi_sync_account",
  LAST_SYNC: "kipi_sync_last_at",
  DEVICE_ID: "kipi_sync_device_id",
  CLIENT_ID: "kipi_sync_client_id",
  CLIENT_SECRET: "kipi_sync_client_secret",
  SHARD_HASHES: "kipi_sync_shard_hashes",
  PENDING: "kipi_sync_pending",
  FAIL_COUNT: "kipi_sync_fail_count",
  LAST_ERROR: "kipi_sync_last_error",
  LAST_NUDGE: "kipi_sync_nudge_at",
};

const SCOPES = [
  "https://www.googleapis.com/auth/drive.appdata",
  "https://www.googleapis.com/auth/userinfo.email",
];

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

// ---------------------------------------------------------------------------
// storage.local helpers (tokens and sync bookkeeping stay out of IndexedDB so
// they survive a library reset and are cheap to read from the service worker)
// ---------------------------------------------------------------------------

async function getLocal(key, fallback = null) {
  const res = await ext.storage.local.get(key);
  return Object.prototype.hasOwnProperty.call(res, key) ? res[key] : fallback;
}
async function setLocal(patch) {
  await ext.storage.local.set(patch);
}

export async function getDeviceId() {
  let id = await getLocal(KEYS.DEVICE_ID);
  if (!id) {
    id = "dev_" + Math.random().toString(36).slice(2, 10);
    await setLocal({ [KEYS.DEVICE_ID]: id });
  }
  return id;
}

export async function setClientId(clientId) {
  await setLocal({ [KEYS.CLIENT_ID]: clientId.trim() });
}
export async function getClientId() {
  return getLocal(KEYS.CLIENT_ID, "");
}
/** Optional: only needed for OAuth client types that issue a secret
 * ("Web application" / "Desktop app"). "Chrome Extension" clients have none. */
export async function setClientSecret(secret) {
  await setLocal({ [KEYS.CLIENT_SECRET]: (secret || "").trim() });
}
export async function getClientSecret() {
  return getLocal(KEYS.CLIENT_SECRET, "");
}

export async function isSignedIn() {
  return !!(await getLocal(KEYS.REFRESH)) || !!(await getLocal(KEYS.TOKEN));
}
export async function getAccount() {
  return getLocal(KEYS.ACCOUNT, null);
}
export async function getLastSyncAt() {
  return getLocal(KEYS.LAST_SYNC, null);
}

/** What the Library's sync pill shows when things go wrong. Failures are counted
 * here rather than swallowed, because a sync that silently stops is worse than
 * one that tells you it stopped. */
export async function getHealth() {
  const [failures, lastError, lastSyncAt, signedIn] = await Promise.all([
    getLocal(KEYS.FAIL_COUNT, 0),
    getLocal(KEYS.LAST_ERROR, ""),
    getLocal(KEYS.LAST_SYNC, null),
    isSignedIn(),
  ]);
  return { failures, lastError, lastSyncAt, signedIn };
}

export async function recordFailure(err) {
  const failures = (await getLocal(KEYS.FAIL_COUNT, 0)) + 1;
  await setLocal({ [KEYS.FAIL_COUNT]: failures, [KEYS.LAST_ERROR]: String(err?.message || err || "unknown") });
  return failures;
}

export async function clearFailures() {
  const failures = await getLocal(KEYS.FAIL_COUNT, 0);
  if (failures || (await getLocal(KEYS.LAST_ERROR, ""))) {
    await setLocal({ [KEYS.FAIL_COUNT]: 0, [KEYS.LAST_ERROR]: "" });
  }
}

/** True at most once per cooldown — used to decide whether to nudge the user. */
export async function shouldNudge(cooldownMs = 12 * 60 * 60 * 1000) {
  const last = await getLocal(KEYS.LAST_NUDGE, 0);
  if (Date.now() - last < cooldownMs) return false;
  await setLocal({ [KEYS.LAST_NUDGE]: Date.now() });
  return true;
}

// ---------------------------------------------------------------------------
// PKCE + token exchange
// ---------------------------------------------------------------------------

function base64url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomBytes(n) {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return new Uint8Array(digest);
}

/** One-time random state, so a redirected auth response cannot be replayed. */
function randomState() {
  return base64url(randomBytes(12));
}

async function postForm(url, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    throw new Error(data?.error_description || data?.error || `Token request failed (${res.status})`);
  }
  return data;
}

/**
 * Authorization Code + PKCE through the browser's native web-auth UI.
 * `access_type=offline` is what makes Google return a refresh token; the first
 * consent also asks for `prompt=consent` so an existing grant cannot suppress it.
 */
export async function signIn() {
  const clientId = await getClientId();
  if (!clientId) {
    throw new Error(
      "No Google OAuth client ID configured. Open Settings → Sync and paste in a client ID (see docs/GOOGLE_SYNC_SETUP.md)."
    );
  }
  const clientSecret = await getClientSecret();
  const redirectUri = ext.identity.getRedirectURL();
  const state = randomState();
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(await sha256(verifier));

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "code"); // NOT `token` — implicit is deprecated
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", SCOPES.join(" "));
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("include_granted_scopes", "true");

  const redirected = await ext.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive: true });

  // Google may return the code in the query string or (older paths) the fragment.
  const parsed = new URL(redirected);
  const params = new URLSearchParams(parsed.search || parsed.hash.replace(/^#/, ""));
  if (params.get("error")) throw new Error(`Google sign-in failed: ${params.get("error")}`);
  if (params.get("state") !== state) throw new Error("OAuth state mismatch — please try again.");
  const code = params.get("code");
  if (!code) throw new Error("Google did not return an authorization code.");

  const tokens = await postForm(TOKEN_ENDPOINT, {
    code,
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret } : {}),
    code_verifier: verifier,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  await setLocal({
    [KEYS.TOKEN]: tokens.access_token,
    [KEYS.TOKEN_EXPIRES]: Date.now() + Number(tokens.expires_in || 3600) * 1000,
    // Google only hands out a refresh token on the first consent for a client.
    // Keep any previously stored one if this response omits it.
    [KEYS.REFRESH]: tokens.refresh_token || (await getLocal(KEYS.REFRESH, "")),
    [KEYS.FAIL_COUNT]: 0,
    [KEYS.LAST_ERROR]: "",
  });

  if (!(await getLocal(KEYS.REFRESH))) {
    // Without a refresh token we are back to hourly re-auth; tell the user why.
    throw new Error(
      "Signed in, but Google did not return a refresh token. Re-run sign-in once more (consent screen must be shown) so sync can refresh itself."
    );
  }

  try {
    const profile = await driveFetch("https://www.googleapis.com/oauth2/v3/userinfo");
    if (profile) await setLocal({ [KEYS.ACCOUNT]: { email: profile.email, name: profile.name || profile.email } });
  } catch {
    /* the email label is cosmetic — never fail sign-in over it */
  }

  return true;
}

export async function signOut() {
  const [token, refresh] = await Promise.all([getLocal(KEYS.TOKEN), getLocal(KEYS.REFRESH)]);
  for (const t of [token, refresh]) {
    if (!t) continue;
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t)}`, { method: "POST" });
    } catch {
      /* ignore network errors on revoke */
    }
  }
  await ext.storage.local.remove([
    KEYS.TOKEN,
    KEYS.REFRESH,
    KEYS.TOKEN_EXPIRES,
    KEYS.ACCOUNT,
    KEYS.LAST_SYNC,
    KEYS.SHARD_HASHES,
    KEYS.PENDING,
    KEYS.FAIL_COUNT,
    KEYS.LAST_ERROR,
  ]);
}

/** Silent refresh — the reason an hourly SESSION_EXPIRED no longer exists. */
async function refreshAccessToken() {
  const refresh = await getLocal(KEYS.REFRESH);
  const clientId = await getClientId();
  const clientSecret = await getClientSecret();
  if (!refresh || !clientId) throw new Error("SESSION_EXPIRED");
  try {
    const tokens = await postForm(TOKEN_ENDPOINT, {
      refresh_token: refresh,
      client_id: clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
      grant_type: "refresh_token",
    });
    await setLocal({
      [KEYS.TOKEN]: tokens.access_token,
      [KEYS.TOKEN_EXPIRES]: Date.now() + Number(tokens.expires_in || 3600) * 1000,
      [KEYS.REFRESH]: tokens.refresh_token || refresh,
    });
    return tokens.access_token;
  } catch (err) {
    // invalid_grant means the refresh token was revoked (password change,
    // app de-authorised) — clear it so the UI asks for a fresh sign-in.
    if (/invalid_grant|Token has been expired|revoked/i.test(String(err?.message || ""))) {
      await ext.storage.local.remove([KEYS.TOKEN, KEYS.REFRESH, KEYS.TOKEN_EXPIRES]);
    }
    throw new Error("SESSION_EXPIRED");
  }
}

async function getValidToken() {
  const token = await getLocal(KEYS.TOKEN);
  const expires = await getLocal(KEYS.TOKEN_EXPIRES, 0);
  if (token && Date.now() < expires - 60_000) return token;
  return refreshAccessToken();
}

/** Drive/Google API call with auth, one transparent refresh-and-retry on 401. */
async function driveRequest(url, options = {}) {
  const doFetch = async (accessToken) =>
    fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${accessToken}` },
    });

  let res = await doFetch(await getValidToken());
  if (res.status === 401) {
    const token = await refreshAccessToken();
    res = await doFetch(token);
  }
  if (res.status === 401 || res.status === 403) throw new Error("SESSION_EXPIRED");
  return res;
}

async function driveFetch(url, options = {}) {
  const res = await driveRequest(url, options);
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sharding
// ---------------------------------------------------------------------------

/** FNV-1a — a change detector, not a security hash. */
function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** Stable bucket for an id, so an item never migrates between shards as the
 * library grows (which would force a full re-upload). */
function bucketOf(id, buckets) {
  let h = 0;
  const s = String(id);
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return h % buckets;
}

const metaShardName = (b) => `${META_PREFIX}${String(b).padStart(3, "0")}.json`;
const contentShardName = (b) => `${CONTENT_PREFIX}${String(b).padStart(3, "0")}.json`;

/** Split the local library into shard payloads. Content is stored apart from
 * metadata so a title edit never re-uploads 4 KB of page text. */
async function buildLocalShards() {
  const metas = await db.getAllItemMetas();
  const metaBuckets = new Map();
  const contentBuckets = new Map();

  // Content is read in batches: one get() per item at 50k items would be tens of
  // thousands of round trips through IndexedDB inside a single sync pass.
  const CONTENT_BATCH = 400;
  for (let i = 0; i < metas.length; i += CONTENT_BATCH) {
    const slice = metas.slice(i, i + CONTENT_BATCH);
    const contents = await db.getContents(slice.map((m) => m.id));
    for (const meta of slice) {
      const { idx, n, ...clean } = meta;
      const mb = bucketOf(meta.id, META_BUCKETS);
      if (!metaBuckets.has(mb)) metaBuckets.set(mb, []);
      metaBuckets.get(mb).push(clean);

      const content = contents.get(meta.id);
      if (content && content.text) {
        const cb = bucketOf(meta.id, CONTENT_BUCKETS);
        if (!contentBuckets.has(cb)) contentBuckets.set(cb, []);
        contentBuckets.get(cb).push({ id: meta.id, text: content.text, wordCount: content.wordCount || 0 });
      }
    }
  }

  const shards = new Map(); // name → { name, kind, bucket, body, hash }
  for (const [bucket, items] of metaBuckets) {
    const body = JSON.stringify({ schema: SCHEMA_VERSION, kind: "meta", bucket, items });
    shards.set(metaShardName(bucket), { name: metaShardName(bucket), kind: "meta", bucket, body, hash: hashString(body) });
  }
  for (const [bucket, contents] of contentBuckets) {
    const body = JSON.stringify({ schema: SCHEMA_VERSION, kind: "content", bucket, contents });
    shards.set(contentShardName(bucket), {
      name: contentShardName(bucket),
      kind: "content",
      bucket,
      body,
      hash: hashString(body),
    });
  }
  return shards;
}

// ---------------------------------------------------------------------------
// Drive file plumbing
// ---------------------------------------------------------------------------

async function listRemoteFiles() {
  const out = new Map(); // name → { id, modifiedTime, size }
  let pageToken = "";
  for (let page = 0; page < 10; page++) {
    const url =
      "https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&pageSize=1000" +
      "&fields=nextPageToken,files(id,name,modifiedTime,size)" +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
    const data = await driveFetch(url);
    if (!data) break;
    for (const f of data.files || []) out.set(f.name, f);
    pageToken = data.nextPageToken || "";
    if (!pageToken) break;
  }
  return out;
}

async function downloadJson(fileId) {
  const res = await driveRequest(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  if (!res.ok) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Upload one file, choosing the transfer type by size. Simple/multipart are
 * documented for ≤5 MB; above that a resumable session is required, which is
 * also what makes a large upload survive a flaky connection instead of
 * restarting from zero.
 */
async function uploadFile(name, body, existingFileId) {
  const bytes = new TextEncoder().encode(body).length;
  const mimeType = "application/json";

  if (bytes <= resumableThreshold) {
    if (existingFileId) {
      const res = await driveRequest(
        `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=media`,
        { method: "PATCH", headers: { "Content-Type": mimeType }, body }
      );
      if (!res.ok) throw new Error(`Upload failed for ${name} (${res.status})`);
      return existingFileId;
    }
    const form = new FormData();
    form.append(
      "metadata",
      new Blob([JSON.stringify({ name, parents: ["appDataFolder"], mimeType })], { type: "application/json" })
    );
    form.append("file", new Blob([body], { type: mimeType }));
    const res = await driveRequest(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
      { method: "POST", body: form }
    );
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.id) throw new Error(`Create failed for ${name} (${res.status})`);
    return data.id;
  }

  // Resumable: start a session, then PUT the bytes to the session URL.
  const startUrl = existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=resumable`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable";
  const startRes = await driveRequest(startUrl, {
    method: existingFileId ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": mimeType },
    body: JSON.stringify(existingFileId ? { mimeType } : { name, parents: ["appDataFolder"], mimeType }),
  });
  if (!startRes.ok) throw new Error(`Resumable start failed for ${name} (${startRes.status})`);
  const location = startRes.headers.get("Location");
  if (!location) throw new Error(`Resumable start for ${name} returned no session URL`);

  const putRes = await driveRequest(location, {
    method: "PUT",
    headers: { "Content-Type": mimeType, "Content-Length": String(bytes) },
    body,
  });
  if (!putRes.ok) throw new Error(`Resumable upload failed for ${name} (${putRes.status})`);
  const data = await putRes.json().catch(() => null);
  return data?.id || existingFileId || null;
}

async function deleteRemoteFile(fileId) {
  try {
    await driveRequest(`https://www.googleapis.com/drive/v3/files/${fileId}`, { method: "DELETE" });
  } catch {
    /* a leftover shard is harmless; the next pass retries */
  }
}

// ---------------------------------------------------------------------------
// Legacy single-blob migration
// ---------------------------------------------------------------------------

/** Import a v1.x `kipideck-sync.json` snapshot (metadata + content in one file)
 * into the sharded layout, so upgrading never strands an existing library. */
async function migrateLegacySnapshot(files) {
  const legacy = files.get(LEGACY_FILE);
  if (!legacy) return 0;
  const snapshot = await downloadJson(legacy.id);
  if (!snapshot) return 0; // transient read failure — try again next pass
  if (!Array.isArray(snapshot.items)) {
    // Parsed, but not a Kipideck snapshot: it can never be migrated, so drop it
    // rather than re-downloading it on every pass forever.
    await deleteRemoteFile(legacy.id);
    return 0;
  }

  const local = await db.getAllItemMetas();
  const tombstones = await Storage.getTombstones();
  const { merged } = mergeRecords(local, snapshot.items, tombstones, snapshot.tombstones || []);
  const localById = new Map(local.map((m) => [m.id, m]));
  const toWrite = merged.filter((rec) => {
    const mine = localById.get(rec.id);
    return !mine || (rec.updatedAt || 0) > (mine.updatedAt || 0);
  });
  if (toWrite.length) {
    await db.writeItemsBulk(toWrite.map((item) => ({ item, text: item.content || "" })));
  }
  if (Array.isArray(snapshot.decks) && snapshot.decks.length) {
    const decks = await Storage.getDecks();
    const known = new Set(decks.map((d) => d.id));
    let changed = false;
    for (const d of snapshot.decks) {
      if (d?.id && !known.has(d.id)) {
        decks.push(d);
        changed = true;
      }
    }
    if (changed) await ext.storage.local.set({ [Storage.KEYS.DECKS]: decks });
  }
  await deleteRemoteFile(legacy.id);
  return toWrite.length;
}

// ---------------------------------------------------------------------------
// The sync pass
// ---------------------------------------------------------------------------

/**
 * One bidirectional pass:
 *   1. list the app-data folder, migrate a legacy snapshot if one exists
 *   2. download the state file and any shard whose remote hash we do not have
 *   3. merge remote records into local (record-level LWW + tombstones)
 *   4. upload only the shards whose LOCAL hash changed since the last pass
 *   5. write a new state file and clear the delta queue
 *
 * Safe to call on every save and on the 10-minute alarm.
 */
export async function syncNow() {
  if (!(await isSignedIn())) throw new Error("Not signed in to Google.");

  const files = await listRemoteFiles();
  const migratedItems = await migrateLegacySnapshot(files);
  const migratedFromLegacy = migratedItems > 0;
  if (migratedFromLegacy) {
    // The library changed, so the file list is stale — re-list before sharding.
    for (const [name, meta] of await listRemoteFiles()) files.set(name, meta);
  }

  const knownHashes = (await getLocal(KEYS.SHARD_HASHES, {})) || {};
  const remoteStateFile = files.get(STATE_FILE);
  const remoteState = remoteStateFile ? await downloadJson(remoteStateFile.id) : null;
  const remoteShards = (remoteState && remoteState.shards) || {};

  // ---- 2/3. download + merge anything remote that we do not already have ----
  let downloaded = 0;
  /** False once the per-pass download cap bites: we are mid-catch-up, so this
   * device must not prune or republish shard metadata it has not merged yet. */
  let caughtUp = true;
  const incoming = [];
  const incomingContent = [];
  for (const [name, info] of Object.entries(remoteShards)) {
    const remote = files.get(name);
    if (!remote) continue; // listed in state but not in the folder — ignore
    if (knownHashes[name] === info.hash) continue; // we already merged this exact shard
    if (downloaded >= MAX_DOWNLOADS_PER_PASS) {
      caughtUp = false;
      break;
    }
    const payload = await downloadJson(remote.id);
    downloaded++;
    if (!payload) continue;
    if (payload.kind === "meta" && Array.isArray(payload.items)) incoming.push(...payload.items);
    else if (payload.kind === "content" && Array.isArray(payload.contents)) incomingContent.push(...payload.contents);
    knownHashes[name] = info.hash;
  }

  if (incoming.length || incomingContent.length) {
    const contentById = new Map(incomingContent.map((c) => [c.id, c.text]));
    const local = await db.getAllItemMetas();
    const tombstones = await Storage.getTombstones();
    const { merged, tombstones: mergedTombstones } = mergeRecords(
      local,
      incoming,
      tombstones,
      (remoteState && remoteState.tombstones) || []
    );
    const localById = new Map(local.map((m) => [m.id, m]));

    // Batch-read the text we already hold for records the other device sent
    // content for, so "same record but missing body text here" is decided with
    // one round trip instead of one per item.
    const localContent = contentById.size ? await db.getContents([...contentById.keys()]) : new Map();

    const toWrite = merged.filter((rec) => {
      const mine = localById.get(rec.id);
      if (!mine) return true;
      if ((rec.updatedAt || 0) > (mine.updatedAt || 0)) return true;
      return contentById.has(rec.id) && !(localContent.get(rec.id)?.text || "");
    });
    if (toWrite.length) {
      await db.writeItemsBulk(toWrite.map((item) => ({ item, text: contentById.get(item.id) ?? item.content ?? "" })));
    }
    await setLocal({ [Storage.KEYS.TOMBSTONES]: mergedTombstones });
    if (remoteState?.decks && Array.isArray(remoteState.decks)) {
      const decks = await Storage.getDecks();
      const known = new Set(decks.map((d) => d.id));
      let changed = false;
      for (const d of remoteState.decks) {
        if (d?.id && !known.has(d.id)) {
          decks.push(d);
          changed = true;
        }
      }
      if (changed) await ext.storage.local.set({ [Storage.KEYS.DECKS]: decks });
    }
    if (remoteState?.settings && typeof remoteState.settings === "object") {
      // Local settings always win on conflict: they encode this device's
      // capture choices, which must not be silently changed by another browser.
      const cur = await Storage.getSettings();
      const mergedSettings = { ...remoteState.settings, ...cur };
      await Storage.updateSettings(mergedSettings);
    }
  }

  // ---- 4. upload only shards whose local content actually changed ----
  const localShards = await buildLocalShards();
  // Start from the remote view so shards we have not caught up on yet stay
  // listed — dropping them here would strand another device's data forever.
  const newStateShards = { ...remoteShards };
  let uploaded = 0;
  const deferred = [];

  for (const [name, shard] of localShards) {
    const remoteInfo = remoteShards[name];
    const inSync = !!remoteInfo && remoteInfo.hash === shard.hash;
    if (inSync) {
      newStateShards[name] = { hash: shard.hash, updatedAt: remoteInfo.updatedAt || Date.now() };
      knownHashes[name] = shard.hash;
      continue;
    }
    if (uploaded >= MAX_UPLOADS_PER_PASS) {
      // Leave the previous (real) remote entry in the state file: publishing a
      // hash for bytes we have not uploaded would make other devices skip it.
      deferred.push(name);
      continue;
    }
    const fileId = files.get(name)?.id || null;
    const id = await uploadFile(name, shard.body, fileId);
    if (id && !files.has(name)) files.set(name, { id, name });
    uploaded++;
    newStateShards[name] = { hash: shard.hash, updatedAt: Date.now() };
    // We just wrote these bytes, so a later pass must not re-download them.
    knownHashes[name] = shard.hash;
  }

  // Shards that exist remotely but no longer locally (items deleted everywhere).
  // Only safe to prune once every remote shard has been merged into this device,
  // otherwise a capped catch-up pass would delete data it never downloaded.
  if (caughtUp) {
    for (const [name, meta] of [...files]) {
      if (!localShards.has(name) && (name.startsWith(META_PREFIX) || name.startsWith(CONTENT_PREFIX))) {
        await deleteRemoteFile(meta.id);
        files.delete(name);
        delete newStateShards[name];
        delete knownHashes[name];
      }
    }
  }

  // ---- 5. new state file, then clear the delta queue ----
  const [counts, decks, settings, tombstones, deviceId] = await Promise.all([
    Storage.getCounts(),
    Storage.getDecks(),
    Storage.getSettings(),
    Storage.getTombstones(),
    getDeviceId(),
  ]);
  const state = {
    schema: SCHEMA_VERSION,
    version: SCHEMA_VERSION,
    updatedAt: Date.now(),
    device: deviceId,
    counts: { items: counts.total, decks: decks.length },
    decks,
    settings,
    tombstones,
    shards: newStateShards,
  };
  const stateBody = JSON.stringify(state);
  await uploadFile(STATE_FILE, stateBody, files.get(STATE_FILE)?.id || null);
  knownHashes[STATE_FILE] = hashString(stateBody);

  await setLocal({ [KEYS.SHARD_HASHES]: knownHashes, [KEYS.LAST_SYNC]: Date.now(), [KEYS.PENDING]: deferred });
  await clearFailures();

  const dirty = await db.getDirty();
  if (dirty.length && !deferred.length) await db.clearDirty(dirty.map((d) => d.id));

  return {
    items: counts.total,
    decks: decks.length,
    uploaded,
    downloaded,
    deferred: deferred.length,
    caughtUp,
    migratedFromLegacy,
    migratedItems,
  };
}

/** True when a previous pass had to defer shards (very large first sync or a
 * capped catch-up), so another pass should be scheduled promptly. */
export async function hasPendingWork() {
  const pending = await getLocal(KEYS.PENDING, []);
  return Array.isArray(pending) && pending.length > 0;
}

export const SyncKeys = KEYS;
