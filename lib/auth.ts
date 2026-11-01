import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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

export async function requireProfile() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.active) redirect("/login?error=account_disabled");
  if (profile.organization && profile.organization.status !== "active") redirect("/login?error=company_suspended");
  if (profile.must_reset_password) redirect("/auth/update-password");
  return profile;
}

export async function requireAdmin() {
  const profile = await requireProfile();
  if (profile.role !== "company_admin" && profile.role !== "branch_admin") redirect(profile.role === "super_admin" ? "/super-admin" : "/app");
  return profile;
}

export async function requireSuperAdmin() {
  const profile = await requireProfile();
  if (profile.role !== "super_admin") redirect(profile.role === "company_admin" || profile.role === "branch_admin" ? "/admin" : "/app");
  return profile;
}
