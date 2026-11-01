import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  return [{ url: `${base}/about`, lastModified: new Date(), changeFrequency: "monthly", priority: 1 }];
}
