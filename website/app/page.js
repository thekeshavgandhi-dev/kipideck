const GITHUB_URL = "https://github.com/thekeshavgandhi-dev/kipideck";

export default function Home() {
  return (
    <>
      <header className="nav">
        <div className="nav-inner">
          <div className="brand">
            <img src="/assets/logo.png" alt="Kipideck" />
            Kipideck
          </div>
          <nav className="nav-links">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#browsers">Browsers</a>
            <a href="#sync">Sync</a>
            <a className="nav-cta" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              View on GitHub
            </a>
          </nav>
        </div>
      </header>

      <section className="hero">
        <div className="hero-inner">
          <span className="eyebrow">Free • Private-by-default • No account required</span>
          <h1>
            Save anything you find online.
            <br />
            Kipideck organizes it for you.
          </h1>
          <p className="lede">
            Right-click any page, link, image, or highlighted text and choose{" "}
            <strong>Save to Kipi</strong>. It&apos;s auto-sorted into decks, tagged, and made
            fully searchable — all stored on your own device first. Turn on sync only if you
            want it to follow you across browsers, through your own Google Drive.
          </p>
          <div className="hero-ctas">
            <a className="btn btn-primary" href="#install">
              ⬇ Add to your browser — it&apos;s free
            </a>
            <a className="btn btn-ghost" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              Read the source
            </a>
          </div>
          <div className="browser-row">
            <span>Works on</span>
            <span className="badge">Chrome</span>
            <span className="badge">Edge</span>
            <span className="badge">Brave</span>
            <span className="badge">Opera</span>
            <span className="badge">Firefox</span>
          </div>
        </div>
        <div className="hero-art">
          <img src="/assets/hero-screenshot.png" alt="Kipideck dashboard preview" />
        </div>
      </section>

      <section className="logos-strip">
        <p>
          Local-first. No servers, no tracking, no subscription. Your data lives on your device —
          cloud sync is optional and, when enabled, goes to <em>your own</em> Google Drive, not ours.
        </p>
      </section>

      <section id="features" className="section">
        <h2>Everything you save, actually organized</h2>
        <div className="priority-banner">
          🔒 Local storage is the default and first priority — Kipideck works fully offline the
          moment you install it. Google Drive sync is a fully optional, opt-in extra you can turn
          on later from Settings.
        </div>
        <div className="grid grid-3">
          <div className="card">
            <div className="card-ico">📌</div>
            <h3>One right-click, saved</h3>
            <p>
              Save a whole page, a link, an image, a video, or exactly the text you selected —
              plus a reference back to where it came from.
            </p>
          </div>
          <div className="card">
            <div className="card-ico">🗂️</div>
            <h3>Auto-sorted into decks</h3>
            <p>
              A local, offline classifier figures out whether something belongs in Reading,
              Videos, Shopping, Dev &amp; Docs, Research, or a deck you made yourself — and tags
              it automatically.
            </p>
          </div>
          <div className="card">
            <div className="card-ico">🔎</div>
            <h3>Full-text search</h3>
            <p>
              Kipideck indexes the entire readable text of pages you save — not just the title —
              so you can find that one paragraph weeks later.
            </p>
          </div>
          <div className="card">
            <div className="card-ico">💾</div>
            <h3>Stored on your device first</h3>
            <p>
              Everything you save lands in your browser&apos;s local storage immediately. No
              sign-up, no internet connection required, nothing to configure.
            </p>
          </div>
          <div className="card">
            <div className="card-ico">☁️</div>
            <h3>Optional sync via your Google Drive</h3>
            <p>
              Want your decks on every device? Sign in with Google and Kipideck mirrors them to a
              private, hidden folder in your own Drive. Skip this entirely and it still works
              great.
            </p>
          </div>
          <div className="card">
            <div className="card-ico">🌐</div>
            <h3>Every major browser</h3>
            <p>
              One codebase, built on the standard WebExtensions API, running natively on Chrome,
              Edge, Brave, Opera, and Firefox.
            </p>
          </div>
        </div>
      </section>

      <section id="how" className="section alt">
        <h2>How it works</h2>
        <ol className="steps">
          <li>
            <strong>Browse normally.</strong> Read articles, shop, watch videos — anything.
          </li>
          <li>
            <strong>See something worth keeping?</strong> Right-click it → <em>Save to Kipi</em>{" "}
            (or select text and click the floating bubble).
          </li>
          <li>
            <strong>Kipideck captures it</strong> — title, URL, image, full text, and a reference
            back to the source — and files it into the right deck with tags, instantly, offline,
            saved straight to your device.
          </li>
          <li>
            <strong>Find it again</strong> in the Library: browse by deck, filter by tag, or
            full-text search across everything you&apos;ve ever saved.
          </li>
          <li>
            <strong>Optional:</strong> turn on Google Drive sync in Settings and the same library
            follows you to your other browsers and devices.
          </li>
        </ol>
      </section>

      <section id="browsers" className="section">
        <h2>Built on web standards — runs everywhere</h2>
        <p className="section-lede">
          Kipideck is written against the standard <code>browser.*</code> WebExtensions API (via
          Mozilla&apos;s official polyfill), not Chrome-only APIs — so the exact same codebase
          installs on:
        </p>
        <div className="grid grid-5 browsers-grid">
          <div className="browser-card">🟢 Chrome</div>
          <div className="browser-card">🔵 Edge</div>
          <div className="browser-card">🦁 Brave</div>
          <div className="browser-card">🔴 Opera</div>
          <div className="browser-card">🦊 Firefox</div>
        </div>
      </section>

      <section id="sync" className="section alt">
        <h2>Sync is optional — local comes first</h2>
        <p className="section-lede">
          By default, Kipideck stores everything in your browser&apos;s local storage on your PC —
          nothing leaves your device, no account needed, works offline. If you want your saved
          items to follow you across browsers or computers, you can opt in to sync: Kipideck
          writes a snapshot to a hidden &quot;app data&quot; folder inside <strong>your own Google
          Drive</strong> — invisible in your normal Drive UI, readable only by Kipideck. Sign in
          with Google on each browser and they merge automatically, with safe conflict handling
          (newest edit wins, deletions always win over stale copies). There is no Kipideck server
          in this picture at all.
        </p>
        <div className="hero-ctas center">
          <a
            className="btn btn-ghost"
            href={`${GITHUB_URL}/blob/main/docs/GOOGLE_SYNC_SETUP.md`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Read the sync setup guide →
          </a>
        </div>
      </section>

      <section id="install" className="section install">
        <h2>Get Kipideck</h2>
        <p className="section-lede">
          Kipideck is currently distributed as source — load it as an unpacked extension in under
          a minute, on any of these browsers:
        </p>
        <div className="install-grid">
          <div className="card">
            <h3>Chrome / Edge / Brave / Opera</h3>
            <ol>
              <li>
                Download or clone the{" "}
                <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                  GitHub repo
                </a>
              </li>
              <li>
                Open <code>chrome://extensions</code> (or your browser&apos;s equivalent)
              </li>
              <li>
                Enable <strong>Developer mode</strong>
              </li>
              <li>
                Click <strong>Load unpacked</strong> → select the <code>kipideck</code> folder
              </li>
            </ol>
          </div>
          <div className="card">
            <h3>Firefox</h3>
            <ol>
              <li>
                Download or clone the{" "}
                <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                  GitHub repo
                </a>
              </li>
              <li>
                Open <code>about:debugging#/runtime/this-firefox</code>
              </li>
              <li>
                Click <strong>Load Temporary Add-on…</strong>
              </li>
              <li>
                Select <code>kipideck/manifest.json</code>
              </li>
            </ol>
          </div>
        </div>
        <p className="muted small">
          Store listings (Chrome Web Store / Firefox Add-ons) coming soon — this page will link to
          them once published.
        </p>
      </section>

      <footer className="footer">
        <div className="footer-inner">
          <div className="brand">
            <img src="/assets/logo.png" alt="" />
            Kipideck
          </div>
          <p className="muted">
            Save anything. It organizes itself. Built in the open on{" "}
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
            .
          </p>
        </div>
      </footer>
    </>
  );
}
