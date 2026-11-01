import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiAdmin } from "@/lib/api-auth";
import { isTrustedMutationOrigin } from "@/lib/attendance-backend";
import { databaseMutationError, isMigrationRequired } from "@/lib/database-errors";
import { removeCompatibilityCalendarNote, saveCompatibilityCalendarNote } from "@/lib/calendar-notes";
import type { CalendarNote } from "@/lib/types";
import { activeUserIds, notifyUsers } from "@/lib/notifications";

const createSchema = z.object({
  note_date: z.string().date(),
  title: z.string().trim().min(2).max(100),
  note: z.string().trim().max(500).optional().default(""),
  branch_id: z.union([z.string().uuid(), z.literal("")]).optional().default(""),
});

const deleteSchema = z.object({ id: z.string().uuid() });

export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const actor = await getApiAdmin();
  if ("error" in actor) return actor.error;
  if (actor.profile.role !== "company_admin" || !actor.profile.organization_id) return NextResponse.json({ error: "Only a company owner can manage the calendar." }, { status: 403 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a date and enter a short note title." }, { status: 400 });

  const branchId = parsed.data.branch_id || null;
  let branch: { id: string; name: string; code: string } | null = null;
  if (branchId) {
    const { data } = await actor.admin.from("branches").select("id, name, code").eq("id", branchId).eq("active", true).maybeSingle();
    branch = data;
    if (!branch) return NextResponse.json({ error: "Choose an active branch." }, { status: 400 });
  }

  const { data: note, error } = await actor.admin.from("calendar_notes").insert({
    organization_id: actor.profile.organization_id,
    note_date: parsed.data.note_date,
    title: parsed.data.title,
    note: parsed.data.note || null,
    branch_id: branchId,
    created_by: actor.user.id,
  }).select("*, branch:branches(id, name, code)").single();

  if (error && isMigrationRequired(error)) {
    const timestamp = new Date().toISOString();
    const compatibilityNote: CalendarNote = {
      id: crypto.randomUUID(),
      organization_id: actor.profile.organization_id,
      note_date: parsed.data.note_date,
      title: parsed.data.title,
      note: parsed.data.note || null,
      branch_id: branchId,
      created_by: actor.user.id,
      created_at: timestamp,
      updated_at: timestamp,
      branch,
    };
    try {
      await saveCompatibilityCalendarNote(compatibilityNote);
      await notifyCalendarUsers(compatibilityNote, actor.profile.organization_id);
      return NextResponse.json({ note: compatibilityNote }, { status: 201 });
    } catch {
      return NextResponse.json({ error: "The calendar note could not be saved." }, { status: 500 });
    }
  }
  if (error) return databaseMutationError(error, "The calendar note could not be saved.");
  await notifyCalendarUsers(note as CalendarNote, actor.profile.organization_id);
  return NextResponse.json({ note }, { status: 201 });
}

export async function DELETE(request: Request) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const actor = await getApiAdmin();
  if ("error" in actor) return actor.error;
  if (actor.profile.role !== "company_admin" || !actor.profile.organization_id) return NextResponse.json({ error: "Only a company owner can manage the calendar." }, { status: 403 });
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid calendar note." }, { status: 400 });

  const { data: existing } = await actor.admin.from("calendar_notes").select("id,title,note_date,branch_id").eq("id", parsed.data.id).maybeSingle();
  if (!existing) return NextResponse.json({ error: "The calendar note was not found." }, { status: 404 });
  const { error } = await actor.admin.from("calendar_notes").delete().eq("id", parsed.data.id);
  if (error && !isMigrationRequired(error)) return databaseMutationError(error, "The calendar note could not be removed.");
  try {
    await removeCompatibilityCalendarNote(parsed.data.id);
  } catch {
    if (error) return NextResponse.json({ error: "The calendar note could not be removed." }, { status: 500 });
  }
  await notifyUsers({
    recipientIds: await activeUserIds(actor.profile.organization_id, existing.branch_id),
    kind: "calendar",
    title: "Calendar item removed",
    body: `${existing.title} on ${existing.note_date} was removed from the team calendar.`,
    actionUrl: "/app#calendar",
    dedupeKey: `calendar-delete:${existing.id}:${Date.now()}`,
  });
  return NextResponse.json({ success: true });
}

async function notifyCalendarUsers(note: CalendarNote, organizationId: string) {
  await notifyUsers({
    recipientIds: await activeUserIds(organizationId, note.branch_id),
    kind: "calendar",
    title: "New team calendar update",
    body: `${note.title} on ${note.note_date}${note.note ? ` - ${note.note}` : ""}`,
    actionUrl: "/app#calendar",
    dedupeKey: `calendar-note:${note.id}:${note.updated_at}`,
  });
}
