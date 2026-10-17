import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./redesign.css";

const newUI = process.env.NEXT_PUBLIC_SOLASH_NEW_UI !== "false";
const iconVersion = newUI ? "v4" : "v3";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: process.env.NEXT_PUBLIC_SOLASH_NEW_UI === "false" ? "#090806" : "#fff9f7",
};

export const metadata: Metadata = {
  title: "SoLash",
  description: "Programari premium pentru extensii de gene.",
  applicationName: "SoLash",
  icons: {
    icon: [
      { url: `/favicon-32-${iconVersion}.png`, sizes: "32x32", type: "image/png" },
      { url: `/solash-icon-192-${iconVersion}.png`, sizes: "192x192", type: "image/png" },
      { url: `/solash-icon-512-${iconVersion}.png`, sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: `/apple-touch-icon-${iconVersion}.png`, sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: process.env.NEXT_PUBLIC_SOLASH_NEW_UI === "false" ? "black-translucent" : "default",
    title: "SoLash",
  },
  formatDetection: {
    telephone: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ro" className={`h-full antialiased${newUI ? " solash-light-theme" : ""}`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
