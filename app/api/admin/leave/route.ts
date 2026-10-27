import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiAdmin } from "@/lib/api-auth";
import { isTrustedMutationOrigin } from "@/lib/attendance-backend";
import { businessLeaveDays } from "@/lib/leave";

const schema = z.object({
  user_id: z.string().uuid(),
  start_date: z.string().date(),
  end_date: z.string().date(),
  leave_type: z.enum(["annual", "monthly", "medical", "unpaid"]),
  portion: z.enum(["full_day", "first_half", "second_half"]),
  reason: z.string().trim().min(4).max(500),
});

export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const actor = await getApiAdmin();
  if ("error" in actor) return actor.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Complete every leave field." }, { status: 400 });
  const input = parsed.data;

  const { data: employee } = await actor.admin.from("profiles")
    .select("id, active, annual_leave_days, monthly_leave_days")
    .eq("id", input.user_id).neq("role", "super_admin").maybeSingle();
  if (!employee || !employee.active) return NextResponse.json({ error: "Choose an active employee." }, { status: 400 });
  if (input.end_date < input.start_date) return NextResponse.json({ error: "The end date must be on or after the start date." }, { status: 400 });
  if (input.portion !== "full_day" && input.start_date !== input.end_date) {
    return NextResponse.json({ error: "A short leave must start and end on the same date." }, { status: 400 });
  }
  if (input.leave_type === "monthly" && input.start_date.slice(0, 7) !== input.end_date.slice(0, 7)) {
    return NextResponse.json({ error: "Monthly leave cannot span two months." }, { status: 400 });
  }
  if (input.leave_type === "annual" && input.start_date.slice(0, 4) !== input.end_date.slice(0, 4)) {
    return NextResponse.json({ error: "Annual leave cannot span two calendar years." }, { status: 400 });
  }

  const requestedDays = businessLeaveDays(input.start_date, input.end_date, input.portion !== "full_day");
  if (requestedDays <= 0) return NextResponse.json({ error: "The selected dates contain no working days." }, { status: 400 });

  const { data: overlap } = await actor.admin.from("leave_requests").select("id")
    .eq("user_id", input.user_id).in("status", ["pending", "approved"])
    .lte("start_date", input.end_date).gte("end_date", input.start_date).limit(1);
  if (overlap?.length) return NextResponse.json({ error: "This employee already has leave on the selected dates." }, { status: 409 });

  if (input.leave_type === "annual" || input.leave_type === "monthly") {
    let usedQuery = actor.admin.from("leave_requests").select("requested_days")
      .eq("user_id", input.user_id).eq("status", "approved").eq("leave_type", input.leave_type);
    if (input.leave_type === "annual") {
      usedQuery = usedQuery.gte("start_date", `${input.start_date.slice(0, 4)}-01-01`).lte("start_date", `${input.start_date.slice(0, 4)}-12-31`);
    } else {
      const month = input.start_date.slice(0, 7);
      usedQuery = usedQuery.gte("start_date", `${month}-01`).lte("start_date", `${month}-31`);
    }
    const { data: rows } = await usedQuery;
    const used = (rows ?? []).reduce((sum, row) => sum + Number(row.requested_days), 0);
    const allowance = input.leave_type === "annual" ? Number(employee.annual_leave_days) : Number(employee.monthly_leave_days);
    if (used + requestedDays > allowance) return NextResponse.json({ error: `Only ${Math.max(0, allowance - used)} ${input.leave_type} leave day(s) remain.` }, { status: 409 });
  }

  const { data: leave, error } = await actor.admin.from("leave_requests").insert({
    ...input,
    requested_days: requestedDays,
    status: "approved",
    reviewed_by: actor.user.id,
    reviewed_at: new Date().toISOString(),
  }).select("*, profile:profiles(full_name, employee_code, branch_id)").single();
  if (error) return NextResponse.json({ error: "The employee leave could not be recorded." }, { status: 500 });
  return NextResponse.json({ leave }, { status: 201 });
}
