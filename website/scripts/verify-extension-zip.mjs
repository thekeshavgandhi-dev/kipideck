// website/scripts/verify-extension-zip.mjs
// Checks the BUILT zips, not the source tree.
//
// The packager already refuses to write an invalid manifest, but the thing you
// drag into the Edge/Chrome/Firefox upload form is a zip that may have been
// built by someone else, last week, from a different branch. So this reads the
// zip back out of website/public/downloads and re-runs the store rules against
// what is actually inside it.
//
//   cd website && npm run verify-extension
//
// Exits non-zero on any problem, so it can gate a release in CI.

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { manifestFiles, manifestProblems } from "./store-rules.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "public", "downloads");

// Store uploads want manifest.json at the zip root. The website download is the
// exception: it nests everything under kipideck/ so unzipping gives a folder to
// point "Load unpacked" at, which is what the install docs tell people to do.
const PACKAGES = [
  { file: "kipideck-extension-chromium.zip", target: "chromium", root: "", store: "Edge Add-ons + Chrome Web Store" },
  { file: "kipideck-extension-firefox.zip", target: "firefox", root: "", store: "Firefox AMO" },
  { file: "kipideck-extension.zip", target: "chromium", root: "kipideck/", store: "website download" },
];

const results = [];
const fail = (pkg, msg) => results.push({ ok: false, pkg: pkg.file, msg });
const pass = (pkg, msg) => results.push({ ok: true, pkg: pkg.file, msg });

function entries(zipPath) {
  const out = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8", maxBuffer: 1 << 26 });
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

function readEntry(zipPath, name) {
  return execFileSync("unzip", ["-p", zipPath, name], { encoding: "utf8", maxBuffer: 1 << 26 });
}

function verify(pkg) {
  const zipPath = join(outDir, pkg.file);
  if (!existsSync(zipPath)) {
    fail(pkg, `missing — run \`npm run package-extension\` (or \`npm run package\` at the repo root)`);
    return;
  }

  let names;
  try {
    names = entries(zipPath);
  } catch {
    fail(pkg, "could not be read as a zip");
    return;
  }

  const manifestPath = `${pkg.root}manifest.json`;
  if (!names.includes(manifestPath)) {
    fail(pkg, `no ${manifestPath} — store validators require manifest.json at the zip root`);
    return;
  }

  let manifest;
  try {
    manifest = JSON.parse(readEntry(zipPath, manifestPath));
  } catch (err) {
    fail(pkg, `manifest.json is not valid JSON: ${err.message}`);
    return;
  }

  for (const problem of manifestProblems(manifest, pkg.target)) fail(pkg, problem);

  // Every file the manifest names has to be in the zip, or the install breaks.
  const have = new Set(names.map((n) => (pkg.root ? n.slice(pkg.root.length) : n)));
  for (const rel of manifestFiles(manifest)) {
    if (!have.has(rel)) fail(pkg, `manifest.json points at ${rel}, which is not in the zip`);
  }

  // Nothing that should never ship.
  for (const n of names) {
    if (/\.DS_Store$|node_modules|\.map$|\.zip-stage|^tools\//.test(n)) {
      fail(pkg, `zip contains ${n}, which should not be packaged`);
    }
  }

  if (results.filter((r) => !r.ok && r.pkg === pkg.file).length === 0) {
    const { size } = statSync(zipPath);
    pass(
      pkg,
      `v${manifest.version} · ${names.length} entries · ${Math.round(size / 1024)} KB · ` +
        `description ${manifest.description.length}/132 chars · clean for ${pkg.store}`
    );
  }
}

for (const pkg of PACKAGES) verify(pkg);

for (const r of results) {
  console.log(`${r.ok ? "  ok  " : " FAIL "} ${r.pkg}${r.ok ? " — " + r.msg : "\n         " + r.msg}`);
}

const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.error(`\n[verify-extension] ${failed.length} problem(s) — do not upload.`);
  process.exit(1);
}
console.log(`\n[verify-extension] all ${PACKAGES.length} packages pass the store rules.`);
