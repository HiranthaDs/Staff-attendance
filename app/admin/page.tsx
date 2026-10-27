import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { localDateParts } from "@/lib/attendance";
import { loadCalendarNotes } from "@/lib/calendar-notes";
import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { loadCompanyHolidays } from "@/lib/workday-data";
import type { AttendanceRecord, Branch, BranchSetupInvite, BranchSetupSubmission, CalendarNote, CompanyHoliday, LeaveRequest, Profile } from "@/lib/types";

export default async function AdminPage() {
  const profile = await requireAdmin();
  const supabase = await createClient();
  const today = localDateParts(new Date(), "Asia/Colombo").date;
  const branchFilter = profile.role === "branch_admin" ? profile.branch_id : null;

  let staffQuery = supabase.from("profiles").select("*, branch:branches(*)").neq("role", "super_admin").order("full_name");
  let branchesQuery = supabase.from("branches").select("*").order("name");
  let attendanceQuery = supabase.from("attendance_records").select("*, profile:profiles(full_name, employee_code), branch:branches(name, code)").gte("attendance_date", `${today.slice(0, 7)}-01`).order("clock_in", { ascending: false }).limit(250);
  const leaveQuery = supabase.from("leave_requests").select("*, profile:profiles(full_name, employee_code, branch_id)").order("created_at", { ascending: false }).limit(100);
  const setupInvitesQuery = supabase.from("branch_setup_invites").select("id, proposed_name, proposed_code, radius_m, verification_mode, status, expires_at, created_at, submitted_at, approved_at").order("created_at", { ascending: false }).limit(100);
  const setupSubmissionsQuery = supabase.from("branch_setup_submissions").select("*, invite:branch_setup_invites(id, proposed_name, proposed_code, radius_m, verification_mode, status, expires_at, created_at, submitted_at, approved_at)").order("submitted_at", { ascending: false }).limit(100);
  const workSchedulesQuery = supabase.from("employee_work_schedules").select("user_id,weekday,day_type,arrival_time,departure_time");
  const calendarNotesQuery = loadCalendarNotes({
    startDate: `${today.slice(0, 4)}-01-01`,
    endDate: `${Number(today.slice(0, 4)) + 1}-12-31`,
    includeAllBranches: true,
  });
  const holidaysQuery = loadCompanyHolidays(supabase, {
    startDate: `${today.slice(0, 4)}-01-01`,
    endDate: `${Number(today.slice(0, 4)) + 1}-12-31`,
    includePending: true,
    includeAllBranches: true,
  });

  if (branchFilter) {
    staffQuery = staffQuery.eq("branch_id", branchFilter);
    branchesQuery = branchesQuery.eq("id", branchFilter);
    attendanceQuery = attendanceQuery.eq("branch_id", branchFilter);
  }

  const [staffResult, branchesResult, attendanceResult, leavesResult, setupInvitesResult, setupSubmissionsResult, calendarNotesResult, holidaysResult, workSchedulesResult] = await Promise.all([
    staffQuery,
    branchesQuery,
    attendanceQuery,
    leaveQuery,
    setupInvitesQuery,
    setupSubmissionsQuery,
    calendarNotesQuery,
    holidaysQuery,
    workSchedulesQuery,
  ]);

  const leaves = ((leavesResult.data ?? []) as (LeaveRequest & { profile?: Profile })[]).filter(
    (leave) => !branchFilter || leave.profile?.branch_id === branchFilter,
  );

  return (
    <AdminDashboard
      admin={profile}
      today={today}
      initialBranches={(branchesResult.data ?? []) as Branch[]}
      initialStaff={((staffResult.data ?? []) as Profile[]).map((person) => ({ ...person, work_schedule: (workSchedulesResult.data ?? []).filter((day) => day.user_id === person.id) }))}
      attendance={(attendanceResult.data ?? []) as AttendanceRecord[]}
      initialLeaves={leaves}
      initialSetupInvites={(setupInvitesResult.data ?? []) as BranchSetupInvite[]}
      initialSetupSubmissions={(setupSubmissionsResult.data ?? []) as BranchSetupSubmission[]}
      initialCalendarNotes={calendarNotesResult as CalendarNote[]}
      initialHolidays={holidaysResult as CompanyHoliday[]}
    />
  );
}
