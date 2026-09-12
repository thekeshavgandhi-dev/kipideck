// website/scripts/store-rules.mjs
// The manifest rules the browser stores enforce, expressed once.
//
// The browsers themselves are far more forgiving than their stores: Chrome loads
// a Manifest V3 extension that carries `background.scripts` without complaint
// (it has ignored the key since Chrome 121), and Firefox quietly ignores
// `background.service_worker`. The upload validators do not — the first Kipideck
// upload to Edge Add-ons came back with three hard errors, two of them about
// exactly those two keys. Nothing local can catch them, so they live here and
// run both before a package is written and against the zip that came out.
//
// Targets: "chromium" (Edge Add-ons + Chrome Web Store) and "firefox" (AMO).

/** Chrome Web Store and Edge Add-ons cap the manifest description at 132 characters. */
export const MAX_DESCRIPTION = 132;
/** Chrome Web Store caps the extension name at 45 characters. */
export const MAX_NAME = 45;

/** Permitted top-level MV3 keys. Firefox-only keys are excluded on purpose. */
const KNOWN_TOP_LEVEL_KEYS = new Set([
  "action",
  "author",
  "background",
  "chrome_settings_overrides",
  "chrome_url_overrides",
  "commands",
  "content_scripts",
  "content_security_policy",
  "cross_origin_embedder_policy",
  "cross_origin_opener_policy",
  "declarative_net_request",
  "default_locale",
  "description",
  "devtools_page",
  "export",
  "externally_connectable",
  "homepage_url",
  "host_permissions",
  "icons",
  "import",
  "incognito",
  "key",
  "manifest_version",
  "minimum_chrome_version",
  "name",
  "oauth2",
  "offline_enabled",
  "omnibox",
  "optional_host_permissions",
  "optional_permissions",
  "options_page",
  "options_ui",
  "permissions",
  "requirements",
  "sandbox",
  "short_name",
  "side_panel",
  "storage",
  "tts_engine",
  "update_url",
  "version",
  "version_name",
  "web_accessible_resources",
]);

/** Firefox understands a handful of keys Chromium does not, and vice versa. */
const FIREFOX_ONLY_KEYS = new Set([
  "browser_specific_settings", // gecko id — required for AMO signing
  "experiment_apis",
  "protocol_handlers",
  "sidebar_action",
  "theme_experiment",
  "user_scripts",
]);

function knownKeysFor(target) {
  return target === "firefox"
    ? new Set([...KNOWN_TOP_LEVEL_KEYS, ...FIREFOX_ONLY_KEYS])
    : KNOWN_TOP_LEVEL_KEYS;
}

/**
 * Every reason `manifest` would be rejected (or flagged) by the store for
 * `target`. Returns [] when the manifest is clean.
 */
export function manifestProblems(manifest, target) {
  const problems = [];
  const isChromium = target === "chromium";
  const where = `${target} package`;

  if (manifest.manifest_version !== 3) {
    problems.push(`${where}: manifest_version is ${manifest.manifest_version}, not 3`);
  }

  // --- name / version / description -------------------------------------
  if (!manifest.name) {
    problems.push(`${where}: name is missing`);
  } else if (manifest.name.length > MAX_NAME) {
    problems.push(`${where}: name is ${manifest.name.length} chars, max is ${MAX_NAME}`);
  }
  if (!/^\d+(\.\d+){1,3}$/.test(String(manifest.version ?? ""))) {
    problems.push(`${where}: version "${manifest.version}" is not 1-4 dot-separated numbers`);
  }
  if (typeof manifest.description !== "string" || !manifest.description) {
    problems.push(`${where}: description is missing — every store shows it on the listing`);
  } else if (manifest.description.length > MAX_DESCRIPTION) {
    problems.push(
      `${where}: description is ${manifest.description.length} chars, max is ${MAX_DESCRIPTION} ` +
        `(trim ${manifest.description.length - MAX_DESCRIPTION})`
    );
  }

  // --- background: the two keys the engines disagree on ------------------
  const bg = manifest.background || {};
  if (!bg || (!bg.service_worker && !bg.scripts)) {
    problems.push(`${where}: no background context declared`);
  }
  if (isChromium) {
    if (bg.scripts) {
      problems.push(
        `${where}: background.scripts cannot be used with manifest_version 3 — use ` +
          `background.service_worker (Firefox's scripts key belongs in ` +
          `tools/firefox-manifest-overlay.json)`
      );
    }
    if (bg.page) {
      problems.push(`${where}: background.page cannot be used with manifest_version 3`);
    }
    if (!bg.service_worker) {
      problems.push(`${where}: background.service_worker is missing`);
    }
    if (manifest.browser_specific_settings) {
      problems.push(
        `${where}: browser_specific_settings is Firefox-only — Chromium reviewers flag it as an ` +
          `unrecognized manifest key`
      );
    }
  } else {
    if (!bg.scripts?.length) {
      problems.push(
        `${where}: Firefox MV3 runs a non-persistent event page declared with background.scripts ` +
          `and ignores background.service_worker (Firefox bug 1573659)`
      );
    }
    if (bg.service_worker) {
      problems.push(
        `${where}: background.service_worker must be removed for Firefox — on Firefox < 121 its ` +
          `presence stops the event page from ever starting (bug 1860304)`
      );
    }
    if (!manifest.browser_specific_settings?.gecko?.id) {
      problems.push(`${where}: browser_specific_settings.gecko.id is required for AMO signing`);
    }
  }
  if ("persistent" in bg) {
    problems.push(`${where}: background.persistent is a Manifest V2 key`);
  }

  // --- unknown keys -------------------------------------------------------
  const known = knownKeysFor(target);
  for (const key of Object.keys(manifest)) {
    if (!known.has(key)) {
      problems.push(
        `${where}: unrecognized top-level manifest key "${key}" — reviewers flag these even when ` +
          `the browser itself ignores them`
      );
    }
  }

  return problems;
}

/** Files the manifest points at. Anything missing here fails the install. */
export function manifestFiles(manifest) {
  return [
    manifest.action?.default_popup,
    manifest.options_ui?.page,
    manifest.background?.service_worker,
    ...(manifest.background?.scripts || []),
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {}),
    ...(manifest.content_scripts || []).flatMap((cs) => [...(cs.js || []), ...(cs.css || [])]),
    ...(manifest.web_accessible_resources || []).flatMap((w) => w.resources || []),
  ].filter(Boolean);
}
