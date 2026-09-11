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

import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
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
const EXTENSION_FILES = [
  "manifest.json",
  "background/background.js",
  "content/content.js",
  "content/content.css",
  "lib/browser-polyfill.js",
  "lib/classify.js",
  "lib/compat.js",
  "lib/drive-sync.js",
  "lib/extract.js",
  "lib/search.js",
  "lib/storage.js",
  "popup/popup.css",
  "popup/popup.html",
  "popup/popup.js",
  "library/library.css",
  "library/library.html",
  "library/library.js",
  "icons/icon128.png",
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
];

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
    for (const rel of EXTENSION_FILES) {
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
  for (const rel of EXTENSION_FILES) {
    const dest = join(os, "kipideck", rel);
    mkdirSync(dirname(dest), { recursive: true });
    execFileSync("cp", [join(repoRoot, rel), dest]);
  }
  execFileSync("rm", ["-f", zipPath]);
  execFileSync("zip", ["-qr", zipPath, "kipideck"], { cwd: os });
  execFileSync("rm", ["-rf", os]);
}

async function main() {
  for (const rel of EXTENSION_FILES) {
    if (!existsSync(join(repoRoot, rel))) {
      console.error(`[package-extension] MISSING required file: ${rel}`);
      process.exit(1);
    }
  }
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
  console.log(`[package-extension] wrote ${zipPath} (${meta.sizeKB} KB, ext v${version}) + version.json`);
}

main().catch((err) => {
  console.error("[package-extension] FAILED:", err);
  process.exit(1);
});
