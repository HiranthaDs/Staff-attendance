import assert from "node:assert/strict";
import { defaultScheduleDay, resolveWorkday, scheduledLeaveDays } from "../lib/workday.ts";
import type { AttendanceRecord, CompanyHoliday, LeaveRequest, WorkScheduleDay } from "../lib/types.ts";

const schedule: WorkScheduleDay[] = Array.from({ length: 7 }, (_, index) => defaultScheduleDay(index + 1, "09:00", "17:00", "half_day", "off", "employee-1"));
assert.equal(schedule[5].day_type, "half_day");
assert.equal(schedule[5].arrival_time, "09:00");
assert.equal(schedule[5].departure_time, "14:00");
assert.equal(schedule[6].day_type, "off");

assert.equal(scheduledLeaveDays({ start: "2026-10-26", end: "2026-11-01", portion: "full_day", schedule }), 5.5);
assert.equal(scheduledLeaveDays({ start: "2026-10-31", end: "2026-10-31", portion: "full_day", schedule }), 0.5);
assert.equal(scheduledLeaveDays({ start: "2026-11-01", end: "2026-11-01", portion: "full_day", schedule }), 0);
assert.equal(scheduledLeaveDays({ start: "2026-10-31", end: "2026-10-31", portion: "first_half", schedule }), 0.5);
assert.equal(scheduledLeaveDays({ start: "2026-10-25", end: "2026-10-25", portion: "full_day", schedule }), 0);

const fullLeave = {
  id: "leave-1", user_id: "employee-1", start_date: "2026-10-27", end_date: "2026-10-27",
  leave_type: "annual", portion: "full_day", requested_days: 1, reason: "Family appointment",
  status: "approved", admin_note: null, created_at: "2026-10-01T00:00:00Z",
} satisfies LeaveRequest;
const halfLeave = { ...fullLeave, id: "leave-2", portion: "first_half" as const, requested_days: 0.5 };
const holiday = {
  id: "holiday-1", holiday_date: "2026-10-27", end_date: "2026-10-27", name: "Company holiday", holiday_type: "company",
  branch_id: null, status: "approved", source: "admin", source_reference: null, reason: "Company event",
  proposed_by: null, reviewed_by: null, review_note: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
} satisfies CompanyHoliday;
const attendance = {
  id: "attendance-1", user_id: "employee-1", branch_id: "branch-1", attendance_date: "2026-10-27",
  clock_in: "2026-10-27T03:00:00Z", clock_out: "2026-10-27T11:30:00Z", status: "present",
  work_minutes: 510, late_minutes: 0, early_leave_minutes: 0, clock_in_distance_m: 5, clock_out_distance_m: 6,
} satisfies AttendanceRecord;

const base = { today: "2026-10-28", branchId: "branch-1", schedule, holidays: [] as CompanyHoliday[], leaves: [] as LeaveRequest[], fallback: { userId: "employee-1", arrival: "09:00", departure: "17:00" } };
assert.equal(resolveWorkday({ ...base, date: "2026-10-27", leaves: [fullLeave] }).status, "approved_leave");
assert.equal(resolveWorkday({ ...base, date: "2026-10-27", leaves: [halfLeave] }).status, "leave_attendance_missing");
assert.equal(resolveWorkday({ ...base, date: "2026-10-27", leaves: [halfLeave], attendance }).status, "half_day_leave");
assert.equal(resolveWorkday({ ...base, date: "2026-10-27", holidays: [holiday], leaves: [fullLeave] }).status, "holiday");
assert.equal(resolveWorkday({ ...base, date: "2026-10-27", holidays: [holiday], attendance }).status, "worked_on_holiday");
assert.equal(resolveWorkday({ ...base, date: "2026-10-28", holidays: [{ ...holiday, holiday_date: "2026-10-27", end_date: "2026-10-29" }] }).status, "holiday");
assert.equal(resolveWorkday({ ...base, date: "2026-11-01" }).status, "scheduled_off");
assert.equal(resolveWorkday({ ...base, date: "2026-11-01", attendance: { ...attendance, attendance_date: "2026-11-01" } }).status, "worked_on_off_day");
assert.equal(resolveWorkday({ ...base, date: "2026-10-26" }).status, "absent");
assert.equal(resolveWorkday({ ...base, date: "2026-10-29" }).status, "scheduled");

console.log("Workday rules verified: holidays, leave, Saturday half-days, Sunday off-days, attendance and absence precedence.");
