import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SoLash",
    short_name: "SoLash",
    description: "Programari premium pentru extensii de gene.",
    start_url: "/",
    display: "standalone",
    background_color: process.env.NEXT_PUBLIC_SOLASH_NEW_UI === "false" ? "#050505" : "#0d0e10",
    theme_color: process.env.NEXT_PUBLIC_SOLASH_NEW_UI === "false" ? "#050505" : "#0d0e10",
    lang: "ro",
    orientation: "portrait",
    icons: [
      {
        src: "/solash-icon-192-v3.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/solash-icon-512-v3.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
