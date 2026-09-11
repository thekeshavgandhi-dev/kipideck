import DownloadButton from "../components/DownloadButton";

export const metadata = {
  title: "Google Drive sync setup — Kipideck",
  description:
    "One-time, ~5 minute setup to sync your Kipideck decks across browsers and devices through your own private Google Drive app-data folder. No Kipideck server involved.",
};

export default function SyncSetupPage() {
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
        <h1 className="page-title">☁️ Google Drive sync setup</h1>
        <p className="section-lede">
          One-time setup, about 5 minutes. After this, your decks follow you to every browser and
          device you use.
        </p>

        <div className="priority-banner">
          🔒 Sync is <strong>fully optional</strong>. Kipideck works great offline with local-only
          storage. Only follow this guide if you want the same library on multiple
          browsers/devices.
        </div>

        <div className="doc-card">
          <h2>How it works (the 30-second version)</h2>
          <p>
            Kipideck stores your decks in a private, hidden <strong>&quot;app data&quot;
            folder</strong> inside <em>your own</em> Google Drive — a folder Google reserves
            specifically for apps, which:
          </p>
          <ul>
            <li>never appears in your normal Google Drive file list,</li>
            <li>can only be read or written by Kipideck itself,</li>
            <li>
              needs <strong>no Kipideck server at all</strong> — Google&apos;s infrastructure{" "}
              <em>is</em> the sync backend, so there is nothing to host, pay for, or that could
              leak your data in a breach.
            </li>
          </ul>
          <p>
            The trade-off: Google requires every app to register a free OAuth &quot;client
            ID&quot; once. That&apos;s what the steps below do.
          </p>
        </div>

        <div className="doc-card">
          <h2>1. Create a Google Cloud project</h2>
          <ol>
            <li>
              Go to{" "}
              <a
                href="https://console.cloud.google.com/projectcreate"
                target="_blank"
                rel="noopener noreferrer"
              >
                console.cloud.google.com/projectcreate
              </a>
              .
            </li>
            <li>Name it anything, e.g. &quot;Kipideck Sync&quot;.</li>
          </ol>
        </div>

        <div className="doc-card">
          <h2>2. Configure the OAuth consent screen</h2>
          <ol>
            <li>
              In the left sidebar: <strong>APIs &amp; Services → OAuth consent screen</strong>.
            </li>
            <li>
              User type: <strong>External</strong> (unless you have a Google Workspace org).
            </li>
            <li>Fill in app name (&quot;Kipideck&quot;), your support email, and developer email.</li>
            <li>
              Under <strong>Scopes</strong>, add:
              <ul>
                <li>
                  <code>https://www.googleapis.com/auth/drive.appdata</code>
                </li>
                <li>
                  <code>https://www.googleapis.com/auth/userinfo.email</code>
                </li>
              </ul>
            </li>
            <li>
              Under <strong>Test users</strong> (while the app is &quot;Testing&quot;), add every
              Google account you&apos;ll sign in with. Google allows up to 100 test users on
              unverified apps — plenty for personal use.
            </li>
          </ol>
        </div>

        <div className="doc-card">
          <h2>3. Create an OAuth client ID</h2>
          <ol>
            <li>
              Go to <strong>APIs &amp; Services → Credentials → Create credentials → OAuth client
              ID</strong>.
            </li>
            <li>
              Application type: <strong>Chrome App</strong> (this also works for the Firefox flow,
              since Kipideck uses the browser-agnostic sign-in method, not a Chrome-only API). If
              &quot;Chrome App&quot; isn&apos;t available, choose <strong>Web application</strong>{" "}
              instead — either works.
            </li>
            <li>
              For &quot;Chrome App&quot;, enter your installed extension&apos;s ID (visible on{" "}
              <code>chrome://extensions</code> under Kipideck&apos;s card) as the{" "}
              <strong>Application ID</strong>. For &quot;Web application&quot;, add this{" "}
              <strong>Authorized redirect URI</strong>:
              <br />
              <code>https://&lt;your-extension-id&gt;.chromiumapp.org/</code>
            </li>
            <li>
              Click <strong>Create</strong> and copy the <strong>Client ID</strong> (looks like{" "}
              <code>1234567890-abc123.apps.googleusercontent.com</code>).
            </li>
          </ol>
          <p className="muted small">
            Tip — finding your redirect URL: open the extension&apos;s background service worker
            console (<code>chrome://extensions</code> → Kipideck → &quot;service worker&quot; →
            Console) and run <code>browser.identity.getRedirectURL()</code>. Firefox users can do
            the same from <code>about:debugging</code> → This Firefox → Kipideck → Inspect.
          </p>
        </div>

        <div className="doc-card">
          <h2>4. Enable the Google Drive API</h2>
          <ol>
            <li>
              Go to <strong>APIs &amp; Services → Library</strong>, search{" "}
              &quot;Google Drive API&quot;, click <strong>Enable</strong>.
            </li>
          </ol>
        </div>

        <div className="doc-card">
          <h2>5. Paste the client ID into Kipideck</h2>
          <ol>
            <li>
              Open your Kipideck Library (toolbar icon → ⤢, or{" "}
              <code>Ctrl+Shift+L</code> / <code>Cmd+Shift+L</code>).
            </li>
            <li>
              Go to <strong>Settings → Sync across devices &amp; browsers</strong>.
            </li>
            <li>
              Paste your client ID into <strong>Google OAuth client ID</strong> →{" "}
              <strong>Save client ID</strong>.
            </li>
            <li>
              Click <strong>🔐 Sign in with Google &amp; enable sync</strong>.
            </li>
            <li>Approve the consent screen. You&apos;re syncing! 🎉</li>
          </ol>
          <p>
            Repeat step 5 on every other browser/device — same client ID, same Google account — and
            they&apos;ll all merge into the same private Drive file. Newest edit always wins, and
            deletions are never accidentally un-done by older copies.
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
            <a href="/#install">Install</a>
          </nav>
          <p className="muted">
            Private by design — your data goes only to your own Google Drive, never to us.
          </p>
        </div>
      </footer>
    </>
  );
}
