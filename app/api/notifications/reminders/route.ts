import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { localDateParts, timeToMinutes } from "@/lib/attendance";
import { notifyUsers } from "@/lib/notifications";
import { loadCompanyHolidays } from "@/lib/workday-data";
import { approvedHolidayForDate, approvedLeaveForDate, scheduleForDate } from "@/lib/workday";
import { isMigrationRequired } from "@/lib/database-errors";
import type { LeaveRequest, WorkScheduleDay } from "@/lib/types";

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

function previousDate(date: string) {
  return new Date(new Date(`${date}T12:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const admin = createAdminClient();
  const now = new Date();
  const [{ data: profiles, error }, { data: preferences }] = await Promise.all([
    admin.from("profiles")
      .select("id,full_name,expected_arrival,expected_departure,branch:branches(id,name,timezone,active)")
      .eq("active", true)
      .neq("role", "super_admin"),
    admin.from("notification_preferences").select("user_id,attendance_reminders,reminder_minutes"),
  ]);
  if (error) return NextResponse.json({ error: "Staff schedules could not be loaded." }, { status: 500 });
  const preferenceMap = new Map((preferences ?? []).map((preference) => [preference.user_id as string, preference]));
  const preliminary = (profiles ?? []).flatMap((profile) => {
    const branch = Array.isArray(profile.branch) ? profile.branch[0] : profile.branch;
    if (!branch?.active) return [];
    const local = localDateParts(now, branch.timezone);
    const preference = preferenceMap.get(profile.id as string);
    if (preference?.attendance_reminders === false) return [];
    const reminderMinutes = Number(preference?.reminder_minutes ?? 10);
    return [{ profile, branch, local, reminderMinutes }];
  });
  const preliminaryIds = preliminary.map((candidate) => candidate.profile.id as string);
  const preliminaryDates = preliminary.flatMap((candidate) => [candidate.local.date, previousDate(candidate.local.date)]).sort();
  const [scheduleResult, leaveResult, holidays] = preliminaryIds.length ? await Promise.all([
    admin.from("employee_work_schedules").select("user_id,weekday,day_type,arrival_time,departure_time").in("user_id", preliminaryIds),
    admin.from("leave_requests").select("*").in("user_id", preliminaryIds).eq("status", "approved").lte("start_date", preliminaryDates.at(-1)!).gte("end_date", preliminaryDates[0]),
    loadCompanyHolidays(admin, { startDate: preliminaryDates[0], endDate: preliminaryDates.at(-1)!, includeAllBranches: true }),
  ]) : [{ data: [], error: null }, { data: [], error: null }, []];
  if (scheduleResult.error && !isMigrationRequired(scheduleResult.error)) return NextResponse.json({ error: "Employee schedules could not be loaded." }, { status: 500 });
  if (leaveResult.error) return NextResponse.json({ error: "Employee leave could not be loaded." }, { status: 500 });
  const schedules = (scheduleResult.data ?? []) as WorkScheduleDay[];
  const leaves = (leaveResult.data ?? []) as LeaveRequest[];
  const candidates = preliminary.flatMap((candidate) => {
    const userId = candidate.profile.id as string;
    const schedule = scheduleForDate(schedules.filter((row) => row.user_id === userId), candidate.local.date, { userId, arrival: candidate.profile.expected_arrival, departure: candidate.profile.expected_departure });
    const holiday = approvedHolidayForDate(holidays, candidate.local.date, candidate.branch.id as string);
    const leave = approvedLeaveForDate(leaves.filter((row) => row.user_id === userId), candidate.local.date);
    if (schedule.day_type === "off" || holiday || leave?.portion === "full_day") return [];
    const arrivalAt = timeToMinutes(schedule.arrival_time) - candidate.reminderMinutes;
    const departureAt = timeToMinutes(schedule.departure_time) - candidate.reminderMinutes;
    const inWindow = (target: number) => candidate.local.minutes >= target && candidate.local.minutes < target + 10;
    return [{ ...candidate, schedule, arrivalDue: inWindow(arrivalAt), departureDue: inWindow(departureAt) }];
  });
  const missedCandidates = preliminary.flatMap((candidate) => {
    const userId = candidate.profile.id as string;
    const date = previousDate(candidate.local.date);
    const schedule = scheduleForDate(schedules.filter((row) => row.user_id === userId), date, { userId, arrival: candidate.profile.expected_arrival, departure: candidate.profile.expected_departure });
    const holiday = approvedHolidayForDate(holidays, date, candidate.branch.id as string);
    const leave = approvedLeaveForDate(leaves.filter((row) => row.user_id === userId), date);
    if (schedule.day_type === "off" || holiday || leave?.portion === "full_day") return [];
    return [{ ...candidate, date, schedule }];
  });
  const dates = [...new Set([...candidates.map((candidate) => candidate.local.date), ...missedCandidates.map((candidate) => candidate.date)])];
  const ids = [...new Set(preliminary.map((candidate) => candidate.profile.id as string))];
  const { data: records } = ids.length && dates.length
    ? await admin.from("attendance_records").select("user_id,attendance_date,clock_in,clock_out").in("user_id", ids).in("attendance_date", dates)
    : { data: [] };
  const recordMap = new Map((records ?? []).map((record) => [`${record.user_id}:${record.attendance_date}`, record]));
  let created = 0;
  let pushed = 0;
  let missedRecorded = 0;

  const missedRows = missedCandidates.filter((candidate) => !recordMap.get(`${candidate.profile.id}:${candidate.date}`)?.clock_in).map((candidate) => ({
    user_id: candidate.profile.id,
    branch_id: candidate.branch.id,
    attendance_date: candidate.date,
    absence_units: candidate.schedule.day_type === "half_day" ? 0.5 : 1,
    scheduled_arrival: candidate.schedule.arrival_time,
    scheduled_departure: candidate.schedule.departure_time,
    reason: "missed_attendance",
  }));
  if (missedRows.length) {
    const missedResult = await admin.from("attendance_absences").upsert(missedRows, { onConflict: "user_id,attendance_date", ignoreDuplicates: true }).select("id,user_id,attendance_date");
    if (!missedResult.error) {
      missedRecorded = missedResult.data?.length ?? 0;
      for (const candidate of missedCandidates.filter((item) => missedRows.some((row) => row.user_id === item.profile.id && row.attendance_date === item.date))) {
        const delivery = await notifyUsers({
          recipientIds: [candidate.profile.id as string],
          kind: "attendance",
          title: "Attendance was not marked",
          body: `${candidate.date} is recorded as ${candidate.schedule.day_type === "half_day" ? "a half-day" : "an"} absence with 0 worked hours. Contact your administrator if this should be leave.`,
          actionUrl: "/app#home",
          dedupeKey: `missed-attendance:${candidate.date}`,
        });
        created += delivery.created;
        pushed += delivery.pushed;
      }
    } else if (!isMigrationRequired(missedResult.error)) {
      return NextResponse.json({ error: "Missed attendance could not be recorded." }, { status: 500 });
    }
  }

  for (const candidate of candidates) {
    const record = recordMap.get(`${candidate.profile.id}:${candidate.local.date}`);
    if (candidate.arrivalDue && !record?.clock_in) {
      const delivery = await notifyUsers({
        recipientIds: [candidate.profile.id as string],
        kind: "attendance",
        title: "Your workday starts soon",
        body: `Your ${candidate.schedule.day_type === "half_day" ? "half-day " : ""}shift starts at ${candidate.schedule.arrival_time.slice(0, 5)}. Clock in at ${candidate.branch.name} after you arrive.`,
        actionUrl: "/app#home",
        dedupeKey: `clock-in-reminder:${candidate.local.date}`,
      });
      created += delivery.created;
      pushed += delivery.pushed;
    }
    if (candidate.departureDue && record?.clock_in && !record.clock_out) {
      const delivery = await notifyUsers({
        recipientIds: [candidate.profile.id as string],
        kind: "attendance",
        title: "Your workday is nearly complete",
        body: `Your scheduled finish is ${candidate.schedule.departure_time.slice(0, 5)}. Remember to clock out before leaving ${candidate.branch.name}.`,
        actionUrl: "/app#home",
        dedupeKey: `clock-out-reminder:${candidate.local.date}`,
      });
      created += delivery.created;
      pushed += delivery.pushed;
    }
  }
  return NextResponse.json({ checked: candidates.length, missedRecorded, created, pushed });
}
