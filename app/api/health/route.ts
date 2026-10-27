import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { error } = await createAdminClient()
      .from("attendance_challenges")
      .select("id")
      .limit(1);
    if (error) {
      const migrationRequired = error.code === "PGRST205";
      return NextResponse.json({
        status: migrationRequired ? "setup_required" : "degraded",
        runtime: "nodejs",
        verifier: "integrated",
        database: migrationRequired ? "migration_required" : "unavailable",
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
    version: "3.0.0",
  }, { headers: { "cache-control": "no-store" } });
}
