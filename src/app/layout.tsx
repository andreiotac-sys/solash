import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SoLash",
  description: "Programari premium pentru extensii de gene.",
  applicationName: "SoLash",
  icons: {
    icon: [
      { url: "/favicon-32-v3.png", sizes: "32x32", type: "image/png" },
      { url: "/solash-icon-192-v3.png", sizes: "192x192", type: "image/png" },
      { url: "/solash-icon-512-v3.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon-v3.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
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
    <html lang="ro" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
