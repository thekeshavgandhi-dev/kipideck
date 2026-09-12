// lib/unzip.js — opening ZIP archives in the browser (ideas.md I-05, Phase 2).
//
// Pocket's final export is a ZIP of part_*.csv files and Omnivore's is a ZIP of
// metadata_*.json + contents/*.html — and until v1.7.0 Kipideck made every
// refugee unzip those by hand. The DEFLATE codec below is vendored fflate
// (lib/vendor/fflate.js, MIT, single file — the one dependency shape the
// project allows); this module is the small, opinionated layer on top that
// decides WHICH entries come out and how much memory they may take.
//
// Design notes:
// - Streaming extraction (`Unzip`, not `unzipSync`): entries we do not want
//   are never inflated, and a hostile file hits the byte caps mid-stream
//   instead of after a 2 GB allocation. Everything still completes
//   synchronously inside push(), so this module stays sync start to finish.
// - Only importable text formats come out. A Pocket ZIP can carry a dozen
//   CSVs; an Omnivore ZIP carries thousands of HTML files next to its JSON.
//   Images, nested archives and macOS resource forks stay inside.
// - Errors are human sentences, because they are shown verbatim in the import
//   dialog next to the file that caused them.

import { Unzip, UnzipInflate, strFromU8 } from "./vendor/fflate.js";

/** File kinds the importer knows how to read. Anything else stays zipped. */
const IMPORTABLE_EXTENSIONS = new Set([
  "csv",
  "tsv",
  "json",
  "html",
  "htm",
  "xhtml",
  "md",
  "markdown",
  "txt",
  "text",
]);

/** Zip-bomb guards. Pocket's largest real exports are tens of megabytes, so a
 * file demanding more than this is either hostile or a mistake worth asking
 * about — either way it must fail loudly, not hang the tab. */
export const MAX_ZIP_ENTRIES = 2000; // entries scanned, wanted or not
export const MAX_ZIP_FILES = 500; // importable files actually extracted
export const MAX_ZIP_FILE_BYTES = 50 * 1024 * 1024; // per inner file
export const MAX_ZIP_TOTAL_BYTES = 256 * 1024 * 1024; // all inner files

/** Extension check for the file picker path. The magic bytes are verified on
 * open, so a renamed .rar fails with "not a ZIP" instead of garbage. */
export function isZipName(name) {
  return /\.zip$/i.test(String(name || "").trim());
}

/** PK.. local-file header, empty-archive end record, or spanned-archive
 * marker. Spanned archives are recognised but not readable (fflate reads a
 * single buffer) — expandZip says so plainly instead of misreading them. */
export function isZipBytes(u8) {
  const b = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8 || []);
  return (
    b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07) && b[3] === b[2] + 1
  );
}

function innerName(raw) {
  // Windows tools sometimes write backslashes; the spec wants forward ones.
  return String(raw || "").replace(/\\/g, "/").replace(/^(?:\/+|\.\/+)+/, "");
}

function extensionOf(name) {
  const base = name.split("/").pop() || "";
  if (base.startsWith(".") && base.indexOf(".", 1) === -1) return "";
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
}

function wantsEntry(name) {
  if (!name || name.endsWith("/")) return false; // a directory
  if (name.startsWith("__MACOSX/")) return false; // resource forks
  const base = name.split("/").pop() || "";
  if (base.startsWith(".")) return false; // .DS_Store and friends
  return IMPORTABLE_EXTENSIONS.has(extensionOf(name));
}

/**
 * Expand a ZIP buffer into the text files the importer can read.
 *
 * @param {Uint8Array} u8 the raw archive bytes
 * @param {object} [opts]
 * @param {string} [opts.outerName] shown in errors ("pocket.zip holds no…")
 * @param {number} [opts.maxEntries] override MAX_ZIP_ENTRIES (tests use small ones)
 * @param {number} [opts.maxFiles] override MAX_ZIP_FILES
 * @param {number} [opts.maxFileBytes] override MAX_ZIP_FILE_BYTES
 * @param {number} [opts.maxTotalBytes] override MAX_ZIP_TOTAL_BYTES
 * @returns {{files: Array<{name: string, text: string, bytes: number}>, scanned: number, skipped: number, totalBytes: number}}
 * @throws {Error} with a human sentence for: not-a-zip, corrupt, encrypted,
 *   over the caps, or holding nothing importable.
 */
export function expandZip(
  u8,
  {
    outerName = "archive.zip",
    maxEntries = MAX_ZIP_ENTRIES,
    maxFiles = MAX_ZIP_FILES,
    maxFileBytes = MAX_ZIP_FILE_BYTES,
    maxTotalBytes = MAX_ZIP_TOTAL_BYTES,
  } = {}
) {
  const bytes = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8 || []);
  const label = `“${outerName}”`;
  if (!isZipBytes(bytes)) {
    throw new Error(`${label} is not a ZIP archive — it may be a RAR, 7z, or a download that did not finish.`);
  }
  if (bytes[2] === 0x07) {
    throw new Error(`${label} is a split (spanned) archive, which Kipideck cannot join. Re-export it as a single ZIP.`);
  }

  const files = [];
  let scanned = 0;
  let skipped = 0;
  let totalBytes = 0;
  let tripped = null; // a cap, hit mid-stream: stop collecting, fail at the end
  let corrupt = null; // entry name + fflate's complaint

  const unzip = new Unzip();
  unzip.o[8] = UnzipInflate; // stored entries work by default; deflated need this
  unzip.onfile = (file) => {
    if (tripped || corrupt) return;
    scanned++;
    if (scanned > maxEntries) {
      tripped = `${label} holds more than ${maxEntries.toLocaleString()} entries — re-export just the files to import.`;
      return;
    }
    const name = innerName(file.name);
    if (!wantsEntry(name)) {
      skipped++;
      return; // never start()ed: skipped entries cost nothing to inflate
    }
    if (files.length >= maxFiles) {
      tripped = `${label} holds more than ${maxFiles} importable files — split it and import in parts.`;
      return;
    }
    const chunks = [];
    let size = 0;
    file.ondata = (err, chunk, final) => {
      if (tripped || corrupt) return;
      if (err) {
        // Encrypted entries die here (fflate has no password API), as do
        // truncated ones. The message names the entry so a half-downloaded
        // archive is diagnosable instead of mysterious.
        corrupt = `${label} could not read “${name}” — the archive may be corrupt or password-protected.`;
        return;
      }
      size += chunk.length;
      totalBytes += chunk.length;
      if (size > maxFileBytes) {
        tripped = `“${name}” inside ${label} is larger than ${(maxFileBytes / 1024 / 1024).toFixed(0)} MB unzipped.`;
        return;
      }
      if (totalBytes > maxTotalBytes) {
        tripped = `${label} unzips to more than ${(maxTotalBytes / 1024 / 1024).toFixed(0)} MB — split it and import in parts.`;
        return;
      }
      chunks.push(chunk);
      if (final) {
        const joined = new Uint8Array(size);
        let at = 0;
        for (const c of chunks) {
          joined.set(c, at);
          at += c.length;
        }
        files.push({ name, text: strFromU8(joined), bytes: size });
      }
    };
    try {
      file.start();
    } catch (e) {
      // fflate throws (rather than calling ondata with err) for unknown
      // compression methods — e.g. bzip2-packed ZIPs some tools produce.
      corrupt = `${label} could not read “${name}” — ${e && e.message ? e.message : "unsupported compression"}.`;
    }
  };

  try {
    unzip.push(bytes, true);
  } catch (e) {
    throw new Error(`${label} could not be opened — ${e && e.message ? e.message : "it is not a valid ZIP file"}.`);
  }
  if (corrupt) throw new Error(corrupt);
  if (tripped) throw new Error(tripped);
  if (!files.length) {
    // scanned === 0 means nothing was even listed: a true empty archive and a
    // truncation that ate the headers look identical from here, so the message
    // covers both instead of guessing wrong.
    throw new Error(
      scanned === 0
        ? `${label} is empty or damaged — no files came out of it.`
        : `${label} holds no files Kipideck can import — it needs CSV, JSON, HTML, Markdown or plain text.`
    );
  }
  return { files, scanned, skipped, totalBytes };
}
