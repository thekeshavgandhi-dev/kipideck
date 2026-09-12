// test/wiring.test.js — "would this extension actually load?"
//
// Kipideck is hand-written with no framework and no bundler, so the failure mode
// that hurts most is a file that references something that is not there: an
// element id that was renamed in the HTML but not the JS, an import of a module
// nobody packaged, a manifest entry pointing at a deleted file. None of those
// are caught by the logic tests, and all of them ship a broken extension.
//
// This suite checks the wiring statically:
//   • every getElementById/el() reference resolves to an id in that page's HTML
//   • every local <script src> / <link href> exists on disk
//   • every static ES import in extension code resolves to a real file
//   • every manifest-referenced file exists
//   • every runtime.getURL("…") target exists
//   • every file the extension needs is in the list the website packages

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");
const exists = (rel) => existsSync(join(repoRoot, rel));

/** Extension pages: [html, js] pairs whose ids must line up. */
const PAGES = [
  ["library/library.html", "library/library.js"],
  ["popup/popup.html", "popup/popup.js"],
  ["onboarding/onboarding.html", "onboarding/onboarding.js"],
];

/** Every module the extension loads (content scripts are classic, so no imports). */
const MODULES = [
  "background/background.js",
  "library/library.js",
  "popup/popup.js",
  "onboarding/onboarding.js",
  "lib/storage.js",
  "lib/search.js",
  "lib/db.js",
  "lib/text.js",
  "lib/canon.js",
  "lib/policy.js",
  "lib/favicons.js",
  "lib/drive-sync.js",
  "lib/compat.js",
  "lib/classify.js",
  "lib/extract.js",
];

function idsIn(html) {
  return new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
}

/** Ids the page script writes into the DOM itself (the detail modal in
 * library.js is built from a template string), so they exist at runtime even
 * though the static HTML never mentions them. */
function idsCreatedBy(js) {
  return new Set([...js.matchAll(/\bid="([^"$]+)"/g)].map((m) => m[1]));
}

function idsReferencedIn(js) {
  const out = new Set();
  for (const m of js.matchAll(/getElementById\(\s*["'`]([^"'`]+)["'`]/g)) out.add(m[1]);
  // library.js and popup.js wrap lookups in a local `el("id")` helper.
  for (const m of js.matchAll(/[^.\w]el\(\s*["'`]([^"'`]+)["'`]/g)) out.add(m[1]);
  return out;
}

function localAssetsIn(html, pageRel) {
  const out = [];
  const dir = dirname(pageRel);
  for (const m of html.matchAll(/<(?:script|link|img)\b[^>]*?\b(?:src|href)="([^"]+)"/g)) {
    const ref = m[1];
    if (/^(https?:|data:|#|mailto:)/i.test(ref)) continue;
    out.push(relFromRoot(join(dir, ref)));
  }
  return out;
}

function importsIn(js, rel) {
  const out = [];
  const dir = dirname(rel);
  const re = /(?:^|\n)\s*(?:import|export)\b[^;\n]*?from\s*["']([^"']+)["']/g;
  for (const m of js.matchAll(re)) {
    const spec = m[1];
    if (!spec.startsWith(".")) continue; // bare/node: specifiers are not files of ours
    out.push(relFromRoot(join(dir, spec)));
  }
  // Side-effect imports: `import "./x.js";`
  for (const m of js.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) {
    if (!m[1].startsWith(".")) continue;
    out.push(relFromRoot(join(dir, m[1])));
  }
  return out;
}

/**
 * Remove comments without touching string or template literals, so scans for
 * member accesses and message types see code only. Prose like
 * "the index lives in lib/db.js" used to be read as a `db.js` member access.
 */
function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      out += " ";
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === c) { j++; break; }
        j++;
      }
      out += src.slice(i, j);
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** A path relative to the repo root, from a path relative to anything. */
function relFromRoot(p) {
  return resolve(repoRoot, p).slice(repoRoot.length + 1).split("\\").join("/");
}

/** Names a module exports, read statically so this test needs no browser globals. */
function exportedNames(js) {
  const out = new Set();
  for (const m of js.matchAll(/^export\s+(?:async\s+)?(?:function|class)\s+([A-Za-z0-9_$]+)/gm)) out.add(m[1]);
  for (const m of js.matchAll(/^export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/gm)) out.add(m[1]);
  for (const m of js.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) out.add(name);
    }
  }
  if (/^export\s+default\b/m.test(js)) out.add("default");
  return out;
}

/** `{ named: [{alias, name, from}], namespace: [{alias, from}] }` for one module. */
function importsOf(js) {
  const named = [];
  const namespace = [];
  const re = /(?:^|\n)\s*import\s+([^;\n]+?)\s+from\s*["']([^"']+)["']/g;
  for (const m of js.matchAll(re)) {
    const clause = m[1].trim();
    const from = m[2];
    if (!from.startsWith(".")) continue;
    const nsMatch = clause.match(/\*\s+as\s+([A-Za-z0-9_$]+)/);
    if (nsMatch) namespace.push({ alias: nsMatch[1], from });
    const braces = clause.match(/\{([^}]*)\}/);
    if (braces) {
      for (const part of braces[1].split(",")) {
        const bits = part.trim().split(/\s+as\s+/);
        if (!bits[0]) continue;
        named.push({ name: bits[0].trim(), alias: (bits[1] || bits[0]).trim(), from });
      }
    }
  }
  return { named, namespace };
}

function getUrlTargets() {
  const out = [];
  for (const rel of [...MODULES, "content/content.js"]) {
    if (!exists(rel)) continue;
    for (const m of read(rel).matchAll(/getURL\(\s*["'`]([^"'`]+)["'`]/g)) {
      out.push({ from: rel, target: m[1].replace(/#.*$/, "") });
    }
  }
  return out;
}

/** Every .js file that ships, found by walking the same directories the
 * packager walks — so a new file is checked without anyone updating a list. */
function shippedScripts() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(repoRoot, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith(".js")) out.push(rel);
    }
  };
  for (const dir of ["background", "content", "lib", "popup", "library", "onboarding"]) {
    if (existsSync(join(repoRoot, dir))) walk(dir);
  }
  return out;
}

// ---------------------------------------------------------------------------
describe("syntax", () => {
  test("every shipped script parses", () => {
    const scripts = shippedScripts();
    assert.ok(scripts.length >= 14, `expected the extension's scripts, found ${scripts.length}`);
    const broken = [];
    for (const rel of scripts) {
      try {
        execFileSync(process.execPath, ["--check", join(repoRoot, rel)], { stdio: "pipe" });
      } catch (e) {
        broken.push(`${rel}: ${String(e.stderr || e.message).split("\n")[0]}`);
      }
    }
    assert.deepEqual(broken, [], `scripts that do not parse:\n  ${broken.join("\n  ")}`);
  });
});

describe("page markup ↔ page script", () => {
  for (const [htmlRel, jsRel] of PAGES) {
    test(`${jsRel} only touches ids that exist in ${htmlRel}`, () => {
      assert.ok(exists(htmlRel), `${htmlRel} is missing`);
      assert.ok(exists(jsRel), `${jsRel} is missing`);
      const js = read(jsRel);
      const ids = new Set([...idsIn(read(htmlRel)), ...idsCreatedBy(js)]);
      const referenced = idsReferencedIn(js);
      assert.ok(referenced.size > 3, "expected the page script to reference several ids");
      const missing = [...referenced].filter((id) => !ids.has(id)).sort();
      assert.deepEqual(missing, [], `ids referenced in JS but absent from HTML: ${missing.join(", ")}`);
    });

    test(`${htmlRel} loads only assets that exist`, () => {
      const assets = localAssetsIn(read(htmlRel), htmlRel);
      assert.ok(assets.length > 0, "expected the page to reference at least one local asset");
      const missing = assets.filter((a) => !exists(a));
      assert.deepEqual(missing, [], `missing assets: ${missing.join(", ")}`);
    });
  }
});

describe("module graph", () => {
  test("every extension module exists", () => {
    const missing = MODULES.filter((m) => !exists(m));
    assert.deepEqual(missing, [], `missing modules: ${missing.join(", ")}`);
  });

  test("every relative import resolves to a real file", () => {
    const problems = [];
    for (const rel of MODULES) {
      if (!exists(rel)) continue;
      for (const target of importsIn(read(rel), rel)) {
        if (!exists(target)) problems.push(`${rel} → ${target}`);
      }
    }
    assert.deepEqual(problems, [], `unresolved imports:\n  ${problems.join("\n  ")}`);
  });

  test("every runtime.getURL() target is a real extension file", () => {
    const targets = getUrlTargets();
    assert.ok(targets.length > 0, "expected at least one getURL() call");
    const problems = targets.filter((t) => !exists(t.target)).map((t) => `${t.from} → ${t.target}`);
    assert.deepEqual(problems, [], `getURL targets that do not exist:\n  ${problems.join("\n  ")}`);
  });
});

describe("module APIs", () => {
  test("every named import is really exported by its module", () => {
    const problems = [];
    for (const rel of MODULES) {
      if (!exists(rel)) continue;
      const { named } = importsOf(read(rel));
      for (const imp of named) {
        const target = relFromRoot(join(dirname(rel), imp.from));
        if (!exists(target)) continue; // covered by the unresolved-imports test
        const exports = exportedNames(read(target));
        if (!exports.has(imp.name)) problems.push(`${rel}: imports { ${imp.name} } from ${imp.from}, which does not export it`);
      }
    }
    assert.deepEqual(problems, [], `API drift:\n  ${problems.join("\n  ")}`);
  });

  test("every member used off a namespace import exists", () => {
    // e.g. `DriveSync.getHealth()` — the call sites that broke most often while
    // the sync engine was being rewritten.
    const problems = [];
    for (const rel of MODULES) {
      if (!exists(rel)) continue;
      const src = read(rel);
      const { namespace } = importsOf(src);
      for (const ns of namespace) {
        const target = relFromRoot(join(dirname(rel), ns.from));
        if (!exists(target)) continue;
        const exports = exportedNames(read(target));
        // Blank the module specifiers so `from "./db.js"` cannot be mistaken for
        // a member access on a namespace alias called `db` (multi-line import
        // statements make stripping whole import blocks unreliable).
        const body = stripComments(src).replace(/from\s*["'][^"']+["']/g, 'from ""');
        const used = new Set();
        for (const m of body.matchAll(new RegExp(`\\b${ns.alias}\\.([A-Za-z0-9_$]+)`, "g"))) used.add(m[1]);
        for (const member of used) {
          if (!exports.has(member)) problems.push(`${rel}: ${ns.alias}.${member} is not exported by ${ns.from}`);
        }
      }
    }
    assert.deepEqual(problems, [], `API drift:\n  ${problems.join("\n  ")}`);
  });

  test("message types sent are handled somewhere", () => {
    // Every KIPI_* message a page sends must have a handler in the background
    // (or in a content script), otherwise the feature silently does nothing.
    const background = stripComments(read("background/background.js"));
    const content = stripComments(read("content/content.js"));
    const senders = ["library/library.js", "popup/popup.js", "onboarding/onboarding.js", "content/content.js"];
    const problems = [];
    for (const rel of senders) {
      if (!exists(rel)) continue;
      for (const m of stripComments(read(rel)).matchAll(/type:\s*"(KIPI_[A-Z_]+)"/g)) {
        const type = m[1];
        const handled = background.includes(`"${type}"`) || content.includes(`"${type}"`);
        if (!handled) problems.push(`${rel} sends ${type}, but nothing listens for it`);
      }
    }
    assert.deepEqual(problems, [], `unhandled messages:\n  ${problems.join("\n  ")}`);
  });
});

describe("manifest", () => {
  const manifest = JSON.parse(read("manifest.json"));

  test("every file the manifest names exists", () => {
    const referenced = [
      manifest.action?.default_popup,
      manifest.options_ui?.page,
      manifest.background?.service_worker,
      ...(manifest.background?.scripts || []),
      ...Object.values(manifest.icons || {}),
      ...Object.values(manifest.action?.default_icon || {}),
      ...(manifest.content_scripts || []).flatMap((cs) => [...(cs.js || []), ...(cs.css || [])]),
      ...(manifest.web_accessible_resources || []).flatMap((w) => w.resources || []),
    ].filter(Boolean);
    assert.ok(referenced.length >= 8, "manifest should reference the extension's files");
    const missing = referenced.filter((rel) => !exists(rel));
    assert.deepEqual(missing, [], `manifest references missing files: ${missing.join(", ")}`);
  });

  test("the service worker is declared as a module and imports its libs relatively", () => {
    assert.equal(manifest.background.type, "module");
    assert.ok(read("background/background.js").includes('from "../lib/storage.js"'));
  });

  // These three are the rejections Edge Add-ons came back with on the first
  // upload attempt (2026-09-12). They are store rules, not browser rules: Chrome
  // loads the `scripts` key happily, so nothing local would ever catch them.
  test("the description fits the 132-character store limit", () => {
    assert.equal(
      typeof manifest.description,
      "string",
      "both stores show manifest.description on the listing page"
    );
    assert.ok(
      manifest.description.length <= 132,
      `description is ${manifest.description.length} chars; the Chrome Web Store and Edge Add-ons cap it at 132`
    );
  });

  test("the Chromium manifest uses service_worker and never background.scripts", () => {
    // "The background.scripts field cannot be used with manifest version 3."
    assert.equal(manifest.manifest_version, 3);
    assert.ok(manifest.background.service_worker, "MV3 Chromium needs background.service_worker");
    assert.equal(
      manifest.background.scripts,
      undefined,
      "background.scripts is rejected by the Chromium store validators — it belongs in " +
        "tools/firefox-manifest-overlay.json"
    );
  });

  test("the Chromium manifest carries no Firefox-only keys", () => {
    assert.equal(
      manifest.browser_specific_settings,
      undefined,
      "browser_specific_settings.gecko is AMO-only; Chromium reviewers flag it as an unrecognized key"
    );
  });

  test("the Firefox overlay restores what the Firefox package needs", () => {
    const overlay = JSON.parse(read("tools/firefox-manifest-overlay.json"));
    assert.deepEqual(
      overlay.background.scripts,
      [manifest.background.service_worker],
      "Firefox MV3 runs an event page declared with scripts, pointing at the same file"
    );
    assert.equal(overlay.background.type, "module", "background.js uses static ES imports");
    assert.equal(
      overlay.background.service_worker,
      null,
      "service_worker must be deleted for Firefox: on Firefox < 121 its presence stops the " +
        "event page from ever starting (bug 1860304)"
    );
    assert.ok(
      overlay.browser_specific_settings?.gecko?.id,
      "AMO signing requires browser_specific_settings.gecko.id"
    );
  });

  test("the version matches what the website advertises", () => {
    const advertised = JSON.parse(read("website/public/downloads/version.json"));
    assert.equal(
      advertised.version,
      manifest.version,
      "website/public/downloads/version.json is stale — run `npm run package-extension` in website/"
    );
  });
});

describe("distribution package", () => {
  test("the website's packaging list covers every module and page", () => {
    const script = read("website/scripts/build-extension-zip.mjs");
    // The packager walks these directories; anything outside them is not shipped.
    const dirsMatch = script.match(/const EXTENSION_DIRS = \[([^\]]+)\]/);
    assert.ok(dirsMatch, "packager should declare the directories it walks");
    const dirs = [...dirsMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);

    const neededDirs = new Set(
      [...MODULES, "content/content.js", "content/content.css", ...PAGES.flatMap((p) => p)]
        .map((rel) => dirname(rel))
        .filter((d) => d !== ".")
    );
    const notPackaged = [...neededDirs].filter((d) => !dirs.includes(d)).sort();
    assert.deepEqual(notPackaged, [], `directories that would not be packaged: ${notPackaged.join(", ")}`);
    assert.ok(script.includes('"manifest.json"'), "manifest.json must be packaged at the root");
  });

  test("the built zip is present and current", () => {
    const zip = "website/public/downloads/kipideck-extension.zip";
    assert.ok(exists(zip), "run `npm run package-extension` inside website/ to build it");
    const meta = JSON.parse(read("website/public/downloads/version.json"));
    assert.ok(meta.size > 20_000, `zip looks too small to contain the extension (${meta.size} bytes)`);
    assert.ok(meta.sizeKB >= Math.round(meta.size / 1024) - 1);
  });

  // Read the real artifacts, not the source: the store uploads the zip, so the
  // zip is the thing that has to be valid.
  test("the store packages put manifest.json at the zip root", () => {
    const names = (zip) =>
      execFileSync("unzip", ["-Z1", join(repoRoot, zip)], { encoding: "utf8" })
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

    for (const zip of [
      "website/public/downloads/kipideck-extension-chromium.zip",
      "website/public/downloads/kipideck-extension-firefox.zip",
    ]) {
      const entries = names(zip);
      assert.ok(
        entries.includes("manifest.json"),
        `${zip} has no manifest.json at the root — store validators reject that outright`
      );
      assert.ok(entries.includes("background/background.js"), `${zip} is missing the background script`);
    }

    // The website download keeps the nested kipideck/ folder the install docs
    // tell people to select after unzipping.
    assert.ok(
      names("website/public/downloads/kipideck-extension.zip").includes("kipideck/manifest.json"),
      "the website download should nest everything under kipideck/"
    );
  });

  test("each store package ships only that browser's manifest keys", () => {
    const manifestIn = (zip) =>
      JSON.parse(
        execFileSync("unzip", ["-p", join(repoRoot, zip), "manifest.json"], { encoding: "utf8" })
      );

    const chromium = manifestIn("website/public/downloads/kipideck-extension-chromium.zip");
    assert.ok(chromium.background.service_worker, "Chromium needs background.service_worker");
    assert.equal(chromium.background.scripts, undefined, "Edge rejects background.scripts in MV3");
    assert.equal(chromium.browser_specific_settings, undefined, "gecko settings are Firefox-only");
    assert.ok(chromium.description.length <= 132);

    const firefox = manifestIn("website/public/downloads/kipideck-extension-firefox.zip");
    assert.ok(firefox.background.scripts?.length, "Firefox MV3 needs background.scripts");
    assert.equal(firefox.background.type, "module");
    assert.equal(firefox.background.service_worker, undefined, "stops Firefox < 121 event pages");
    assert.ok(firefox.browser_specific_settings?.gecko?.id, "AMO signing needs a gecko id");
  });
});
