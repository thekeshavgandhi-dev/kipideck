// lib/status.js — the save-state workflow (ideas.md I-12).
//
// WHY: ~70% of saves are never reopened, and an unbounded pile with no states
// is a graveyard, not a library. Every item therefore carries one of four
// states — Unread → Reading → Done, plus Archived for things kept but out of
// the way — and the Library filters, counts and searches by them.
//
// This module is the single vocabulary for that feature: the four values, what
// they mean in the UI, and how foreign read-states (Pocket's "archive",
// Readwise's "read", a Kipideck backup's own "done") map onto them. It is pure
// string work with no storage access, so lib/db.js (which normalises every
// record on write), lib/import.js (which maps foreign files) and the Library UI
// can all share it without drifting apart.

/** The four save-states, in triage order. */
export const STATUSES = ["unread", "reading", "done", "archived"];

/** What each state means in the UI. Icons stay monochrome-small on purpose: a
 * status badge must never shout louder than the item it labels. */
export const STATUS_META = {
  unread: { label: "Unread", icon: "○", hint: "Saved, not started yet" },
  reading: { label: "Reading", icon: "◐", hint: "Started — pick up where you left off" },
  done: { label: "Done", icon: "●", hint: "Finished" },
  archived: { label: "Archived", icon: "📦", hint: "Kept, but out of the way" },
};

const BY_ALIAS = new Map();
// Canonical values map to themselves; everything else is a foreign spelling.
for (const s of STATUSES) BY_ALIAS.set(s, s);
for (const [alias, canonical] of [
  ["unreads", "unread"],
  ["new", "unread"],
  ["toread", "unread"],
  ["to-read", "unread"],
  ["inbox", "unread"],
  ["saved", "unread"],
  ["favorite", "unread"], // a favourite is still unread until it has been read
  ["favourite", "unread"],
  ["starred", "unread"],
  ["liked", "unread"],
  ["reading", "reading"],
  ["in-progress", "reading"],
  ["inprogress", "reading"],
  ["started", "reading"],
  ["read", "done"], // Pocket/Readwise "read" and "done" both mean finished
  ["done", "done"],
  ["finished", "done"],
  ["completed", "done"],
  ["archive", "archived"],
  ["archived", "archived"],
]) {
  BY_ALIAS.set(alias, canonical);
}

/**
 * Normalise anything claiming to be a status — user input, an old record, an
 * imported file — to one of the four canonical values. Unknown, empty and
 * missing values become "unread": the state every save starts in, and the only
 * safe default for a record whose history we cannot see.
 */
export function normalizeStatus(value) {
  const key = String(value ?? "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  return BY_ALIAS.get(key) || "unread";
}

/** The status of a stored record. Pre-v1.6 records have no `status` key at all
 * (the field did not exist); they read as "unread", which is also what the v1→v2
 * IndexedDB upgrade backfills onto them — see lib/db.js. */
export function statusOf(item) {
  if (!item || typeof item !== "object") return "unread";
  return normalizeStatus(item.status);
}

/**
 * Map a foreign read-state onto a Kipideck status. This is what the importer
 * calls: Pocket says "archive", Pinboard says "toread", Readwise says "read".
 * `favorite` deliberately stays "unread" — favouriting is enthusiasm, not
 * progress — while the favourite-ness itself is kept as a tag (see
 * lib/import.js).
 */
export function fromForeignStatus(raw) {
  if (raw === null || raw === undefined || raw === "") return "unread";
  return normalizeStatus(raw);
}

/** True when `value` is already one of the four canonical values. */
export function isStatus(value) {
  return STATUSES.includes(String(value ?? "").trim().toLowerCase());
}
