import PageShell from "../components/PageShell";
import DownloadButton from "../components/DownloadButton";

export const metadata = {
  title: "Pocket is gone — import your export into Kipideck",
  description:
    "Mozilla deleted every Pocket library on 12 November 2025. If you downloaded your export in time, Kipideck reads the part_*.csv files or ril_export.html, keeps your tags, dates and read state, and puts the library on your own device where nobody can switch it off.",
  openGraph: {
    title: "Pocket is gone. Your export file doesn't have to be.",
    description:
      "Import your Pocket CSV or HTML export into a local-first library: tags, save dates and archive state preserved, no account, no server, no subscription.",
    type: "website",
  },
};

const TIMELINE = [
  { date: "22 May 2025", what: "Mozilla announces Pocket is being discontinued. New sign-ups and Premium purchases are switched off." },
  { date: "8 July 2025", what: "Pocket goes read-only. The apps, the browser extensions and the API stop working. Premium refunds go out." },
  { date: "12 Nov 2025", what: "The export tool and the API are disabled, and every account's data is permanently deleted. Mozilla kept no copy." },
];

const SURVIVES = [
  { what: "Links and titles", pocket: "Yes", kipi: "Yes", note: "Pocket's redirect wrappers (getpocket.com/extredirect?…) are unwrapped, so your links point at the article, not at a dead service." },
  { what: "Tags", pocket: "Yes", kipi: "Yes", note: "Pipe-separated tags in the CSV and comma-separated tags in the HTML are both split correctly." },
  { what: "Save dates", pocket: "Yes", kipi: "Yes", note: "time_added becomes the item's real saved date, so ten years of reading stays in chronological order." },
  { what: "Unread / archive state", pocket: "Yes", kipi: "Yes", note: "Archived items are tagged “archive” instead of being dumped in one pile with everything else." },
  { what: "Favourites", pocket: "Yes", kipi: "Yes", note: "Kept as a tag, and searchable like any other." },
  { what: "Article text", pocket: "Never exported", kipi: "No", note: "Pocket's export contained links and metadata only. No importer can recover text that was never in the file." },
  { what: "Your highlights", pocket: "Premium, separate file", kipi: "If you have the file", note: "Import it alongside the CSVs: a JSON list with URLs and note fields comes across as notes on the matching items." },
];

const COMPARE = [
  { label: "Where your library lives", pocket: "Mozilla's servers", kipi: "Your own browser storage, on your device" },
  { label: "Can a company delete it?", pocket: "It did — 12 Nov 2025", kipi: "There is no Kipideck server to delete it from" },
  { label: "Account required", pocket: "Yes", kipi: "No" },
  { label: "Price", pocket: "Free, then Premium, then gone", kipi: "Free. No subscription, no premium tier" },
  { label: "Works offline", pocket: "Partly, in the apps", kipi: "Fully — search included" },
  { label: "Getting your data out", pocket: "One export window, then closed", kipi: "Any time, in three formats" },
  { label: "Sync between devices", pocket: "Their cloud", kipi: "Optional, through your own Google Drive" },
  { label: "Auto-organising", pocket: "No", kipi: "Yes — saved items are filed into decks by type" },
];

const FAQ = [
  {
    q: "I never exported. Can I still get my Pocket library back?",
    a: "No, and we would rather tell you plainly than sell you hope. Mozilla disabled exports on 12 November 2025 and deleted every account's data; no copy was kept, and the API third-party recovery tools used is offline. What you can still rebuild from: your browser's own bookmarks (Kipideck imports Chrome's HTML export and its raw Bookmarks JSON file, plus Firefox's), any URL lists you kept in notes or emails, and the read-later app you moved to afterwards — Raindrop, Instapaper, Readwise Reader and Wallabag exports all import too.",
  },
  {
    q: "My download is a ZIP. Do I need to unzip it first?",
    a: "No — drop the ZIP straight into the import dialog. Kipideck opens it in your browser (nothing is uploaded anywhere), merges every part_*.csv into one library and removes duplicates across the parts. Unzipping by hand first and selecting the CSVs still works too.",
  },
  {
    q: "Will Kipideck be deleted the way Pocket was?",
    a: "The structure is different, not just the intentions. Pocket was a service: your library lived on someone else's servers, so when the service stopped, the library stopped. Kipideck is an extension that runs in your browser — there is no Kipideck server, no account, and no copy of your data anywhere we can reach. If this project stopped tomorrow, the extension you installed would keep working and your library would stay on your disk. Read the full pledge, including the things we cannot promise, on the shutdown-proof page.",
  },
  {
    q: "What happens to links that are already dead?",
    a: "They stay in your library with their title, tags and saved date, which is often the only record left that you read them. Kipideck does not silently drop broken links on import, and it shows the domain so you can search for an archived copy. It cannot fetch text for a page that no longer exists.",
  },
  {
    q: "I have 40,000 items. Will this actually work?",
    a: "That is the size the importer was built for. Parsing runs at roughly 40,000 rows a second, writes happen in batches with a progress bar, and the library afterwards is paginated and indexed rather than loaded into memory. Importing is also repeatable: run it again and it adds nothing, because matching is on the canonical URL rather than on the row.",
  },
  {
    q: "Does it cost anything? Is there a catch?",
    a: "No cost, no account, no analytics, no ads. Optional sync uses your own Google Drive app-data folder and your own OAuth client, which you set up yourself — Kipideck's author never sees your tokens or your data. The privacy policy lists every permission the extension asks for and what each one does.",
  },
];

export default function PocketAlternativePage() {
  return (
    <PageShell>
      <h1 className="page-title">Pocket is gone. Your export file doesn&apos;t have to be.</h1>
      <p className="section-lede">
        Mozilla deleted every Pocket library on 12 November 2025. If you downloaded your export
        before the deadline, that file is still sitting in your Downloads folder — a ZIP of CSVs, or
        an <code>ril_export.html</code>. Kipideck reads either one, keeps your tags, save dates and
        read state, and puts the result on your own device, where no company can switch it off.
      </p>

      <div className="rescue-stats">
        <div className="rescue-stat">
          <b>18 years</b>
          <span>Pocket ran 2007–2025</span>
        </div>
        <div className="rescue-stat">
          <b>127 days</b>
          <span>from read-only to deleted</span>
        </div>
        <div className="rescue-stat">
          <b>~1 minute</b>
          <span>to import 20,000 links</span>
        </div>
        <div className="rescue-stat">
          <b>0 servers</b>
          <span>holding your library</span>
        </div>
      </div>

      <div className="doc-card">
        <h2>What actually happened</h2>
        <ul className="timeline">
          {TIMELINE.map((t) => (
            <li key={t.date}>
              <time>{t.date}</time>
              <span>{t.what}</span>
            </li>
          ))}
        </ul>
        <p className="muted small" style={{ marginTop: 12 }}>
          The export window is closed and there is no recovery path for data that was not
          downloaded. Everything below is for people who still have their file.
        </p>
      </div>

      <div className="doc-card">
        <h2>Rescue your library in four steps</h2>
        <ol className="import-steps">
          <li>
            <h3>Find the export</h3>
            <p>
              Pocket&apos;s final export is a ZIP containing <code>part_000000.csv</code>,{" "}
              <code>part_000001.csv</code>… Older exports are a single{" "}
              <code>ril_export.html</code>. Drop the ZIP straight into the import dialog — it
              opens in your browser, nothing is uploaded — or unzip it by hand first; both
              paths merge into one library.
            </p>
          </li>
          <li>
            <h3>Install Kipideck</h3>
            <p>
              Free, no account, works in Chrome, Edge, Brave, Opera and Firefox. It takes about a
              minute, and nothing is uploaded anywhere.
            </p>
          </li>
          <li>
            <h3>Library → ⬆ Import → select the ZIP</h3>
            <p>
              Kipideck opens the ZIP in your browser, recognises the format from the columns,
              unwraps Pocket&apos;s redirect URLs, splits the pipe-separated tags, and merges all
              the parts into one library. (Unzipped by hand? Select every CSV at once instead.)
            </p>
          </li>
          <li>
            <h3>Read the preview, then import</h3>
            <p>
              You see exactly how many items are ready, how many are already in your library and how
              many were skipped — before a single byte is written. Choose a deck, or let Kipideck
              file the items by type. Then watch the progress bar and the count of rescued items.
            </p>
          </li>
        </ol>
      </div>

      <div className="callout">
        <strong>Running it twice is safe.</strong> Matching is on the canonical URL, so a second
        import of the same file adds nothing, an article that appears in both the Unread and Archive
        sections arrives once, and items you deleted in Kipideck stay deleted.
      </div>

      <div className="doc-card">
        <h2>What survives the move</h2>
        <table className="compare-table">
          <thead>
            <tr>
              <th>In your Pocket export</th>
              <th>Exported by Pocket</th>
              <th>Kept by Kipideck</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {SURVIVES.map((row) => (
              <tr key={row.what}>
                <td>{row.what}</td>
                <td className={/never|premium/i.test(row.pocket) ? "" : "yes"}>{row.pocket}</td>
                <td className={row.kipi === "No" ? "no" : "yes"}>{row.kipi}</td>
                <td className="muted">{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small" style={{ marginTop: 12 }}>
          The honest summary: Pocket exported a list of links with metadata, so that is what any
          importer can rescue. From now on Kipideck also stores the article text of what you save,
          which is the part Pocket never gave anyone.
        </p>
      </div>

      <div className="doc-card">
        <h2>Pocket and Kipideck, side by side</h2>
        <table className="compare-table">
          <thead>
            <tr>
              <th> </th>
              <th>Pocket</th>
              <th>Kipideck</th>
            </tr>
          </thead>
          <tbody>
            {COMPARE.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td className="muted">{row.pocket}</td>
                <td>{row.kipi}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="doc-card">
        <h2>Questions people actually ask</h2>
        <div className="faq">
          {FAQ.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </div>

      <div className="doc-card">
        <h2>Not arriving from Pocket?</h2>
        <p>
          The same importer reads <a href="/omnivore-alternative">Omnivore</a>,{" "}
          <a href="/raindrop-alternative">Raindrop</a>, Instapaper, Pinboard, Wallabag, Readwise
          Reader, browser bookmarks and plain lists of URLs. And whichever file you arrive with, you
          can leave with three of your own: see the{" "}
          <a href="/shutdown-proof">shutdown-proof pledge</a>.
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
