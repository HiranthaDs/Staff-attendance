import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { localDateParts } from "@/lib/attendance";
import { EmployeeProfilePage } from "@/components/employee/profile-page";
import { loadWorkSchedule } from "@/lib/workday-data";
import { loadPayrollRecords, loadSalarySettings } from "@/lib/payroll-store";
import type { AttendanceRecord, LeaveRequest, PayrollRecord, SalarySettings } from "@/lib/types";

export default async function ProfilePage() {
  const profile = await requireProfile();
  if (profile.role === "super_admin") redirect("/admin");
  const supabase = await createClient();
  const today = localDateParts(new Date(), profile.branch?.timezone || "Asia/Colombo").date;
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const yearEnd = `${today.slice(0, 4)}-12-31`;
  const [{ data: attendance }, { data: leaves }, workSchedule, salarySettings, payrollRecords] = await Promise.all([
    supabase.from("attendance_records").select("*, branch:branches(name, code)").eq("user_id", profile.id).gte("attendance_date", yearStart).lte("attendance_date", yearEnd).order("attendance_date", { ascending: false }),
    supabase.from("leave_requests").select("*").eq("user_id", profile.id).lte("start_date", yearEnd).gte("end_date", yearStart).order("start_date", { ascending: false }),
    loadWorkSchedule(supabase, { userId: profile.id, arrival: profile.expected_arrival, departure: profile.expected_departure }),
    loadSalarySettings(supabase, [profile.id]),
    loadPayrollRecords(supabase, { userIds: [profile.id], staffVisibleOnly: true }),
  ]);
  return <EmployeeProfilePage profile={{ ...profile, work_schedule: workSchedule }} attendance={(attendance ?? []) as AttendanceRecord[]} leaves={(leaves ?? []) as LeaveRequest[]} salarySettings={(salarySettings[0] as SalarySettings | undefined) ?? null} payrollRecords={payrollRecords as PayrollRecord[]} />;
}
