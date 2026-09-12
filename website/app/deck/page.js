import DeckOpener from "../components/DeckOpener";
import DownloadButton from "../components/DownloadButton";
import VersionPill from "../components/VersionPill";

export const metadata = {
  title: "Open My Deck — Kipideck",
  description:
    "Open your Kipideck library: everything you saved on this device, plus anything synced from your other browsers via your own Google Drive.",
};

export default function DeckPage() {
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
            <a href="/sync-setup">Sync setup guide</a>
            <DownloadButton label="⬇ Add to Chrome" className="nav-cta" scrollTo={null} />
          </nav>
        </div>
      </header>

      <main className="section deck-page">
        <h1 className="page-title">📂 Your Kipideck</h1>
        <p className="section-lede">
          Your deck lives <strong>on your device, inside the extension</strong> — this page simply
          opens it for you. If you enabled sync, you&apos;ll also see everything from your other
          browsers, merged in from your own Google Drive.
        </p>

        <DeckOpener />

        <div id="deck-install-steps" className="install-grid" style={{ marginTop: 36 }}>
          <div className="card">
            <h3>🟢 New here? Install in 1 minute (Chrome / Edge / Brave / Opera)</h3>
            <ol>
              <li>
                <strong>Download</strong> the extension file (small .zip, free forever).
              </li>
              <li>
                <strong>Unzip it</strong> — right-click → <em>Extract All…</em> (Windows) or
                double-click (Mac).
              </li>
              <li>
                Open <code>chrome://extensions</code>, enable <strong>Developer mode</strong>{" "}
                (top-right), click <strong>Load unpacked</strong>, select the unzipped{" "}
                <code>kipideck</code> folder.
              </li>
              <li>
                Come back to this page and hit <strong>Open My Deck</strong>. 🎉
              </li>
            </ol>
            <div className="hero-ctas" style={{ marginBottom: 0 }}>
              <DownloadButton label="⬇ Download Kipideck — free" scrollTo={null} />
            </div>
            <div className="version-row left" style={{ marginTop: 12 }}>
              <VersionPill />
            </div>
          </div>
          <div className="card">
            <h3>🦊 Firefox</h3>
            <ol>
              <li>Download + unzip the same file to get the <code>kipideck</code> folder.</li>
              <li>
                Open <code>about:debugging#/runtime/this-firefox</code>.
              </li>
              <li>
                Click <strong>Load Temporary Add-on…</strong> → pick{" "}
                <code>manifest.json</code> inside the folder.
              </li>
              <li>Return here and open your deck. 🎉</li>
            </ol>
            <h3 style={{ marginTop: 20 }}>⌨️ Shortcuts (once installed)</h3>
            <ul className="shortcut-list">
              <li>
                <code>Ctrl+Shift+L</code> / <code>Cmd+Shift+L</code> — open your deck
              </li>
              <li>
                <code>Ctrl+Shift+K</code> / <code>Cmd+Shift+K</code> — quick-save the current page
              </li>
              <li>Right-click anything → Save to Kipi</li>
            </ul>
          </div>
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
            <a href="/sync-setup">Sync setup guide</a>
            <a href="/#install">Install</a>
            <a href="/privacy">Privacy</a>
          </nav>
          <p className="muted">
            Private by design — this website never sees your saved items. They open directly from
            your own browser.
          </p>
        </div>
      </footer>
    </>
  );
}
