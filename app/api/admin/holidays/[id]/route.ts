import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiAdmin } from "@/lib/api-auth";
import { isTrustedMutationOrigin } from "@/lib/attendance-backend";
import { databaseMutationError, isMigrationRequired } from "@/lib/database-errors";
import { notifyUsers } from "@/lib/notifications";
import { loadCompatibilityHolidays, saveCompatibilityHoliday } from "@/lib/holiday-store";
import type { CompanyHoliday } from "@/lib/types";

const schema = z.object({
  status: z.enum(["approved", "rejected", "cancelled"]),
  review_note: z.string().trim().max(500).optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const actor = await getApiAdmin();
  if ("error" in actor) return actor.error;
  const id = z.string().uuid().safeParse((await context.params).id);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!id.success || !parsed.success) return NextResponse.json({ error: "Choose a valid holiday decision." }, { status: 400 });

  const existingResult = await actor.admin.from("company_holidays").select("*").eq("id", id.data).maybeSingle();
  const rawExisting = (existingResult.data ?? (isMigrationRequired(existingResult.error) ? (await loadCompatibilityHolidays()).find((holiday) => holiday.id === id.data) : null)) as CompanyHoliday | null;
  const existing = rawExisting ? { ...rawExisting, end_date: rawExisting.end_date || rawExisting.holiday_date } : null;
  if (!existing) return NextResponse.json({ error: "The holiday request was not found." }, { status: 404 });
  if (existing.source === "official") return NextResponse.json({ error: "Gazetted holidays cannot be changed here." }, { status: 409 });
  if (existing.status !== "pending" && parsed.data.status !== "cancelled") {
    return NextResponse.json({ error: "This holiday request has already been reviewed." }, { status: 409 });
  }
  const update = await actor.admin.from("company_holidays").update({
    status: parsed.data.status,
    review_note: parsed.data.review_note || null,
    reviewed_by: actor.user.id,
    reviewed_at: new Date().toISOString(),
  }).eq("id", id.data).select("*, branch:branches(id,name,code), proposer:profiles!company_holidays_proposed_by_fkey(full_name,employee_code)").single();
  let holiday = update.data as CompanyHoliday | null;
  const legacyRangeSchema = Boolean(existingResult.data && !("end_date" in existingResult.data));
  if ((update.error && isMigrationRequired(update.error)) || legacyRangeSchema) {
    holiday = await saveCompatibilityHoliday({ ...existing, status: parsed.data.status, review_note: parsed.data.review_note || null, reviewed_by: actor.user.id, updated_at: new Date().toISOString() });
  } else if (update.error) return databaseMutationError(update.error, "The holiday decision could not be saved.");

  const recipientIds = existing.proposed_by ? [existing.proposed_by] : [];
  if (parsed.data.status === "approved") {
    let recipients = actor.admin.from("profiles").select("id").eq("active", true).neq("role", "super_admin");
    if (existing.branch_id) recipients = recipients.eq("branch_id", existing.branch_id);
    const { data: people } = await recipients;
    recipientIds.push(...(people ?? []).map((person) => person.id));
  }
  await notifyUsers({
    recipientIds: [...new Set(recipientIds)],
    kind: "calendar",
    title: parsed.data.status === "approved" ? `${existing.name} approved as a holiday` : `${existing.name} holiday request ${parsed.data.status}`,
    body: `${existing.holiday_date === existing.end_date ? existing.holiday_date : `${existing.holiday_date} to ${existing.end_date}`}: ${parsed.data.status === "approved" ? "Attendance is not required." : "This period remains on the normal work schedule."}${parsed.data.review_note ? ` Note: ${parsed.data.review_note}` : ""}`,
    actionUrl: "/app#calendar",
    dedupeKey: `holiday-decision:${existing.id}:${parsed.data.status}`,
  });
  return NextResponse.json({ holiday });
}
