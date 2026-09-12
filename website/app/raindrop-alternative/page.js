import PageShell from "../components/PageShell";
import DownloadButton from "../components/DownloadButton";

export const metadata = {
  title: "A local copy of your Raindrop library — and a way out if you leave",
  description:
    "Raindrop is good software and we are not going to pretend otherwise. Keep it. Kipideck reads the same backup JSON you already make — tags, collections, notes, highlights, types and dates — so you can hold a second copy that needs no subscription and no server, or migrate properly if you decide to go.",
  openGraph: {
    title: "Keep Raindrop. Also keep a copy nobody can take away.",
    description:
      "Import a Raindrop backup JSON into a local-first library: tags, collections, notes, highlights, types and created dates preserved. Re-importing the same backup adds nothing, so it works as a repeating mirror.",
    type: "website",
  },
};

const SURVIVES = [
  { what: "Links and titles", rain: "Yes", kipi: "Yes", note: "The link field is used, with redirect wrappers unwrapped so saved links point at the real destination." },
  { what: "Tags", rain: "Yes", kipi: "Yes", note: "Lower-cased and de-duplicated, and they stay searchable alongside everything else." },
  { what: "Collections → tags", rain: "Yes", kipi: "Yes", note: "A collection's title becomes a tag, and nested collection paths are split on “/” so each level arrives separately. There is a checkbox to turn this off." },
  { what: "Notes", rain: "Yes", kipi: "Yes", note: "Your note is kept on the item and is searchable, not stranded in a separate field." },
  { what: "Highlights", rain: "Yes", kipi: "Yes", note: "Every highlighted passage is appended to the item's note in quotation marks, with any annotation you wrote kept underneath it." },
  { what: "Important → favourite", rain: "Yes", kipi: "Yes", note: "Items you marked important arrive as favourites, and get a “favorite” tag so they are filterable too." },
  { what: "Type (article, image, video…)", rain: "Yes", kipi: "Yes", note: "Link, article, image, video, document, audio and book are recognised; anything else is left unset rather than guessed." },
  { what: "Created and updated dates", rain: "Yes", kipi: "Yes", note: "created becomes the saved date and lastUpdate the edited date, so your library keeps its real chronology instead of the import date." },
  { what: "Cover image", rain: "Yes", kipi: "Yes", note: "The cover, or the first media item if there is no cover, is kept so cards still render a thumbnail." },
  { what: "Cached article text", rain: "On paid plans", kipi: "If it is in the backup", note: "Raindrop only stores full page text for some plan tiers. If your backup contains it, Kipideck indexes it for search; if not, there is nothing to import." },
  { what: "Broken-link status", rain: "Yes", kipi: "Flagged", note: "Items Raindrop already knows to be broken are marked rather than silently imported as healthy." },
];

const COMPARE = [
  { label: "Status", rain: "Actively developed", kipi: "Actively developed" },
  { label: "Where your library lives", rain: "Raindrop's servers, plus their apps", kipi: "Your browser storage, on your device" },
  { label: "Works with no account", rain: "No", kipi: "Yes" },
  { label: "Price", rain: "Free plan; some features need a paid plan", kipi: "Free. No subscription, no premium tier" },
  { label: "Reading it offline", rain: "Partly, depending on plan", kipi: "Fully — search included" },
  { label: "Export your data", rain: "Yes, JSON backup", kipi: "Yes, three formats, any time" },
  { label: "Import someone else's data", rain: "Yes", kipi: "Yes — 13 formats" },
  { label: "Sync target", rain: "Their cloud", kipi: "Optional, through your own Google Drive" },
  { label: "Source code", rain: "Closed source", kipi: "Open — every file is in the repository" },
];

const FAQ = [
  {
    q: "Is Kipideck trying to replace Raindrop?",
    a: "Not necessarily, and we would rather say so than write a hit job on good software. Raindrop is actively developed, it does things Kipideck does not, and plenty of people should keep paying for it. The honest pitch is narrower: your Raindrop library exists on someone else's servers and is reachable through your account. A local copy that needs no subscription and no server costs you nothing to maintain — you already take the backup — and it means the library outlives any single company's decisions. Keep both if that is useful to you; the import is repeatable precisely so the two can stay in step.",
  },
  {
    q: "How do I make the backup file?",
    a: "In Raindrop: Settings → Backups → Create backup, then download the JSON. That is the same file you would use to restore your own account, which is the point — it is not a special export we talked anyone into supporting, it is the file you should already be making. Then in Kipideck: Library → ⬆ Import → select the JSON.",
  },
  {
    q: "Can I re-import a newer backup later without creating duplicates?",
    a: "Yes, and this is the behaviour that makes it usable as a mirror rather than a one-off migration. Matching is on the canonical URL, so importing a fresh backup adds the items that are new to it, updates the ones that changed, and adds nothing for everything already present. Importing the exact same file twice is a no-op. Deletions work the same way in your favour: an item you deleted in Kipideck stays deleted, because tombstones now carry the canonical URL and cannot be resurrected by a re-import.",
  },
  {
    q: "What happens to my collections?",
    a: "By default each collection becomes a tag on the items inside it, and a nested collection path is split so every level arrives as its own tag. Tags are what Kipideck filters and searches on, so this usually preserves the structure you were actually using. If you would rather not, uncheck “Turn source folders and collections into tags” in the import dialog, or send the whole import to a single deck instead of auto-organising it.",
  },
  {
    q: "Will my highlights survive?",
    a: "Yes. Every highlight is written into the item's note as a quoted passage, and any annotation you attached to a highlight is kept with it, formatted as the quote followed by your note. They are then full-text searchable like everything else in the library, so you can find a passage you remember without remembering which article it was in.",
  },
  {
    q: "What won't come across?",
    a: "The things that only exist inside Raindrop's product rather than in the data: collaborators and shared-collection permissions, reminders, RSS rules, and the UI state of your collections. Full article text is included only if it is in your backup, which depends on your Raindrop plan. Raindrop's own pricing and which features sit behind which tier changes over time, so check their site for the current picture rather than trusting a table on a competitor's page — including this one.",
  },
  {
    q: "If I import, do I have to stop using Raindrop?",
    a: "No. Nothing about the import touches your Raindrop account; it reads a file you already downloaded. Plenty of people will sensibly keep Raindrop as their main library and treat Kipideck as the offline copy that cannot be switched off. If you later decide to move properly, the migration is already done — the copy is on your disk, and you can export it again in three open formats whenever you like.",
  },
];

export default function RaindropAlternativePage() {
  return (
    <PageShell>
      <h1 className="page-title">
        Keep Raindrop. Also keep a copy nobody can take away.
      </h1>
      <p className="section-lede">
        Raindrop is good software, actively developed, and worth paying for if it fits how you work
        — we are not going to pretend otherwise to win a click. This page is about a narrower thing:{" "}
        <strong>the backup file you already make</strong> can also be a complete library of your own,
        on your own device, that needs no subscription and no server. Keep both, or use it as the
        migration path if you decide to leave.
      </p>

      <div className="rescue-stats">
        <div className="rescue-stat">
          <b>1 file</b>
          <span>the backup you already take</span>
        </div>
        <div className="rescue-stat">
          <b>0 duplicates</b>
          <span>on a second import</span>
        </div>
        <div className="rescue-stat">
          <b>13 formats</b>
          <span>the importer reads</span>
        </div>
        <div className="rescue-stat">
          <b>0 servers</b>
          <span>holding your copy</span>
        </div>
      </div>

      <div className="doc-card">
        <h2>Mirror your library in three steps</h2>
        <ol className="import-steps">
          <li>
            <h3>Settings → Backups → Create backup</h3>
            <p>
              Download the JSON. This is the same file you would use to restore your own account,
              which is exactly why it is worth doing — you are not making an export for Kipideck&apos;s
              benefit, you are making the backup you should already have.
            </p>
          </li>
          <li>
            <h3>Install Kipideck and open Library → ⬆ Import</h3>
            <p>
              Free, no account, works in Chrome, Edge, Brave, Opera and Firefox. Select the backup
              JSON; Kipideck recognises the format from its fields.
            </p>
          </li>
          <li>
            <h3>Read the preview, then import</h3>
            <p>
              You see how many items are ready, how many are already in your library and how many
              were skipped before anything is written. Then pick a deck, or let Kipideck file items
              by type. Next month, import the newer backup and only the differences arrive.
            </p>
          </li>
        </ol>
      </div>

      <div className="callout">
        <strong>This works as a repeating mirror, not just a one-way exit.</strong> Matching is on
        the canonical URL, so re-importing a fresh backup adds what is new, updates what changed, and
        adds nothing for everything already present. Importing the same file twice is a no-op.
      </div>

      <div className="doc-card">
        <h2>What survives the import</h2>
        <table className="compare-table">
          <thead>
            <tr>
              <th>In your Raindrop backup</th>
              <th>Exported by Raindrop</th>
              <th>Kept by Kipideck</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {SURVIVES.map((row) => (
              <tr key={row.what}>
                <td>{row.what}</td>
                <td className={/on paid plans/i.test(row.rain) ? "" : "yes"}>{row.rain}</td>
                <td className={/^No$/.test(row.kipi) ? "no" : "yes"}>{row.kipi}</td>
                <td className="muted">{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small" style={{ marginTop: 12 }}>
          The honest summary: Raindrop&apos;s backup is unusually complete, so most of what you would
          miss is product state — collaborators, reminders, RSS rules — rather than your actual saved
          material.
        </p>
      </div>

      <div className="doc-card">
        <h2>Raindrop and Kipideck, side by side</h2>
        <table className="compare-table">
          <thead>
            <tr>
              <th> </th>
              <th>Raindrop</th>
              <th>Kipideck</th>
            </tr>
          </thead>
          <tbody>
            {COMPARE.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td className="muted">{row.rain}</td>
                <td>{row.kipi}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small" style={{ marginTop: 12 }}>
          We have deliberately left pricing vague on our side of this table. Raindrop&apos;s plans
          change, and a comparison page quietly quoting a stale number is worse than one that tells
          you to check. We will not claim a feature of theirs is missing or paywalled without
          verifying it, and this page will not name a price we cannot keep current.
        </p>
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
        <h2>The part that matters if you do leave</h2>
        <p>
          Whichever way you decide, the copy you make is yours in a form you can read without us.
          Kipideck exports the whole library — including full text, notes, tags and decks — as JSON,
          as Netscape bookmark HTML that every browser and most read-later apps will import, and as a
          folder of Markdown. That guarantee, and the things we explicitly cannot promise, are written
          out on the <a href="/shutdown-proof">shutdown-proof pledge</a>.
        </p>
        <p className="muted small">
          Not arriving from Raindrop? The same importer reads{" "}
          <a href="/pocket-alternative">Pocket</a>,{" "}
          <a href="/omnivore-alternative">Omnivore</a>, Instapaper, Pinboard, Wallabag, Readwise
          Reader, browser bookmarks and plain lists of URLs.
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
