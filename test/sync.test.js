// test/sync.test.js — the Drive sync engine, exercised against an in-memory
// stand-in for the Drive appDataFolder + Google's token endpoint.
//
// Why this file exists: v1.x sync uploaded ONE JSON blob of the whole library.
// At 1,000 saved articles that blob was ~20 MB against a 5 MB Drive limit, so
// sync silently stopped working for exactly the users who needed it most — and
// it failed silently. These tests pin the behaviours that replace it:
//   • sign-in is Authorization Code + PKCE (implicit flow is gone from OAuth 2.1)
//   • the library is sharded, and only shards that actually changed are uploaded
//   • a second device merges instead of overwriting, and deletions propagate
//   • a huge library converges over several capped passes without losing shards
//   • an expired session is reported, not swallowed

import { test, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

await import("./harness.js");
const { resetWorld, memoryStore, identityBehaviour } = await import("./harness.js");
const { MockDrive, installMockDrive } = await import("./drive-mock.js");
const { Storage } = await import("../lib/storage.js");
const db = await import("../lib/db.js");
const DriveSync = await import("../lib/drive-sync.js");

const CLIENT_ID = "1234567890-abcdefghijklmnop.apps.googleusercontent.com";

let drive;
let restoreFetch = () => {};

/** Seed a signed-in session directly, so most tests can skip the OAuth dance. */
async function seedSession({ expired = false } = {}) {
  memoryStore.set(DriveSync.SyncKeys.CLIENT_ID, CLIENT_ID);
  memoryStore.set(DriveSync.SyncKeys.TOKEN, expired ? "stale-token" : drive.currentToken || "access-seed");
  memoryStore.set(DriveSync.SyncKeys.REFRESH, "refresh-seed");
  memoryStore.set(DriveSync.SyncKeys.TOKEN_EXPIRES, expired ? Date.now() - 1000 : Date.now() + 3600_000);
  memoryStore.set(DriveSync.SyncKeys.ACCOUNT, { email: "keeper@example.com", name: "Keeper" });
}

function item(over = {}) {
  const now = Date.now();
  return {
    id: "k_" + Math.random().toString(36).slice(2, 10),
    type: "page",
    title: "Untitled",
    url: "https://example.com/",
    domain: "example.com",
    tags: [],
    deckId: "inbox",
    excerpt: "",
    note: "",
    content: "",
    createdAt: now,
    updatedAt: now,
    pinned: false,
    ...over,
  };
}

async function save(items) {
  const saved = [];
  for (const it of items) {
    saved.push(await Storage.saveItem(it));
  }
  return saved;
}

/** Wipe the local library but keep the Drive session: "the same account, a new device". */
async function simulateFreshDevice() {
  await Storage.clearAll(); // also resets decks + tombstones
  memoryStore.delete(DriveSync.SyncKeys.SHARD_HASHES);
  memoryStore.delete(DriveSync.SyncKeys.PENDING);
}

/** Run capped passes until the backlog is drained (what the alarm does in production). */
async function syncUntilCaughtUp(maxPasses = 40) {
  let result = null;
  for (let i = 0; i < maxPasses; i++) {
    result = await DriveSync.syncNow();
    if (!result.deferred && result.caughtUp !== false) return { result, passes: i + 1 };
  }
  throw new Error(`sync did not converge within ${maxPasses} passes (last: ${JSON.stringify(result)})`);
}

beforeEach(async () => {
  restoreFetch();
  await resetWorld();
  await Storage.init();
  drive = new MockDrive();
  restoreFetch = installMockDrive(drive);
  identityBehaviour.calls.length = 0;
  identityBehaviour.redirectUrlFor = () =>
    "https://kipideck-test.chromiumapp.org/?code=test-code&state=test-state";
  DriveSync._setResumableThreshold(4 * 1024 * 1024);
});

// ---------------------------------------------------------------------------
describe("sign-in (Authorization Code + PKCE)", () => {
  test("refuses to start without a client ID and says where to put one", async () => {
    await assert.rejects(() => DriveSync.signIn(), /No Google OAuth client ID configured/);
  });

  test("asks Google for a code with an S256 challenge — never an implicit token", async () => {
    await DriveSync.setClientId(CLIENT_ID);
    await DriveSync.setClientSecret("web-client-secret");

    // launchWebAuthFlow returns the redirect URL; the harness default carries a
    // state that will not match, so capture the real one from the auth request.
    identityBehaviour.redirectUrlFor = (options) => {
      const authUrl = new URL(options.url);
      return `https://kipideck-test.chromiumapp.org/?code=the-code&state=${authUrl.searchParams.get("state")}`;
    };

    const ok = await DriveSync.signIn();
    assert.equal(ok, true);

    assert.equal(identityBehaviour.calls.length, 1);
    const auth = new URL(identityBehaviour.calls[0].url);
    assert.equal(auth.origin + auth.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(auth.searchParams.get("response_type"), "code", "implicit flow must not be used");
    assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
    assert.match(auth.searchParams.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/, "base64url SHA-256");
    assert.equal(auth.searchParams.get("access_type"), "offline", "needed for a refresh token");
    assert.equal(auth.searchParams.get("prompt"), "consent");
    assert.match(auth.searchParams.get("scope"), /drive\.appdata/);
    assert.ok(!/drive\b(?!\.appdata)/.test(auth.searchParams.get("scope")), "no full-drive scope");
    assert.equal(identityBehaviour.calls[0].interactive, true);

    assert.equal(await DriveSync.isSignedIn(), true);
    const account = await DriveSync.getAccount();
    assert.equal(account.email, "keeper@example.com");

    // A refresh token must be stored, otherwise sync dies every hour again.
    assert.ok(memoryStore.get(DriveSync.SyncKeys.REFRESH), "refresh token persisted");
    assert.equal(drive.calls.token, 1);
  });

  test("rejects a redirect whose state does not match (CSRF guard)", async () => {
    await DriveSync.setClientId(CLIENT_ID);
    identityBehaviour.redirectUrlFor = () => "https://kipideck-test.chromiumapp.org/?code=c&state=attacker";
    await assert.rejects(() => DriveSync.signIn(), /state mismatch/);
    assert.equal(await DriveSync.isSignedIn(), false);
  });

  test("surfaces a Google-side error instead of hanging", async () => {
    await DriveSync.setClientId(CLIENT_ID);
    identityBehaviour.redirectUrlFor = () => "https://kipideck-test.chromiumapp.org/?error=access_denied";
    await assert.rejects(() => DriveSync.signIn(), /access_denied/);
  });

  test("tells the user when Google withheld the refresh token", async () => {
    await DriveSync.setClientId(CLIENT_ID);
    identityBehaviour.redirectUrlFor = (options) => {
      const authUrl = new URL(options.url);
      return `https://kipideck-test.chromiumapp.org/?code=one-shot&state=${authUrl.searchParams.get("state")}`;
    };
    const original = drive.fetch.bind(drive);
    drive.fetch = async (url, opts) => {
      const res = await original(url, opts);
      if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
        const data = await res.json();
        delete data.refresh_token; // simulate a client that has already consented
        return MockDrive.json(data);
      }
      return res;
    };
    await assert.rejects(() => DriveSync.signIn(), /did not return a refresh token/);
  });

  test("refreshes silently when the access token has expired", async () => {
    await seedSession({ expired: true });
    await save([item({ title: "Needs a fresh token", url: "https://example.com/a", content: "body" })]);

    const result = await DriveSync.syncNow();
    assert.equal(result.items, 1);
    assert.equal(identityBehaviour.calls.length, 0, "no user interaction for a routine sync");
    assert.ok(drive.calls.token >= 1, "refresh grant used");
    assert.notEqual(memoryStore.get(DriveSync.SyncKeys.TOKEN), "stale-token");
  });

  test("sign-out revokes and clears the session", async () => {
    await seedSession();
    await DriveSync.signOut();
    assert.equal(await DriveSync.isSignedIn(), false);
    assert.equal(memoryStore.get(DriveSync.SyncKeys.REFRESH), undefined);
    await assert.rejects(() => DriveSync.syncNow(), /Not signed in/);
  });
});

// ---------------------------------------------------------------------------
describe("sharded upload", () => {
  test("splits metadata and text into separate shard files, plus one state file", async () => {
    await seedSession();
    await save(
      Array.from({ length: 30 }, (_, i) =>
        item({
          title: `Article ${i}`,
          url: `https://example.com/post-${i}`,
          content: `Full text of article ${i}. `.repeat(20),
          tags: ["reading"],
        })
      )
    );

    const { result } = await syncUntilCaughtUp();
    assert.equal(result.items, 30);

    const state = drive.byName("kipideck-state.json");
    assert.ok(state, "state file written");
    const parsed = JSON.parse(state.text);
    assert.equal(parsed.schema, 3);
    assert.equal(parsed.counts.items, 30);
    assert.ok(Array.isArray(parsed.tombstones));
    assert.ok(Object.keys(parsed.shards).length >= 2);

    const metaShards = [...drive.files.values()].filter((f) => f.name.startsWith("kipideck-meta-"));
    const contentShards = [...drive.files.values()].filter((f) => f.name.startsWith("kipideck-content-"));
    assert.ok(metaShards.length >= 1);
    assert.ok(contentShards.length >= 1);

    // Metadata shards must not carry page text — that separation is the whole point.
    let metaRecords = 0;
    for (const shard of metaShards) {
      const body = JSON.parse(shard.text);
      assert.equal(body.kind, "meta");
      metaRecords += body.items.length;
      for (const rec of body.items) {
        assert.equal(rec.content, undefined, "content must not ride along in metadata");
        assert.ok(typeof rec.title === "string");
      }
      assert.ok(shard.text.length < 5 * 1024 * 1024, "shard stays under the Drive simple-upload limit");
    }
    assert.equal(metaRecords, 30, "every item landed in exactly one metadata shard");

    let contentRecords = 0;
    for (const shard of contentShards) {
      const body = JSON.parse(shard.text);
      assert.equal(body.kind, "content");
      contentRecords += body.contents.length;
      for (const c of body.contents) assert.match(c.text, /Full text of article/);
    }
    assert.equal(contentRecords, 30, "every item's text landed in exactly one content shard");

    // Every shard in the state file must exist in Drive, with the hash we claim.
    for (const [name, info] of Object.entries(parsed.shards)) {
      const file = drive.byName(name);
      assert.ok(file, `state lists ${name} but Drive has no such file`);
      assert.match(info.hash, /^[0-9a-z]+$/);
    }
  });

  test("an item always maps to the same shard as the library grows", async () => {
    await seedSession();
    const [target] = await save([item({ title: "Anchor", url: "https://example.com/anchor", content: "text" })]);
    await syncUntilCaughtUp();

    const before = [...drive.files.values()].find((f) => f.text.includes(`"id":"${target.id}"`) && f.name.startsWith("kipideck-meta-"));
    assert.ok(before, "anchor item is in a metadata shard");

    // Add 400 more items; the anchor must not migrate shards (that would force a
    // full re-upload every time the library grows).
    await save(Array.from({ length: 400 }, (_, i) => item({ title: `Filler ${i}`, url: `https://example.com/f/${i}` })));
    const { result } = await syncUntilCaughtUp();
    assert.equal(result.items, 401);

    const after = [...drive.files.values()].find((f) => f.text.includes(`"id":"${target.id}"`) && f.name.startsWith("kipideck-meta-"));
    assert.equal(after.name, before.name, "item stayed in the same shard bucket");
  });

  test("a quiet library uploads nothing on the next pass", async () => {
    await seedSession();
    await save(Array.from({ length: 20 }, (_, i) => item({ title: `T${i}`, url: `https://example.com/${i}`, content: "body" })));
    await syncUntilCaughtUp();

    const before = { ...drive.calls };
    const result = await DriveSync.syncNow();
    assert.equal(result.uploaded, 0, "no shard changed, so nothing is uploaded");
    assert.equal(result.downloaded, 0, "nothing remote changed either");
    assert.equal(drive.calls.create, before.create);
    assert.equal(drive.calls.update, before.update + 1, "only the state file is rewritten");
  });

  test("editing one title re-uploads two shards, not the whole library", async () => {
    await seedSession();
    const items = await save(
      Array.from({ length: 200 }, (_, i) =>
        item({ title: `T${i}`, url: `https://example.com/${i}`, content: `body ${i} `.repeat(50) })
      )
    );
    await syncUntilCaughtUp();
    const shardsAfterFirst = [...drive.files.values()].filter((f) => f.name.startsWith("kipideck-")).length;
    assert.ok(shardsAfterFirst > 10, "a 200-item library is spread across many shards");

    const before = { ...drive.calls };
    const victim = items[7];
    await Storage.saveItem({ ...victim, title: "Renamed by hand" });

    const result = await DriveSync.syncNow();
    // Its metadata shard changed, and its content shard changed because the
    // record's text is re-indexed with the item. Everything else is untouched.
    assert.ok(result.uploaded <= 4, `only the touched shards upload (got ${result.uploaded})`);
    assert.ok(result.uploaded >= 1);
    assert.equal(drive.calls.create, before.create, "no new files created");
    assert.equal(drive.calls.update - before.update, result.uploaded + 1, "+1 for the state file");

    const renamed = drive.byName(
      [...drive.files.values()].find((f) => f.name.startsWith("kipideck-meta-") && f.text.includes(`"id":"${victim.id}"`)).name
    );
    assert.match(JSON.parse(renamed.text).items.find((r) => r.id === victim.id).title, /Renamed by hand/);
  });

  test("switches to a resumable upload for big shards", async () => {
    await seedSession();
    await save(Array.from({ length: 5 }, (_, i) => item({ title: `Big ${i}`, url: `https://example.com/big/${i}`, content: "x".repeat(2000) })));
    DriveSync._setResumableThreshold(1024); // force the resumable path

    const { result } = await syncUntilCaughtUp();
    assert.ok(result.uploaded > 0);
    assert.ok(drive.calls.resumable >= 1, "resumable session started");
    assert.equal(drive.calls.create + drive.calls.update > 0, true);

    const state = JSON.parse(drive.byName("kipideck-state.json").text);
    for (const name of Object.keys(state.shards)) assert.ok(drive.byName(name), `${name} really exists`);
  });
});

// ---------------------------------------------------------------------------
describe("second device: merge, not overwrite", () => {
  test("a fresh device downloads the library, text included", async () => {
    await seedSession();
    const items = await save(
      Array.from({ length: 25 }, (_, i) =>
        item({ title: `Saved on device A ${i}`, url: `https://example.com/a/${i}`, content: `Article body ${i}.`, tags: ["alpha"] })
      )
    );
    await Storage.updateSettings({ theme: "dark" });
    await syncUntilCaughtUp();

    await simulateFreshDevice();
    assert.equal((await Storage.getCounts()).total, 0, "device B starts empty");

    const { result } = await syncUntilCaughtUp();
    assert.equal(result.items, 25);
    assert.ok(result.downloaded > 0);

    const found = await Storage.getItem(items[3].id);
    assert.equal(found.title, "Saved on device A 3");
    const content = await db.getContent(items[3].id);
    assert.equal(content.text, "Article body 3.", "text arrives from the content shards");

    const settings = await Storage.getSettings();
    assert.equal(settings.theme, "dark", "settings come across in the state file");
  });

  test("items saved on both devices coexist after one pass each", async () => {
    await seedSession();
    const [a] = await save([item({ title: "Only on A", url: "https://example.com/a", content: "a text" })]);
    await syncUntilCaughtUp();

    // Device B: same account, its own item, and it must not clobber A's.
    await simulateFreshDevice();
    await syncUntilCaughtUp();
    const [b] = await save([item({ title: "Only on B", url: "https://example.com/b", content: "b text" })]);
    await syncUntilCaughtUp();

    // Back on A.
    await simulateFreshDevice();
    const { result } = await syncUntilCaughtUp();
    assert.equal(result.items, 2, "both devices' items survive");
    assert.ok(await Storage.getItem(a.id));
    assert.ok(await Storage.getItem(b.id));
  });

  test("the newer edit wins, and the loser's text is not resurrected", async () => {
    await seedSession();
    const [rec] = await save([item({ title: "Original", url: "https://example.com/x", content: "original text" })]);
    await syncUntilCaughtUp();

    // Device B edits later.
    await simulateFreshDevice();
    await syncUntilCaughtUp();
    await Storage.saveItem({ ...rec, title: "Edited on B", note: "from B", updatedAt: Date.now() + 5000 });
    await syncUntilCaughtUp();

    // Device A had edited earlier; B's newer timestamp must win.
    await simulateFreshDevice();
    await Storage.saveItem({ ...rec, title: "Edited on A", updatedAt: Date.now() - 60_000 });
    await syncUntilCaughtUp();

    const after = await Storage.getItem(rec.id);
    assert.equal(after.title, "Edited on B", "last-writer-wins by updatedAt");
  });

  test("a deletion on one device is not resurrected on the next", async () => {
    await seedSession();
    const [keep, drop] = await save([
      item({ title: "Keep me", url: "https://example.com/keep", content: "keep" }),
      item({ title: "Drop me", url: "https://example.com/drop", content: "drop" }),
    ]);
    await syncUntilCaughtUp();

    await Storage.deleteItem(drop.id);
    await syncUntilCaughtUp();

    const tombstones = await Storage.getTombstones();
    assert.ok(tombstones.some((t) => (t.id || t) === drop.id), "deletion recorded as a tombstone");
    const state = JSON.parse(drive.byName("kipideck-state.json").text);
    assert.ok(state.tombstones.some((t) => (t.id || t) === drop.id), "tombstone published to Drive");
    for (const shard of [...drive.files.values()].filter((f) => f.name.startsWith("kipideck-meta-"))) {
      assert.ok(!shard.text.includes(`"id":"${drop.id}"`), "deleted item removed from the metadata shard");
    }

    await simulateFreshDevice();
    const { result } = await syncUntilCaughtUp();
    assert.equal(result.items, 1, "the deleted item does not come back");
    assert.equal(await Storage.getItem(drop.id), null);
    assert.ok(await Storage.getItem(keep.id));
  });

  test("deleting everything prunes the now-empty shards from Drive", async () => {
    await seedSession();
    const items = await save(
      Array.from({ length: 40 }, (_, i) => item({ title: `T${i}`, url: `https://example.com/${i}`, content: "body" }))
    );
    await syncUntilCaughtUp();
    assert.ok([...drive.files.values()].some((f) => f.name.startsWith("kipideck-meta-")));

    for (const it of items) await Storage.deleteItem(it.id);
    const { result } = await syncUntilCaughtUp();
    assert.equal(result.items, 0);
    assert.equal(
      [...drive.files.values()].filter((f) => f.name.startsWith("kipideck-meta-")).length,
      0,
      "empty shards are deleted rather than left as orphans"
    );
    assert.ok(drive.byName("kipideck-state.json"), "the state file always remains");
  });
});

// ---------------------------------------------------------------------------
describe("legacy single-blob migration", () => {
  test("imports a v1.x kipideck-sync.json and removes it", async () => {
    await seedSession();
    const legacy = {
      version: 2,
      updatedAt: Date.now() - 1000,
      items: [
        item({ id: "legacy_1", title: "From the old blob", url: "https://example.com/legacy-1", content: "legacy text one" }),
        item({ id: "legacy_2", title: "Also old", url: "https://example.com/legacy-2", content: "legacy text two" }),
      ],
      decks: [{ id: "reading", name: "Reading", emoji: "📚" }],
      settings: { theme: "sepia" },
      tombstones: [],
    };
    drive.seed("kipideck-sync.json", JSON.stringify(legacy));

    const result = await DriveSync.syncNow();
    assert.equal(result.migratedFromLegacy, true);
    assert.equal(result.migratedItems, 2, "reports how many items came across, for the UI toast");
    assert.notEqual(await Storage.getItem("legacy_1"), null);
    const text = await db.getContent("legacy_1");
    assert.equal(text.text, "legacy text one", "inline content from the old format is preserved");

    const decks = await Storage.getDecks();
    assert.ok(decks.some((d) => d.id === "reading"), "decks migrated");

    assert.equal(drive.byName("kipideck-sync.json"), undefined, "legacy blob deleted after migration");
    assert.ok(drive.byName("kipideck-state.json"), "replaced by the sharded layout");

    // A second pass must not re-migrate or duplicate anything.
    const again = await syncUntilCaughtUp();
    assert.equal(again.result.migratedFromLegacy, false);
    assert.equal(again.result.items, 2);
  });

  test("merges the legacy blob with items that already exist locally", async () => {
    await seedSession();
    const [local] = await save([item({ title: "Local only", url: "https://example.com/local", content: "local" })]);
    drive.seed(
      "kipideck-sync.json",
      JSON.stringify({
        version: 2,
        items: [item({ id: "legacy_9", title: "Remote only", url: "https://example.com/legacy-9", content: "remote" })],
        decks: [],
        settings: {},
        tombstones: [],
      })
    );

    const result = await DriveSync.syncNow();
    assert.equal(result.migratedFromLegacy, true);
    assert.equal(result.items, 2, "local item is kept, remote item is added");
    assert.ok(await Storage.getItem(local.id));
    assert.ok(await Storage.getItem("legacy_9"));
  });
});

// ---------------------------------------------------------------------------
describe("big libraries converge over several capped passes", () => {
  test("a first sync larger than one pass defers shards and finishes later", async () => {
    await seedSession();
    // 600 items spread over most of the 64 metadata / 256 content buckets puts
    // well over MAX_UPLOADS_PER_PASS (40) shards in play.
    await save(
      Array.from({ length: 600 }, (_, i) =>
        item({ title: `Bulk ${i}`, url: `https://example.com/bulk/${i}`, content: `Body of article ${i}. `.repeat(4) })
      )
    );

    const first = await DriveSync.syncNow();
    assert.equal(first.uploaded, 40, "one pass is capped so the service worker cannot time out");
    assert.ok(first.deferred > 0, "the rest is reported as deferred, not dropped");
    assert.equal(await DriveSync.hasPendingWork(), true);

    const { result, passes } = await syncUntilCaughtUp();
    assert.ok(passes > 1, `needed ${passes} passes`);
    assert.equal(result.deferred, 0);
    assert.equal(result.items, 600);
    assert.equal(await DriveSync.hasPendingWork(), false);

    // Everything the final state file claims must actually be in Drive.
    const state = JSON.parse(drive.byName("kipideck-state.json").text);
    for (const name of Object.keys(state.shards)) {
      assert.ok(drive.byName(name), `${name} listed in state but missing from Drive`);
    }
    let total = 0;
    for (const shard of [...drive.files.values()].filter((f) => f.name.startsWith("kipideck-meta-"))) {
      total += JSON.parse(shard.text).items.length;
    }
    assert.equal(total, 600, "no item lost across the capped passes");
  });

  test("a fresh device with more shards than one download pass still gets everything", async () => {
    await seedSession();
    await save(
      Array.from({ length: 600 }, (_, i) =>
        item({ title: `Bulk ${i}`, url: `https://example.com/bulk/${i}`, content: `Body ${i}` })
      )
    );
    await syncUntilCaughtUp();
    const remoteShards = [...drive.files.values()].filter((f) => f.name !== "kipideck-state.json").length;
    assert.ok(remoteShards > 40, `fixture must exceed the download cap (has ${remoteShards})`);

    await simulateFreshDevice();
    const first = await DriveSync.syncNow();
    assert.equal(first.caughtUp, false, "reports that it is still catching up");

    const { result, passes } = await syncUntilCaughtUp();
    assert.ok(passes > 1);
    assert.equal(result.items, 600, "every item arrived");
    // Critically, the partial passes must not have deleted shards they had not
    // merged yet — that was the data-loss trap this guards against.
    const survivors = [...drive.files.values()].filter((f) => f.name !== "kipideck-state.json").length;
    assert.ok(survivors >= remoteShards - 5, `remote shards survived catch-up (${survivors} of ${remoteShards})`);
    let metaRecords = 0;
    for (const shard of [...drive.files.values()].filter((f) => f.name.startsWith("kipideck-meta-"))) {
      metaRecords += JSON.parse(shard.text).items.length;
    }
    assert.ok(metaRecords >= 600, `metadata intact in Drive (${metaRecords})`);

    const sample = await db.getContent((await Storage.queryItems({ limit: 1 })).items[0].id);
    assert.match(sample.text, /^Body \d+$/, "content shards were merged too");
  });
});

// ---------------------------------------------------------------------------
describe("failures are visible", () => {
  test("a revoked refresh token surfaces as SESSION_EXPIRED and is counted", async () => {
    await seedSession({ expired: true });
    drive.rejectRefresh = true;
    await save([item({ title: "Cannot sync", url: "https://example.com/nope" })]);

    await assert.rejects(() => DriveSync.syncNow(), /SESSION_EXPIRED/);
    const failures = await DriveSync.recordFailure(new Error("SESSION_EXPIRED"));
    assert.equal(failures, 1);

    const health = await DriveSync.getHealth();
    assert.equal(health.failures, 1);
    assert.match(health.lastError, /SESSION_EXPIRED/);

    // The revoked token is cleared so the UI asks for a fresh sign-in.
    assert.equal(memoryStore.get(DriveSync.SyncKeys.REFRESH), undefined);
    assert.equal(await DriveSync.isSignedIn(), false);
  });

  test("a nudge is offered once per cooldown, not on every failure", async () => {
    assert.equal(await DriveSync.shouldNudge(60_000), true);
    assert.equal(await DriveSync.shouldNudge(60_000), false, "second failure inside the window stays quiet");
    assert.equal(await DriveSync.shouldNudge(0), true, "an expired cooldown allows another nudge");
  });

  test("a successful pass clears the failure counter", async () => {
    await seedSession({ expired: true });
    drive.rejectRefresh = true;
    await assert.rejects(() => DriveSync.syncNow(), /SESSION_EXPIRED/);
    await DriveSync.recordFailure(new Error("SESSION_EXPIRED"));

    // User re-authenticates; the next pass must reset the warning state.
    drive.rejectRefresh = false;
    await seedSession();
    await save([item({ title: "Back online", url: "https://example.com/back", content: "text" })]);
    await syncUntilCaughtUp();

    const health = await DriveSync.getHealth();
    assert.equal(health.failures, 0);
    assert.equal(health.lastError, "");
    assert.ok(health.lastSyncAt, "last sync timestamp recorded");
  });

  test("a transient Drive 500 does not corrupt local state", async () => {
    await seedSession();
    await save([item({ title: "Local first", url: "https://example.com/1", content: "text" })]);
    await syncUntilCaughtUp();

    const original = drive.fetch.bind(drive);
    let failed = false;
    drive.fetch = async (url, opts) => {
      if (!failed && String(url).includes("uploadType=multipart")) {
        failed = true;
        return MockDrive.error(500, { error: { message: "backendError" } });
      }
      return original(url, opts);
    };
    await Storage.saveItem(item({ title: "Second", url: "https://example.com/2", content: "two" }));
    await assert.rejects(() => DriveSync.syncNow());

    drive.fetch = original;
    const { result } = await syncUntilCaughtUp();
    assert.equal(result.items, 2, "the retry recovers both items");
    assert.equal((await Storage.getCounts()).total, 2);
  });
});
