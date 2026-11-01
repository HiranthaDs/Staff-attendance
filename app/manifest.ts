import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Presence · Office Attendance",
    short_name: "Presence",
    description: "Secure office attendance, leave, staff calendars and workforce operations.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#e9eee8",
    theme_color: "#e9eee8",
    orientation: "portrait-primary",
    categories: ["business", "productivity"],
    shortcuts: [
      { name: "Mark attendance", short_name: "Attendance", description: "Open today's secure attendance", url: "/app#home", icons: [{ src: "/icons/presence-192-v2.png", sizes: "192x192", type: "image/png" }] },
      { name: "Staff calendar", short_name: "Calendar", description: "Open attendance and leave calendar", url: "/app#calendar", icons: [{ src: "/icons/presence-192-v2.png", sizes: "192x192", type: "image/png" }] },
      { name: "Request leave", short_name: "Leave", description: "Open leave requests", url: "/app#leave", icons: [{ src: "/icons/presence-192-v2.png", sizes: "192x192", type: "image/png" }] },
    ],
    icons: [
      { src: "/icons/presence-192-v2.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/presence-512-v2.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/presence-maskable-512-v2.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-192.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/icon-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/maskable-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
