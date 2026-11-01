import { requireSuperAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { SuperAdminDashboard, type PlatformDailyRow, type PlatformLateAttendance } from "@/components/super-admin/super-admin-dashboard";
import { localDateParts } from "@/lib/attendance";
import type { Organization, OrganizationInvitation, PlatformHotline } from "@/lib/types";

export default async function SuperAdminPage() {
  const profile = await requireSuperAdmin();
  const admin = createAdminClient();
  const today = localDateParts(new Date(), "Asia/Colombo").date;
  const [organizationsResult, invitationsResult, dailyResult, lateResult, hotlinesResult] = await Promise.all([
    admin.rpc("platform_organization_summary", { p_actor_id: profile.id }),
    admin.from("organization_invitations").select("id,organization_id,branch_id,invited_email,role,full_name,phone,employee_code,job_title,status,expires_at,accepted_at,created_at").eq("role", "company_admin").order("created_at", { ascending: false }),
    admin.rpc("platform_daily_overview", { p_actor_id: profile.id, p_date: today }),
    admin.from("attendance_records")
      .select("id,attendance_date,clock_in,clock_out,status,late_minutes,early_leave_minutes,work_minutes,branch_id,user_id,profile:profiles(id,full_name,employee_code,avatar_path,organization_id,organization:organizations(name,slug)),branch:branches(name,code)")
      .eq("attendance_date", today).gt("late_minutes", 0).order("late_minutes", { ascending: false }).limit(30),
    admin.from("platform_hotlines").select("id,label,phone_e164,availability,call_enabled,whatsapp_enabled,active,sort_order,created_at,updated_at").order("sort_order").order("created_at"),
  ]);
  const organizations = ((organizationsResult.data ?? []) as Array<Organization & { owner_id: string | null; owner_name: string | null; owner_email: string | null; owner_avatar_path: string | null }>).map((organization) => ({
    ...organization,
    member_count: Number(organization.member_count ?? 0),
    branch_count: Number(organization.branch_count ?? 0),
    owner: organization.owner_id ? { id: organization.owner_id, full_name: organization.owner_name || "Company owner", email: organization.owner_email || undefined, avatar_path: organization.owner_avatar_path } : null,
  }));
  return <SuperAdminDashboard
    admin={profile}
    today={today}
    initialOrganizations={organizations}
    initialInvitations={(invitationsResult.data ?? []) as OrganizationInvitation[]}
    dailyByOrganization={((dailyResult.data ?? []) as PlatformDailyRow[]).map((row) => ({
      ...row,
      active_members: Number(row.active_members ?? 0),
      present_today: Number(row.present_today ?? 0),
      late_today: Number(row.late_today ?? 0),
      open_shifts: Number(row.open_shifts ?? 0),
      pending_leave: Number(row.pending_leave ?? 0),
    }))}
    lateAttendance={(lateResult.data ?? []) as unknown as PlatformLateAttendance[]}
    initialHotlines={(hotlinesResult.data ?? []) as PlatformHotline[]}
  />;
}
