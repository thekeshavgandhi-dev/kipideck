"use client";

import { useState } from "react";
import { detectExtension, requestOpenLibrary } from "./kipideck-bridge";

// "Open My Deck" button. If the extension is installed, this asks it to open
// the USER'S OWN library (their local items + their Google Drive items).
// If not installed, it sends the visitor to /deck for guidance.
export default function OpenDeckButton({
  label = "📂 Open My Deck",
  className = "btn btn-ghost",
}) {
  const [state, setState] = useState("idle"); // idle | checking | opening

  const handleClick = async (e) => {
    e.preventDefault();
    if (state !== "idle") return;
    setState("checking");
    const { installed } = await detectExtension(1200);
    if (installed) {
      setState("opening");
      requestOpenLibrary();
      setTimeout(() => setState("idle"), 2500);
    } else {
      window.location.href = "/deck";
    }
  };

  const text =
    state === "checking"
      ? "🔍 Looking for Kipideck…"
      : state === "opening"
        ? "✅ Opening your deck…"
        : label;

  return (
    <a href="/deck" className={className} onClick={handleClick} aria-live="polite">
      {text}
    </a>
  );
}
