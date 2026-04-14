import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SoLash",
  description: "Programari premium pentru extensii de gene.",
  applicationName: "SoLash",
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
