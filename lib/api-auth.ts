import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyCurrentStaffDevice } from "@/lib/staff-device-security";
import { isPlatformOwnerProfile } from "@/lib/platform-owner";
import type { Profile } from "@/lib/types";

export async function getApiActor() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { error: NextResponse.json({ error: "Your session has expired." }, { status: 401 }) };
  }

  const serviceAdmin = createAdminClient();
  const { data: profile } = await serviceAdmin
    .from("profiles")
    .select("*, branch:branches(*), organization:organizations(*)")
    .eq("id", data.user.id)
    .single();

  if (!profile || !profile.active) {
    return { error: NextResponse.json({ error: "This account is not active." }, { status: 403 }) };
  }

  if (profile.organization && profile.organization.status !== "active") {
    return { error: NextResponse.json({ error: "This company workspace is suspended." }, { status: 403 }) };
  }

  if ((profile.role === "staff" || profile.role === "branch_admin") && !await verifyCurrentStaffDevice(data.user.id)) {
    return { error: NextResponse.json({
      error: "This attendance account is not authorized on this device.",
      code: "device_verification_failed",
    }, { status: 403, headers: { "cache-control": "no-store" } }) };
  }

  // Database work uses the caller's session so PostgreSQL RLS remains the final tenant boundary.
  // The service client is reserved for Supabase Auth administration and platform-only operations.
  return { user: data.user, profile: profile as Profile, admin: supabase, serviceAdmin, sessionClient: supabase };
}

export async function getApiAdmin() {
  const result = await getApiActor();
  if ("error" in result) return result;
  if (result.profile.role !== "company_admin" && result.profile.role !== "branch_admin") {
    return { error: NextResponse.json({ error: "Company administrator access required." }, { status: 403 }) };
  }
  return result;
}


export async function getApiSuperAdmin() {
  const result = await getApiActor();
  if ("error" in result) return result;
  if (!isPlatformOwnerProfile(result.profile)) {
    return { error: NextResponse.json({ error: "System-owner access required." }, { status: 403 }) };
  }
  return result;
}

export const getApiSystemOwner = getApiSuperAdmin;
