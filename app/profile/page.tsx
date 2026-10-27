import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { localDateParts } from "@/lib/attendance";
import { EmployeeProfilePage } from "@/components/employee/profile-page";
import type { AttendanceRecord, LeaveRequest } from "@/lib/types";

export default async function ProfilePage() {
  const profile = await requireProfile();
  if (profile.role === "super_admin") redirect("/admin");
  const supabase = await createClient();
  const today = localDateParts(new Date(), profile.branch?.timezone || "Asia/Colombo").date;
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const yearEnd = `${today.slice(0, 4)}-12-31`;
  const [{ data: attendance }, { data: leaves }] = await Promise.all([
    supabase.from("attendance_records").select("*, branch:branches(name, code)").eq("user_id", profile.id).gte("attendance_date", yearStart).lte("attendance_date", yearEnd).order("attendance_date", { ascending: false }),
    supabase.from("leave_requests").select("*").eq("user_id", profile.id).lte("start_date", yearEnd).gte("end_date", yearStart).order("start_date", { ascending: false }),
  ]);
  return <EmployeeProfilePage profile={profile} attendance={(attendance ?? []) as AttendanceRecord[]} leaves={(leaves ?? []) as LeaveRequest[]} />;
}
