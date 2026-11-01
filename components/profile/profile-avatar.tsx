"use client";
/* eslint-disable @next/next/no-img-element -- Private, authenticated redirect URLs are intentionally rendered as tiny native images. */

import { useState } from "react";

export function ProfileAvatar({ id, name, avatarPath, className = "" }: { id: string; name: string; avatarPath?: string | null; className?: string }) {
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const showImage = Boolean(avatarPath) && failedPath !== avatarPath;
  return <span className={`avatar profile-image-avatar ${className}`.trim()} aria-label={`${name}'s profile photo`}>
    {showImage
      ? <img src={`/api/profile/photo/${id}?v=${encodeURIComponent(avatarPath || "")}`} alt="" loading="lazy" decoding="async" onError={() => setFailedPath(avatarPath || "missing")} />
      : initials(name)}
  </span>;
}
function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
}
