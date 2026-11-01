"use client";

import { useRef, useState } from "react";
import { Camera, LoaderCircle, Trash2 } from "lucide-react";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { compressProfilePhoto } from "@/lib/profile-photo";

export function ProfilePhotoEditor({ profileId, name, avatarPath, onChanged, compact = false }: { profileId: string; name: string; avatarPath?: string | null; onChanged: (path: string | null) => void; compact?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function upload(source: File) {
    setBusy(true);
    setMessage("Compressing photo…");
    try {
      const photo = await compressProfilePhoto(source);
      setMessage(`Uploading ${(photo.size / 1024).toFixed(0)} KB photo…`);
      const form = new FormData();
      form.set("photo", photo);
      form.set("user_id", profileId);
      const response = await fetch("/api/profile/photo", { method: "POST", body: form });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The profile photo could not be uploaded.");
      onChanged(result.avatar_path as string);
      setMessage("Photo saved in low-resolution format.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "The profile photo could not be uploaded.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/profile/photo", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id: profileId }),
    });
    const result = await response.json().catch(() => ({}));
    if (response.ok) { onChanged(null); setMessage("Profile photo removed."); }
    else setMessage(result.error || "The profile photo could not be removed.");
    setBusy(false);
  }

  return <div className={`profile-photo-editor ${compact ? "compact" : ""}`}>
    <div className="profile-photo-frame">
      <ProfileAvatar id={profileId} name={name} avatarPath={avatarPath} className={compact ? "employee-avatar" : "profile-avatar"} />
      <button type="button" className="profile-photo-camera" onClick={() => inputRef.current?.click()} disabled={busy} aria-label="Choose profile photo">
        {busy ? <LoaderCircle className="spin" size={16} /> : <Camera size={16} />}
      </button>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
    </div>
    <div className="profile-photo-copy">
      {!compact && <><strong>Profile photo</strong><small>Automatically cropped to 192 × 192 and compressed below 100 KB.</small></>}
      {message && <small className="profile-photo-message" aria-live="polite">{message}</small>}
      {avatarPath && <button type="button" className="profile-photo-remove" onClick={() => void remove()} disabled={busy}><Trash2 size={13} /> Remove</button>}
    </div>
  </div>;
}
