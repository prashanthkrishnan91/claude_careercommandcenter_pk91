import type { Metadata, Viewport } from "next";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Career Command Center",
  description: "Evidence vault for your career. Stores what you enter — nothing more.",
};

export const viewport: Viewport = {
  themeColor: "#0a0d13",
  width: "device-width",
  initialScale: 1,
};

const fontStyle = `
  body { font-family: 'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif; }
  code, kbd, pre, .font-mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; }
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <style dangerouslySetInnerHTML={{ __html: fontStyle }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
