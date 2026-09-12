import DownloadButton from "../components/DownloadButton";

export const metadata = {
  title: "Privacy policy — Kipideck",
  description:
    "What Kipideck stores, what it never collects, which permissions it asks for and why, and how to delete everything. Kipideck has no server and no accounts: your saves stay in your own browser, and optionally in your own Google Drive.",
};

const EFFECTIVE = "12 September 2026";
const VERSION = "Extension version 1.4.0";

const PERMISSIONS = [
  {
    name: "contextMenus",
    why: "Adds the “Save to Kipi” entry to the right-click menu — the main way you save a page, link, image, or selection.",
  },
  {
    name: "activeTab + scripting",
    why: "Reads the title, URL, preview image and visible text of the tab you just acted on, so the saved item is searchable. Only runs on that tab, only at that moment.",
  },
  {
    name: "tabs",
    why: "Needs the URL and title of the tab being saved, and lets the “Open” button on a save-toast focus the right tab. Kipideck does not read your tab list, history, or other tabs.",
  },
  {
    name: "<all_urls> (host permission)",
    why: "You can save from any website, so the content script has to be able to run anywhere. It does nothing until you act on the page (or until you enable auto-save of selections).",
  },
  {
    name: "storage + unlimitedStorage",
    why: "Keeps your library, decks, tags, notes and search index on this device. “unlimitedStorage” exists so a large library of saved article text is not truncated by the browser's quota.",
  },
  {
    name: "identity",
    why: "Only used if you turn on Google Drive sync: it runs Google's own sign-in sheet and holds the token that lets Kipideck read and write your private Drive app-data folder.",
  },
  {
    name: "alarms",
    why: "Only used if sync is on: wakes the background script every 10 minutes to push and pull changes. No alarm exists for anything else.",
  },
  {
    name: "notifications",
    why: "The small “Saved to Kipideck” toast, and a warning if syncing to your Drive has stopped working. Both can be turned off in Settings.",
  },
];

const STORED = [
  {
    what: "The page you save",
    detail: "Title, URL, domain, the site's own description and preview-image URL, and when you saved it.",
    when: "When you save a page (right-click, popup, Space+K, or Ctrl/Cmd+Shift+K).",
  },
  {
    what: "Article text for search",
    detail: "Up to 20,000 characters of the visible text of that page, plus a locally built word index so search is instant.",
    when: "Only for pages you save. Never for pages you simply visit.",
  },
  {
    what: "Selected text",
    detail: "The passage you highlighted, stored as a quote with a link back to the page it came from.",
    when: "On a right-click save, or automatically if you enabled auto-save on the first-run page.",
  },
  {
    what: "Links and images",
    detail: "The link or image URL you clicked, plus the page it was on.",
    when: "Only when you right-click and choose Save to Kipi.",
  },
  {
    what: "Your own additions",
    detail: "Notes, tags, and which deck you filed an item into.",
    when: "Only what you type or choose.",
  },
  {
    what: "Site icons",
    detail: "The favicon of domains you have saved, fetched from that site and cached on your device.",
    when: "After you save something from that domain. No third-party icon service is ever contacted.",
  },
  {
    what: "Preferences",
    detail: "Your toggles, muted sites, decks, and (if you use sync) your Google OAuth tokens and your own client ID.",
    when: "Whenever you change a setting.",
  },
];

const NEVER = [
  "Your browsing history — Kipideck only ever sees the page you act on.",
  "Keystrokes, form contents, passwords, or anything you type into a website.",
  "Your other tabs, windows, or the contents of pages you have not saved.",
  "Analytics, crash reports, advertising identifiers, or usage telemetry of any kind.",
  "Any request to a Kipideck server. There is no Kipideck server and no Kipideck account.",
];

export default function PrivacyPage() {
  return (
    <>
      <header className="nav">
        <div className="nav-inner">
          <a className="brand brand-link" href="/">
            <img src="/assets/logo.png" alt="Kipideck" />
            Kipideck
          </a>
          <nav className="nav-links">
            <a href="/">← Back to home</a>
            <a href="/deck">Open My Deck</a>
            <DownloadButton label="⬇ Add to Chrome" className="nav-cta" scrollTo={null} />
          </nav>
        </div>
      </header>

      <main className="section doc-page">
        <h1 className="page-title">Privacy policy</h1>
        <p className="section-lede">
          The short version: Kipideck stores what you deliberately save, on your own device. It has
          no server, no accounts, no analytics, and no third parties — with one optional exception
          (your own Google Drive) that only exists if you set it up yourself.
        </p>
        <p className="small muted" style={{ textAlign: "center", marginTop: -14 }}>
          Effective {EFFECTIVE} · {VERSION}
        </p>

        <div className="priority-banner">
          🧾 This page is the disclosure required by the Chrome Web Store. The same summary is
          shown inside the extension on first run, before anything is captured automatically.
        </div>

        <div className="doc-card">
          <h2>1. Who we are, and what Kipideck is</h2>
          <p>
            Kipideck is a browser extension for Chrome, Edge, Brave, Opera and Firefox. It saves
            pages, links, images and selected text into decks, indexes them so you can search them,
            and — optionally — syncs them between your own browsers through your own Google Drive.
          </p>
          <p>
            It is built and maintained as an open project; the source is published at{" "}
            <a
              href="https://github.com/thekeshavgandhi-dev/kipideck"
              target="_blank"
              rel="noopener noreferrer"
            >
              github.com/thekeshavgandhi-dev/kipideck
            </a>
            . That repository is also the fastest way to verify any claim on this page: the network
            requests Kipideck makes are all visible in <code>lib/drive-sync.js</code> and{" "}
            <code>lib/favicons.js</code>.
          </p>
        </div>

        <div className="doc-card">
          <h2>2. The single purpose of this extension</h2>
          <p>
            To let you save things you find on the web and find them again later. Every permission
            and every byte stored exists to serve that one purpose. Nothing is collected for any
            other reason, and nothing is collected that the purpose does not require.
          </p>
        </div>

        <div className="doc-card">
          <h2>3. What Kipideck stores</h2>
          <p className="muted">
            All of this is stored locally in your browser profile (IndexedDB and extension
            storage). None of it is transmitted anywhere unless you enable Google Drive sync.
          </p>
          <ul>
            {STORED.map((row) => (
              <li key={row.what}>
                <strong>{row.what}</strong> — {row.detail} <span className="muted">({row.when})</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="doc-card">
          <h2>4. What Kipideck never collects</h2>
          <ul>
            {NEVER.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p>
            Because there is no server and no account, there is also nothing we could sell, share,
            sub-process, or lose in a breach. We do not operate any database of Kipideck users, and
            we cannot enumerate, contact, or identify them.
          </p>
        </div>

        <div className="doc-card">
          <h2>5. Automatic capture, and how to stop it</h2>
          <p>
            Nothing is captured automatically until you have seen the first-run page and pressed a
            button on it. That page opens the first time the extension runs, and it lists the two
            behaviours that can act without a click:
          </p>
          <ul>
            <li>
              <strong>Auto-save of selected text</strong> — on by default after you accept, off if
              you choose “Continue with auto-capture off”. Every automatic save shows a toast with
              an <em>Open</em> and a <em>Never here</em> button; <em>Never here</em> mutes that
              site permanently.
            </li>
            <li>
              <strong>Space + K to save the current page</strong> — a deliberate keystroke, and
              automatically disabled on sites where Space already does something else (video and
              music players, Gmail, Google Docs and Drive), inside any text field, and on any site
              you have muted.
            </li>
          </ul>
          <p>
            All of it is reversible at any time from <strong>Library → Settings</strong>: turn
            either behaviour off globally, mute individual sites, or turn off save notifications.
          </p>
        </div>

        <div className="doc-card">
          <h2>6. The only third party: your own Google Drive (optional)</h2>
          <p>
            Sync is off by default and stays off until you create a Google OAuth client, paste its
            ID into Kipideck, and sign in. When it is on:
          </p>
          <ul>
            <li>
              Sign-in uses Google's Authorization Code flow with PKCE, through Google's own consent
              screen. Kipideck receives an access token and a refresh token, both stored only in
              your browser profile.
            </li>
            <li>
              The scopes requested are the narrowest that work:{" "}
              <code>drive.appdata</code> (a hidden per-app folder in your Drive that never appears
              in your normal Drive file list and that only this OAuth client can read) and{" "}
              <code>userinfo.email</code> (so Settings can show which account is connected). Full
              Drive access is never requested.
            </li>
            <li>
              Your saved items, in sharded JSON files, are written to that folder and read back from
              it. Only the changed shards are uploaded, so a title edit does not re-upload your
              library.
            </li>
            <li>
              Because sync uses <em>your own</em> client ID, your tokens are issued to you by
              Google; Kipideck's author never sees them, your data, or the fact that you exist.
            </li>
          </ul>
          <p>
            Google's handling of that data is governed by{" "}
            <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">
              Google's privacy policy
            </a>
            . You can revoke Kipideck's access at any time at{" "}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noopener noreferrer"
            >
              myaccount.google.com/permissions
            </a>
            , or from <strong>Library → Settings → Sync → Disconnect Google Drive</strong>.
          </p>
          <p className="muted">
            <strong>With sync off</strong>, the only outbound requests Kipideck makes are to the
            websites of items you have already saved: to fetch that site's own favicon for the
            library grid, and to load a saved preview image (<code>og:image</code>) when you view
            that item. Both go to the site the item came from, never to us or to a third-party
            service. Nothing else leaves your browser.
          </p>
        </div>

        <div className="doc-card">
          <h2>7. Permissions, and why each one is needed</h2>
          <ul>
            {PERMISSIONS.map((p) => (
              <li key={p.name}>
                <code>{p.name}</code> — {p.why}
              </li>
            ))}
          </ul>
        </div>

        <div className="doc-card">
          <h2>8. How long data is kept, and how to delete it</h2>
          <p>
            Your library is kept until you delete it. There is no expiry, no server-side copy, and
            no retention period we control — because we never hold your data.
          </p>
          <ul>
            <li>
              <strong>One item:</strong> delete it in the Library. If sync is on, a tombstone is
              written to your Drive shards so the item is not resurrected on another device.
            </li>
            <li>
              <strong>Everything:</strong> Library → Settings → <em>Delete all items &amp; reset
              decks</em>, then (if you sync) <em>Disconnect Google Drive</em> and delete the
              Kipideck files via{" "}
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noopener noreferrer"
              >
                Google's connected apps page
              </a>
              .
            </li>
            <li>
              <strong>A copy to keep:</strong> Library → <em>Export</em> writes a standard JSON file
              of your whole library. <em>Import</em> merges a JSON file into what you already have
              and shows you the arithmetic before writing anything.
            </li>
            <li>
              <strong>Uninstalling</strong> the extension removes its local storage from that
              browser profile.
            </li>
          </ul>
        </div>

        <div className="doc-card">
          <h2>9. Children's privacy</h2>
          <p>
            Kipideck is not directed at children under 13 (or the equivalent minimum age in your
            country), and it does not knowingly collect personal information from anyone — child or
            adult. Because it has no server and no accounts, it has no user data to collect, sell or
            disclose, and no advertising of any kind.
          </p>
        </div>

        <div className="doc-card">
          <h2>10. Your rights</h2>
          <p>
            Access, correction, portability and erasure are all exercised directly inside the
            extension, without contacting anyone: the Library shows everything stored, every field
            is editable, <em>Export</em> gives you a portable JSON copy, and <em>Delete</em> removes
            items permanently. If you use Drive sync, the same operations apply to your synced
            shards.
          </p>
        </div>

        <div className="doc-card">
          <h2>11. Changes to this policy</h2>
          <p>
            If a future version starts collecting anything not described here, that change will be
            (a) disclosed on the first-run page inside the extension before it takes effect, (b)
            listed in the release notes, and (c) reflected on this page with a new effective date.
            The effective date at the top of this page is the version currently in force.
          </p>
        </div>

        <div className="doc-card">
          <h2>12. Contact</h2>
          <p>
            Questions about this policy, or about anything Kipideck stores: open an issue at{" "}
            <a
              href="https://github.com/thekeshavgandhi-dev/kipideck/issues"
              target="_blank"
              rel="noopener noreferrer"
            >
              github.com/thekeshavgandhi-dev/kipideck/issues
            </a>
            . There is no support inbox and no user database — the issue tracker is the contact
            channel, and it is public so answers stay verifiable.
          </p>
        </div>

        <div className="hero-ctas center" style={{ marginTop: 32 }}>
          <a className="btn btn-primary" href="/deck">
            📂 Open My Deck
          </a>
          <a className="btn btn-ghost" href="/">
            ← Back to home
          </a>
        </div>
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <div className="brand">
            <img src="/assets/logo.png" alt="" />
            Kipideck
          </div>
          <nav className="footer-links">
            <a href="/">Home</a>
            <a href="/deck">Open My Deck</a>
            <a href="/sync-setup">Sync setup</a>
            <a href="/privacy">Privacy</a>
          </nav>
          <p className="muted">
            Private by design — your data goes only to your own Google Drive, never to us.
          </p>
        </div>
      </footer>
    </>
  );
}
