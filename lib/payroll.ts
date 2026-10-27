import { addDays, addMonths, endOfMonth, format, parseISO, startOfMonth } from "date-fns";
import { approvedHolidayForDate, approvedLeaveForDate, dateRange, resolveWorkday, scheduleForDate, workdayStatusLabel } from "./workday.ts";
import type { AttendanceRecord, CompanyHoliday, LeaveRequest, PayCycle, PayrollSummary, Profile, WorkScheduleDay } from "./types.ts";

export function payrollPeriod(referenceMonth: string, cycle: PayCycle, customStartDay = 15) {
  const reference = parseISO(`${referenceMonth.slice(0, 7)}-01T12:00:00`);
  if (cycle === "calendar_month") {
    return { start: format(startOfMonth(reference), "yyyy-MM-dd"), end: format(endOfMonth(reference), "yyyy-MM-dd") };
  }
  const startDay = cycle === "fifteenth_cycle" ? 15 : Math.min(28, Math.max(1, customStartDay));
  const start = new Date(reference.getFullYear(), reference.getMonth(), startDay, 12);
  return { start: format(start, "yyyy-MM-dd"), end: format(addDays(addMonths(start, 1), -1), "yyyy-MM-dd") };
}

export function payrollCycleForStartDay(startDay: number): PayCycle {
  return startDay === 1 ? "calendar_month" : startDay === 15 ? "fifteenth_cycle" : "custom_cycle";
}

export function payrollCycleForPeriod(start: string, end: string, customStartDay = 15): PayCycle | null {
  const cycle = payrollCycleForStartDay(customStartDay);
  const expected = payrollPeriod(start.slice(0, 7), cycle, customStartDay);
  if (expected.start === start && expected.end === end) return cycle;
  return null;
}

export type PayrollDayRecord = {
  date: string;
  day_type: WorkScheduleDay["day_type"];
  scheduled_start: string;
  scheduled_finish: string;
  status: string;
  status_label: string;
  clock_in: string | null;
  clock_out: string | null;
  work_minutes: number;
};

export function summarizePayroll(input: {
  profile: Profile;
  start: string;
  end: string;
  today: string;
  schedule: WorkScheduleDay[];
  holidays: CompanyHoliday[];
  leaves: LeaveRequest[];
  attendance: AttendanceRecord[];
}): PayrollSummary {
  const summary: PayrollSummary = {
    period_start: input.start, period_end: input.end, calendar_days: 0, scheduled_days: 0,
    attendance_days: 0, attendance_units: 0, full_leave_days: 0, paid_leave_days: 0,
    unpaid_leave_days: 0, short_leave_count: 0, short_leave_days: 0, absent_days: 0,
    holiday_days: 0, off_days: 0, late_minutes: 0, early_leave_minutes: 0, worked_minutes: 0,
  };
  const records = new Map(input.attendance.map((row) => [row.attendance_date, row]));
  for (const date of dateRange(input.start, input.end)) {
    if (input.profile.created_at && date < input.profile.created_at.slice(0, 10)) continue;
    summary.calendar_days += 1;
    const schedule = scheduleForDate(input.schedule, date, { userId: input.profile.id, arrival: input.profile.expected_arrival, departure: input.profile.expected_departure });
    const unit = schedule.day_type === "full_day" ? 1 : schedule.day_type === "half_day" ? 0.5 : 0;
    const holiday = approvedHolidayForDate(input.holidays, date, input.profile.branch_id);
    const leave = approvedLeaveForDate(input.leaves, date);
    const attendance = records.get(date);
    // A holiday supersedes leave, and an inconsistent full-day-leave record must
    // never be counted alongside attendance. Short leave intentionally can be.
    const effectiveLeave = holiday || (leave?.portion === "full_day" && attendance?.clock_in) ? null : leave;
    summary.scheduled_days += unit;
    if (holiday) summary.holiday_days += 1;
    else if (schedule.day_type === "off") summary.off_days += 1;
    if (effectiveLeave?.portion === "full_day") {
      summary.full_leave_days += unit;
      if (effectiveLeave.leave_type === "unpaid") summary.unpaid_leave_days += unit;
      else summary.paid_leave_days += unit;
    } else if (effectiveLeave) {
      const shortUnit = Math.min(0.5, unit);
      summary.short_leave_count += 1;
      summary.short_leave_days += shortUnit;
      if (effectiveLeave.leave_type === "unpaid") summary.unpaid_leave_days += shortUnit;
      else summary.paid_leave_days += shortUnit;
    }
    if (attendance?.clock_in) {
      summary.attendance_days += 1;
      summary.attendance_units += unit || 1;
      summary.late_minutes += attendance.late_minutes || 0;
      summary.early_leave_minutes += attendance.early_leave_minutes || 0;
      summary.worked_minutes += attendance.work_minutes || 0;
    } else if (date < input.today && !holiday && unit > 0 && effectiveLeave?.portion !== "full_day") {
      summary.absent_days += Math.max(0, unit - (effectiveLeave ? 0.5 : 0));
    }
  }
  for (const key of Object.keys(summary) as Array<keyof PayrollSummary>) {
    if (typeof summary[key] === "number") (summary[key] as number) = Math.round((summary[key] as number) * 100) / 100;
  }
  return summary;
}

export function payrollDailyRecords(input: {
  profile: Profile;
  start: string;
  end: string;
  today: string;
  schedule: WorkScheduleDay[];
  holidays: CompanyHoliday[];
  leaves: LeaveRequest[];
  attendance: AttendanceRecord[];
}): PayrollDayRecord[] {
  const attendance = new Map(input.attendance.map((row) => [row.attendance_date, row]));
  return dateRange(input.start, input.end).flatMap((date) => {
    if (input.profile.created_at && date < input.profile.created_at.slice(0, 10)) return [];
    const resolved = resolveWorkday({
      date,
      today: input.today,
      branchId: input.profile.branch_id,
      schedule: input.schedule,
      holidays: input.holidays,
      leaves: input.leaves,
      attendance: attendance.get(date),
      fallback: { userId: input.profile.id, arrival: input.profile.expected_arrival, departure: input.profile.expected_departure },
    });
    return [{
      date,
      day_type: resolved.schedule.day_type,
      scheduled_start: resolved.schedule.arrival_time,
      scheduled_finish: resolved.schedule.departure_time,
      status: resolved.status,
      status_label: workdayStatusLabel(resolved.status),
      clock_in: resolved.attendance?.clock_in ?? null,
      clock_out: resolved.attendance?.clock_out ?? null,
      work_minutes: resolved.attendance?.work_minutes ?? 0,
    }];
  });
}

export function calculatePayrollMoney(input: {
  basicSalary: number;
  fixedAllowances: number;
  otherEarnings: number;
  attendanceDeduction: number;
  otherDeductions: number;
  epfEnabled: boolean;
}) {
  const money = (value: number) => Math.round(Math.max(0, value) * 100) / 100;
  const contributionBase = money(input.basicSalary + input.fixedAllowances - input.attendanceDeduction);
  const employeeEpf = input.epfEnabled ? money(contributionBase * 0.08) : 0;
  const employerEpf = input.epfEnabled ? money(contributionBase * 0.12) : 0;
  const employerEtf = input.epfEnabled ? money(contributionBase * 0.03) : 0;
  const grossPay = money(input.basicSalary + input.fixedAllowances + input.otherEarnings - input.attendanceDeduction);
  const netPay = money(grossPay - employeeEpf - input.otherDeductions);
  return { contributionBase, employeeEpf, employerEpf, employerEtf, grossPay, netPay };
}

export function suggestedAttendanceDeduction(basicSalary: number, summary: PayrollSummary) {
  if (basicSalary <= 0 || summary.scheduled_days <= 0) return 0;
  return Math.round((basicSalary / summary.scheduled_days) * (summary.absent_days + summary.unpaid_leave_days) * 100) / 100;
}
