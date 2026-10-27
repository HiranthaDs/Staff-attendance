import { NextResponse } from "next/server";
import { z } from "zod";
import { isTrustedMutationOrigin } from "@/lib/attendance-backend";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const schema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});

export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) {
    return NextResponse.json({ error: "This sign-in request did not come from the app." }, { status: 403 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email address and password." }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
    if (error || !data.user) {
      const throttled = error?.status === 429;
      const unavailable = !error?.status || error.status >= 500;
      return NextResponse.json({
        error: unavailable
          ? "The sign-in service could not be reached. Please try again in a moment."
          : throttled
          ? "Too many sign-in attempts. Wait a moment and try again."
          : "Email or password is incorrect. Please try again.",
      }, { status: unavailable ? 503 : throttled ? 429 : 401 });
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, active, must_reset_password")
      .eq("id", data.user.id)
      .single();

    if (profileError || !profile) {
      await supabase.auth.signOut();
      return NextResponse.json({ error: "This account is not connected to an employee profile. Contact your administrator." }, { status: 403 });
    }
    if (!profile.active) {
      await supabase.auth.signOut();
      return NextResponse.json({ error: "This account has been disabled." }, { status: 403 });
    }

    const redirectTo = profile.must_reset_password
      ? "/auth/update-password"
      : profile.role === "super_admin" ? "/admin" : "/app";
    return NextResponse.json({ success: true, redirectTo }, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json({
      error: "The sign-in service could not be reached. Please try again in a moment.",
    }, { status: 503 });
  }
}
