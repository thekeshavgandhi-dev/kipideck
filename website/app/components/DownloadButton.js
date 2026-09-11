"use client";

import { DOWNLOAD_URL, DOWNLOAD_FILENAME, startDownload } from "./kipideck-bridge";

// Primary "Add to Chrome / Download" button. Starts the .zip download from
// this same website (no store needed) and then scrolls the visitor
// down to the 1-minute install steps.
export default function DownloadButton({
  label = "⬇ Add to Chrome — it's free",
  className = "btn btn-primary",
  scrollTo = "install",
}) {
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
      href={DOWNLOAD_URL}
      download={DOWNLOAD_FILENAME}
      className={className}
      onClick={handleClick}
    >
      {label}
    </a>
  );
}
