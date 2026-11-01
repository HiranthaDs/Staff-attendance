import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return {
    rules: [{ userAgent: "*", allow: ["/about"], disallow: ["/api/", "/admin", "/app", "/profile", "/super-admin", "/join/", "/branch-setup/", "/auth/", "/login", "/offline"] }],
    sitemap: `${base.replace(/\/$/, "")}/sitemap.xml`,
    host: base,
  };
}
