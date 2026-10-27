import { NextResponse } from "next/server";

type DatabaseErrorLike = { code?: string | null } | null;

export function isMigrationRequired(error: DatabaseErrorLike) {
  return error?.code === "PGRST202" || error?.code === "PGRST204" || error?.code === "PGRST205" || error?.code === "42703";
}

export function databaseMutationError(error: DatabaseErrorLike, fallback: string) {
  if (isMigrationRequired(error)) {
    return NextResponse.json({
      error: "Database upgrade required. Run `npm run db:migrate` with the Supabase database password, then restart the app.",
      code: "DATABASE_MIGRATION_REQUIRED",
    }, { status: 503 });
  }
  return NextResponse.json({ error: fallback }, { status: 500 });
}
