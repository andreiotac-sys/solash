import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SoLash",
    short_name: "SoLash",
    description: "Programari premium pentru extensii de gene.",
    start_url: "/",
    display: "standalone",
    background_color: "#050505",
    theme_color: "#050505",
    lang: "ro",
    orientation: "portrait",
  };
}
