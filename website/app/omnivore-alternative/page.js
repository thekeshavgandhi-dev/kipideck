import PageShell from "../components/PageShell";
import DownloadButton from "../components/DownloadButton";

export const metadata = {
  title: "Omnivore shut down — import your export into Kipideck",
  description:
    "Omnivore's hosted library was switched off on 15 November 2024 and user data was deleted, two weeks after ElevenLabs acqui-hired the team. If you exported in time, Kipideck reads metadata_*.json and rejoins the article text from contents/<slug>.html, keeping your labels, dates, highlights and annotations.",
  openGraph: {
    title: "Omnivore was open source and it still died. Your export doesn't have to.",
    description:
      "Import your Omnivore export into a local-first library: labels become tags, highlights and annotations become notes, and the article text is rejoined from the contents folder. No account, no server, no subscription.",
    type: "website",
  },
};

const TIMELINE = [
  {
    date: "29 Oct 2024",
    what: "ElevenLabs announces it has acqui-hired Omnivore's two co-founders to work on ElevenReader. The product itself is not acquired — it is being ended.",
  },
  {
    date: "Late Oct 2024",
    what: "The export window opens. Users are told to download their library; the deadline is two weeks away.",
  },
  {
    date: "15 Nov 2024",
    what: "The hosted service is switched off and user data is permanently deleted. There is no read-only archive and no extension of the deadline.",
  },
  {
    date: "After",
    what: "The repository is archived. Self-hosting remains possible in principle but needs PostgreSQL, Elasticsearch, a content fetcher and several services. The API never comes back, so the Obsidian and Logseq plugins built on it stop working.",
  },
];

const ANATOMY = [
  { file: "metadata_0.json, metadata_1.json…", holds: "Every item's URL, title, labels, savedAt, read state, author, preview image, and its highlights and annotations." },
  { file: "contents/<slug>.html", holds: "The article text itself, one file per saved item, named after the item's slug." },
  { file: "highlights/<slug>.md", holds: "A human-readable copy of that item's highlights in Markdown. Omnivore wrote it for you to read; Kipideck does not need it, because the same highlights are already inside the metadata JSON." },
];

const SURVIVES = [
  { what: "Links and titles", omni: "Yes", kipi: "Yes", note: "originalUrl is used, and redirect wrappers are unwrapped so the link points at the article rather than at a dead service." },
  { what: "Labels → tags", omni: "Yes", kipi: "Yes", note: "Omnivore's labels become Kipideck tags, lower-cased and de-duplicated, and stay searchable like any other tag." },
  { what: "Save dates", omni: "Yes", kipi: "Yes", note: "savedAt becomes the item's real saved date, so years of reading stay in chronological order instead of all landing on today's date." },
  { what: "Archived state", omni: "Yes", kipi: "Yes", note: "Items with state ARCHIVED or COMPLETED arrive archived rather than being mixed into one unread pile." },
  { what: "Highlights", omni: "Yes", kipi: "Yes", note: "Each highlighted passage becomes part of the item's note, wrapped in quotation marks, so it is searchable and readable without opening the original page." },
  { what: "Annotations on highlights", omni: "Yes", kipi: "Yes", note: "A note you attached to a highlight is kept with it, in the form “quote” — your annotation." },
  { what: "Author", omni: "Yes", kipi: "Yes", note: "Carried across from the metadata and shown with the item." },
  { what: "Preview image", omni: "Yes", kipi: "Yes", note: "The image field is kept, so cards in the Library still show a thumbnail." },
  { what: "Article text", omni: "Yes, in contents/", kipi: "Yes, if you include it", note: "This is the half most people lose when they import only the metadata. Select the contents/ HTML files alongside the metadata and Kipideck rejoins each one to its item by slug." },
  { what: "Reading progress percentage", omni: "In the app", kipi: "No", note: "Omnivore's export records state, not how far through a page you were. Kipideck keeps unread versus archived and does not invent a percentage." },
  { what: "Data you never exported", omni: "Deleted", kipi: "No", note: "Nothing can recover it. The servers were wiped and no backup was kept — see the FAQ below." },
];

const COMPARE = [
  { label: "Where your library lived", omni: "Omnivore's own servers", kipi: "Your browser storage, on your device" },
  { label: "Was the code open source?", omni: "Yes — and it did not help", kipi: "The data location is what matters, not the licence" },
  { label: "Could a company delete it?", omni: "It did — 15 Nov 2024", kipi: "There is no Kipideck server to delete it from" },
  { label: "Notice before deletion", omni: "About two weeks", kipi: "Not applicable — you already hold the data" },
  { label: "Account required", omni: "Yes", kipi: "No" },
  { label: "Price", omni: "Free, then gone", kipi: "Free. No subscription, no premium tier" },
  { label: "Works offline", omni: "Partly, in the apps", kipi: "Fully — search included" },
  { label: "Getting your data out", omni: "One export window, then closed", kipi: "Any time, in three formats" },
  { label: "Sync between devices", omni: "Their cloud", kipi: "Optional, through your own Google Drive" },
];

const FAQ = [
  {
    q: "Omnivore was open source and it still died. Why would local-first be different?",
    a: "Because open source governed the software, not the data. Anyone could read, fork and self-host Omnivore's code — and forks do exist — but essentially nobody's library was in that code. It was in a PostgreSQL database on Omnivore's servers, reachable only through their API and their login. When the service was switched off, the API stopped answering and the fork had nothing to connect to. A community fork can run the same software; it cannot produce a copy of data it never held. Kipideck inverts that arrangement: the library is a file on your own device, written by your own browser, and the extension works with no server in the picture at all. That is a structural difference, not a promise about our intentions — which is why the shutdown-proof page also lists the things we cannot promise.",
  },
  {
    q: "I only kept the metadata JSON. Have I lost the articles?",
    a: "You kept everything except the text. The metadata carries your links, titles, labels, dates, author, preview image and all of your highlights and annotations — so an import of just the JSON gives you a complete, searchable library of what you saved and what you marked. What is missing is the body text of each article, which lived in contents/<slug>.html. Omnivore's export tool is gone, so that half cannot be re-downloaded from them. Import what you have now, then re-save anything you still want the text of: from here on Kipideck stores the article text when you save, so the gap closes going forward and cannot reopen.",
  },
  {
    q: "I never exported. Can I get my Omnivore library back?",
    a: "No. This is the one question with an answer we would rather give plainly than soften. The hosted service went offline on 15 November 2024 and the user data was deleted; there was no read-only archive and no grace period beyond the original window. No importer, no fork and no recovery service can retrieve data from a server that no longer has it. What you may still be able to rebuild from: any notes, Markdown files or emails where you kept links; your browser's own bookmarks (Kipideck imports Chrome's HTML export, its raw Bookmarks JSON file, and Firefox's); and whichever read-later app you moved to next — Raindrop, Instapaper, Pocket, Readwise Reader and Wallabag exports all import too.",
  },
  {
    q: "My download is a ZIP. Do I need to unzip it first?",
    a: "No — drop the ZIP straight into the import dialog. Kipideck opens it in your browser (nothing is uploaded anywhere), merges the metadata batches, rejoins each article to its metadata by slug, and de-duplicates across all of it. Unzipping by hand first and selecting the files still works too.",
  },
  {
    q: "Do I need to select the contents/ HTML files as well?",
    a: "Only if you want the article text, but that is usually the whole point of having used a read-later app. The metadata files alone give you the library's shape; the contents/ files give you the words. Select both together in one go and Kipideck matches each HTML file to its item using the slug recorded in the metadata. Anything it rejoins is reported back to you as a count, and any article file with no matching metadata and no URL of its own is reported as skipped rather than silently dropped.",
  },
  {
    q: "Will the community self-host fork bring my data back?",
    a: "No. A self-host fork is a copy of the software you run on your own machine, and running it gives you an empty library plus whatever you import into it. It is a genuinely good option if you want to keep using Omnivore's exact feature set and are comfortable standing up PostgreSQL, Elasticsearch, a content fetcher and the surrounding services. It is not a route back to the cloud data, because the fork's operators never had that data either.",
  },
  {
    q: "I have 40,000 items. Will this actually work?",
    a: "That is the size the importer was built for. Parsing runs at roughly 40,000 rows a second, writes happen in batches behind a progress bar, and the library afterwards is paginated and indexed rather than loaded into memory in one piece. Importing is also repeatable: run it again and it adds nothing, because matching is on the canonical URL rather than on the row.",
  },
  {
    q: "Does it cost anything? Is there a catch?",
    a: "No cost, no account, no analytics, no ads. Optional sync uses your own Google Drive app-data folder and your own OAuth client, which you set up yourself — Kipideck's author never sees your tokens or your data. The privacy policy lists every permission the extension asks for and what each one does.",
  },
];

export default function OmnivoreAlternativePage() {
  return (
    <PageShell>
      <h1 className="page-title">
        Omnivore was open source. It still died. Your export doesn&apos;t have to.
      </h1>
      <p className="section-lede">
        ElevenLabs acqui-hired Omnivore&apos;s team at the end of October 2024, and on{" "}
        <strong>15 November 2024</strong> the hosted service was switched off and user data was
        deleted — about two weeks after users were told to export. If you downloaded your export in
        time, that folder is still on your disk. Kipideck reads it, keeps your labels, dates,
        highlights and annotations, and rejoins the article text itself.
      </p>

      <div className="rescue-stats">
        <div className="rescue-stat">
          <b>17 days</b>
          <span>announced to deleted</span>
        </div>
        <div className="rescue-stat">
          <b>15 Nov 2024</b>
          <span>data permanently deleted</span>
        </div>
        <div className="rescue-stat">
          <b>500k+</b>
          <span>libraries affected</span>
        </div>
        <div className="rescue-stat">
          <b>0 servers</b>
          <span>holding your library now</span>
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
          The export window closed in November 2024 and there is no recovery path for data that was
          not downloaded. Everything below is for people who still have their files.
        </p>
      </div>

      <div className="doc-card">
        <h2>What is actually inside your export</h2>
        <p>
          Omnivore split your library across a few pieces, which is why importing only one of them
          feels like losing half of it. Knowing which piece holds what is the whole trick:
        </p>
        <table className="compare-table">
          <thead>
            <tr>
              <th>File</th>
              <th>What it holds</th>
            </tr>
          </thead>
          <tbody>
            {ANATOMY.map((row) => (
              <tr key={row.file}>
                <td>
                  <code>{row.file}</code>
                </td>
                <td className="muted">{row.holds}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small" style={{ marginTop: 12 }}>
          The <code>slug</code> field in the metadata is what ties the halves together — each
          article&apos;s text file is named after it. That is why the metadata and the contents
          folder have to be imported in the same pass.
        </p>
      </div>

      <div className="doc-card">
        <h2>Rescue your library in four steps</h2>
        <ol className="import-steps">
          <li>
            <h3>Find the export</h3>
            <p>
              Drop the export ZIP straight into the import dialog — it opens in your browser,
              nothing is uploaded. Inside it should be <code>metadata_0.json</code>,{" "}
              <code>metadata_1.json</code>…, a <code>contents/</code> folder full of HTML files
              (the article words — the ZIP path picks these up automatically), and a{" "}
              <code>highlights/</code> folder of Markdown you do not need to import.
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
              Kipideck recognises the format from the fields, merges the batches, and rejoins
              each article&apos;s text to its item by slug. (Unzipped by hand? Select every{" "}
              <code>metadata_*.json</code> and the <code>contents/</code> HTML files together
              instead.)
            </p>
          </li>
          <li>
            <h3>Read the preview, then import</h3>
            <p>
              You see how many items are ready, how many are already in your library, how many were
              skipped and how many had their article text recovered — before a single byte is
              written. Choose a deck, or let Kipideck file the items by type.
            </p>
          </li>
        </ol>
      </div>

      <div className="callout">
        <strong>Running it twice is safe.</strong> Matching is on the canonical URL, so a second
        import of the same export adds nothing, and items you deleted in Kipideck stay deleted even
        if the export still lists them.
      </div>

      <div className="doc-card">
        <h2>What survives the move</h2>
        <table className="compare-table">
          <thead>
            <tr>
              <th>In your Omnivore export</th>
              <th>Exported by Omnivore</th>
              <th>Kept by Kipideck</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {SURVIVES.map((row) => (
              <tr key={row.what}>
                <td>{row.what}</td>
                <td className={/deleted|in the app/i.test(row.omni) ? "" : "yes"}>{row.omni}</td>
                <td className={/^No/.test(row.kipi) ? "no" : "yes"}>{row.kipi}</td>
                <td className="muted">{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small" style={{ marginTop: 12 }}>
          The honest summary: Omnivore exported more than Pocket ever did — including the article
          text and every highlight — so an Omnivore rescue can be close to complete, provided you
          kept the <code>contents/</code> folder as well as the metadata.
        </p>
      </div>

      <div className="doc-card">
        <h2>Omnivore and Kipideck, side by side</h2>
        <table className="compare-table">
          <thead>
            <tr>
              <th> </th>
              <th>Omnivore</th>
              <th>Kipideck</th>
            </tr>
          </thead>
          <tbody>
            {COMPARE.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td className="muted">{row.omni}</td>
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
        <h2>Not arriving from Omnivore?</h2>
        <p>
          The same importer reads <a href="/pocket-alternative">Pocket</a>,{" "}
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
