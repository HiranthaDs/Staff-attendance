import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiActor } from "@/lib/api-auth";
import { isTrustedMutationOrigin } from "@/lib/attendance-backend";
import { databaseMutationError } from "@/lib/database-errors";

export async function PATCH(request: Request) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const actor = await getApiActor();
  if ("error" in actor) return actor.error;
  const parsed = z.object({ id: z.string().uuid() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid missed-attendance notice." }, { status: 400 });
  const result = await actor.admin.from("attendance_absences")
    .update({ acknowledged_at: new Date().toISOString() })
    .eq("id", parsed.data.id)
    .eq("user_id", actor.user.id)
    .select("*")
    .maybeSingle();
  if (result.error) return databaseMutationError(result.error, "The notice could not be acknowledged.");
  if (!result.data) return NextResponse.json({ error: "The missed-attendance notice was not found." }, { status: 404 });
  return NextResponse.json({ absence: result.data });
}
