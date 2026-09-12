// test/policy.test.js — does the code do what the first-run page says it does?
//
// onboarding/onboarding.html makes specific promises: nothing is captured
// silently until the user presses a button there; Space+K is disabled on sites
// where Space already means something (video players, Gmail, Google Docs) and on
// any muted site; "Never here" mutes a site for good. Those promises are worth
// exactly nothing if the code drifts away from them, so this file asserts the
// disclosure and the implementation agree — including for the sites the
// disclosure names out loud.

import { test, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

await import("./harness.js");
const { resetWorld } = await import("./harness.js");
const { Storage } = await import("../lib/storage.js");
const { capturePolicyFor, anySilentCaptureAllowed } = await import("../lib/policy.js");

const ONBOARDED = { onboardingDone: true, autoSaveSelection: true, spaceKQuickSave: true, showToast: true };

beforeEach(async () => {
  await resetWorld();
  await Storage.init();
});

describe("before the first-run disclosure is accepted", () => {
  test("nothing is captured silently, even though the toggles default to on", async () => {
    const settings = await Storage.getSettings();
    assert.equal(settings.onboardingDone, false, "the shipped default is undisclosed");
    assert.equal(settings.autoSaveSelection, true, "the convenience default is on");

    const policy = await capturePolicyFor("example.com", settings);
    assert.equal(policy.autoSaveSelection, false, "no silent capture before disclosure");
    assert.equal(policy.spaceKQuickSave, false, "no shortcut before disclosure either");
    assert.equal(await anySilentCaptureAllowed("example.com", settings), false);
  });

  test("a fresh install on any site is inert", async () => {
    for (const host of ["example.com", "news.ycombinator.com", "github.com", "reddit.com"]) {
      const policy = await capturePolicyFor(host);
      assert.equal(policy.onboardingDone, false);
      assert.equal(policy.autoSaveSelection, false, host);
      assert.equal(policy.spaceKQuickSave, false, host);
    }
  });
});

describe("after the disclosure is accepted", () => {
  test("an ordinary site allows both automatic behaviours", async () => {
    const policy = await capturePolicyFor("example.com", ONBOARDED);
    assert.equal(policy.autoSaveSelection, true);
    assert.equal(policy.spaceKQuickSave, true);
    assert.equal(policy.muted, false);
    assert.equal(policy.showToast, true);
  });

  test("the toggles are honoured independently", async () => {
    const noAuto = await capturePolicyFor("example.com", { ...ONBOARDED, autoSaveSelection: false });
    assert.equal(noAuto.autoSaveSelection, false);
    assert.equal(noAuto.spaceKQuickSave, true, "turning off auto-save keeps the shortcut");

    const noShortcut = await capturePolicyFor("example.com", { ...ONBOARDED, spaceKQuickSave: false });
    assert.equal(noShortcut.spaceKQuickSave, false);
    assert.equal(noShortcut.autoSaveSelection, true, "turning off the shortcut keeps auto-save");

    const quiet = await capturePolicyFor("example.com", { ...ONBOARDED, showToast: false });
    assert.equal(quiet.showToast, false);
    assert.equal(quiet.autoSaveSelection, true, "hiding toasts is not the same as disabling capture");
  });
});

describe("sites the disclosure names explicitly", () => {
  // onboarding.html says: "Automatically disabled on sites where Space does
  // something else (YouTube, Gmail, Google Docs, and any text field)".
  const named = [
    ["www.youtube.com", "YouTube"],
    ["music.youtube.com", "YouTube Music (a subdomain of YouTube)"],
    ["m.youtube.com", "mobile YouTube"],
    ["mail.google.com", "Gmail"],
    ["docs.google.com", "Google Docs"],
    ["drive.google.com", "Google Drive"],
    ["netflix.com", "Netflix"],
    ["vimeo.com", "Vimeo"],
    ["twitch.tv", "Twitch"],
    ["open.spotify.com", "Spotify"],
  ];

  for (const [host, label] of named) {
    test(`${label} (${host}) never gets the Space→K shortcut`, async () => {
      const policy = await capturePolicyFor(host, ONBOARDED);
      assert.equal(policy.spaceKQuickSave, false, `${host} must be blocked`);
      assert.equal(policy.blockedShortcut, true);
    });
  }

  test("blocking the shortcut does not block auto-saving a selection there", async () => {
    // Space+K is blocked because the key means something else; highlighting a
    // passage on YouTube and having it saved is still what the user asked for.
    const policy = await capturePolicyFor("www.youtube.com", ONBOARDED);
    assert.equal(policy.spaceKQuickSave, false);
    assert.equal(policy.autoSaveSelection, true);
  });

  test("sites that look similar are not blocked by accident", async () => {
    for (const host of ["notyoutube.com", "youtubefriends.org", "mail.google.com.evil.test"]) {
      const policy = await capturePolicyFor(host, ONBOARDED);
      assert.equal(policy.blockedShortcut, false, `${host} is a different site`);
    }
  });

  test("host matching ignores case and www", async () => {
    for (const host of ["WWW.YouTube.COM", "YouTube.com", "www.YouTube.com"]) {
      const policy = await capturePolicyFor(host, ONBOARDED);
      assert.equal(policy.spaceKQuickSave, false, host);
    }
  });
});

describe("muting a site", () => {
  test("mute turns off both automatic behaviours on that site only", async () => {
    const settings = { ...ONBOARDED, mutedHosts: ["example.com"] };
    const muted = await capturePolicyFor("example.com", settings);
    assert.equal(muted.muted, true);
    assert.equal(muted.autoSaveSelection, false);
    assert.equal(muted.spaceKQuickSave, false, "the disclosure says muting silences the shortcut too");
    assert.equal(await anySilentCaptureAllowed("example.com", settings), false);

    const other = await capturePolicyFor("elsewhere.org", settings);
    assert.equal(other.muted, false);
    assert.equal(other.autoSaveSelection, true, "other sites are unaffected");
  });

  test("a muted domain covers its subdomains", async () => {
    const settings = { ...ONBOARDED, mutedHosts: ["example.com"] };
    for (const host of ["blog.example.com", "shop.example.com", "www.example.com"]) {
      const policy = await capturePolicyFor(host, settings);
      assert.equal(policy.muted, true, host);
      assert.equal(policy.autoSaveSelection, false, host);
    }
  });

  test("muting does not look like a match on unrelated domains", async () => {
    const settings = { ...ONBOARDED, mutedHosts: ["example.com"] };
    for (const host of ["notexample.com", "example.community", "example.com.evil.test"]) {
      const policy = await capturePolicyFor(host, settings);
      assert.equal(policy.muted, false, host);
    }
  });

  test("the mute round trip through Settings works end to end", async () => {
    // This is the path the toast's "Never here" button takes.
    await Storage.updateSettings({ ...ONBOARDED });
    assert.equal((await capturePolicyFor("example.com")).autoSaveSelection, true);

    const settings = await Storage.getSettings();
    await Storage.updateSettings({ mutedHosts: [...(settings.mutedHosts || []), "example.com"] });
    const after = await capturePolicyFor("example.com");
    assert.equal(after.autoSaveSelection, false);
    assert.equal(after.muted, true);

    // And the Library's unmute button reverses it.
    const cur = await Storage.getSettings();
    await Storage.updateSettings({ mutedHosts: cur.mutedHosts.filter((h) => h !== "example.com") });
    assert.equal((await capturePolicyFor("example.com")).autoSaveSelection, true);
  });

  test("an empty or missing mute list is not an error", async () => {
    for (const mutedHosts of [undefined, null, [], [""]]) {
      const policy = await capturePolicyFor("example.com", { ...ONBOARDED, mutedHosts });
      assert.equal(policy.muted, false, JSON.stringify(mutedHosts));
      assert.equal(policy.autoSaveSelection, true);
    }
  });
});

describe("edge cases", () => {
  test("an unknown host yields an inert policy rather than a crash", async () => {
    for (const host of ["", null, undefined, "   "]) {
      const policy = await capturePolicyFor(host, ONBOARDED);
      // Fail closed: if we cannot tell what page this is, do not grab keystrokes.
      assert.equal(policy.spaceKQuickSave, false, `no host (${JSON.stringify(host)}), no shortcut`);
      assert.equal(policy.autoSaveSelection, true, "selection capture is host-independent");
    }
  });

  test("settings that never arrived do not enable capture", async () => {
    const policy = await capturePolicyFor("example.com", {});
    assert.equal(policy.autoSaveSelection, false);
    assert.equal(policy.spaceKQuickSave, false);
    assert.equal(policy.showToast, true, "toasts default on so capture is never invisible");
  });

  test("the policy reads live settings when none are injected", async () => {
    await Storage.updateSettings({ onboardingDone: true, autoSaveSelection: true, spaceKQuickSave: true });
    const policy = await capturePolicyFor("example.com");
    assert.equal(policy.autoSaveSelection, true);
    assert.equal(policy.onboardingDone, true);
  });
});
