"use client";

import { useEffect, useState } from "react";

// Shows the packaged extension version + size from /downloads/version.json
// (regenerated on every Vercel build). Falls back gracefully offline.
export default function VersionPill() {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/downloads/version.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setInfo(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!info) {
    return (
      <span className="version-pill" aria-live="polite">
        ⬇ Free download • No account needed
      </span>
    );
  }

  return (
    <span className="version-pill" aria-live="polite">
      ⬇ v{info.version} • {info.sizeKB} KB • Free forever • No account needed
    </span>
  );
}
