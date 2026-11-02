import { SuperAdminDashboard, type PlatformDailyRow, type PlatformGrowthPoint, type PlatformLateAttendance, type PlatformRegistration } from "@/components/super-admin/super-admin-dashboard";
import { localDateParts } from "@/lib/attendance";
import { requireSystemOwner } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Organization, OrganizationInvitation, PlatformHotline, StaffDeviceDirectoryRow } from "@/lib/types";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export default async function SystemOwnerPage() {
  const profile = await requireSystemOwner();
  const admin = createAdminClient();
  const now = new Date();
  const today = localDateParts(now, "Asia/Colombo").date;
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const growthStart = new Date(now.getTime() - (8 * WEEK_MS)).toISOString();

  const [organizationsResult, organizationDetailsResult, invitationsResult, dailyResult, lateResult, hotlinesResult, devicesResult, registrationsResult, growthResult, companyAdminsResult, employeesResult, branchesResult, newThisMonthResult] = await Promise.all([
    admin.rpc("platform_organization_summary", { p_actor_id: profile.id }),
    admin.from("organizations").select("id,legal_name,registration_number,industry,phone,website,address,city,country,timezone"),
    admin.from("organization_invitations").select("id,organization_id,branch_id,invited_email,role,full_name,phone,employee_code,job_title,status,expires_at,accepted_at,created_at").eq("role", "company_admin").order("created_at", { ascending: false }),
    admin.rpc("platform_daily_overview", { p_actor_id: profile.id, p_date: today }),
    admin.from("attendance_records")
      .select("id,attendance_date,clock_in,clock_out,status,late_minutes,early_leave_minutes,work_minutes,branch_id,user_id,profile:profiles(id,full_name,employee_code,avatar_path,organization_id,organization:organizations(name,slug)),branch:branches(name,code)")
      .eq("attendance_date", today).gt("late_minutes", 0).order("late_minutes", { ascending: false }).limit(30),
    admin.from("platform_hotlines").select("id,label,phone_e164,availability,call_enabled,whatsapp_enabled,active,sort_order,created_at,updated_at").order("sort_order").order("created_at"),
    admin.rpc("platform_staff_device_directory", { p_actor_id: profile.id }),
    admin.from("profiles").select("id,full_name,email,role,active,created_at,organization:organizations(name,slug),branch:branches(name,code)").neq("role", "super_admin").not("organization_id", "is", null).order("created_at", { ascending: false }).limit(100),
    admin.from("profiles").select("created_at").in("role", ["branch_admin", "staff"]).not("organization_id", "is", null).gte("created_at", growthStart),
    admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "company_admin").eq("active", true),
    admin.from("profiles").select("id", { count: "exact", head: true }).in("role", ["branch_admin", "staff"]).eq("active", true),
    admin.from("branches").select("id", { count: "exact", head: true }).eq("active", true),
    admin.from("profiles").select("id", { count: "exact", head: true }).in("role", ["branch_admin", "staff"]).not("organization_id", "is", null).gte("created_at", monthStart),
  ]);

  const detailsById = new Map((organizationDetailsResult.data ?? []).map((item) => [item.id as string, item]));
  const organizations = ((organizationsResult.data ?? []) as Array<Organization & { owner_id: string | null; owner_name: string | null; owner_email: string | null; owner_avatar_path: string | null }>).map((organization) => ({
    ...organization,
    ...(detailsById.get(organization.id) ?? {}),
    member_count: Number(organization.member_count ?? 0),
    branch_count: Number(organization.branch_count ?? 0),
    owner: organization.owner_id ? { id: organization.owner_id, full_name: organization.owner_name || "Company super admin", email: organization.owner_email || undefined, avatar_path: organization.owner_avatar_path } : null,
  }));

  return <SuperAdminDashboard
    admin={profile}
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
    initialDeviceDirectory={(devicesResult.data ?? []) as StaffDeviceDirectoryRow[]}
    recentRegistrations={(registrationsResult.data ?? []) as unknown as PlatformRegistration[]}
    registrationGrowth={buildGrowthSeries((growthResult.data ?? []) as Array<{ created_at: string }>, now)}
    totals={{
      companies: organizations.length,
      activeCompanies: organizations.filter((organization) => organization.status === "active").length,
      companyAdmins: companyAdminsResult.count ?? 0,
      employees: employeesResult.count ?? 0,
      branches: branchesResult.count ?? 0,
      newThisMonth: newThisMonthResult.count ?? 0,
    }}
  />;
}

function buildGrowthSeries(rows: Array<{ created_at: string }>, now: Date): PlatformGrowthPoint[] {
  return Array.from({ length: 8 }, (_, index) => {
    const weeksAgo = 7 - index;
    const start = new Date(now.getTime() - ((weeksAgo + 1) * WEEK_MS));
    const end = new Date(now.getTime() - (weeksAgo * WEEK_MS));
    return {
      label: new Intl.DateTimeFormat("en-LK", { month: "short", day: "numeric", timeZone: "Asia/Colombo" }).format(end),
      registrations: rows.filter((row) => { const created = new Date(row.created_at); return created >= start && created < end; }).length,
    };
  });
}
