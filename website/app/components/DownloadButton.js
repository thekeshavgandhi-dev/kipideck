"use client";

import { useEffect, useState } from "react";
import { DOWNLOAD_URL, DOWNLOAD_FILENAME, downloadTarget, startDownload } from "./kipideck-bridge";

// Primary "Add to Chrome / Download" button. Starts the .zip download from
// this same website (no store needed) and then scrolls the visitor
// down to the 1-minute install steps.
//
// The href starts as the Chromium package so the server-rendered HTML matches
// the first client render; on mount it switches to the Firefox package when
// Firefox is the browser asking. Shipping Firefox the Chromium package would
// give it an extension with no background context at all.
export default function DownloadButton({
  label = "⬇ Add to Chrome — it's free",
  firefoxLabel = "⬇ Add to Firefox — it's free",
  className = "btn btn-primary",
  scrollTo = "install",
}) {
  const [target, setTarget] = useState({ url: DOWNLOAD_URL, filename: DOWNLOAD_FILENAME });
  const [isFirefox, setIsFirefox] = useState(false);

  useEffect(() => {
    const t = downloadTarget();
    setTarget(t);
    setIsFirefox(t.url !== DOWNLOAD_URL);
  }, []);

  const handleClick = (e) => {
    e.preventDefault();
    startDownload();
    if (scrollTo) {
      // Let the download start first, then guide the eye to the steps.
      setTimeout(() => {
        document.getElementById(scrollTo)?.scrollIntoView({ behavior: "smooth" });
      }, 350);
    }
  };

  return (
    <a
      href={target.url}
      download={target.filename}
      className={className}
      onClick={handleClick}
    >
      {isFirefox ? firefoxLabel : label}
    </a>
  );
}
