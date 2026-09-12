// website/scripts/build-extension-zip.mjs
// Packages the Kipideck browser extension (the files in the repo root) into a
// downloadable .zip served by the Vercel site at /downloads/kipideck-extension.zip
// so visitors can install straight from the website itself.
//
// Runs automatically on Vercel via the `prebuild` npm script (Vercel clones the
// full repo, then builds inside `website/`, so `../manifest.json` etc. exist at
// build time). Also run it locally any time with:  npm run package-extension
//
// Output:
//   website/public/downloads/kipideck-extension.zip  — the installable package
//   website/public/downloads/version.json            — { version, builtAt, ... }

import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const websiteDir = join(here, "..");
const repoRoot = join(here, "..", "..");
const outDir = join(websiteDir, "public", "downloads");
const zipName = "kipideck-extension.zip";
const zipPath = join(outDir, zipName);

// Every file that makes up the installable extension. manifest.json MUST be at
// the zip root (inside the top-level kipideck/ folder) for "Load unpacked".
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

/** Fail loudly if the package would not actually work when unpacked. */
function assertPackageComplete(packed) {
  const have = new Set(packed);
  const missing = [];

  const manifest = JSON.parse(readFileSync(join(repoRoot, "manifest.json"), "utf8"));
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
  for (const rel of referenced) if (!have.has(rel)) missing.push(`manifest.json → ${rel}`);

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

async function buildWithArchiver() {
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
    for (const rel of packedFiles) {
      // Put everything under a top-level kipideck/ folder so unzipping gives a
      // ready-to-load folder.
      archive.file(join(repoRoot, rel), { name: `kipideck/${rel}` });
    }
    archive.finalize();
  });
}

function buildWithZipCli() {
  // Fallback when `archiver` isn't installed (e.g. minimal CI): use the `zip`
  // binary with a staging dir. Keeps the same kipideck/ top-level layout.
  const os = join(repoRoot, ".zip-stage");
  execFileSync("rm", ["-rf", os]);
  mkdirSync(join(os, "kipideck"), { recursive: true });
  for (const rel of packedFiles) {
    const dest = join(os, "kipideck", rel);
    mkdirSync(dirname(dest), { recursive: true });
    execFileSync("cp", [join(repoRoot, rel), dest]);
  }
  execFileSync("rm", ["-f", zipPath]);
  execFileSync("zip", ["-qr", zipPath, "kipideck"], { cwd: os });
  execFileSync("rm", ["-rf", os]);
}

let packedFiles = [];

async function main() {
  packedFiles = extensionFiles();
  if (!packedFiles.includes("manifest.json")) {
    console.error("[package-extension] MISSING required file: manifest.json");
    process.exit(1);
  }
  assertPackageComplete(packedFiles);
  console.log(`[package-extension] packaging ${packedFiles.length} files`);
  mkdirSync(outDir, { recursive: true });

  let method = "archiver";
  try {
    await buildWithArchiver();
  } catch (err) {
    if (err.code === "ERR_MODULE_NOT_FOUND") {
      console.log("[package-extension] `archiver` not installed — falling back to `zip` CLI");
      method = "zip-cli";
      buildWithZipCli();
    } else {
      throw err;
    }
  }

  const version = readVersion();
  const { size } = statSync(zipPath);
  const meta = {
    version,
    file: `/downloads/${zipName}`,
    filename: zipName,
    size,
    sizeKB: Math.round(size / 1024),
    builtAt: new Date().toISOString(),
    method,
  };
  writeFileSync(join(outDir, "version.json"), JSON.stringify(meta, null, 2) + "\n");
  console.log(
    `[package-extension] wrote ${zipPath} (${meta.sizeKB} KB, ${packedFiles.length} files, ext v${version}) + version.json`
  );
}

main().catch((err) => {
  console.error("[package-extension] FAILED:", err);
  process.exit(1);
});
