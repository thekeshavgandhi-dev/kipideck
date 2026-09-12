// website/scripts/build-extension-zip.mjs
// Packages the Kipideck browser extension (the files in the repo root) into
// installable .zip files.
//
// Runs automatically on Vercel via the `prebuild` npm script (Vercel clones the
// full repo, then builds inside `website/`, so `../manifest.json` etc. exist at
// build time). Also run it locally any time with:  npm run package-extension
//
// Three packages are produced, because Chromium's stores and Firefox want
// different manifests and stores want manifest.json at the zip ROOT:
//
//   website/public/downloads/
//     kipideck-extension.zip           Chromium manifest, nested in kipideck/  → website download, "Load unpacked"
//     kipideck-extension-chromium.zip  Chromium manifest, at the zip root       → Edge Add-ons + Chrome Web Store upload
//     kipideck-extension-firefox.zip   Firefox manifest,  at the zip root       → AMO upload / temporary add-on
//     version.json                     { version, builtAt, packages: [...] }
//
// Usage:
//   node scripts/build-extension-zip.mjs                 # all three
//   node scripts/build-extension-zip.mjs --only=website  # just the website one
//   node scripts/build-extension-zip.mjs --only=chromium # just the store one

import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const websiteDir = join(here, "..");
const repoRoot = join(here, "..", "..");
const outDir = join(websiteDir, "public", "downloads");

// Every file that makes up the installable extension. manifest.json MUST be at
// the zip root (for the -chromium/-firefox packages, and inside the top-level
// kipideck/ folder for the website one) for "Load unpacked".
//
// The list is DERIVED from these directories rather than hardcoded file names:
// a hardcoded list silently shipped a package with no onboarding page the first
// time a new file was added, and a broken first-run page is exactly the kind of
// bug nobody notices until users hit it. `assertPackageComplete` below then
// cross-checks the result against manifest.json and every runtime.getURL() call
// in the source, so a missing file fails the build instead of the install.
const EXTENSION_ROOT_FILES = ["manifest.json"];
const EXTENSION_DIRS = ["background", "content", "lib", "popup", "library", "onboarding", "icons"];
const SKIP = /^(node_modules|\.DS_Store|.*\.map)$/;

// Firefox-only manifest keys (background.scripts + gecko id). See the comments
// inside the file for why this cannot simply live in manifest.json.
const FIREFOX_OVERLAY = "tools/firefox-manifest-overlay.json";

// The store rules themselves live in ./store-rules.mjs so the packager and the
// verifier (scripts/verify-extension-zip.mjs) cannot drift apart.
import { manifestFiles, manifestProblems } from "./store-rules.mjs";

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.test(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function extensionFiles() {
  const files = [];
  for (const rel of EXTENSION_ROOT_FILES) {
    const full = join(repoRoot, rel);
    if (existsSync(full)) files.push(full);
  }
  for (const dir of EXTENSION_DIRS) {
    const full = join(repoRoot, dir);
    if (existsSync(full)) files.push(...walk(full));
  }
  return files.map((full) => relative(repoRoot, full).split("\\").join("/")).sort();
}

/**
 * Recursively merge `overlay` over `base`, replacing arrays rather than
 * concatenating. A `null` in the overlay deletes that key — that is how the
 * Firefox package drops `background.service_worker`, which Firefox ignores but
 * which stopped its event page from starting on Firefox < 121 (bug 1860304).
 */
function mergeManifest(base, overlay) {
  const out = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (key.startsWith("_")) continue; // `_comment` and friends — documentation only
    if (value === null) {
      delete out[key];
      continue;
    }
    const plain = value && typeof value === "object" && !Array.isArray(value);
    out[key] = plain && out[key] && typeof out[key] === "object" && !Array.isArray(out[key])
      ? mergeManifest(out[key], value)
      : value;
  }
  return out;
}

/**
 * The store validators are stricter than the browsers themselves, and the two
 * disagree: Firefox needs background.scripts, Chromium rejects it. Validate each
 * package against the rules of the store it is going to, so a rejection we have
 * already seen once cannot be uploaded twice.
 */
function assertStoreValid(manifest, target) {
  const problems = manifestProblems(manifest, target);
  if (problems.length) {
    console.error(`[package-extension] the ${target} package would be rejected by the store:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  return manifest;
}

/** Fail loudly if the package would not actually work when unpacked. */
function assertPackageComplete(packed, manifest) {
  const have = new Set(packed);
  const missing = [];

  for (const rel of manifestFiles(manifest)) if (!have.has(rel)) missing.push(`manifest.json → ${rel}`);

  // Any page the code opens with runtime.getURL() must be in the package too —
  // this is what catches a new HTML page that nobody added to the list.
  const urlRe = /getURL\(\s*["'`]([^"'`]+)["'`]/g;
  for (const rel of packed) {
    if (!/\.js$/.test(rel)) continue;
    const src = readFileSync(join(repoRoot, rel), "utf8");
    for (const m of src.matchAll(urlRe)) {
      const target = m[1].replace(/#.*$/, "");
      if (target && !have.has(target)) missing.push(`${rel} → getURL("${m[1]}")`);
    }
  }

  if (missing.length) {
    console.error("[package-extension] package would be incomplete:");
    for (const m of missing) console.error(`  - ${m}`);
    process.exit(1);
  }
}

function readVersion() {
  try {
    return JSON.parse(readFileSync(join(repoRoot, "manifest.json"), "utf8")).version || "1.0.0";
  } catch {
    return "1.0.0";
  }
}

async function buildWithArchiver(zipPath, entries) {
  const { default: archiver } = await import("archiver");
  return new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolve);
    archive.on("warning", (err) => {
      if (err.code !== "ENOENT") reject(err);
    });
    archive.on("error", reject);
    archive.pipe(output);
    for (const { rel, name, content } of entries) {
      // `content` overrides the on-disk file — used to swap in the target manifest.
      if (content != null) archive.append(content, { name });
      else archive.file(join(repoRoot, rel), { name });
    }
    archive.finalize();
  });
}

function buildWithZipCli(zipPath, entries) {
  // Fallback when `archiver` isn't installed (e.g. minimal CI): use the `zip`
  // binary with a staging dir.
  const os = join(repoRoot, ".zip-stage");
  execFileSync("rm", ["-rf", os]);
  mkdirSync(os, { recursive: true });
  for (const { rel, name, content } of entries) {
    const dest = join(os, name);
    mkdirSync(dirname(dest), { recursive: true });
    if (content != null) writeFileSync(dest, content);
    else execFileSync("cp", [join(repoRoot, rel), dest]);
  }
  execFileSync("rm", ["-f", zipPath]);
  // `zip -X` keeps it deterministic-ish; -q for quiet.
  execFileSync("zip", ["-qrX", zipPath, ...readdirSync(os)], { cwd: os });
  execFileSync("rm", ["-rf", os]);
}

/** Turn the shared file list into zip entries for one package. */
function entriesFor(packedFiles, { prefix, manifestJson }) {
  return packedFiles.map((rel) =>
    rel === "manifest.json"
      ? { rel, name: `${prefix}manifest.json`, content: manifestJson }
      : { rel, name: `${prefix}${rel}` }
  );
}

/**
 * `preferArchiver` is false once we know `archiver` is not installed — there is
 * no point retrying an import that already failed for every package.
 */
async function writeZip(zipPath, entries, preferArchiver = true) {
  if (!preferArchiver) {
    buildWithZipCli(zipPath, entries);
    return "zip-cli";
  }
  try {
    await buildWithArchiver(zipPath, entries);
    return "archiver";
  } catch (err) {
    if (err.code === "ERR_MODULE_NOT_FOUND") {
      console.log("[package-extension] `archiver` not installed — falling back to `zip` CLI");
      buildWithZipCli(zipPath, entries);
      return "zip-cli";
    }
    throw err;
  }
}

const PACKAGES = [
  {
    // The website download. Everything under a top-level kipideck/ folder so
    // unzipping gives a ready-to-load folder (website/app/page.js documents the
    // folder name, so keep it).
    id: "website",
    file: "kipideck-extension.zip",
    prefix: "kipideck/",
    target: "chromium",
    description: "website download (Chromium, nested in kipideck/)",
  },
  {
    // Store upload. Store validators want manifest.json at the zip ROOT, which
    // is why this one is flat rather than nested like the website download.
    id: "chromium",
    file: "kipideck-extension-chromium.zip",
    prefix: "",
    target: "chromium",
    description: "Edge Add-ons + Chrome Web Store upload (Chromium, flat)",
  },
  {
    id: "firefox",
    file: "kipideck-extension-firefox.zip",
    prefix: "",
    target: "firefox",
    description: "Firefox AMO upload / temporary add-on (Firefox, flat)",
  },
];

async function main() {
  const only = process.argv.slice(2).find((a) => a.startsWith("--only="))?.slice(7);
  const packages = only ? PACKAGES.filter((p) => p.id === only) : PACKAGES;
  if (!packages.length) {
    console.error(`[package-extension] unknown --only=${only}; expected one of ${PACKAGES.map((p) => p.id).join(", ")}`);
    process.exit(1);
  }

  const packedFiles = extensionFiles();
  if (!packedFiles.includes("manifest.json")) {
    console.error("[package-extension] MISSING required file: manifest.json");
    process.exit(1);
  }

  const baseManifest = JSON.parse(readFileSync(join(repoRoot, "manifest.json"), "utf8"));
  const firefoxOverlay = JSON.parse(readFileSync(join(repoRoot, FIREFOX_OVERLAY), "utf8"));

  // Fail on a store-rule violation before writing a single byte: the packages
  // are committed, and a committed-but-rejected zip is worse than no zip.
  const manifests = {
    chromium: assertStoreValid(baseManifest, "chromium"),
    firefox: assertStoreValid(mergeManifest(baseManifest, firefoxOverlay), "firefox"),
  };
  assertPackageComplete(packedFiles, baseManifest);
  assertPackageComplete(packedFiles, manifests.firefox);

  console.log(`[package-extension] packaging ${packedFiles.length} files into ${packages.length} zips`);
  mkdirSync(outDir, { recursive: true });

  const built = [];
  // Once `archiver` is known to be missing, stop trying it for every package.
  let method = null;
  for (const pkg of packages) {
    const manifest = manifests[pkg.target];
    const manifestJson = JSON.stringify(manifest, null, 2) + "\n";
    const zipPath = join(outDir, pkg.file);
    const entries = entriesFor(packedFiles, { prefix: pkg.prefix, manifestJson });
    method = await writeZip(zipPath, entries, method !== "zip-cli");
    const { size } = statSync(zipPath);
    built.push({ id: pkg.id, file: `/downloads/${pkg.file}`, filename: pkg.file, target: pkg.target, size, sizeKB: Math.round(size / 1024), description: pkg.description });
    console.log(`[package-extension] wrote ${zipPath} (${Math.round(size / 1024)} KB, ${pkg.description})`);
  }

  const primary = built.find((b) => b.id === "website") || built[0];
  const meta = {
    version: readVersion(),
    file: primary.file,
    filename: primary.filename,
    size: primary.size,
    sizeKB: primary.sizeKB,
    builtAt: new Date().toISOString(),
    method,
    packages: built,
  };
  writeFileSync(join(outDir, "version.json"), JSON.stringify(meta, null, 2) + "\n");
  console.log(`[package-extension] wrote version.json (ext v${meta.version}, ${built.length} packages)`);
}

main().catch((err) => {
  console.error("[package-extension] FAILED:", err);
  process.exit(1);
});
