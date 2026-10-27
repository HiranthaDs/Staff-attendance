import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiActor } from "@/lib/api-auth";
import { localDateParts } from "@/lib/attendance";
import { employeeLeaveDays } from "@/lib/leave";
import { isTrustedMutationOrigin } from "@/lib/attendance-backend";
import { notifyUsers, superAdminIds } from "@/lib/notifications";
import { loadCompanyHolidays, loadWorkSchedule } from "@/lib/workday-data";

const schema = z.object({
  start_date: z.string().date(),
  end_date: z.string().date(),
  leave_type: z.enum(["annual", "monthly", "medical", "unpaid"]),
  portion: z.enum(["full_day", "first_half", "second_half"]),
  reason: z.string().trim().min(4).max(500),
});

export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const actor = await getApiActor();
  if ("error" in actor) return actor.error;
  if (actor.profile.role === "super_admin") return NextResponse.json({ error: "Leave requests are available to employee accounts only." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Complete every leave request field." }, { status: 400 });
  const input = parsed.data;
  const today = localDateParts(new Date(), actor.profile.branch?.timezone || "Asia/Colombo").date;
  if (input.start_date < today || input.end_date < input.start_date) {
    return NextResponse.json({ error: "Choose a valid current or future date range." }, { status: 400 });
  }
  if (input.portion !== "full_day" && input.start_date !== input.end_date) {
    return NextResponse.json({ error: "Half-day leave must start and end on the same date." }, { status: 400 });
  }
  if (input.leave_type === "monthly" && input.start_date.slice(0, 7) !== input.end_date.slice(0, 7)) {
    return NextResponse.json({ error: "Monthly leave cannot span two calendar months." }, { status: 400 });
  }
  if (input.leave_type === "annual" && input.start_date.slice(0, 4) !== input.end_date.slice(0, 4)) {
    return NextResponse.json({ error: "Submit separate annual leave requests for each calendar year." }, { status: 400 });
  }
  const [schedule, holidays] = await Promise.all([
    loadWorkSchedule(actor.admin, { userId: actor.user.id, arrival: actor.profile.expected_arrival, departure: actor.profile.expected_departure }),
    loadCompanyHolidays(actor.admin, { startDate: input.start_date, endDate: input.end_date, branchId: actor.profile.branch_id }),
  ]);
  const days = employeeLeaveDays({
    start: input.start_date,
    end: input.end_date,
    portion: input.portion,
    schedule,
    holidayDates: new Set(holidays.filter((holiday) => holiday.status === "approved").map((holiday) => holiday.holiday_date)),
    fallback: { userId: actor.user.id, arrival: actor.profile.expected_arrival, departure: actor.profile.expected_departure },
  });
  if (days <= 0) return NextResponse.json({ error: "The selected dates contain no working days." }, { status: 400 });

  if (input.portion === "full_day") {
    const { data: attendance } = await actor.admin.from("attendance_records").select("id")
      .eq("user_id", actor.user.id).gte("attendance_date", input.start_date).lte("attendance_date", input.end_date).limit(1);
    if (attendance?.length) return NextResponse.json({ error: "Full-day leave cannot overlap attendance that is already recorded." }, { status: 409 });
  }

  const { data: overlap } = await actor.admin.from("leave_requests").select("id").eq("user_id", actor.user.id).in("status", ["pending", "approved"]).lte("start_date", input.end_date).gte("end_date", input.start_date).limit(1);
  if (overlap?.length) return NextResponse.json({ error: "A pending or approved request already overlaps these dates." }, { status: 409 });

  if (input.leave_type === "annual" || input.leave_type === "monthly") {
    let query = actor.admin.from("leave_requests").select("requested_days, start_date").eq("user_id", actor.user.id).eq("status", "approved").eq("leave_type", input.leave_type);
    if (input.leave_type === "annual") {
      query = query.gte("start_date", `${input.start_date.slice(0, 4)}-01-01`).lte("start_date", `${input.start_date.slice(0, 4)}-12-31`);
    } else {
      const prefix = input.start_date.slice(0, 7);
      query = query.gte("start_date", `${prefix}-01`).lte("start_date", `${prefix}-31`);
    }
    const { data: usedRows } = await query;
    const used = (usedRows ?? []).reduce((sum, row) => sum + Number(row.requested_days), 0);
    const allowance = input.leave_type === "annual" ? actor.profile.annual_leave_days : actor.profile.monthly_leave_days;
    if (used + days > allowance) return NextResponse.json({ error: `Only ${Math.max(0, allowance - used)} ${input.leave_type} leave day(s) remain.` }, { status: 409 });
  }

  const { data: leave, error } = await actor.admin.from("leave_requests").insert({ ...input, requested_days: days, user_id: actor.user.id }).select().single();
  if (error) {
    const conflict = error.code === "23P01" || error.message === "LEAVE_ATTENDANCE_OVERLAP";
    return NextResponse.json({ error: conflict ? "This leave overlaps another request or recorded attendance." : "The leave request could not be saved." }, { status: conflict ? 409 : 500 });
  }
  await notifyUsers({
    recipientIds: await superAdminIds(),
    kind: "leave",
    title: `New leave request from ${actor.profile.full_name}`,
    body: `${days} day${days === 1 ? "" : "s"} of ${input.leave_type} leave from ${input.start_date} to ${input.end_date}. Reason: ${input.reason}`,
    actionUrl: "/admin",
    dedupeKey: `leave-request:${leave.id}`,
  });
  return NextResponse.json({ leave }, { status: 201 });
}
