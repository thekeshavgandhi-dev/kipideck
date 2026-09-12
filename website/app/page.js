import DownloadButton from "./components/DownloadButton";
import OpenDeckButton from "./components/OpenDeckButton";
import VersionPill from "./components/VersionPill";

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
            <a href="/deck">Open My Deck</a>
            <DownloadButton label="⬇ Add to Chrome" className="nav-cta" />
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
            <DownloadButton label="⬇ Add to Chrome — it's free" />
            <OpenDeckButton />
          </div>
          <div className="version-row">
            <VersionPill />
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
            (or just highlight text — it saves itself automatically).
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
          Mozilla&apos;s official polyfill), not Chrome-only APIs — so the exact same download
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
          <a className="btn btn-ghost" href="/sync-setup">
            Read the sync setup guide →
          </a>
        </div>
      </section>

      <section id="install" className="section install">
        <h2>Get Kipideck in under a minute</h2>
        <p className="section-lede">
          Download the extension right here — no store account, no sign-up. One small file,
          installs on every major browser.
        </p>

        <div className="download-hero-card">
          <div className="download-hero-text">
            <div className="card-ico big">📦</div>
            <div>
              <h3>Kipideck for Chrome, Edge, Brave, Opera &amp; Firefox</h3>
              <p className="muted">
                Free forever. Works offline from the second it installs. Your saves stay on your
                device unless you choose to sync.
              </p>
              <div className="version-row left">
                <VersionPill />
              </div>
            </div>
          </div>
          <DownloadButton label="⬇ Download Kipideck — free" scrollTo="install-steps" />
        </div>

        <div id="install-steps" className="install-grid">
          <div className="card" id="install-chrome">
            <h3>🟢 Chrome / Edge / Brave / Opera</h3>
            <ol>
              <li>
                Click <strong>Download Kipideck</strong> above — a small{" "}
                <code>kipideck-extension.zip</code> file saves to your computer.
              </li>
              <li>
                <strong>Unzip it</strong>: right-click → <em>Extract All…</em> (Windows) or
                double-click it (Mac). You&apos;ll get a <code>kipideck</code> folder.
              </li>
              <li>
                Open <code>chrome://extensions</code> (or <code>edge://extensions</code>,{" "}
                <code>brave://extensions</code>) and switch on{" "}
                <strong>Developer mode</strong> (toggle, top-right).
              </li>
              <li>
                Click <strong>Load unpacked</strong> and select the unzipped{" "}
                <code>kipideck</code> folder.
              </li>
              <li>
                Pin it: click the 🧩 puzzle icon → 📌 next to Kipideck. Done — right-click
                anything → <strong>Save to Kipi</strong>!
              </li>
            </ol>
          </div>
          <div className="card" id="install-firefox">
            <h3>🦊 Firefox</h3>
            <ol>
              <li>
                Click <strong>Download Kipideck</strong> above and <strong>unzip</strong> the file
                (double-click it) to get the <code>kipideck</code> folder.
              </li>
              <li>
                Open <code>about:debugging#/runtime/this-firefox</code> in Firefox.
              </li>
              <li>
                Click <strong>Load Temporary Add-on…</strong> and pick{" "}
                <code>manifest.json</code> inside the unzipped <code>kipideck</code> folder.
              </li>
              <li>
                Pin it to your toolbar and start saving with a right-click →{" "}
                <strong>Save to Kipi</strong>.
              </li>
            </ol>
            <p className="muted small">
              Note: Firefox loads unpacked add-ons temporarily, so you&apos;ll re-add it after a
              browser restart — until the signed store version ships.
            </p>
          </div>
        </div>

        <div className="how-to-open">
          <h3>Already installed? Open your deck 👇</h3>
          <p className="muted">
            Your deck lives inside the extension — your saved items on this device, plus anything
            synced from your other browsers. One click opens it:
          </p>
          <div className="hero-ctas center">
            <OpenDeckButton label="📂 Open My Deck" />
          </div>
        </div>

        <details className="troubleshoot">
          <summary>Download or install not working? Quick fixes →</summary>
          <ul>
            <li>
              <strong>Can&apos;t find Developer mode?</strong> On the extensions page{" "}
              <code>chrome://extensions</code>, it&apos;s a toggle in the very top-right corner.
            </li>
            <li>
              <strong>&quot;Manifest file is missing&quot; error?</strong> You selected the{" "}
              <code>.zip</code> itself or the wrong folder — unzip first, then select the folder
              that directly contains <code>manifest.json</code>.
            </li>
            <li>
              <strong>Download blocked?</strong> Some networks block <code>.zip</code> files — try
              another browser or network, the file is tiny (under 100 KB).
            </li>
            <li>
              <strong>Want the one-click store install?</strong> Chrome Web Store / Firefox Add-ons
              listings are coming soon — this page will link to them once published.
            </li>
          </ul>
        </details>
      </section>

      <footer className="footer">
        <div className="footer-inner">
          <div className="brand">
            <img src="/assets/logo.png" alt="" />
            Kipideck
          </div>
          <nav className="footer-links">
            <a href="/deck">Open My Deck</a>
            <a href="/sync-setup">Sync setup guide</a>
            <a href="#install">Install</a>
            <a href="/privacy">Privacy</a>
          </nav>
          <p className="muted">
            Save anything. It organizes itself. Private by design — your saves stay on your device
            unless you turn on Google Drive sync.
          </p>
        </div>
      </footer>
    </>
  );
}
