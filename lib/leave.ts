import { scheduledLeaveDays } from "@/lib/workday";
import type { LeaveRequest, WorkScheduleDay } from "@/lib/types";

export function businessLeaveDays(start: string, end: string, halfDay: boolean) {
  return scheduledLeaveDays({ start, end, portion: halfDay ? "first_half" : "full_day", schedule: [] });
}

export function employeeLeaveDays(input: {
  start: string;
  end: string;
  portion: LeaveRequest["portion"];
  schedule: WorkScheduleDay[];
  holidayDates: Set<string>;
  fallback: { userId: string; arrival: string; departure: string };
}) {
  return scheduledLeaveDays(input);
}
