import "./globals.css";

export const metadata = {
  title: "Kipideck — Save anything. It organizes itself.",
  description:
    "Kipideck is a browser extension for Chrome, Edge, Brave, Opera and Firefox that saves pages, links, images and selected text with one right-click, auto-organizes them into decks, makes everything searchable, and optionally syncs across devices through your own Google Drive.",
  icons: {
    icon: "/favicon.ico",
  },
  metadataBase: new URL("https://kipideck.vercel.app"),
  openGraph: {
    title: "Kipideck — Save anything. It organizes itself.",
    description:
      "Right-click any page, link, image, or selected text and save it — auto-organized, searchable, and synced across every browser.",
    images: ["/assets/hero-screenshot.png"],
    type: "website",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
