import PageShell from "../components/PageShell";
import DownloadButton from "../components/DownloadButton";

const SCHEMA_URL =
  "https://github.com/thekeshavgandhi-dev/kipideck/blob/main/docs/EXPORT_FORMAT.md";

export const metadata = {
  title: "The Kipideck shutdown-proof pledge",
  description:
    "No server, no account, no subscription: your library lives in your own browser storage on your own device, sync is optional and goes to your own Google Drive, and you can export everything at any time in three open formats whose schema is published. Including the parts we cannot promise.",
  openGraph: {
    title: "The Kipideck shutdown-proof pledge — including what we cannot promise",
    description:
      "Structural facts, not promises: no Kipideck server, no account, data in your browser's own storage, optional sync to your own Drive, export any time in three documented open formats.",
    type: "website",
  },
};

// The pledge is deliberately phrased as facts about where data lives, not
// assurances about our intentions. Intentions do not survive an acquisition;
// architecture does.
const PLEDGE = [
  "There is no Kipideck server. Nothing you save is uploaded to us, because there is nowhere to upload it to. The extension has no analytics, no telemetry and no account system to report to.",
  "There is no account. No sign-up, no email address, no password, no subscription. Nobody can lock you out of a Kipideck account because one does not exist.",
  "Your library lives in your own browser's storage on your own device. It is ordinary IndexedDB, written by the browser you installed the extension into.",
  "Sync is optional, and it goes to your Drive, not ours. If you turn it on, Kipideck writes into a hidden app-data folder in the Google Drive you sign in to, using an OAuth client you create yourself. Tokens stay in your browser.",
  "You can export everything at any time, in three open formats: JSON (lossless), Netscape bookmark HTML (which every browser and most read-later apps import), and Markdown.",
  "The export schema is published, not private. Every field of the JSON is documented in the repository, so the file is readable and convertible without Kipideck even if this project disappeared.",
  "Import is a first-class feature, not a favour. Thirteen export formats from other tools are supported, because a tool that makes it hard to arrive is a tool you should be suspicious of.",
  "The code is open. Every file is in the public repository, so the claims on this page can be checked rather than taken on trust.",
];

// The credibility half. A pledge with no limits reads as marketing.
const CANNOT = [
  {
    title: "We cannot promise your browser will never change underneath you.",
    body: "Kipideck stores data using web platform APIs, chiefly IndexedDB. Browser vendors control those APIs and occasionally change or remove them. If that happened, the extension could stop working even though your data is intact. This is why the export schema is documented: the bytes stay readable and convertible regardless of what any browser does next.",
  },
  {
    title: "We cannot promise an extension you never update will keep working.",
    body: "Browsers change their extension platforms too. An extension installed and never touched can eventually stop loading. Keeping the extension reasonably current is your side of the bargain, and it is the same bargain you have with any software you run.",
  },
  {
    title: "We cannot rescue data from a disk that died.",
    body: "Local-first means the single copy of your library is on your machine. If that disk fails and you never exported and never turned on sync, the data is gone — and no company, including us, can get it back. That is not a flaw in the design, it is what owning your data means. Turn on sync or export regularly; both take under a minute.",
  },
  {
    title: "We cannot promise this project will be maintained forever.",
    body: "We can promise the structure, and the structure is the point: your library is already a set of files you hold, in a documented format, readable without us. If development stopped tomorrow, the extension you have installed would keep working and your exports would still open. We will not promise a timeline we cannot guarantee.",
  },
];

const GRAVEYARD = [
  {
    date: "15 Nov 2024",
    what: "Omnivore. ElevenLabs acqui-hired the team in late October; the hosted service was switched off and user data deleted about two weeks later. The code was open source and still on GitHub. It did not matter, because the library was in their database, not in the code.",
  },
  {
    date: "12 Nov 2025",
    what: "Pocket. Mozilla announced the shutdown in May 2025, made it read-only in July, and on 12 November 2025 disabled exports and permanently deleted every account's data. No copy was kept.",
  },
];

const FORMATS = [
  { name: "Kipideck JSON", ext: ".json", use: "The file to restore from. Lossless: page text, notes, tags, decks, pins, dates and tombstones." },
  { name: "Bookmark HTML", ext: ".html", use: "Netscape format. Opens in any browser and imports into most read-later apps. Links, titles, dates, folders, tags and notes." },
  { name: "Markdown", ext: ".md", use: "Your library as readable notes — one per item, with page text inside a collapsible block if you want it." },
];

export default function ShutdownProofPage() {
  return (
    <PageShell>
      <h1 className="page-title">The shutdown-proof pledge</h1>
      <p className="section-lede">
        Every read-later app that has died was run by people who meant well right up until the day it
        was switched off. So this page is not a list of intentions. It is a list of{" "}
        <strong>structural facts about where your data lives</strong> — facts you can verify, and
        that hold regardless of what happens to this project. It ends with the things we genuinely
        cannot promise, because a pledge without limits is just marketing.
      </p>

      <div className="doc-card">
        <h2>What is true about Kipideck today</h2>
        <ul className="pledge-list">
          {PLEDGE.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>

      <div className="doc-card">
        <h2>How to leave in three clicks</h2>
        <p>
          Not a figure of speech — three actions, and nothing is asked of you in return:
        </p>
        <ol className="import-steps">
          <li>
            <h3>Open the Library</h3>
            <p>
              Click the Kipideck icon → Open My Deck, or press <code>Ctrl/⌘ + Shift + L</code>.
            </p>
          </li>
          <li>
            <h3>Click ⬇</h3>
            <p>
              The export button in the sidebar. A dialog lists the three formats with a one-line note
              on what each one carries.
            </p>
          </li>
          <li>
            <h3>Pick a format</h3>
            <p>
              The file downloads immediately. Large libraries export in chunks behind a progress bar
              rather than being assembled into one enormous string in memory.
            </p>
          </li>
        </ol>
        <table className="compare-table">
          <thead>
            <tr>
              <th>Format</th>
              <th>File</th>
              <th>Best for</th>
            </tr>
          </thead>
          <tbody>
            {FORMATS.map((f) => (
              <tr key={f.name}>
                <td>{f.name}</td>
                <td>
                  <code>{f.ext}</code>
                </td>
                <td className="muted">{f.use}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small" style={{ marginTop: 12 }}>
          Every field of the JSON format is documented publicly:{" "}
          <a href={SCHEMA_URL} rel="noopener">
            the export schema
          </a>
          . If Kipideck vanished, that document is enough to read or convert the file yourself.
        </p>
      </div>

      <div className="doc-card">
        <h2>What we cannot promise</h2>
        <p className="muted">
          This section is the part that makes the rest of the page worth reading.
        </p>
        <div className="faq">
          {CANNOT.map((c) => (
            <details key={c.title}>
              <summary>{c.title}</summary>
              <p>{c.body}</p>
            </details>
          ))}
        </div>
      </div>

      <div className="doc-card">
        <h2>Why people ask this question at all</h2>
        <p>
          Two of the best-loved read-later apps of the last decade are gone, and both deleted user
          data on a schedule:
        </p>
        <ul className="timeline">
          {GRAVEYARD.map((g) => (
            <li key={g.date}>
              <time>{g.date}</time>
              <span>{g.what}</span>
            </li>
          ))}
        </ul>
        <p className="muted small" style={{ marginTop: 12 }}>
          We name only products that have already shut down. We do not predict the death of anything
          that is currently alive and working — that would be fearmongering, and most of the tools in
          this category deserve to succeed.
        </p>
      </div>

      <div className="doc-card">
        <h2>Read the details yourself</h2>
        <p>
          Every claim here is checkable.{" "}
          <a href={SCHEMA_URL} rel="noopener">
            The export schema
          </a>{" "}
          documents the JSON, the bookmark HTML and the Markdown output field by field. The{" "}
          <a href="/privacy">privacy policy</a> lists every permission the extension requests and
          what each one is used for — including the ones we do not need. And the source is public, so
          you can confirm there is no server by looking for one.
        </p>
        <p className="muted small">
          Arriving from a shutdown? The importer reads{" "}
          <a href="/pocket-alternative">Pocket</a>,{" "}
          <a href="/omnivore-alternative">Omnivore</a> and{" "}
          <a href="/raindrop-alternative">Raindrop</a> exports directly.
        </p>
      </div>

      <div className="page-cta">
        <DownloadButton label="⬇ Add to Chrome — it's free" scrollTo={null} />
        <a className="btn btn-ghost" href="/deck">
          Open my library
        </a>
      </div>
    </PageShell>
  );
}
