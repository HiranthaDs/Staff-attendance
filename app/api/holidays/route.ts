import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiActor } from "@/lib/api-auth";
import { isTrustedMutationOrigin } from "@/lib/attendance-backend";
import { databaseMutationError, isMigrationRequired } from "@/lib/database-errors";
import { notifyUsers, superAdminIds } from "@/lib/notifications";
import { loadCompatibilityHolidays, saveCompatibilityHoliday } from "@/lib/holiday-store";
import type { Branch, CompanyHoliday } from "@/lib/types";

const schema = z.object({
  start_date: z.string().date(),
  end_date: z.string().date(),
  name: z.string().trim().min(2).max(120),
  holiday_type: z.enum(["poya", "public", "company", "special"]).default("company"),
  branch_id: z.union([z.string().uuid(), z.literal("")]).optional(),
  reason: z.string().trim().min(4).max(500),
});

export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const actor = await getApiActor();
  if ("error" in actor) return actor.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a date, clear holiday name and reason." }, { status: 400 });
  const input = parsed.data;
  if (input.end_date < input.start_date) return NextResponse.json({ error: "The holiday end date cannot be before its start date." }, { status: 400 });
  const rangeDays = Math.round((new Date(`${input.end_date}T12:00:00Z`).getTime() - new Date(`${input.start_date}T12:00:00Z`).getTime()) / 86_400_000) + 1;
  if (rangeDays > 45) return NextResponse.json({ error: "A holiday range cannot be longer than 45 days." }, { status: 400 });
  const isAdmin = actor.profile.role === "super_admin";
  const branchId = isAdmin ? input.branch_id || null : actor.profile.branch_id;
  if (!isAdmin && !branchId) return NextResponse.json({ error: "Your account must have a branch before suggesting a holiday." }, { status: 409 });

  let branch: Pick<Branch, "id" | "name" | "code"> | null = null;
  if (branchId) {
    const result = await actor.admin.from("branches").select("id,name,code").eq("id", branchId).eq("active", true).maybeSingle();
    if (!result.data) return NextResponse.json({ error: "Choose an active branch." }, { status: 400 });
    branch = result.data;
  }
  let duplicateQuery = actor.admin.from("company_holidays").select("id,status")
    .lte("holiday_date", input.end_date).gte("end_date", input.start_date).eq("name", input.name)
    .in("status", ["pending", "approved"]);
  duplicateQuery = branchId ? duplicateQuery.eq("branch_id", branchId) : duplicateQuery.is("branch_id", null);
  const [{ data: duplicate }, compatibility] = await Promise.all([duplicateQuery.limit(1), loadCompatibilityHolidays()]);
  const compatibilityDuplicate = compatibility.some((holiday) => holiday.name.toLowerCase() === input.name.toLowerCase()
    && holiday.branch_id === branchId && ["pending", "approved"].includes(holiday.status)
    && holiday.holiday_date <= input.end_date && (holiday.end_date || holiday.holiday_date) >= input.start_date);
  if (duplicate?.length || compatibilityDuplicate) return NextResponse.json({ error: "This holiday is already pending or approved for that audience." }, { status: 409 });

  const insert = await actor.admin.from("company_holidays").insert({
    holiday_date: input.start_date,
    end_date: input.end_date,
    name: input.name,
    holiday_type: input.holiday_type,
    branch_id: branchId,
    reason: input.reason,
    status: isAdmin ? "approved" : "pending",
    source: isAdmin ? "admin" : "staff",
    proposed_by: actor.user.id,
    reviewed_by: isAdmin ? actor.user.id : null,
    reviewed_at: isAdmin ? new Date().toISOString() : null,
  }).select("*, branch:branches(id,name,code), proposer:profiles!company_holidays_proposed_by_fkey(full_name,employee_code)").single();
  let holiday = insert.data as CompanyHoliday | null;
  if (insert.error && isMigrationRequired(insert.error)) {
    const now = new Date().toISOString();
    holiday = await saveCompatibilityHoliday({
      id: crypto.randomUUID(), holiday_date: input.start_date, end_date: input.end_date, name: input.name,
      holiday_type: input.holiday_type, branch_id: branchId, status: isAdmin ? "approved" : "pending",
      source: isAdmin ? "admin" : "staff", source_reference: "Compatibility storage pending database migration",
      reason: input.reason, proposed_by: actor.user.id, reviewed_by: isAdmin ? actor.user.id : null,
      review_note: null, created_at: now, updated_at: now, branch,
      proposer: { full_name: actor.profile.full_name, employee_code: actor.profile.employee_code },
    });
  } else if (insert.error) return databaseMutationError(insert.error, "The holiday could not be saved.");
  if (!holiday) return NextResponse.json({ error: "The holiday could not be saved." }, { status: 500 });

  const dateLabel = input.start_date === input.end_date ? input.start_date : `${input.start_date} to ${input.end_date}`;

  if (isAdmin) {
    let recipients = actor.admin.from("profiles").select("id").eq("active", true).neq("id", actor.user.id);
    if (branchId) recipients = recipients.eq("branch_id", branchId);
    const { data: people } = await recipients;
    await notifyUsers({
      recipientIds: (people ?? []).map((person) => person.id),
      kind: "calendar",
      title: `${input.name} added as a holiday`,
      body: `${dateLabel} is now an approved ${branchId ? "branch" : "company-wide"} holiday. Attendance is not required.`,
      actionUrl: "/app#calendar",
      dedupeKey: `holiday-approved:${holiday.id}`,
    });
  } else {
    await notifyUsers({
      recipientIds: await superAdminIds(),
      kind: "calendar",
      title: `Holiday suggestion from ${actor.profile.full_name}`,
      body: `${input.name} was suggested for ${dateLabel}. It will not affect attendance until approved.`,
      actionUrl: "/admin",
      dedupeKey: `holiday-proposal:${holiday.id}`,
    });
  }
  return NextResponse.json({ holiday }, { status: 201 });
}
