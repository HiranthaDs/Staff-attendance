import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiAdmin } from "@/lib/api-auth";

const schema = z.object({ status: z.enum(["approved", "rejected"]), admin_note: z.string().trim().max(500).optional() });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getApiAdmin();
  if ("error" in actor) return actor.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid decision." }, { status: 400 });
  const { id } = await context.params;
  const { data: leave } = await actor.admin.from("leave_requests").select("*, profile:profiles(branch_id, annual_leave_days, monthly_leave_days)").eq("id", id).maybeSingle();
  if (!leave || leave.status !== "pending") return NextResponse.json({ error: "This request is no longer pending." }, { status: 409 });
  if (actor.profile.role === "branch_admin" && actor.profile.branch_id !== leave.profile?.branch_id) return NextResponse.json({ error: "This request belongs to another branch." }, { status: 403 });

  if (parsed.data.status === "approved" && ["annual", "monthly"].includes(leave.leave_type)) {
    let query = actor.admin.from("leave_requests").select("requested_days").eq("user_id", leave.user_id).eq("status", "approved").eq("leave_type", leave.leave_type);
    if (leave.leave_type === "annual") query = query.gte("start_date", `${leave.start_date.slice(0, 4)}-01-01`).lte("start_date", `${leave.start_date.slice(0, 4)}-12-31`);
    else query = query.gte("start_date", `${leave.start_date.slice(0, 7)}-01`).lte("start_date", `${leave.start_date.slice(0, 7)}-31`);
    const { data: usedRows } = await query;
    const used = (usedRows ?? []).reduce((sum, row) => sum + Number(row.requested_days), 0);
    const allowance = leave.leave_type === "annual" ? Number(leave.profile.annual_leave_days) : Number(leave.profile.monthly_leave_days);
    if (used + Number(leave.requested_days) > allowance) return NextResponse.json({ error: "This employee no longer has enough leave balance." }, { status: 409 });
  }

  const { data: updated, error } = await actor.admin.from("leave_requests").update({ status: parsed.data.status, admin_note: parsed.data.admin_note || null, reviewed_by: actor.user.id, reviewed_at: new Date().toISOString() }).eq("id", id).eq("status", "pending").select("*, profile:profiles(full_name, employee_code, branch_id)").single();
  if (error) return NextResponse.json({ error: "The decision could not be saved." }, { status: 500 });
  return NextResponse.json({ leave: updated });
}
