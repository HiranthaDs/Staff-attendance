import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiAdmin } from "@/lib/api-auth";
import { isTrustedMutationOrigin } from "@/lib/attendance-backend";
import { databaseMutationError } from "@/lib/database-errors";
import { localDateParts } from "@/lib/attendance";
import { loadCompanyHolidays, loadWorkSchedule } from "@/lib/workday-data";
import { loadPayrollRecords, loadSalarySettings } from "@/lib/payroll-store";

const time = z.string().regex(/^\d{2}:\d{2}$/);
const scheduleSchema = z.object({
  mode: z.literal("schedule").optional().default("schedule"),
  expected_arrival: time,
  expected_departure: time,
  schedule: z.array(z.object({
    weekday: z.number().int().min(1).max(7),
    day_type: z.enum(["full_day", "half_day", "off"]),
    arrival_time: time,
    departure_time: time,
  })).length(7),
});
const profileSchema = z.object({
  mode: z.literal("profile"),
  full_name: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(7).max(30),
  email: z.string().trim().email().max(200),
  employee_code: z.string().trim().max(30).optional().default(""),
  branch_id: z.string().uuid(),
  job_title: z.string().trim().min(2).max(100),
  monthly_leave_days: z.coerce.number().min(0).max(10),
  annual_leave_days: z.coerce.number().min(0).max(60),
  active: z.boolean(),
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getApiAdmin();
  if ("error" in actor) return actor.error;
  const parsed = z.string().uuid().safeParse((await context.params).id);
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid employee." }, { status: 400 });
  const today = localDateParts(new Date(), "Asia/Colombo").date;
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const yearEnd = `${today.slice(0, 4)}-12-31`;

  const [profileResult, attendanceResult, leaveResult] = await Promise.all([
    actor.admin.from("profiles").select("*, branch:branches(*)").eq("id", parsed.data).neq("role", "super_admin").maybeSingle(),
    actor.admin.from("attendance_records").select("*, branch:branches(name, code)").eq("user_id", parsed.data).gte("attendance_date", yearStart).lte("attendance_date", yearEnd).order("attendance_date", { ascending: false }),
    actor.admin.from("leave_requests").select("*").eq("user_id", parsed.data).lte("start_date", yearEnd).gte("end_date", yearStart).order("start_date", { ascending: false }),
  ]);
  if (!profileResult.data) return NextResponse.json({ error: "Employee profile was not found." }, { status: 404 });
  if (profileResult.error || attendanceResult.error || leaveResult.error) {
    return NextResponse.json({ error: "The employee details could not be loaded." }, { status: 500 });
  }
  const [workSchedule, holidays, salarySettings, payrollRecords] = await Promise.all([
    loadWorkSchedule(actor.admin, { userId: parsed.data, arrival: profileResult.data.expected_arrival, departure: profileResult.data.expected_departure }),
    loadCompanyHolidays(actor.admin, { startDate: yearStart, endDate: yearEnd, branchId: profileResult.data.branch_id, includePending: true }),
    loadSalarySettings(actor.admin, [parsed.data]),
    loadPayrollRecords(actor.admin, { userIds: [parsed.data] }),
  ]);
  return NextResponse.json({
    profile: { ...profileResult.data, work_schedule: workSchedule },
    attendance: attendanceResult.data ?? [],
    leaves: leaveResult.data ?? [],
    holidays,
    salary_settings: salarySettings[0] ?? null,
    payroll_records: payrollRecords,
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const actor = await getApiAdmin();
  if ("error" in actor) return actor.error;
  const id = z.string().uuid().safeParse((await context.params).id);
  if (!id.success) return NextResponse.json({ error: "Choose a valid employee." }, { status: 400 });
  const body = await request.json().catch(() => null);
  if (body?.mode === "profile") {
    const parsedProfile = profileSchema.safeParse(body);
    if (!parsedProfile.success) return NextResponse.json({ error: "Check every employee detail and try again." }, { status: 400 });
    const input = parsedProfile.data;
    const [{ data: employee }, { data: branch }] = await Promise.all([
      actor.admin.from("profiles").select("id").eq("id", id.data).neq("role", "super_admin").maybeSingle(),
      actor.admin.from("branches").select("id").eq("id", input.branch_id).eq("active", true).maybeSingle(),
    ]);
    if (!employee) return NextResponse.json({ error: "Employee profile was not found." }, { status: 404 });
    if (!branch) return NextResponse.json({ error: "Choose an active branch." }, { status: 400 });
    const { error: authError } = await actor.admin.auth.admin.updateUserById(id.data, {
      email: input.email.toLowerCase(),
      email_confirm: true,
      user_metadata: { full_name: input.full_name },
    });
    if (authError) return NextResponse.json({ error: authError.message.toLowerCase().includes("exists") ? "Another account already uses that email." : "The sign-in details could not be updated." }, { status: 409 });
    const { data: profile, error: profileError } = await actor.admin.from("profiles").update({
      full_name: input.full_name,
      phone: input.phone,
      email: input.email.toLowerCase(),
      employee_code: input.employee_code || null,
      branch_id: input.branch_id,
      job_title: input.job_title,
      monthly_leave_days: input.monthly_leave_days,
      annual_leave_days: input.annual_leave_days,
      active: input.active,
    }).eq("id", id.data).select("*, branch:branches(*)").single();
    if (profileError) return databaseMutationError(profileError, profileError.code === "23505" ? "That employee code is already in use." : "The employee details could not be saved.");
    const workSchedule = await loadWorkSchedule(actor.admin, { userId: id.data, arrival: profile.expected_arrival, departure: profile.expected_departure });
    return NextResponse.json({ profile: { ...profile, work_schedule: workSchedule } });
  }

  const parsed = scheduleSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Check every schedule day and try again." }, { status: 400 });

  const input = parsed.data;
  const weekdays = new Set(input.schedule.map((day) => day.weekday));
  if (weekdays.size !== 7 || input.expected_departure <= input.expected_arrival) {
    return NextResponse.json({ error: "The weekly schedule must contain seven unique days and valid working hours." }, { status: 400 });
  }
  const invalidDay = input.schedule.find((day) => day.departure_time <= day.arrival_time);
  if (invalidDay) return NextResponse.json({ error: "Every scheduled time must finish after it starts." }, { status: 400 });

  const { data: employee } = await actor.admin.from("profiles").select("id").eq("id", id.data).neq("role", "super_admin").maybeSingle();
  if (!employee) return NextResponse.json({ error: "Employee profile was not found." }, { status: 404 });

  const { data: workSchedule, error: scheduleError } = await actor.admin.from("employee_work_schedules")
    .upsert(input.schedule.map((day) => ({ ...day, user_id: id.data })), { onConflict: "user_id,weekday" })
    .select("user_id,weekday,day_type,arrival_time,departure_time")
    .order("weekday");
  if (scheduleError) return databaseMutationError(scheduleError, "The employee work schedule could not be saved.");

  const { data: profile, error: profileError } = await actor.admin.from("profiles")
    .update({ expected_arrival: input.expected_arrival, expected_departure: input.expected_departure })
    .eq("id", id.data)
    .select("*, branch:branches(*)")
    .single();
  if (profileError) return databaseMutationError(profileError, "The employee default hours could not be saved.");

  return NextResponse.json({ profile: { ...profile, work_schedule: workSchedule } });
}
