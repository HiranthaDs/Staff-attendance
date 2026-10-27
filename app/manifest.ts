import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Presence · Office Attendance",
    short_name: "Presence",
    description: "Secure, effortless attendance and leave management.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f7f5",
    theme_color: "#0d493d",
    orientation: "portrait-primary",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/icon-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/maskable-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
