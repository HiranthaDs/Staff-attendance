import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiAdmin } from "@/lib/api-auth";
import { isTrustedMutationOrigin } from "@/lib/attendance-backend";
import { sendWelcomeEmail } from "@/lib/email";
import { notifyUsers } from "@/lib/notifications";
import { databaseMutationError } from "@/lib/database-errors";

const schema = z.object({
  full_name: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(7).max(30),
  email: z.string().trim().email().max(200),
  employee_code: z.string().trim().max(30).optional().default(""),
  branch_id: z.string().uuid(),
  role: z.literal("staff").optional().default("staff"),
  job_title: z.string().trim().min(2).max(100),
  temporary_password: z.string().min(10).max(128),
  expected_arrival: z.string().regex(/^\d{2}:\d{2}$/),
  expected_departure: z.string().regex(/^\d{2}:\d{2}$/),
  monthly_leave_days: z.coerce.number().min(0).max(10),
  annual_leave_days: z.coerce.number().min(0).max(60),
  saturday_type: z.enum(["half_day", "full_day", "off"]).default("half_day"),
  sunday_type: z.enum(["off", "half_day", "full_day"]).default("off"),
  half_day_arrival: z.string().regex(/^\d{2}:\d{2}$/).default("09:00"),
  half_day_departure: z.string().regex(/^\d{2}:\d{2}$/).default("14:00"),
});

export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const actor = await getApiAdmin();
  if ("error" in actor) return actor.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check every staff detail and try again." }, { status: 400 });
  const input = parsed.data;
  if (input.expected_departure <= input.expected_arrival) {
    return NextResponse.json({ error: "Leaving time must be after arrival time." }, { status: 400 });
  }
  if (input.half_day_departure <= input.half_day_arrival) {
    return NextResponse.json({ error: "Half-day finishing time must be after its starting time." }, { status: 400 });
  }
  const { data: branch } = await actor.admin.from("branches").select("id").eq("id", input.branch_id).eq("active", true).maybeSingle();
  if (!branch) return NextResponse.json({ error: "Choose an active branch." }, { status: 400 });

  const { data: created, error: authError } = await actor.admin.auth.admin.createUser({
    email: input.email.toLowerCase(),
    password: input.temporary_password,
    email_confirm: true,
    user_metadata: { full_name: input.full_name },
  });
  if (authError || !created.user) {
    const duplicate = authError?.message.toLowerCase().includes("registered") || authError?.message.toLowerCase().includes("exists");
    return NextResponse.json({ error: duplicate ? "An account already uses that email." : "The sign-in account could not be created." }, { status: 409 });
  }

  const { data: profile, error: profileError } = await actor.admin.from("profiles").insert({
    id: created.user.id,
    full_name: input.full_name,
    email: input.email.toLowerCase(),
    phone: input.phone,
    employee_code: input.employee_code || null,
    branch_id: input.branch_id,
    role: input.role,
    job_title: input.job_title,
    expected_arrival: input.expected_arrival,
    expected_departure: input.expected_departure,
    monthly_leave_days: input.monthly_leave_days,
    annual_leave_days: input.annual_leave_days,
    must_reset_password: true,
    created_by: actor.user.id,
  }).select("*, branch:branches(*)").single();

  if (profileError) {
    await actor.admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: profileError.code === "23505" ? "That employee code is already in use." : "The staff profile could not be saved." }, { status: 409 });
  }
  const scheduleRows = Array.from({ length: 7 }, (_, index) => {
    const weekday = index + 1;
    const dayType = weekday === 6 ? input.saturday_type : weekday === 7 ? input.sunday_type : "full_day";
    return {
      user_id: created.user.id,
      weekday,
      day_type: dayType,
      arrival_time: dayType === "half_day" ? input.half_day_arrival : input.expected_arrival,
      departure_time: dayType === "half_day" ? input.half_day_departure : input.expected_departure,
    };
  });
  const { data: workSchedule, error: scheduleError } = await actor.admin.from("employee_work_schedules")
    .upsert(scheduleRows, { onConflict: "user_id,weekday" })
    .select("user_id,weekday,day_type,arrival_time,departure_time");
  if (scheduleError) {
    await actor.admin.auth.admin.deleteUser(created.user.id);
    return databaseMutationError(scheduleError, "The staff work schedule could not be saved.");
  }
  const email = await sendWelcomeEmail({
    fullName: input.full_name,
    email: input.email.toLowerCase(),
    temporaryPassword: input.temporary_password,
  });
  await notifyUsers({
    recipientIds: [created.user.id],
    kind: "account",
    title: "Welcome to Presence",
    body: `Your ${profile.branch?.name || "office"} attendance account is ready. Change your temporary password to begin.`,
    actionUrl: "/auth/update-password",
    dedupeKey: `welcome:${created.user.id}`,
  });
  return NextResponse.json({ profile: { ...profile, work_schedule: workSchedule }, email }, { status: 201 });
}
