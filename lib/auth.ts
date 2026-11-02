import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyCurrentStaffDevice } from "@/lib/staff-device-security";
import { isPlatformOwnerProfile } from "@/lib/platform-owner";
import type { Profile } from "@/lib/types";

export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;

  const { data } = await supabase
    .from("profiles")
    .select("*, branch:branches(*), organization:organizations(*)")
    .eq("id", userId)
    .single();
  return data as Profile | null;
}

export async function requireProfile(loginPath = "/login") {
  const profile = await getCurrentProfile();
  if (!profile) redirect(loginPath);
  if (!profile.active) redirect(`${loginPath}?error=account_disabled`);
  if (profile.organization && profile.organization.status !== "active") redirect(`${loginPath}?error=company_suspended`);
  if ((profile.role === "staff" || profile.role === "branch_admin") && !await verifyCurrentStaffDevice(profile.id)) {
    redirect(`${loginPath}?error=device_required`);
  }
  if (profile.must_reset_password) redirect("/auth/update-password");
  return profile;
}

export async function requireAdmin() {
  const profile = await requireProfile();
  if (profile.role !== "company_admin" && profile.role !== "branch_admin") redirect(profile.role === "super_admin" ? "/system-owner" : "/app");
  return profile;
}

export async function requireSuperAdmin() {
  const profile = await requireProfile("/system-owner/login");
  if (!isPlatformOwnerProfile(profile)) redirect(profile.role === "company_admin" || profile.role === "branch_admin" ? "/admin" : "/app");
  return profile;
}

export const requireSystemOwner = requireSuperAdmin;
