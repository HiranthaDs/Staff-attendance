import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { localDateParts } from "@/lib/attendance";
import { isMigrationRequired } from "@/lib/database-errors";
import { calculatePayrollMoney, payrollDailyRecords, suggestedAttendanceDeduction, summarizePayroll } from "@/lib/payroll";
import { loadPayrollRecords, loadSalarySettings } from "@/lib/payroll-store";
import { loadCompanyHolidays } from "@/lib/workday-data";
import type { AttendanceRecord, LeaveRequest, PayrollRecord, Profile, SalarySettings, WorkScheduleDay } from "@/lib/types";

export type PayrollPreviewRow = {
  profile: Profile;
  summary: ReturnType<typeof summarizePayroll>;
  settings: SalarySettings;
  saved: PayrollRecord | null;
  suggested_attendance_deduction: number;
  preview_money: ReturnType<typeof calculatePayrollMoney>;
  daily_records: ReturnType<typeof payrollDailyRecords>;
};

export async function buildPayrollPreview(client: SupabaseClient, input: { start: string; end: string; branchId?: string | null; userId?: string }) {
  let profilesQuery = client.from("profiles").select("*, branch:branches(*)").neq("role", "super_admin").order("full_name");
  if (input.branchId) profilesQuery = profilesQuery.eq("branch_id", input.branchId);
  if (input.userId) profilesQuery = profilesQuery.eq("id", input.userId);
  const profilesResult = await profilesQuery;
  if (profilesResult.error) throw profilesResult.error;
  const profiles = ((profilesResult.data ?? []) as unknown as Profile[]).filter((profile) => !profile.created_at || profile.created_at.slice(0, 10) <= input.end);
  const userIds = profiles.map((profile) => profile.id);
  if (!userIds.length) return [];
  const [attendanceResult, leaveResult, scheduleResult, holidays, settings, saved] = await Promise.all([
    client.from("attendance_records").select("*").in("user_id", userIds).gte("attendance_date", input.start).lte("attendance_date", input.end),
    client.from("leave_requests").select("*").in("user_id", userIds).eq("status", "approved").lte("start_date", input.end).gte("end_date", input.start),
    client.from("employee_work_schedules").select("user_id,weekday,day_type,arrival_time,departure_time").in("user_id", userIds),
    loadCompanyHolidays(client, { startDate: input.start, endDate: input.end, includeAllBranches: true }),
    loadSalarySettings(client, userIds),
    loadPayrollRecords(client, { userIds, start: input.start, end: input.end }),
  ]);
  if (attendanceResult.error || leaveResult.error) throw attendanceResult.error || leaveResult.error;
  if (scheduleResult.error && !isMigrationRequired(scheduleResult.error)) throw scheduleResult.error;
  const attendance = (attendanceResult.data ?? []) as AttendanceRecord[];
  const leaves = (leaveResult.data ?? []) as LeaveRequest[];
  const schedules = (scheduleResult.data ?? []) as WorkScheduleDay[];
  const settingMap = new Map(settings.map((item) => [item.user_id, item]));
  const savedMap = new Map(saved.filter((item) => item.period_start === input.start && item.period_end === input.end).map((item) => [item.user_id, item]));
  const today = localDateParts(new Date(), "Asia/Colombo").date;
  return profiles.map((profile): PayrollPreviewRow => {
    const setting = settingMap.get(profile.id) ?? { user_id: profile.id, basic_salary: 0, fixed_allowances: 0, pay_cycle: "calendar_month", epf_enabled: true, currency: "LKR", updated_at: new Date(0).toISOString() } satisfies SalarySettings;
    const employeeSchedule = schedules.filter((row) => row.user_id === profile.id);
    const employeeLeaves = leaves.filter((row) => row.user_id === profile.id);
    const employeeAttendance = attendance.filter((row) => row.user_id === profile.id);
    const payrollInput = { profile, start: input.start, end: input.end, today, schedule: employeeSchedule, holidays, leaves: employeeLeaves, attendance: employeeAttendance };
    const summary = summarizePayroll(payrollInput);
    const deduction = suggestedAttendanceDeduction(setting.basic_salary, summary);
    return {
      profile,
      summary,
      settings: setting,
      saved: savedMap.get(profile.id) ?? null,
      suggested_attendance_deduction: deduction,
      preview_money: calculatePayrollMoney({ basicSalary: setting.basic_salary, fixedAllowances: setting.fixed_allowances, otherEarnings: 0, attendanceDeduction: deduction, otherDeductions: 0, epfEnabled: setting.epf_enabled }),
      daily_records: payrollDailyRecords(payrollInput),
    };
  });
}
