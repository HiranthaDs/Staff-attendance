import { isSriLankaHoliday } from "./sri-lanka-holidays.ts";
import type { AttendanceRecord, CompanyHoliday, LeaveRequest, WorkScheduleDay, WorkdayType } from "./types.ts";

export type WorkdayLedgerStatus =
  | "holiday"
  | "worked_on_holiday"
  | "approved_leave"
  | "half_day_leave"
  | "leave_attendance_missing"
  | "scheduled_off"
  | "worked_on_off_day"
  | "present"
  | "late"
  | "partial"
  | "absent"
  | "scheduled";

export type ResolvedWorkday = {
  date: string;
  schedule: WorkScheduleDay;
  holiday: CompanyHoliday | null;
  leave: LeaveRequest | null;
  attendance: AttendanceRecord | null;
  status: WorkdayLedgerStatus;
};

const DEFAULT_ARRIVAL = "09:00";
const DEFAULT_DEPARTURE = "17:00";
const DEFAULT_SATURDAY_DEPARTURE = "14:00";

export function isoWeekday(date: string) {
  const sundayBased = new Date(`${date}T12:00:00Z`).getUTCDay();
  return sundayBased === 0 ? 7 : sundayBased;
}

export function defaultScheduleDay(
  weekday: number,
  arrival = DEFAULT_ARRIVAL,
  departure = DEFAULT_DEPARTURE,
  saturdayType: WorkdayType = "half_day",
  sundayType: WorkdayType = "off",
  userId = "",
): WorkScheduleDay {
  const dayType: WorkdayType = weekday === 6 ? saturdayType : weekday === 7 ? sundayType : "full_day";
  const candidateSaturdayDeparture = departure < DEFAULT_SATURDAY_DEPARTURE ? departure : DEFAULT_SATURDAY_DEPARTURE;
  const saturdayDeparture = candidateSaturdayDeparture > arrival ? candidateSaturdayDeparture : departure;
  return {
    user_id: userId,
    weekday,
    day_type: dayType,
    arrival_time: arrival,
    departure_time: weekday === 6 && dayType === "half_day" ? saturdayDeparture : departure,
  };
}

export function scheduleForDate(
  schedule: WorkScheduleDay[],
  date: string,
  fallback?: { userId?: string; arrival?: string; departure?: string },
) {
  const weekday = isoWeekday(date);
  return schedule.find((day) => day.weekday === weekday)
    ?? defaultScheduleDay(weekday, fallback?.arrival, fallback?.departure, "half_day", "off", fallback?.userId);
}

export function dateRange(start: string, end: string) {
  const dates: string[] = [];
  for (let cursor = new Date(`${start}T12:00:00Z`); cursor <= new Date(`${end}T12:00:00Z`); cursor = new Date(cursor.getTime() + 86_400_000)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

export function approvedHolidayForDate(holidays: CompanyHoliday[], date: string, branchId?: string | null) {
  return holidays.find((holiday) => holiday.status === "approved"
    && holiday.holiday_date <= date
    && (holiday.end_date || holiday.holiday_date) >= date
    && (holiday.branch_id === null || holiday.branch_id === branchId)) ?? null;
}

export function approvedLeaveForDate(leaves: LeaveRequest[], date: string) {
  return leaves.find((leave) => leave.status === "approved" && leave.start_date <= date && leave.end_date >= date) ?? null;
}

export function resolveWorkday(input: {
  date: string;
  today: string;
  branchId?: string | null;
  schedule: WorkScheduleDay[];
  holidays: CompanyHoliday[];
  leaves: LeaveRequest[];
  attendance?: AttendanceRecord | null;
  fallback?: { userId?: string; arrival?: string; departure?: string };
}): ResolvedWorkday {
  const schedule = scheduleForDate(input.schedule, input.date, input.fallback);
  const holiday = approvedHolidayForDate(input.holidays, input.date, input.branchId);
  const leave = approvedLeaveForDate(input.leaves, input.date);
  const attendance = input.attendance ?? null;
  const officialHoliday = holiday || isSriLankaHoliday(input.date);

  let status: WorkdayLedgerStatus;
  if (officialHoliday) status = attendance ? "worked_on_holiday" : "holiday";
  else if (leave?.portion === "full_day") status = attendance ? "present" : "approved_leave";
  else if (schedule.day_type === "off") status = attendance ? "worked_on_off_day" : "scheduled_off";
  else if (leave && attendance) status = "half_day_leave";
  else if (leave && input.date < input.today) status = "leave_attendance_missing";
  else if (attendance) status = attendance.status;
  else status = input.date < input.today ? "absent" : "scheduled";

  return { date: input.date, schedule, holiday, leave, attendance, status };
}

export function scheduledLeaveDays(input: {
  start: string;
  end: string;
  portion: LeaveRequest["portion"];
  schedule: WorkScheduleDay[];
  holidayDates?: Set<string>;
  fallback?: { userId?: string; arrival?: string; departure?: string };
}) {
  let days = 0;
  for (const date of dateRange(input.start, input.end)) {
    if (input.holidayDates?.has(date) || isSriLankaHoliday(date)) continue;
    const scheduled = scheduleForDate(input.schedule, date, input.fallback);
    const fraction = scheduled.day_type === "full_day" ? 1 : scheduled.day_type === "half_day" ? 0.5 : 0;
    days += input.portion === "full_day" ? fraction : Math.min(0.5, fraction);
  }
  return days;
}

export function workdayStatusLabel(status: WorkdayLedgerStatus) {
  const labels: Record<WorkdayLedgerStatus, string> = {
    holiday: "Holiday",
    worked_on_holiday: "Worked on holiday",
    approved_leave: "Approved leave",
    half_day_leave: "Half-day leave + attendance",
    leave_attendance_missing: "Half-day leave - attendance missing",
    scheduled_off: "Scheduled off",
    worked_on_off_day: "Worked on off day",
    present: "Present",
    late: "Late",
    partial: "Partial attendance",
    absent: "Absent",
    scheduled: "Scheduled / not yet marked",
  };
  return labels[status];
}
