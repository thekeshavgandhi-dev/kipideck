// lib/extract.js
// Runs INSIDE the page (via scripting.executeScript) to pull out clean,
// readable full-text content for full-text search — not just a meta
// description snippet. Kept dependency-free and defensive since it executes
// in arbitrary, unknown pages.
export function extractPageText() {
  try {
    const skipTags = new Set([
      "SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "SVG", "CANVAS", "TEMPLATE",
      "NAV", "FOOTER", "HEADER", "FORM", "BUTTON", "ASIDE",
    ]);

    // Prefer an <article> or <main> if the page has one — usually the real content.
    const root =
      document.querySelector("article") ||
      document.querySelector("main") ||
      document.body;

    let text = "";
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (skipTags.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        const style = window.getComputedStyle(parent);
        if (style && (style.display === "none" || style.visibility === "hidden")) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let node;
    let count = 0;
    const MAX_CHARS = 20000; // cap so storage.local stays lean per item
    while ((node = walker.nextNode()) && text.length < MAX_CHARS) {
      const chunk = node.nodeValue.trim();
      if (chunk) {
        text += chunk + " ";
        count++;
      }
    }
    text = text.replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
    return { text, wordCount: count };
  } catch (e) {
    return { text: "", wordCount: 0 };
  }
}
