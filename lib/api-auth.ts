import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Profile } from "@/lib/types";

export async function getApiActor() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { error: NextResponse.json({ error: "Your session has expired." }, { status: 401 }) };
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("*, branch:branches(*)")
    .eq("id", data.user.id)
    .single();

  if (!profile || !profile.active) {
    return { error: NextResponse.json({ error: "This account is not active." }, { status: 403 }) };
  }

  return { user: data.user, profile: profile as Profile, admin, sessionClient: supabase };
}

export async function getApiAdmin() {
  const result = await getApiActor();
  if ("error" in result) return result;
  if (result.profile.role !== "super_admin") {
    return { error: NextResponse.json({ error: "Super administrator access required." }, { status: 403 }) };
  }
  return result;
}
