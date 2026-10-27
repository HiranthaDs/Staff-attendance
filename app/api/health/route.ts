import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const admin = createAdminClient();
    const [{ error: profileError }, { error: attendanceError }, { error: branchError }] = await Promise.all([
      admin.from("profiles").select("id").limit(1),
      admin.from("attendance_records").select("id").limit(1),
      admin.from("branches").select("id").limit(1),
    ]);
    const baseError = profileError || attendanceError || branchError;
    if (baseError) {
      return NextResponse.json({
        status: "degraded",
        runtime: "nodejs",
        verifier: "integrated",
        database: "unavailable",
        code: baseError.code,
      }, { status: 503, headers: { "cache-control": "no-store" } });
    }

    const [{ error: challengeError }, { error: calendarError }, { error: policyError }] = await Promise.all([
      admin.from("attendance_challenges").select("id").limit(1),
      admin.from("calendar_notes").select("id").limit(1),
      admin.from("branches").select("id, early_leave_grace_minutes").limit(1),
    ]);
    const error = challengeError || calendarError || policyError;
    if (error) {
      const migrationRequired = ["PGRST202", "PGRST204", "PGRST205", "42703"].includes(error.code);
      if (migrationRequired) {
        return NextResponse.json({
          status: "ok",
          runtime: "nodejs",
          verifier: "integrated",
          database: "compatibility",
          migration: "recommended",
        }, { headers: { "cache-control": "no-store" } });
      }
      return NextResponse.json({
        status: "degraded",
        runtime: "nodejs",
        verifier: "integrated",
        database: "unavailable",
        code: error.code,
      }, { status: 503, headers: { "cache-control": "no-store" } });
    }
  } catch {
    return NextResponse.json({
      status: "degraded",
      runtime: "nodejs",
      verifier: "integrated",
      database: "unavailable",
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  return NextResponse.json({
    status: "ok",
    runtime: "nodejs",
    verifier: "integrated",
    database: "ready",
    version: "4.0.0",
  }, { headers: { "cache-control": "no-store" } });
}
