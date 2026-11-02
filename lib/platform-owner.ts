import "server-only";
import type { Profile } from "@/lib/types";

function configuredOwnerEmail() {
  return process.env.PLATFORM_OWNER_EMAIL?.trim().toLowerCase() || "";
}

export function isPlatformOwnerEmail(email: string | null | undefined) {
  const ownerEmail = configuredOwnerEmail();
  return Boolean(ownerEmail && email?.trim().toLowerCase() === ownerEmail);
}

export function isPlatformOwnerProfile(profile: Pick<Profile, "role" | "email" | "organization_id">) {
  return profile.role === "super_admin"
    && profile.organization_id === null
    && isPlatformOwnerEmail(profile.email);
}
