import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiAdmin } from "@/lib/api-auth";
import { localDateParts, timeToMinutes } from "@/lib/attendance";
import { isMigrationRequired } from "@/lib/database-errors";
import { loadCompanyHolidays } from "@/lib/workday-data";
import { dateRange, resolveWorkday, workdayStatusLabel } from "@/lib/workday";
import type { AttendanceRecord, Branch, LeaveRequest, Profile, WorkScheduleDay } from "@/lib/types";

const querySchema = z.object({
  branch_id: z.union([z.string().uuid(), z.literal("all")]).default("all"),
  start: z.string().date(),
  end: z.string().date(),
});

function csvCell(value: unknown) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function clockTime(value: string | null, timezone: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-LK", { timeZone: timezone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }).format(new Date(value));
}

function monthLabel(date: string) {
  return new Intl.DateTimeFormat("en", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${date}T12:00:00Z`));
}

function safeFilename(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "");
}

export async function GET(request: Request) {
  const actor = await getApiAdmin();
  if ("error" in actor) return actor.error;
  const url = new URL(request.url);
  const today = localDateParts(new Date(), "Asia/Colombo").date;
  const parsed = querySchema.safeParse({
    branch_id: url.searchParams.get("branch_id") || "all",
    start: url.searchParams.get("start") || `${today.slice(0, 7)}-01`,
    end: url.searchParams.get("end") || today,
  });
  if (!parsed.success || parsed.data.end < parsed.data.start) return NextResponse.json({ error: "Choose a valid branch and date range." }, { status: 400 });
  const dates = dateRange(parsed.data.start, parsed.data.end);
  if (dates.length > 366) return NextResponse.json({ error: "Export one year or less at a time." }, { status: 400 });

  let profilesQuery = actor.admin.from("profiles").select("*, branch:branches(*)").neq("role", "super_admin").order("full_name");
  let attendanceQuery = actor.admin.from("attendance_records").select("*").gte("attendance_date", parsed.data.start).lte("attendance_date", parsed.data.end).limit(50_000);
  if (parsed.data.branch_id !== "all") {
    profilesQuery = profilesQuery.eq("branch_id", parsed.data.branch_id);
    attendanceQuery = attendanceQuery.eq("branch_id", parsed.data.branch_id);
  }
  const [profilesResult, attendanceResult, holidays] = await Promise.all([
    profilesQuery,
    attendanceQuery,
    loadCompanyHolidays(actor.admin, {
      startDate: parsed.data.start,
      endDate: parsed.data.end,
      branchId: parsed.data.branch_id === "all" ? null : parsed.data.branch_id,
      includeAllBranches: parsed.data.branch_id === "all",
    }),
  ]);
  if (profilesResult.error || attendanceResult.error) return NextResponse.json({ error: "The attendance ledger could not be prepared." }, { status: 500 });
  const profiles = (profilesResult.data ?? []) as unknown as Profile[];
  if (profiles.length * dates.length > 100_000) return NextResponse.json({ error: "This export is too large. Choose one branch or a shorter period." }, { status: 400 });
  const userIds = profiles.map((profile) => profile.id);
  let schedules: WorkScheduleDay[] = [];
  let leaves: LeaveRequest[] = [];
  if (userIds.length) {
    const [scheduleResult, leaveResult] = await Promise.all([
      actor.admin.from("employee_work_schedules").select("user_id,weekday,day_type,arrival_time,departure_time").in("user_id", userIds),
      actor.admin.from("leave_requests").select("*").in("user_id", userIds).eq("status", "approved").lte("start_date", parsed.data.end).gte("end_date", parsed.data.start),
    ]);
    if (scheduleResult.error && !isMigrationRequired(scheduleResult.error)) return NextResponse.json({ error: "Employee schedules could not be loaded." }, { status: 500 });
    if (leaveResult.error) return NextResponse.json({ error: "Employee leave could not be loaded." }, { status: 500 });
    schedules = (scheduleResult.data ?? []) as WorkScheduleDay[];
    leaves = (leaveResult.data ?? []) as LeaveRequest[];
  }
  const attendance = (attendanceResult.data ?? []) as AttendanceRecord[];
  const attendanceByUserDate = new Map(attendance.map((row) => [`${row.user_id}:${row.attendance_date}`, row]));
  const branchNames = [...new Set(profiles.map((profile) => profile.branch?.name).filter(Boolean))].join(", ") || "No matching branch";
  const branchCodes = [...new Set(profiles.map((profile) => profile.branch?.code).filter(Boolean))].join(", ") || "—";
  const periodLabel = parsed.data.start.slice(0, 7) === parsed.data.end.slice(0, 7) ? monthLabel(parsed.data.start) : `${parsed.data.start} to ${parsed.data.end}`;
  const lines = [
    ["PRESENCE ATTENDANCE LEDGER"], ["Branch", branchNames], ["Branch code", branchCodes],
    ["Reporting period", periodLabel], ["From", parsed.data.start, "To", parsed.data.end], ["Generated at", new Date().toISOString()], [],
    ["Branch", "Branch code", "Month", "Date", "Day", "Employee", "Employee code", "Email", "Schedule", "Scheduled arrival", "Scheduled departure", "Scheduled hours", "Day result", "Attendance status", "Clock in", "Clock out", "Worked hours", "Late minutes", "Early leave minutes", "Leave type", "Leave portion", "Leave days", "Leave reason", "Leave admin note", "Holiday", "Holiday type", "Holiday source", "Clock-in distance (m)", "Clock-out distance (m)"],
  ].map((row) => row.map(csvCell).join(","));

  for (const profile of profiles) {
    const branch = profile.branch as Branch | null | undefined;
    const timezone = branch?.timezone || "Asia/Colombo";
    const employeeSchedule = schedules.filter((row) => row.user_id === profile.id);
    const employeeLeaves = leaves.filter((row) => row.user_id === profile.id);
    for (const date of dates) {
      if (profile.created_at && date < profile.created_at.slice(0, 10)) continue;
      const record = attendanceByUserDate.get(`${profile.id}:${date}`) ?? null;
      const ledger = resolveWorkday({ date, today, branchId: profile.branch_id, schedule: employeeSchedule, holidays, leaves: employeeLeaves, attendance: record, fallback: { userId: profile.id, arrival: profile.expected_arrival, departure: profile.expected_departure } });
      const scheduledMinutes = ledger.schedule.day_type === "off" ? 0 : Math.max(0, timeToMinutes(ledger.schedule.departure_time) - timeToMinutes(ledger.schedule.arrival_time));
      const worked = Number(record?.work_minutes ?? 0);
      lines.push([
        branch?.name, branch?.code, monthLabel(date), date,
        new Intl.DateTimeFormat("en", { timeZone: "UTC", weekday: "long" }).format(new Date(`${date}T12:00:00Z`)),
        profile.full_name, profile.employee_code, profile.email, ledger.schedule.day_type.replaceAll("_", " "),
        ledger.schedule.arrival_time.slice(0, 5), ledger.schedule.departure_time.slice(0, 5), `${Math.floor(scheduledMinutes / 60)}:${String(scheduledMinutes % 60).padStart(2, "0")}`,
        workdayStatusLabel(ledger.status), record?.status, clockTime(record?.clock_in ?? null, timezone), clockTime(record?.clock_out ?? null, timezone),
        record?.work_minutes == null ? "" : `${Math.floor(worked / 60)}:${String(worked % 60).padStart(2, "0")}`, record?.late_minutes, record?.early_leave_minutes,
        ledger.leave?.leave_type, ledger.leave?.portion, ledger.leave?.requested_days, ledger.leave?.reason, ledger.leave?.admin_note,
        ledger.holiday?.name || (ledger.status === "holiday" || ledger.status === "worked_on_holiday" ? "Official Sri Lanka holiday" : ""), ledger.holiday?.holiday_type, ledger.holiday?.source,
        record?.clock_in_distance_m, record?.clock_out_distance_m,
      ].map(csvCell).join(","));
    }
  }

  const branchLabel = parsed.data.branch_id === "all" ? "All-Branches" : `${branchNames}-${branchCodes}`;
  const filename = `Presence_${safeFilename(branchLabel)}_${safeFilename(periodLabel)}_Attendance-Ledger.csv`;
  return new NextResponse(`\uFEFF${lines.join("\r\n")}`, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "private, no-store" },
  });
}
