"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  detectExtension,
  requestItemCount,
  requestOpenLibrary,
  startDownload,
} from "./kipideck-bridge";

// Full "Open My Deck" experience for the /deck page:
//  1. detects the installed extension,
//  2. shows the user's saved-item count,
//  3. opens THEIR library (local + Drive-synced) on click,
//  4. falls back to download + install steps when not installed.
export default function DeckOpener() {
  const [status, setStatus] = useState("checking"); // checking | found | missing
  const [version, setVersion] = useState("");
  const [count, setCount] = useState(null);
  const [opening, setOpening] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const check = useCallback(async () => {
    setStatus("checking");
    setCount(null);
    const { installed, version: v } = await detectExtension(1800);
    if (!mounted.current) return;
    if (installed) {
      setVersion(v);
      setStatus("found");
      const n = await requestItemCount(1500);
      if (mounted.current) setCount(n);
    } else {
      setStatus("missing");
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  const handleOpen = () => {
    setOpening(true);
    requestOpenLibrary();
    setTimeout(() => {
      if (mounted.current) setOpening(false);
    }, 3000);
  };

  if (status === "checking") {
    return (
      <div className="deck-status-card">
        <div className="spinner" aria-hidden="true" />
        <h2>Looking for Kipideck on this browser…</h2>
        <p className="muted">Checking whether the extension is installed here.</p>
      </div>
    );
  }

  if (status === "found") {
    return (
      <div className="deck-status-card success">
        <div className="card-ico big">✅</div>
        <h2>Kipideck is installed — welcome back!</h2>
        <p className="muted">
          {count === null
            ? "Loading your library…"
            : count === 0
              ? "Your deck is empty so far — save your first item with a right-click → Save to Kipi."
              : `You have ${count} saved item${count === 1 ? "" : "s"} in this browser${
                  version ? ` (extension v${version})` : ""
                }.`}
        </p>
        <p className="muted small">
          Opening your deck shows everything saved on <strong>this device</strong>
          {` `}plus anything synced in from your other browsers via your own Google
          Drive (if you enabled sync in Settings).
        </p>
        <div className="hero-ctas center">
          <button className="btn btn-primary" onClick={handleOpen}>
            {opening ? "✅ Opening your deck…" : "📂 Open My Deck now"}
          </button>
          <button className="btn btn-ghost" onClick={check}>
            ↻ Re-check
          </button>
        </div>
        <p className="muted tiny">
          Nothing opened? Click the 🧩 puzzle icon in your toolbar, pin Kipideck, then
          click it → ⤢. Or press Ctrl+Shift+L (Cmd+Shift+L on Mac).
        </p>
      </div>
    );
  }

  return (
    <div className="deck-status-card">
      <div className="card-ico big">📭</div>
      <h2>Kipideck isn&apos;t installed in this browser yet</h2>
      <p className="muted">
        Your deck lives <strong>inside the extension</strong> on your device (and
        optionally in your own Google Drive) — this website just opens it for you.
        Install the extension first, then come back here.
      </p>
      <div className="hero-ctas center">
        <button
          className="btn btn-primary"
          onClick={() => {
            startDownload();
            document.getElementById("deck-install-steps")?.scrollIntoView({ behavior: "smooth" });
          }}
        >
          ⬇ Download Kipideck — free
        </button>
        <button className="btn btn-ghost" onClick={check}>
          ↻ I installed it — check again
        </button>
      </div>
    </div>
  );
}
