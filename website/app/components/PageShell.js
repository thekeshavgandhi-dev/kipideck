import DownloadButton from "./DownloadButton";

/**
 * Chrome shared by the content pages: the import guides, the shutdown-proof
 * pledge, the privacy policy.
 *
 * One component rather than a copy-pasted header per page, so a new page cannot
 * ship with a stale nav, and every page — including the ones a worried Pocket
 * refugee lands on from a search — carries the same two links out: open the
 * library, or install the extension.
 */
export default function PageShell({ children, backLabel = "← Back to home" }) {
  return (
    <>
      <header className="nav">
        <div className="nav-inner">
          <a className="brand brand-link" href="/">
            <img src="/assets/logo.png" alt="Kipideck" />
            Kipideck
          </a>
          <nav className="nav-links">
            <a href="/">{backLabel}</a>
            <a href="/shutdown-proof">Shutdown-proof</a>
            <a href="/deck">Open My Deck</a>
            <DownloadButton label="⬇ Add to Chrome" className="nav-cta" scrollTo={null} />
          </nav>
        </div>
      </header>

      <main className="section doc-page">{children}</main>

      <footer className="footer">
        <div className="footer-inner">
          <div className="brand">
            <img src="/assets/logo.png" alt="" />
            Kipideck
          </div>
          <nav className="footer-links">
            <a href="/deck">Open My Deck</a>
            <a href="/pocket-alternative">Moving from Pocket</a>
            <a href="/omnivore-alternative">Moving from Omnivore</a>
            <a href="/raindrop-alternative">Moving from Raindrop</a>
            <a href="/shutdown-proof">Shutdown-proof pledge</a>
            <a href="/privacy">Privacy</a>
          </nav>
          <p className="muted">
            Save anything. It organizes itself. Your library lives on your own device — and you can
            always leave with all of it.
          </p>
        </div>
      </footer>
    </>
  );
}
