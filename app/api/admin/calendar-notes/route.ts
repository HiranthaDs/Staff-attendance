import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiAdmin } from "@/lib/api-auth";
import { isTrustedMutationOrigin } from "@/lib/attendance-backend";

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
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a date and enter a short note title." }, { status: 400 });

  const branchId = parsed.data.branch_id || null;
  if (branchId) {
    const { data: branch } = await actor.admin.from("branches").select("id").eq("id", branchId).eq("active", true).maybeSingle();
    if (!branch) return NextResponse.json({ error: "Choose an active branch." }, { status: 400 });
  }

  const { data: note, error } = await actor.admin.from("calendar_notes").insert({
    note_date: parsed.data.note_date,
    title: parsed.data.title,
    note: parsed.data.note || null,
    branch_id: branchId,
    created_by: actor.user.id,
  }).select("*, branch:branches(id, name, code)").single();

  if (error) return NextResponse.json({ error: "The calendar note could not be saved." }, { status: 500 });
  return NextResponse.json({ note }, { status: 201 });
}

export async function DELETE(request: Request) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const actor = await getApiAdmin();
  if ("error" in actor) return actor.error;
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid calendar note." }, { status: 400 });

  const { error } = await actor.admin.from("calendar_notes").delete().eq("id", parsed.data.id);
  if (error) return NextResponse.json({ error: "The calendar note could not be removed." }, { status: 500 });
  return NextResponse.json({ success: true });
}
