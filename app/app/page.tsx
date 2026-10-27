import { format } from "date-fns";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { localDateParts } from "@/lib/attendance";
import { loadCalendarNotes } from "@/lib/calendar-notes";
import { EmployeeDashboard } from "@/components/employee/employee-dashboard";
import type { AttendanceRecord, CalendarNote, LeaveRequest } from "@/lib/types";

export default async function EmployeePage() {
  const profile = await requireProfile();
  if (profile.role === "super_admin") redirect("/admin");
  const supabase = await createClient();
  const timezone = profile.branch?.timezone || "Asia/Colombo";
  const renderedAt = new Date();
  const today = localDateParts(renderedAt, timezone).date;
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const yearEnd = `${today.slice(0, 4)}-12-31`;
  const calendarEnd = `${Number(today.slice(0, 4)) + 1}-12-31`;

  const [{ data: todayRecord }, { data: attendance }, { data: leaves }, calendarNotes] = await Promise.all([
    supabase.from("attendance_records").select("*").eq("user_id", profile.id).eq("attendance_date", today).maybeSingle(),
    supabase.from("attendance_records").select("*, branch:branches(name, code)").eq("user_id", profile.id).order("attendance_date", { ascending: false }).limit(10),
    supabase.from("leave_requests").select("*").eq("user_id", profile.id).gte("start_date", yearStart).lte("start_date", yearEnd).order("created_at", { ascending: false }),
    loadCalendarNotes({ startDate: yearStart, endDate: calendarEnd, branchId: profile.branch_id }),
  ]);

  return (
    <EmployeeDashboard
      profile={profile}
      initialNow={renderedAt.toISOString()}
      today={today}
      todayLabel={format(new Date(`${today}T12:00:00`), "EEEE, d MMMM")}
      initialTodayRecord={(todayRecord as AttendanceRecord | null) ?? null}
      attendance={(attendance ?? []) as AttendanceRecord[]}
      leaves={(leaves ?? []) as LeaveRequest[]}
      calendarNotes={calendarNotes as CalendarNote[]}
    />
  );
}
