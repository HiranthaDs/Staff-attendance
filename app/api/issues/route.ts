import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiActor, getApiAdmin } from "@/lib/api-auth";
import { isTrustedMutationOrigin } from "@/lib/attendance-backend";
import { databaseMutationError } from "@/lib/database-errors";
import { notifyUsers } from "@/lib/notifications";

const createSchema = z.object({
  category: z.enum(["attendance", "location", "leave", "schedule", "payroll", "app", "other"]),
  message: z.string().trim().min(4).max(1000),
  context: z.record(z.string(), z.unknown()).optional().default({}),
});

export async function GET() {
  const actor = await getApiAdmin();
  if ("error" in actor) return actor.error;
  const result = await actor.admin.from("support_issues")
    .select("*, reporter:profiles!support_issues_reporter_id_fkey(full_name,employee_code)")
    .order("created_at", { ascending: false })
    .limit(50);
  if (result.error) return databaseMutationError(result.error, "Issue reports could not be loaded.");
  return NextResponse.json({ issues: result.data ?? [] });
}

export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const actor = await getApiActor();
  if ("error" in actor) return actor.error;
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Describe the problem so an administrator can help." }, { status: 400 });
  const result = await actor.admin.from("support_issues").insert({ reporter_id: actor.user.id, ...parsed.data }).select("*").single();
  if (result.error) return databaseMutationError(result.error, "The issue report could not be sent.");
  const { data: admins } = await actor.admin.from("profiles").select("id").eq("role", "super_admin").eq("active", true);
  await notifyUsers({
    recipientIds: (admins ?? []).map((admin) => admin.id),
    kind: "system",
    title: `Staff issue: ${parsed.data.category}`,
    body: `${actor.profile.full_name}: ${parsed.data.message}`,
    actionUrl: "/admin",
    dedupeKey: `support-issue:${result.data.id}`,
  });
  return NextResponse.json({ issue: result.data }, { status: 201 });
}

export async function PATCH(request: Request) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const actor = await getApiAdmin();
  if ("error" in actor) return actor.error;
  const parsed = z.object({ id: z.string().uuid(), status: z.literal("resolved") }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid issue report." }, { status: 400 });
  const result = await actor.admin.from("support_issues").update({ status: "resolved", resolved_by: actor.user.id, resolved_at: new Date().toISOString() }).eq("id", parsed.data.id).select("*, reporter:profiles!support_issues_reporter_id_fkey(full_name,employee_code)").single();
  if (result.error) return databaseMutationError(result.error, "The issue report could not be resolved.");
  return NextResponse.json({ issue: result.data });
}
