// lib/digest.js — "Kipi Daily 5" resurfacing (ideas.md I-11).
//
// WHY: the read-it-later graveyard. ~70% of saves are never reopened; the pile
// turns into guilt, the guilt turns into avoidance, the avoidance turns into
// churn (RESEARCH.md §4.3/§4.14). The only products that solve recall charge
// ~$100/yr to do it (Readwise). This is the free, local version: five items a
// day — the oldest unread (so nothing rots at the bottom), two "forgotten
// gems" (old but untouched), and one pick that keeps the deck feeling like a
// deck, not a queue (the random one).
//
// SPENDING THE QUOTA HONESTLY: every input is a bounded page the caller has
// already fetched (≤ a few dozen records). No full-library scan, ever. The
// randomness is seeded by the LOCAL DATE — the same five all day, stable
// across the popup, the library and the notification, without storing the
// picks anywhere (recomputing from seeded inputs is cheaper than persisting).
//
// Pure, no browser APIs — see test/digest.test.js.

/** Deterministic 32-bit string hash → seed for a tiny PRNG (mulberry32). */
export function seedFromString(str) {
  let h = 2166136261 >>> 0;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — 10 lines, good enough for choosing five cards, not for crypto. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `2026-09-12` in the browser's LOCAL time — the day a digest belongs to. */
export function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Choose the daily five from already-fetched, already-ordered pages.
 *
 * @param {object} pages
 * @param {object[]} [pages.unread]    oldest-first page of UNREAD items (the
 *                                     caller sorted; the two freshest-oldest win)
 * @param {object[]} [pages.forgotten] oldest-by-activity page across the whole
 *                                     library; statuses the caller considers
 *                                     "sitting there" (unread/reading)
 * @param {object[]} [pages.any]       a small pool the random slot draws from
 *                                     (e.g. a seed-offset page of the library)
 * @param {{now?: Date, salt?: string}} [opts]  salt re-rolls the random slot
 *                                     ("🔀 Surprise me") without touching the day key.
 * @returns {Array<{item: object, slot: "oldest"|"gem"|"random"}>} ≤ 5, no duplicates
 */
export function pickDaily5({ unread = [], forgotten = [], any = [] } = {}, { now = new Date(), salt = "" } = {}) {
  const rng = makeRng(seedFromString(dayKey(now) + (salt ? `#${salt}` : "")));
  const picked = [];
  const seen = new Set();

  const take = (list, slot, count) => {
    let n = 0;
    for (const item of list || []) {
      if (n >= count) break;
      if (!item || !item.id || seen.has(item.id)) continue;
      seen.add(item.id);
      picked.push({ item, slot });
      n++;
    }
  };

  take(unread, "oldest", 2); // 2: so the bottom of the pile keeps rising
  take(forgotten, "gem", 2); // 2: forgotten gems — old, still open
  if (any.length) {
    // 1: a seeded random pick from the pool the caller placed under the cursor.
    const idx = Math.floor(rng() * any.length) % any.length;
    const one = any[idx];
    if (one && one.id && !seen.has(one.id)) {
      seen.add(one.id);
      picked.push({ item: one, slot: "random" });
    } else {
      take(any, "random", 1); // tiny libraries: fall back to whatever the pool holds
    }
  }
  return picked;
}

export const SLOT_META = {
  oldest: { icon: "📥", label: "Oldest unread" },
  gem: { icon: "💎", label: "Forgotten gem" },
  random: { icon: "🎲", label: "Random pick" },
};

/** Why a pick was made — shown as a chip on every digest card. */
export function slotLabel(slot) {
  return SLOT_META[slot]?.label || "Today's pick";
}

/** One-line body for the notification ("2 old unread · 2 gems · 1 random"). */
export function digestSummaryLine(picks) {
  const n = { oldest: 0, gem: 0, random: 0 };
  for (const p of picks || []) if (n[p.slot] !== undefined) n[p.slot]++;
  const parts = [];
  if (n.oldest) parts.push(`${n.oldest} waiting`);
  if (n.gem) parts.push(`${n.gem} forgotten gem${n.gem === 1 ? "" : "s"}`);
  if (n.random) parts.push("1 surprise");
  return parts.join(" · ");
}
