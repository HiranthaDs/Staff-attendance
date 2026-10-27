"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import {
  Banknote,
  Bell,
  Building2,
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
  CalendarRange,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Copy,
  Download,
  Gauge,
  HelpCircle,
  LayoutDashboard,
  Link2,
  LifeBuoy,
  LoaderCircle,
  LogOut,
  MapPin,
  Mail,
  Menu,
  MoreHorizontal,
  Pencil,
  Plus,
  Phone,
  KeyRound,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { MapPicker } from "@/components/admin/map-picker";
import { BranchMap } from "@/components/admin/branch-map";
import { BranchSetupView } from "@/components/admin/branch-setup-view";
import { WorkCalendar } from "@/components/calendar/work-calendar";
import { NotificationCenter } from "@/components/notifications/notification-center";
import { PayrollView } from "@/components/admin/payroll-view";
import { captureBestBrowserLocation } from "@/lib/browser-location";
import { createClient } from "@/lib/supabase/client";
import { currentPushSubscription, enablePushNotifications } from "@/lib/push-client";
import { approvedHolidayForDate, approvedLeaveForDate, defaultScheduleDay, scheduleForDate } from "@/lib/workday";
import type { AttendanceRecord, Branch, BranchSetupInvite, BranchSetupSubmission, CalendarNote, CompanyHoliday, LeaveRequest, PayrollRecord, Profile, SalarySettings, SupportIssue, WorkScheduleDay, WorkdayType } from "@/lib/types";

type Tab = "overview" | "branches" | "staff" | "attendance" | "leave" | "payroll" | "calendar" | "setup" | "settings";

export function AdminDashboard({ admin, today, initialBranches, initialStaff, attendance, initialLeaves, initialSetupInvites, initialSetupSubmissions, initialCalendarNotes, initialHolidays }: { admin: Profile; today: string; initialBranches: Branch[]; initialStaff: Profile[]; attendance: AttendanceRecord[]; initialLeaves: LeaveRequest[]; initialSetupInvites: BranchSetupInvite[]; initialSetupSubmissions: BranchSetupSubmission[]; initialCalendarNotes: CalendarNote[]; initialHolidays: CompanyHoliday[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [branches, setBranches] = useState(initialBranches);
  const [staff, setStaff] = useState(initialStaff);
  const [leaves, setLeaves] = useState(initialLeaves);
  const [branchModal, setBranchModal] = useState(false);
  const [staffModal, setStaffModal] = useState(false);
  const [leaveModalUserId, setLeaveModalUserId] = useState<string | null>(null);
  const [staffModalBranchId, setStaffModalBranchId] = useState<string | undefined>();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState("");
  const todaysAttendance = attendance.filter((row) => row.attendance_date === today);
  const pendingLeaves = leaves.filter((leave) => leave.status === "pending");
  const activeStaff = staff.filter((person) => person.active);
  const expectedStaff = activeStaff.filter((person) => {
    const schedule = scheduleForDate(person.work_schedule ?? [], today, { userId: person.id, arrival: person.expected_arrival, departure: person.expected_departure });
    const holiday = approvedHolidayForDate(initialHolidays, today, person.branch_id);
    const leave = approvedLeaveForDate(leaves.filter((item) => item.user_id === person.id), today);
    return schedule.day_type !== "off" && !holiday && leave?.portion !== "full_day";
  });
  const attendanceRate = expectedStaff.length ? Math.min(100, Math.round((todaysAttendance.length / expectedStaff.length) * 100)) : 100;

  async function logout() { await createClient().auth.signOut(); router.replace("/login"); }
  function navigate(next: Tab) { setTab(next); setSidebarOpen(false); }
  function openStaffModal(branchId?: string) { setStaffModalBranchId(branchId); setStaffModal(true); }
  const filteredStaff = staff.filter((person) => `${person.full_name} ${person.email} ${person.employee_code}`.toLowerCase().includes(search.toLowerCase()));

  const isSuperAdmin = admin.role === "super_admin";
  return <main className="admin-shell">
    <aside className={`admin-sidebar ${sidebarOpen ? "open" : ""}`}>
      <div className="sidebar-brand"><Brand light /><button className="sidebar-close" onClick={() => setSidebarOpen(false)}><X size={20} /></button></div>
      <div className="workspace-chip"><span className="workspace-logo">H</span><div><small>WORKSPACE</small><strong>Head Office</strong></div><ChevronDown size={16} /></div>
      <nav className="side-nav">
        <NavButton active={tab === "overview"} icon={<LayoutDashboard />} label="Overview" onClick={() => navigate("overview")} />
        <NavButton active={tab === "branches"} icon={<Building2 />} label="Branches" count={branches.length} onClick={() => navigate("branches")} />
        <NavButton active={tab === "staff"} icon={<Users />} label="People" count={staff.length} onClick={() => navigate("staff")} />
        <NavButton active={tab === "attendance"} icon={<ClipboardCheck />} label="Attendance" onClick={() => navigate("attendance")} />
        <NavButton active={tab === "leave"} icon={<CalendarCheck />} label="Leave requests" count={pendingLeaves.length || undefined} onClick={() => navigate("leave")} />
        <NavButton active={tab === "payroll"} icon={<Banknote />} label="Salary creation" onClick={() => navigate("payroll")} />
        <NavButton active={tab === "calendar"} icon={<CalendarDays />} label="Team calendar" onClick={() => navigate("calendar")} />
        {isSuperAdmin && <NavButton active={tab === "setup"} icon={<Link2 />} label="Branch setup" count={initialSetupSubmissions.filter((item) => !item.created_branch_id).length || undefined} onClick={() => navigate("setup")} />}
      </nav>
      <div className="side-nav secondary"><button className={tab === "settings" ? "active" : ""} onClick={() => navigate("settings")}><Settings size={19} /><span>Settings</span></button><button onClick={() => navigate("settings")}><HelpCircle size={19} /><span>Help & setup</span></button></div>
      <div className="sidebar-user"><span className="avatar avatar-sm">{initials(admin.full_name)}</span><div><strong>{admin.full_name}</strong><small>{isSuperAdmin ? "Super administrator" : "Branch administrator"}</small></div><button onClick={logout}><LogOut size={17} /></button></div>
    </aside>
    {sidebarOpen && <button className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="Close navigation" />}

    <section className="admin-main">
      <header className="admin-topbar">
        <button className="menu-button" onClick={() => setSidebarOpen(true)}><Menu size={22} /></button>
        <div className="admin-search"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people, branches or records…" /></div>
        <div className="topbar-actions"><NotificationCenter /><span className="topbar-divider" /><div className="topbar-user"><span className="avatar avatar-sm">{initials(admin.full_name)}</span><div><strong>{admin.full_name}</strong><small>{isSuperAdmin ? "Super admin" : "Branch admin"}</small></div></div></div>
      </header>

      <div className="admin-content">
        {tab === "overview" && <Overview admin={admin} branches={branches} staff={activeStaff} expectedStaff={expectedStaff} today={today} todaysAttendance={todaysAttendance} pendingLeaves={pendingLeaves} attendanceRate={attendanceRate} onAddStaff={() => openStaffModal()} onAddBranch={() => setBranchModal(true)} onNavigate={navigate} canManageBranches={isSuperAdmin} />}
        {tab === "branches" && <BranchesView branches={branches} staff={staff} onAdd={() => setBranchModal(true)} onAddStaff={openStaffModal} canAdd={isSuperAdmin} onUpdated={(updated) => setBranches((current) => current.map((branch) => branch.id === updated.id ? updated : branch))} />}
        {tab === "staff" && <StaffView staff={filteredStaff} branches={branches} today={today} calendarNotes={initialCalendarNotes} holidays={initialHolidays} onAdd={() => openStaffModal()} onRecordLeave={(userId) => setLeaveModalUserId(userId)} canManageSchedules={isSuperAdmin} onUpdated={(updated) => setStaff((current) => current.map((person) => person.id === updated.id ? updated : person))} />}
        {tab === "attendance" && <AttendanceView rows={attendance} branches={branches} today={today} />}
        {tab === "leave" && <LeaveView leaves={leaves} onUpdate={(updated) => setLeaves((current) => current.map((leave) => leave.id === updated.id ? updated : leave))} onCreate={() => setLeaveModalUserId("")} />}
        {tab === "payroll" && <PayrollView branches={branches} today={today} />}
        {tab === "calendar" && <><div className="page-heading"><div><span className="eyebrow">TEAM SCHEDULE</span><h1>Calendar</h1><p>Approve holiday suggestions and publish auditable workday changes.</p></div></div><WorkCalendar today={today} initialNotes={initialCalendarNotes} initialHolidays={initialHolidays} canManage branches={branches} title="Company calendar" /></>}
        {tab === "setup" && isSuperAdmin && <BranchSetupView initialInvites={initialSetupInvites} initialSubmissions={initialSetupSubmissions} onBranchCreated={(branch) => setBranches((current) => current.some((item) => item.id === branch.id) ? current : [...current, branch])} />}
        {tab === "settings" && <SettingsView branches={branches} today={today} />}
      </div>
    </section>

    {branchModal && isSuperAdmin && <BranchModal onClose={() => setBranchModal(false)} onCreated={(branch) => { setBranches((current) => [...current, branch]); setBranchModal(false); }} />}
    {staffModal && <StaffModal branches={branches} defaultBranchId={staffModalBranchId} onClose={() => setStaffModal(false)} onCreated={(person) => setStaff((current) => current.some((item) => item.id === person.id) ? current : [...current, person])} />}
    {leaveModalUserId !== null && <AdminLeaveModal staff={staff} defaultUserId={leaveModalUserId || undefined} onClose={() => setLeaveModalUserId(null)} onCreated={(leave) => { setLeaves((current) => [leave, ...current]); setLeaveModalUserId(null); }} />}
  </main>;
}

function Overview({ admin, branches, staff, expectedStaff, today, todaysAttendance, pendingLeaves, attendanceRate, onAddStaff, onAddBranch, onNavigate, canManageBranches }: { admin: Profile; branches: Branch[]; staff: Profile[]; expectedStaff: Profile[]; today: string; todaysAttendance: AttendanceRecord[]; pendingLeaves: LeaveRequest[]; attendanceRate: number; onAddStaff: () => void; onAddBranch: () => void; onNavigate: (tab: Tab) => void; canManageBranches: boolean }) {
  const late = todaysAttendance.filter((row) => row.status === "late").length;
  return <>
    <div className="page-heading"><div><span className="eyebrow">{format(parseISO(today), "EEEE, d MMMM yyyy")}</span><h1>Good {new Date().getHours() < 12 ? "morning" : "afternoon"}, {admin.full_name.split(" ")[0]}.</h1><p>Here’s what’s happening across your offices today.</p></div><div className="heading-actions"><button className="button button-ghost" onClick={() => onNavigate("attendance")}><Download size={17} /> Export</button><button className="button button-primary" onClick={onAddStaff}><Plus size={17} /> Add staff</button></div></div>
    <div className="stats-grid">
      <StatCard label="Present today" value={`${todaysAttendance.length}`} detail={`of ${expectedStaff.length} scheduled today`} icon={<ClipboardCheck />} tone="green" />
      <StatCard label="Attendance rate" value={`${attendanceRate}%`} detail={attendanceRate >= 90 ? "Strong start today" : "Across all branches"} icon={<Gauge />} tone="navy" />
      <StatCard label="Late arrivals" value={`${late}`} detail={late ? "Need attention" : "Everyone is on time"} icon={<Clock3 />} tone="amber" />
      <StatCard label="Pending leave" value={`${pendingLeaves.length}`} detail="Awaiting your review" icon={<CalendarCheck />} tone="violet" />
    </div>
    <div className="overview-grid">
      <section className="panel attendance-panel"><PanelHead eyebrow="LIVE TODAY" title="Attendance board" action="View all" onClick={() => onNavigate("attendance")} /><div className="attendance-overview"><div className="donut" style={{ "--percent": `${attendanceRate * 3.6}deg` } as React.CSSProperties}><div><strong>{attendanceRate}%</strong><small>present</small></div></div><div className="legend"><span><i className="green" />Present<strong>{todaysAttendance.length}</strong></span><span><i className="amber" />Late<strong>{late}</strong></span><span><i className="slate" />Not marked<strong>{Math.max(0, expectedStaff.length - todaysAttendance.length)}</strong></span></div></div><div className="mini-people">{todaysAttendance.slice(0, 5).map((row) => <div key={row.id}><span className="avatar avatar-sm">{initials(row.profile?.full_name || "Staff")}</span><div><strong>{row.profile?.full_name}</strong><small>{row.branch?.name}</small></div><time>{row.clock_in ? format(parseISO(row.clock_in), "h:mm a") : "—"}</time><span className={`status-badge ${row.status}`}>{row.status}</span></div>)}{!todaysAttendance.length && <div className="inline-empty">No one has clocked in yet today.</div>}</div></section>
      <section className="panel"><PanelHead eyebrow="BRANCHES" title="Office pulse" action="Manage" onClick={() => onNavigate("branches")} /><div className="branch-pulse">{branches.slice(0, 4).map((branch) => { const count = todaysAttendance.filter((r) => r.branch_id === branch.id).length; const total = staff.filter((p) => p.branch_id === branch.id).length; return <div key={branch.id}><span className="branch-letter">{branch.code.slice(0, 2)}</span><div><strong>{branch.name}</strong><small>{count} of {total} present</small></div><div className="mini-progress"><span style={{ width: `${total ? count / total * 100 : 0}%` }} /></div><strong>{total ? Math.round(count / total * 100) : 0}%</strong></div>; })}</div>{canManageBranches && <button className="dashed-button" onClick={onAddBranch}><Plus size={17} /> Add another branch</button>}</section>
    </div>
    <section className="panel quick-panel"><div><span className="eyebrow">QUICK SETUP</span><h2>Keep your workspace growing</h2><p>Add branches, invite team members and let Presence handle the rest.</p></div><div className="quick-actions">{canManageBranches && <button onClick={onAddBranch}><span><Building2 size={20} /></span><div><strong>New branch</strong><small>Set a secure office zone</small></div></button>}<button onClick={onAddStaff}><span><Users size={20} /></span><div><strong>Invite staff</strong><small>Create a team account</small></div></button></div></section>
  </>;
}

function BranchesView({ branches, staff, onAdd, onAddStaff, canAdd, onUpdated }: { branches: Branch[]; staff: Profile[]; onAdd: () => void; onAddStaff: (branchId: string) => void; canAdd: boolean; onUpdated: (branch: Branch) => void }) {
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
  return <>
    <div className="page-heading"><div><span className="eyebrow">WORKPLACES</span><h1>Branches</h1><p>Open a branch to view its live map, security settings and people.</p></div>{canAdd && <button className="button button-primary" onClick={onAdd}><Plus size={17} /> Add branch</button>}</div>
    <div className="branch-grid">{branches.map((branch) => <article className="branch-card branch-card-interactive" key={branch.id} role="button" tabIndex={0} onClick={() => setSelectedBranch(branch)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedBranch(branch); }}>
      <div className="branch-map-preview"><BranchMap branch={branch} className="branch-card-map" /><span className={`active-pill ${branch.active ? "" : "inactive"}`}>{branch.active ? "Active" : "Inactive"}</span></div>
      <div className="branch-card-body"><div className="branch-title"><span className="branch-letter">{branch.code.slice(0, 2)}</span><div><h3>{branch.name}</h3><p>{branch.address}</p></div><button className="icon-button" onClick={(event) => { event.stopPropagation(); setSelectedBranch(branch); }} aria-label={`Open ${branch.name}`}><MoreHorizontal size={19} /></button></div><div className="branch-facts"><span><MapPin size={16} /> {branch.radius_m} m radius</span><span><ShieldCheck size={16} /> Location only</span><span><Users size={16} /> {staff.filter((person) => person.branch_id === branch.id).length} people</span></div></div>
    </article>)}</div>
    {selectedBranch && <BranchDetailModal branch={selectedBranch} staff={staff.filter((person) => person.branch_id === selectedBranch.id)} canEdit={canAdd} onUpdated={(updated) => { setSelectedBranch(updated); onUpdated(updated); }} onClose={() => setSelectedBranch(null)} onAddStaff={() => { const branchId = selectedBranch.id; setSelectedBranch(null); onAddStaff(branchId); }} />}
  </>;
}

function BranchDetailModal({ branch, staff, canEdit, onUpdated, onClose, onAddStaff }: { branch: Branch; staff: Profile[]; canEdit: boolean; onUpdated: (branch: Branch) => void; onClose: () => void; onAddStaff: () => void }) {
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="modal modal-wide branch-detail-modal" role="dialog" aria-modal="true" aria-labelledby="branch-detail-title">
    <div className="modal-head"><div><span className="eyebrow">{branch.code} · VERIFIED WORKPLACE</span><h2 id="branch-detail-title">{branch.name}</h2><p>{branch.address}</p></div><button className="icon-button bordered" onClick={onClose} aria-label="Close"><X size={20} /></button></div>
    <div className="branch-detail-map"><BranchMap branch={branch} interactive className="branch-detail-live-map" /><span className={`active-pill ${branch.active ? "" : "inactive"}`}>{branch.active ? "Active branch" : "Inactive branch"}</span></div>
    <div className="branch-detail-facts">
      <div><span><MapPin size={19} /></span><small>Attendance zone</small><strong>{branch.radius_m} metres</strong></div>
      <div><span><ShieldCheck size={19} /></span><small>Verification</small><strong>Location only</strong></div>
      <div><span><MapPin size={19} /></span><small>Location check</small><strong>Inside radius</strong></div>
      <div><span><Users size={19} /></span><small>People</small><strong>{staff.length}</strong></div>
    </div>
    {canEdit && <BranchPolicyEditor branch={branch} onUpdated={onUpdated} />}
    <section className="branch-detail-team"><div className="branch-detail-section-head"><div><span className="eyebrow">BRANCH TEAM</span><h3>People at this office</h3></div><button className="button button-primary" onClick={onAddStaff}><Plus size={16} /> Add staff here</button></div>
      <div className="branch-detail-people">{staff.length ? staff.map((person) => <div key={person.id}><span className="avatar avatar-sm">{initials(person.full_name)}</span><div><strong>{person.full_name}</strong><small>{person.job_title || "Team member"} · {person.employee_code || person.email}</small></div><span className={person.active ? "person-active" : "person-active inactive"}>{person.active ? "Active" : "Disabled"}</span></div>) : <div className="empty-state"><span><Users size={24} /></span><strong>No staff assigned yet</strong><small>Add the first team member directly from this branch.</small></div>}</div>
    </section>
  </div></div>;
}

function BranchPolicyEditor({ branch, onUpdated }: { branch: Branch; onUpdated: (branch: Branch) => void }) {
  const [latitude, setLatitude] = useState(Number(branch.latitude));
  const [longitude, setLongitude] = useState(Number(branch.longitude));
  const [radius, setRadius] = useState(branch.radius_m);
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [saveTone, setSaveTone] = useState<"success" | "error">("success");

  async function locate() {
    if (!navigator.geolocation) return setMessage("This browser does not support location services.");
    setLocating(true);
    setMessage("");
    try {
      const location = await captureBestBrowserLocation({ maximumAccuracyM: 200, minimumWaitMs: 1_000, maximumWaitMs: 15_000 });
      setLatitude(location.latitude);
      setLongitude(location.longitude);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "The office location could not be captured.");
    } finally {
      setLocating(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setSaveTone("success");
    setMessage("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch("/api/admin/branches", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...values, id: branch.id, latitude, longitude, radius_m: radius }),
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok) {
        onUpdated(result.branch as Branch);
        setSaveTone("success");
        setMessage("Branch details and location radius saved successfully.");
      } else {
        setSaveTone("error");
        setMessage(result.error || "The branch details could not be saved.");
      }
    } catch {
      setSaveTone("error");
      setMessage("The branch details could not be saved. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return <section className="branch-policy-card">
    <div className="branch-detail-section-head"><div><span className="eyebrow">EDIT BRANCH</span><h3>Branch details and attendance policy</h3><p>Update the office location, attendance radius and timing tolerances.</p></div></div>
    <form onSubmit={submit} className="branch-policy-form">
      <label className="field"><span>Branch name</span><input name="name" defaultValue={branch.name} minLength={2} maxLength={80} required /></label>
      <label className="field"><span>Branch code</span><input name="code" defaultValue={branch.code} minLength={2} maxLength={8} required /></label>
      <label className="field field-span"><span>Office address</span><input name="address" defaultValue={branch.address} minLength={5} maxLength={300} required /></label>
      <label className="field"><span>Verification method</span><input value="Location inside branch radius" readOnly /><small>No IP address, office Wi-Fi or SSID is required.</small></label>
      <label className="field"><span>Office radius</span><div className="suffix-input"><input name="radius_m" type="number" min="50" max="1000" step="10" value={radius} onChange={(event) => setRadius(Number(event.target.value))} required /><span>metres</span></div><small>The employee can be anywhere inside this radius; the exact pin is not required.</small></label>
      <label className="field"><span>Late-arrival tolerance</span><div className="suffix-input"><input name="late_grace_minutes" type="number" min="0" max="120" defaultValue={branch.late_grace_minutes ?? 10} required /><span>minutes</span></div><small>Arrivals within this time are recorded as on time.</small></label>
      <label className="field"><span>Early-departure tolerance</span><div className="suffix-input"><input name="early_leave_grace_minutes" type="number" min="0" max="120" defaultValue={branch.early_leave_grace_minutes ?? 10} required /><span>minutes</span></div><small>Departures within this time are not marked as early leave.</small></label>
      <div className="branch-policy-map field-span"><div className="map-toolbar"><div><strong>Office centre point</strong><small>Drag the pin or capture the current office location</small></div><button type="button" className="button button-ghost button-sm" onClick={locate} disabled={locating}>{locating ? <LoaderCircle className="spin" size={15} /> : <MapPin size={15} />} {locating ? "Locating…" : "Use my location"}</button></div><MapPicker latitude={latitude} longitude={longitude} radius={radius} onChange={(nextLatitude, nextLongitude) => { setLatitude(nextLatitude); setLongitude(nextLongitude); }} /><div className="coordinate-bar"><span>Lat {latitude.toFixed(6)}</span><span>Lng {longitude.toFixed(6)}</span><span>{radius} m radius</span></div></div>
      <div className="branch-policy-actions">{message && <span className={`save-message ${saveTone}`}>{message}</span>}<button className="button button-primary" disabled={saving || locating}><Save size={16} /> {saving ? "Saving…" : "Save updated branch"}</button></div>
    </form>
  </section>;
}

function StaffView({ staff, branches, today, calendarNotes, holidays, onAdd, onRecordLeave, canManageSchedules, onUpdated }: { staff: Profile[]; branches: Branch[]; today: string; calendarNotes: CalendarNote[]; holidays: CompanyHoliday[]; onAdd: () => void; onRecordLeave: (userId: string) => void; canManageSchedules: boolean; onUpdated: (profile: Profile) => void }) {
  const [selected, setSelected] = useState<Profile | null>(null);
  return <>
    <div className="page-heading"><div><span className="eyebrow">TEAM DIRECTORY</span><h1>People</h1><p>{staff.length} accounts across {branches.length} branches. Select a person for their full profile and calendar.</p></div><button className="button button-primary" onClick={onAdd}><Plus size={17} /> Add staff</button></div>
    <div className="panel table-panel">
      <div className="table-tools"><span className="filter-chip">All people <ChevronDown size={15} /></span><span className="filter-chip">All branches <ChevronDown size={15} /></span></div>
      <div className="data-table">
        <div className="table-row table-head"><span>Person</span><span>Branch</span><span>Role</span><span>Work hours</span><span>Leave</span><span>Status</span></div>
        {staff.map((person) => <button className="table-row staff-row-button" key={person.id} onClick={() => setSelected(person)}>
          <span className="person-cell"><span className="avatar">{initials(person.full_name)}</span><span><strong>{person.full_name}</strong><small>{person.email || person.employee_code}</small></span></span>
          <span>{person.branch?.name || "—"}</span><span>{person.job_title || roleTitle(person.role)}</span><span>{person.expected_arrival.slice(0, 5)} – {person.expected_departure.slice(0, 5)}</span><span>{person.annual_leave_days} annual</span><span><i className={`account-dot ${person.active ? "" : "inactive"}`} />{person.active ? "Active" : "Disabled"}</span>
        </button>)}
      </div>
    </div>
    {selected && <EmployeeDetailModal employee={selected} branches={branches} today={today} calendarNotes={calendarNotes} initialHolidays={holidays} canManageSchedule={canManageSchedules} onUpdated={(updated) => { setSelected(updated); onUpdated(updated); }} onClose={() => setSelected(null)} onRecordLeave={() => { onRecordLeave(selected.id); setSelected(null); }} />}
  </>;
}

function EmployeeDetailModal({ employee, branches, today, calendarNotes, initialHolidays, canManageSchedule, onUpdated, onClose, onRecordLeave }: { employee: Profile; branches: Branch[]; today: string; calendarNotes: CalendarNote[]; initialHolidays: CompanyHoliday[]; canManageSchedule: boolean; onUpdated: (profile: Profile) => void; onClose: () => void; onRecordLeave: () => void }) {
  const [detail, setDetail] = useState<{ profile: Profile; attendance: AttendanceRecord[]; leaves: LeaveRequest[]; holidays: CompanyHoliday[]; salary_settings: SalarySettings | null; payroll_records: PayrollRecord[] } | null>(null);
  const [error, setError] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [salaryOpen, setSalaryOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/admin/staff/${employee.id}`).then(async (response) => {
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The employee profile could not be loaded.");
      if (active) setDetail(result);
    }).catch((reason) => active && setError(reason instanceof Error ? reason.message : "The employee profile could not be loaded."));
    return () => { active = false; };
  }, [employee.id]);

  const profile = detail?.profile ?? employee;
  const rows = detail?.attendance ?? [];
  const leaves = detail?.leaves ?? [];
  const totalMinutes = rows.reduce((sum, row) => sum + (row.work_minutes ?? 0), 0);
  const leaveDays = leaves.filter((leave) => leave.status === "approved").reduce((sum, leave) => sum + Number(leave.requested_days), 0);
  const timingFlags = rows.filter((row) => row.late_minutes > 0 || row.early_leave_minutes > 0).length;

  return <><div className="modal-backdrop employee-detail-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="modal modal-wide employee-detail-modal" role="dialog" aria-modal="true" aria-labelledby="employee-detail-title">
    <div className="modal-head employee-profile-head"><div className="employee-profile-identity"><span className="avatar employee-avatar">{initials(profile.full_name)}</span><div><span className="eyebrow">EMPLOYEE PROFILE</span><h2 id="employee-detail-title">{profile.full_name}</h2><p>{profile.job_title || roleTitle(profile.role)} · {profile.branch?.name || "No branch assigned"}</p></div></div><div className="heading-actions">{canManageSchedule && <button className="button button-ghost" onClick={() => setEditOpen(true)}><Pencil size={16} /> Edit employee</button>}<button className="button button-ghost" onClick={() => setResetOpen(true)}><KeyRound size={16} /> Reset password</button><button className="button button-primary" onClick={onRecordLeave}><CalendarPlus size={16} /> Record leave</button><button className="icon-button bordered" onClick={onClose} aria-label="Close"><X size={20} /></button></div></div>
    {error && <div className="form-alert error">{error}</div>}
    {!detail && !error ? <div className="detail-loading"><LoaderCircle className="spin" size={25} /> Loading employee details…</div> : <>
      <div className="employee-profile-grid">
        <section className="employee-contact-card"><span className="eyebrow">DETAILS</span><div><Mail size={17} /><span><small>Email</small><strong>{profile.email || "Not provided"}</strong></span></div><div><Phone size={17} /><span><small>Phone</small><strong>{profile.phone || "Not provided"}</strong></span></div><div><Building2 size={17} /><span><small>Employee code</small><strong>{profile.employee_code || "Not assigned"}</strong></span></div>{canManageSchedule ? <button className="employee-schedule-row" onClick={() => setScheduleOpen(true)}><Clock3 size={17} /><span><small>Work schedule</small><strong>{scheduleSummary(profile.work_schedule ?? [])}</strong></span><ChevronRight size={16} /></button> : <div><Clock3 size={17} /><span><small>Work schedule</small><strong>{scheduleSummary(profile.work_schedule ?? [])}</strong></span></div>}<button className="employee-salary-row" onClick={() => setSalaryOpen(true)}><Banknote size={17} /><span><small>Salary settings</small><strong>{detail?.salary_settings ? `LKR ${Number(detail.salary_settings.basic_salary).toLocaleString("en-LK")} · ${detail.salary_settings.pay_cycle === "calendar_month" ? "monthly" : detail.salary_settings.pay_cycle === "fifteenth_cycle" ? "15th cycle" : "custom cycle"}` : "Add salary details"}</strong></span><ChevronRight size={16} /></button></section>
        <div className="employee-summary-grid"><StatCard label="Total hours" value={formatWorkMinutes(totalMinutes)} detail={`${rows.length} recorded workday${rows.length === 1 ? "" : "s"} this year`} icon={<Clock3 />} tone="navy" /><StatCard label="Approved leave" value={`${leaveDays}`} detail={`${profile.annual_leave_days} annual days allocated`} icon={<CalendarCheck />} tone="violet" /><StatCard label="Timing flags" value={`${timingFlags}`} detail="Late arrivals or early departures" icon={<Gauge />} tone="amber" /></div>
      </div>
      <WorkCalendar today={today} initialNotes={calendarNotes} initialHolidays={detail?.holidays ?? initialHolidays} attendance={rows} leaves={leaves} workSchedule={(profile.work_schedule ?? []) as WorkScheduleDay[]} title={`${profile.full_name}'s calendar`} />
      <section className="employee-recent-records"><div className="branch-detail-section-head"><div><span className="eyebrow">RECENT RECORDS</span><h3>Attendance detail</h3></div></div><div className="data-table"><div className="table-row employee-record-row table-head"><span>Date</span><span>Clock in</span><span>Clock out</span><span>Worked</span><span>Timing</span></div>{rows.slice(0, 12).map((row) => <div className="table-row employee-record-row" key={row.id}><span>{format(parseISO(row.attendance_date), "d MMM yyyy")}</span><span>{row.clock_in ? format(parseISO(row.clock_in), "h:mm a") : "—"}</span><span>{row.clock_out ? format(parseISO(row.clock_out), "h:mm a") : "—"}</span><span>{formatWorkMinutes(row.work_minutes ?? 0)}</span><span>{row.late_minutes > 0 ? `${row.late_minutes}m late` : row.early_leave_minutes > 0 ? `${row.early_leave_minutes}m early` : "On time"}</span></div>)}</div></section>
    </>}
  </div></div>{resetOpen && <ResetPasswordModal employee={profile} onClose={() => setResetOpen(false)} />}{salaryOpen && <SalarySettingsModal employee={profile} initial={detail?.salary_settings ?? null} onClose={() => setSalaryOpen(false)} onSaved={(settings) => { setDetail((current) => current ? { ...current, salary_settings: settings } : current); setSalaryOpen(false); }} />}{scheduleOpen && <WorkScheduleModal employee={profile} onClose={() => setScheduleOpen(false)} onSaved={(updated) => { setDetail((current) => current ? { ...current, profile: updated } : current); onUpdated(updated); setScheduleOpen(false); }} />}{editOpen && <EditStaffModal employee={profile} branches={branches} onClose={() => setEditOpen(false)} onSaved={(updated) => { setDetail((current) => current ? { ...current, profile: updated } : current); onUpdated(updated); setEditOpen(false); }} />}</>;
}

function EditStaffModal({ employee, branches, onClose, onSaved }: { employee: Profile; branches: Branch[]; onClose: () => void; onSaved: (profile: Profile) => void }) {
  const [active, setActive] = useState(employee.active);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch(`/api/admin/staff/${employee.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "profile", ...values, active }) });
    const result = await response.json().catch(() => ({}));
    if (response.ok) onSaved(result.profile as Profile);
    else { setError(result.error || "The employee details could not be saved."); setSaving(false); }
  }
  return <div className="modal-backdrop elevated-modal" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="modal modal-wide edit-staff-modal" role="dialog" aria-modal="true" aria-labelledby="edit-staff-title"><div className="modal-head"><div><span className="eyebrow">EDIT TEAM MEMBER</span><h2 id="edit-staff-title">Update {employee.full_name}</h2><p>Change account, branch, leave and employment details. Working hours remain in the schedule editor.</p></div><button className="icon-button bordered" onClick={onClose} aria-label="Close"><X size={20} /></button></div><form className="form-grid" onSubmit={submit}>
    <label className="field"><span>Full name</span><input name="full_name" defaultValue={employee.full_name} required minLength={2} maxLength={100} /></label>
    <label className="field"><span>Phone number</span><input name="phone" defaultValue={employee.phone || ""} required minLength={7} maxLength={30} /></label>
    <label className="field"><span>Email address</span><input name="email" type="email" defaultValue={employee.email || ""} required /></label>
    <label className="field"><span>Employee code</span><input name="employee_code" defaultValue={employee.employee_code || ""} maxLength={30} /></label>
    <label className="field"><span>Branch</span><select name="branch_id" defaultValue={employee.branch_id || ""} required><option value="" disabled>Select a branch</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
    <label className="field"><span>Job title</span><input name="job_title" defaultValue={employee.job_title || ""} required minLength={2} maxLength={100} /></label>
    <label className="field"><span>Monthly leave days</span><input name="monthly_leave_days" type="number" min="0" max="10" step="0.5" defaultValue={employee.monthly_leave_days} required /></label>
    <label className="field"><span>Annual leave days</span><input name="annual_leave_days" type="number" min="0" max="60" step="0.5" defaultValue={employee.annual_leave_days} required /></label>
    <label className="staff-active-toggle field-span"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /><span><strong>Active employee account</strong><small>Disabled employees cannot sign in or mark attendance.</small></span></label>
    {error && <div className="form-alert error field-span">{error}</div>}
    <div className="modal-actions field-span"><button type="button" className="button button-ghost" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={saving}><Save size={16} /> {saving ? "Saving…" : "Save employee"}</button></div>
  </form></div></div>;
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function WorkScheduleModal({ employee, onClose, onSaved }: { employee: Profile; onClose: () => void; onSaved: (profile: Profile) => void }) {
  const [expectedArrival, setExpectedArrival] = useState(employee.expected_arrival.slice(0, 5) || "09:00");
  const [expectedDeparture, setExpectedDeparture] = useState(employee.expected_departure.slice(0, 5) || "17:00");
  const [schedule, setSchedule] = useState<WorkScheduleDay[]>(() => Array.from({ length: 7 }, (_, index) => {
    const weekday = index + 1;
    const saved = employee.work_schedule?.find((day) => day.weekday === weekday);
    return saved ? { ...saved, arrival_time: saved.arrival_time.slice(0, 5), departure_time: saved.departure_time.slice(0, 5) } : defaultScheduleDay(weekday, "09:00", "17:00", "half_day", "off", employee.id);
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function updateDay(weekday: number, update: Partial<WorkScheduleDay>) {
    setSchedule((current) => current.map((day) => day.weekday === weekday ? { ...day, ...update } : day));
  }

  function changeDayType(day: WorkScheduleDay, dayType: WorkdayType) {
    const defaults = dayType === "half_day"
      ? { arrival_time: "09:00", departure_time: "14:00" }
      : { arrival_time: expectedArrival, departure_time: expectedDeparture };
    updateDay(day.weekday, { day_type: dayType, ...defaults });
  }

  function applyStandardWeek() {
    setExpectedArrival("09:00");
    setExpectedDeparture("17:00");
    setSchedule(Array.from({ length: 7 }, (_, index) => defaultScheduleDay(index + 1, "09:00", "17:00", "half_day", "off", employee.id)));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/staff/${employee.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "schedule", expected_arrival: expectedArrival, expected_departure: expectedDeparture, schedule: schedule.map(({ weekday, day_type, arrival_time, departure_time }) => ({ weekday, day_type, arrival_time, departure_time })) }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The work schedule could not be saved.");
      onSaved(result.profile as Profile);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The work schedule could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="modal-backdrop elevated-modal" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="modal modal-wide schedule-editor-modal" role="dialog" aria-modal="true" aria-labelledby="schedule-editor-title">
    <div className="modal-head"><div><span className="eyebrow">EMPLOYEE WORKING HOURS</span><h2 id="schedule-editor-title">Schedule for {employee.full_name}</h2><p>Choose full days, half days or days off. Half days default to 9:00 AM–2:00 PM.</p></div><button className="icon-button bordered" onClick={onClose} aria-label="Close"><X size={20} /></button></div>
    <form onSubmit={submit}>
      <div className="schedule-defaults">
        <div><strong>Default full day</strong><small>Used for attendance fallbacks and reminders.</small></div>
        <label className="field"><span>Starts</span><input type="time" required value={expectedArrival} onChange={(event) => setExpectedArrival(event.target.value)} /></label>
        <label className="field"><span>Ends</span><input type="time" required value={expectedDeparture} onChange={(event) => setExpectedDeparture(event.target.value)} /></label>
        <button type="button" className="button button-ghost" onClick={applyStandardWeek}>Use 9–5 defaults</button>
      </div>
      <div className="schedule-editor-table">
        <div className="schedule-editor-head"><span>Day</span><span>Day type</span><span>Start</span><span>Finish</span></div>
        {schedule.map((day) => <div className={`schedule-editor-row ${day.day_type}`} key={day.weekday}>
          <strong>{WEEKDAYS[day.weekday - 1]}</strong>
          <select aria-label={`${WEEKDAYS[day.weekday - 1]} day type`} value={day.day_type} onChange={(event) => changeDayType(day, event.target.value as WorkdayType)}><option value="full_day">Full day</option><option value="half_day">Half day</option><option value="off">Day off</option></select>
          <input aria-label={`${WEEKDAYS[day.weekday - 1]} start time`} type="time" required value={day.arrival_time.slice(0, 5)} onChange={(event) => updateDay(day.weekday, { arrival_time: event.target.value })} />
          <input aria-label={`${WEEKDAYS[day.weekday - 1]} finish time`} type="time" required value={day.departure_time.slice(0, 5)} onChange={(event) => updateDay(day.weekday, { departure_time: event.target.value })} />
        </div>)}
      </div>
      {error && <div className="form-alert error schedule-editor-error">{error}</div>}
      <div className="modal-actions"><button type="button" className="button button-ghost" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={saving}><Save size={16} /> {saving ? "Saving…" : "Save schedule"}</button></div>
    </form>
  </div></div>;
}

function AttendanceView({ rows, branches, today }: { rows: AttendanceRecord[]; branches: Branch[]; today: string }) {
  const [branchId, setBranchId] = useState("all");
  const start = `${today.slice(0, 7)}-01`;
  const filteredRows = branchId === "all" ? rows : rows.filter((row) => row.branch_id === branchId);
  const exportUrl = `/api/admin/backups/attendance?branch_id=${encodeURIComponent(branchId)}&start=${start}&end=${today}`;
  return <><div className="page-heading"><div><span className="eyebrow">VERIFIED RECORDS</span><h1>Attendance</h1><p>Server-verified check-ins and check-outs across every branch.</p></div><a className="button button-ghost" href={exportUrl}><Download size={17} /> Export clean CSV</a></div><div className="panel table-panel"><div className="table-tools"><span className="filter-chip">{format(parseISO(start), "MMMM yyyy")} <ChevronDown size={15} /></span><label className="filter-select"><Building2 size={15} /><select value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="all">All {branches.length} branches</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select><ChevronDown size={15} /></label><span className="table-result-count">{filteredRows.length} record{filteredRows.length === 1 ? "" : "s"}</span></div><div className="data-table"><div className="table-row attendance-table table-head"><span>Employee</span><span>Date</span><span>Branch</span><span>Clock in</span><span>Clock out</span><span>Hours</span><span>Status</span></div>{filteredRows.map((row) => <div className="table-row attendance-table" key={row.id}><span className="person-cell"><span className="avatar avatar-sm">{initials(row.profile?.full_name || "Staff")}</span><strong>{row.profile?.full_name}</strong></span><span>{format(parseISO(row.attendance_date), "d MMM yyyy")}</span><span>{row.branch?.name}</span><span>{row.clock_in ? format(parseISO(row.clock_in), "h:mm a") : "—"}</span><span>{row.clock_out ? format(parseISO(row.clock_out), "h:mm a") : "—"}</span><span>{row.work_minutes ? `${Math.floor(row.work_minutes / 60)}h ${row.work_minutes % 60}m` : "—"}</span><span><span className={`status-badge ${row.status}`}>{row.status}</span></span></div>)}</div>{!filteredRows.length && <div className="empty-state"><span><ClipboardCheck size={24} /></span><strong>No attendance for this branch</strong><small>Choose another branch or wait for the first verified record.</small></div>}</div></>;
}

function LeaveView({ leaves, onUpdate, onCreate }: { leaves: LeaveRequest[]; onUpdate: (leave: LeaveRequest) => void; onCreate: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  async function decide(id: string, status: "approved" | "rejected") {
    setBusy(id);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/leave/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status, admin_note: notes[id] || undefined }) });
      const json = await response.json().catch(() => ({}));
      if (response.ok) {
        onUpdate(json.leave);
        setMessage(`Leave ${status}. The employee was notified${notes[id] ? " with your note" : ""}.`);
      } else setMessage(json.error || "The leave decision could not be saved.");
    } finally {
      setBusy(null);
    }
  }
  return <><div className="page-heading"><div><span className="eyebrow">TIME OFF</span><h1>Leave requests</h1><p>Review requests, add a clear note for the employee and keep balances accurate.</p></div><button className="button button-primary" onClick={onCreate}><CalendarPlus size={17} /> Record employee leave</button></div>{message && <div className="form-alert success leave-decision-message">{message}</div>}<div className="leave-admin-grid"><section className="panel"><PanelHead eyebrow="NEEDS REVIEW" title={`${leaves.filter((l) => l.status === "pending").length} pending requests`} /> <div className="request-list">{leaves.filter((l) => l.status === "pending").map((leave) => <article key={leave.id}><div className="request-person"><span className="avatar">{initials(leave.profile?.full_name || "Staff")}</span><div><strong>{leave.profile?.full_name}</strong><small>{leave.profile?.employee_code}</small></div><span className="status-badge pending">pending</span></div><div className="request-dates"><CalendarCheck size={18} /><div><strong>{format(parseISO(leave.start_date), "d MMM")} – {format(parseISO(leave.end_date), "d MMM yyyy")}</strong><small>{leave.requested_days} day{Number(leave.requested_days) === 1 ? "" : "s"} · {leave.leave_type} leave</small></div></div><p className="leave-reason">{leave.reason}</p><label className="leave-admin-note"><span>Note to employee (optional)</span><textarea value={notes[leave.id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [leave.id]: event.target.value }))} maxLength={500} placeholder="Add context that will appear in their notification" /></label><div className="request-actions"><button className="button button-ghost" disabled={busy === leave.id} onClick={() => void decide(leave.id, "rejected")}>Decline</button><button className="button button-primary" disabled={busy === leave.id} onClick={() => void decide(leave.id, "approved")}><Check size={16} /> Approve & notify</button></div></article>)}{!leaves.some((l) => l.status === "pending") && <div className="empty-state"><span><Check size={24} /></span><strong>All caught up</strong><small>There are no requests waiting for review.</small></div>}</div></section><section className="panel"><PanelHead eyebrow="RECENT" title="Decision history" /><div className="decision-list">{leaves.filter((l) => l.status !== "pending").slice(0, 12).map((leave) => <div key={leave.id}><span className={`status-icon ${leave.status}`}><Check size={16} /></span><div><strong>{leave.profile?.full_name}</strong><small>{leave.leave_type} · {leave.requested_days} day(s){leave.admin_note ? ` · ${leave.admin_note}` : ""}</small></div><span className={`status-badge ${leave.status}`}>{leave.status}</span></div>)}</div></section></div></>;
}

function BranchModal({ onClose, onCreated }: { onClose: () => void; onCreated: (branch: Branch) => void }) {
  const [lat, setLat] = useState(6.927079);
  const [lng, setLng] = useState(79.861244);
  const [radius, setRadius] = useState(200);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const [error, setError] = useState("");
  async function locate() {
    if (!navigator.geolocation) return setError("This browser does not support location services.");
    setLocating(true); setError("");
    try {
      const location = await captureBestBrowserLocation({ maximumAccuracyM: 200, minimumWaitMs: 1_000, maximumWaitMs: 15_000 });
      setLat(location.latitude); setLng(location.longitude); setLocationAccuracy(location.accuracy);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not read this device location.");
    } finally {
      setLocating(false);
    }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = Object.fromEntries(new FormData(event.currentTarget));
      const response = await fetch("/api/admin/branches", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...data, latitude: lat, longitude: lng, radius_m: radius }) });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) { setError(json.error || `The branch could not be created (${response.status}).`); return; }
      onCreated(json.branch);
    } catch {
      setError("The branch service could not be reached. Check the connection and try again.");
    } finally {
      setLoading(false);
    }
  }
  return <div className="modal-backdrop"><div className="modal modal-wide branch-modal">
    <div className="modal-head"><div><span className="eyebrow">SECURE WORKPLACE</span><h2>Add a branch</h2><p>Pin the office and set the radius employees can use for attendance.</p></div><button className="icon-button bordered" onClick={onClose}><X size={20} /></button></div>
    <form onSubmit={submit} className="branch-form">
      <div className="branch-form-fields">
        <div className="form-grid">
          <label className="field"><span>Branch name</span><input name="name" required placeholder="Colombo HQ" /></label>
          <label className="field"><span>Short code</span><input name="code" required minLength={2} maxLength={8} placeholder="CMB" /></label>
          <label className="field field-span"><span>Office address</span><input name="address" required placeholder="123 Galle Road, Colombo 03" /></label>
          <label className="field"><span>Attendance radius</span><div className="suffix-input"><input type="number" min={50} max={1000} step={10} value={radius} onChange={(e) => setRadius(Number(e.target.value))} /><span>metres</span></div><small>Any verified point inside this circle is accepted.</small></label>
          <label className="field"><span>Verification method</span><input value="Location inside branch radius" readOnly /><small>No IP address, office Wi-Fi or SSID is required.</small></label>
          <label className="field"><span>Late-arrival tolerance</span><div className="suffix-input"><input name="late_grace_minutes" type="number" min="0" max="120" defaultValue="10" required /><span>minutes</span></div></label>
          <label className="field"><span>Early-departure tolerance</span><div className="suffix-input"><input name="early_leave_grace_minutes" type="number" min="0" max="120" defaultValue="10" required /><span>minutes</span></div></label>
        </div>
        {error && <div className="form-alert error">{error}</div>}
      </div>
      <div className="branch-map-side"><div className="map-toolbar"><div><strong>Office location</strong><small>Tap the map or drag the pin</small></div><button type="button" className="button button-ghost button-sm" onClick={locate} disabled={locating}>{locating ? <LoaderCircle className="spin" size={15} /> : <MapPin size={15} />} {locating ? "Improving..." : "Use my location"}</button></div><MapPicker latitude={lat} longitude={lng} radius={radius} onChange={(nextLat, nextLng) => { setLat(nextLat); setLng(nextLng); setLocationAccuracy(null); }} /><div className="coordinate-bar"><span>Lat {lat.toFixed(6)}</span><span>Lng {lng.toFixed(6)}</span><span>{radius} m zone</span>{locationAccuracy !== null && <span>GPS +/-{Math.round(locationAccuracy)} m</span>}</div></div>
      <div className="modal-actions branch-actions"><button type="button" className="button button-ghost" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={loading || locating}>{loading ? "Creating…" : "Create branch"}</button></div>
    </form>
  </div></div>;
}

function StaffModal({ branches, defaultBranchId, onClose, onCreated }: { branches: Branch[]; defaultBranchId?: string; onClose: () => void; onCreated: (profile: Profile) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [receipt, setReceipt] = useState<CredentialReceipt | null>(null);

  function generatePassword() {
    const value = `Welcome!${crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 7)}A9`;
    setTemporaryPassword(value);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget));
      const response = await fetch("/api/admin/staff", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values) });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) { setError(json.error || "The account could not be created."); return; }
      onCreated(json.profile);
      setReceipt({
        fullName: String(values.full_name),
        email: String(values.email),
        temporaryPassword: String(values.temporary_password),
        emailSent: Boolean(json.email?.sent),
        emailConfigured: Boolean(json.email?.configured),
        emailError: json.email?.error,
      });
    } catch {
      setError("The account service could not be reached. Check the connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (receipt) return <CredentialReceiptModal title="Staff account created" receipt={receipt} onClose={onClose} />;
  return <div className="modal-backdrop"><div className="modal modal-wide">
    <div className="modal-head"><div><span className="eyebrow">NEW TEAM MEMBER</span><h2>Create a staff account</h2><p>The employee must replace the temporary password on first sign in.</p></div><button className="icon-button bordered" onClick={onClose}><X size={20} /></button></div>
    <form onSubmit={submit} className="form-grid staff-form">
      <input type="hidden" name="role" value="staff" />
      <label className="field"><span>Full name</span><input name="full_name" required placeholder="Nimali Perera" /></label>
      <label className="field"><span>Phone number</span><input name="phone" required placeholder="+94 77 123 4567" /></label>
      <label className="field"><span>Email address</span><input name="email" type="email" required placeholder="nimali@company.com" /></label>
      <label className="field"><span>Employee code</span><input name="employee_code" placeholder="EMP-024" /></label>
      <label className="field"><span>Branch</span><select name="branch_id" required defaultValue={defaultBranchId || ""}><option value="" disabled>Select a branch</option>{branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label>
      <label className="field"><span>Job title</span><input name="job_title" required placeholder="Operations executive" /></label>
      <label className="field"><span>Temporary password</span><div className="inline-input"><input name="temporary_password" required minLength={10} value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} placeholder="At least 10 characters" /><button type="button" onClick={generatePassword}>Generate</button></div></label>
      <label className="field"><span>Full-day start</span><input name="expected_arrival" type="time" required defaultValue="09:00" /><small>Normal workday default</small></label>
      <label className="field"><span>Full-day finish</span><input name="expected_departure" type="time" required defaultValue="17:00" /><small>Normal workday default</small></label>
      <label className="field"><span>Half-day start</span><input name="half_day_arrival" type="time" required defaultValue="09:00" /><small>Can be adjusted per employee</small></label>
      <label className="field"><span>Half-day finish</span><input name="half_day_departure" type="time" required defaultValue="14:00" /><small>Default half day is 9:00 AM–2:00 PM</small></label>
      <label className="field"><span>Saturday schedule</span><select name="saturday_type" defaultValue="half_day"><option value="half_day">Half day</option><option value="full_day">Full day</option><option value="off">Off</option></select></label>
      <label className="field"><span>Sunday schedule</span><select name="sunday_type" defaultValue="off"><option value="off">Off</option><option value="half_day">Half day</option><option value="full_day">Full day</option></select></label>
      <label className="field"><span>Monthly leave days</span><input name="monthly_leave_days" type="number" min="0" max="10" step="0.5" required defaultValue="1" /></label>
      <label className="field"><span>Annual leave days</span><input name="annual_leave_days" type="number" min="0" max="60" step="0.5" required defaultValue="14" /></label>
      {error && <div className="form-alert error field-span">{error}</div>}
      <div className="modal-actions field-span"><button type="button" className="button button-ghost" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={loading}>{loading ? "Creating…" : "Create account"}</button></div>
    </form>
  </div></div>;
}

type CredentialReceipt = {
  fullName: string;
  email: string;
  temporaryPassword: string;
  emailSent: boolean;
  emailConfigured: boolean;
  emailError?: string;
};

function CredentialReceiptModal({ title, receipt, onClose }: { title: string; receipt: CredentialReceipt; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const loginUrl = typeof window === "undefined" ? "/login" : `${window.location.origin}/login?email=${encodeURIComponent(receipt.email)}`;
  const bundle = `Presence sign-in\nName: ${receipt.fullName}\nEmail / username: ${receipt.email}\nTemporary password: ${receipt.temporaryPassword}\nSign in: ${loginUrl}\nYou must choose a new password after signing in.`;
  async function copy() {
    await navigator.clipboard.writeText(bundle);
    setCopied(true);
  }
  return <div className="modal-backdrop elevated-modal"><div className="modal credential-receipt-modal" role="dialog" aria-modal="true" aria-labelledby="credential-title">
    <div className="credential-success-icon"><CheckCircle2 size={32} /></div>
    <span className="eyebrow">ACCOUNT READY</span><h2 id="credential-title">{title}</h2><p>{receipt.fullName} can now sign in to Presence.</p>
    <div className={`delivery-status ${receipt.emailSent ? "sent" : "warning"}`}>{receipt.emailSent ? <><Mail size={18} /><span><strong>Welcome email sent</strong><small>The staff member received the link and temporary credentials.</small></span></> : <><Mail size={18} /><span><strong>{receipt.emailConfigured ? "Email delivery failed" : "Email is not configured"}</strong><small>{receipt.emailError || "Copy the credentials below, or add Resend settings and try a password reset."}</small></span></>}</div>
    <div className="credential-grid"><div><small>EMAIL / USERNAME</small><strong>{receipt.email}</strong></div><div><small>TEMPORARY PASSWORD</small><strong className="credential-password">{receipt.temporaryPassword}</strong></div><div className="credential-link"><small>SIGN-IN LINK</small><strong>{loginUrl}</strong></div></div>
    <div className="form-alert success"><ShieldCheck size={17} /> A forced password change protects this account on first sign-in.</div>
    <div className="modal-actions"><button className="button button-ghost" onClick={() => void copy()}><Copy size={16} /> {copied ? "Copied" : "Copy welcome message"}</button><button className="button button-primary" onClick={onClose}>Done</button></div>
  </div></div>;
}

function SalarySettingsModal({ employee, initial, onClose, onSaved }: { employee: Profile; initial: SalarySettings | null; onClose: () => void; onSaved: (settings: SalarySettings) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [epfEnabled, setEpfEnabled] = useState(initial?.epf_enabled ?? true);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch(`/api/admin/staff/${employee.id}/salary`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...values, epf_enabled: epfEnabled }) });
    const result = await response.json().catch(() => ({}));
    if (response.ok) onSaved(result.settings as SalarySettings);
    else { setError(result.error || "Salary settings could not be saved."); setLoading(false); }
  }
  return <div className="modal-backdrop elevated-modal"><div className="modal salary-settings-modal" role="dialog" aria-modal="true"><div className="modal-head"><div><span className="eyebrow">STAFF PROFILE · SALARY</span><h2>{employee.full_name}</h2><p>These values prefill every salary period. The accountant’s date range comes from Settings.</p></div><button className="icon-button bordered" onClick={onClose}><X size={20} /></button></div><form className="stack-lg" onSubmit={submit}><div className="form-grid"><label className="field"><span>Basic salary (LKR)</span><input name="basic_salary" type="number" min="0" max="100000000" step="0.01" required defaultValue={initial?.basic_salary ?? 0} /></label><label className="field"><span>Fixed allowances (LKR)</span><input name="fixed_allowances" type="number" min="0" max="100000000" step="0.01" required defaultValue={initial?.fixed_allowances ?? 0} /></label></div><label className="payroll-epf-toggle"><input type="checkbox" checked={epfEnabled} onChange={(event) => setEpfEnabled(event.target.checked)} /><span><strong>EPF / ETF calculations enabled</strong><small>Uses 8% employee EPF, 12% employer EPF and 3% employer ETF on the contribution base.</small></span></label>{error && <div className="form-alert error">{error}</div>}<div className="modal-actions"><button type="button" className="button button-ghost" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={loading}><Save size={16} /> {loading ? "Saving…" : "Save salary settings"}</button></div></form></div></div>;
}

function ResetPasswordModal({ employee, onClose }: { employee: Profile; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<CredentialReceipt | null>(null);
  function generate() {
    setPassword(`Reset!${crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 8)}A7`);
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const response = await fetch(`/api/admin/staff/${employee.id}/password`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ temporary_password: password }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(result.error || "The temporary password could not be created.");
      setLoading(false);
      return;
    }
    setReceipt({
      fullName: employee.full_name,
      email: employee.email || "",
      temporaryPassword: password,
      emailSent: Boolean(result.email?.sent),
      emailConfigured: Boolean(result.email?.configured),
      emailError: result.email?.error,
    });
    setLoading(false);
  }
  if (receipt) return <CredentialReceiptModal title="Temporary password created" receipt={receipt} onClose={onClose} />;
  return <div className="modal-backdrop elevated-modal"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="reset-password-title">
    <div className="modal-head"><div><span className="eyebrow">SECURE RESET</span><h2 id="reset-password-title">Reset {employee.full_name}&apos;s password</h2><p>A temporary password will be emailed and must be changed after sign-in.</p></div><button className="icon-button bordered" onClick={onClose} aria-label="Close"><X size={20} /></button></div>
    <form onSubmit={submit} className="stack-lg"><label className="field"><span>Temporary password</span><div className="inline-input"><input value={password} onChange={(event) => setPassword(event.target.value)} minLength={10} maxLength={128} required autoComplete="new-password" /><button type="button" onClick={generate}>Generate</button></div><small>Use at least 10 characters. The employee cannot mark attendance until it is replaced.</small></label>{error && <div className="form-alert error">{error}</div>}<div className="modal-actions"><button type="button" className="button button-ghost" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={loading}><KeyRound size={16} /> {loading ? "Resetting..." : "Reset & email staff"}</button></div></form>
  </div></div>;
}

function AdminLeaveModal({ staff, defaultUserId, onClose, onCreated }: { staff: Profile[]; defaultUserId?: string; onClose: () => void; onCreated: (leave: LeaveRequest) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const response = await fetch("/api/admin/leave", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setError(result.error || "The leave could not be recorded."); setLoading(false); return; }
    onCreated(result.leave as LeaveRequest);
  }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="admin-leave-title">
    <div className="modal-head"><div><span className="eyebrow">ADMIN LEAVE ENTRY</span><h2 id="admin-leave-title">Record employee leave</h2><p>This entry is approved immediately and appears on the employee calendar.</p></div><button className="icon-button bordered" onClick={onClose} aria-label="Close"><X size={20} /></button></div>
    <form onSubmit={submit} className="form-grid">
      <label className="field field-span"><span>Employee</span><select name="user_id" required defaultValue={defaultUserId || ""}><option value="" disabled>Select an employee</option>{staff.filter((person) => person.active).map((person) => <option key={person.id} value={person.id}>{person.full_name} · {person.branch?.name || person.employee_code || "Staff"}</option>)}</select></label>
      <label className="field"><span>Leave type</span><select name="leave_type" defaultValue="annual" required><option value="annual">Annual leave</option><option value="monthly">Monthly leave</option><option value="medical">Medical leave</option><option value="unpaid">Unpaid leave</option></select></label>
      <label className="field"><span>Duration</span><select name="portion" defaultValue="full_day" required><option value="full_day">Full day</option><option value="first_half">First half / short leave</option><option value="second_half">Second half / short leave</option></select></label>
      <label className="field"><span>Start date</span><input name="start_date" type="date" required /></label>
      <label className="field"><span>End date</span><input name="end_date" type="date" required /></label>
      <label className="field field-span"><span>Reason or admin note</span><textarea name="reason" minLength={4} maxLength={500} required placeholder="Reason for the approved leave" /></label>
      {error && <div className="form-alert error field-span">{error}</div>}
      <div className="modal-actions field-span"><button type="button" className="button button-ghost" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={loading}><CalendarPlus size={16} /> {loading ? "Recording…" : "Approve and record"}</button></div>
    </form>
  </div></div>;
}

function SettingsView({ branches, today }: { branches: Branch[]; today: string }) {
  const [pushActive, setPushActive] = useState(false);
  const [pushConfigured, setPushConfigured] = useState(false);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [cycleStartDay, setCycleStartDay] = useState(15);
  const [cycleSaving, setCycleSaving] = useState(false);
  const [cycleMessage, setCycleMessage] = useState("");
  const [issues, setIssues] = useState<SupportIssue[]>([]);
  const start = `${today.slice(0, 7)}-01`;

  useEffect(() => {
    let active = true;
    Promise.all([
      currentPushSubscription().catch(() => null),
      fetch("/api/admin/system-status", { cache: "no-store" }).then((response) => response.json()),
      fetch("/api/admin/payroll/preferences", { cache: "no-store" }).then((response) => response.json()),
      fetch("/api/issues", { cache: "no-store" }).then((response) => response.json()),
    ]).then(([subscription, status, payroll, issueResult]) => {
      if (!active) return;
      setPushActive(Boolean(subscription));
      setPushConfigured(Boolean(status.pushConfigured));
      setEmailConfigured(Boolean(status.emailConfigured));
      setCycleStartDay(Number(payroll.preferences?.cycle_start_day ?? 15));
      setIssues((issueResult.issues ?? []) as SupportIssue[]);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  async function enablePush() {
    setBusy(true);
    setMessage("");
    try {
      await enablePushNotifications();
      setPushActive(true);
      const response = await fetch("/api/notifications/test", { method: "POST" });
      const result = await response.json().catch(() => ({}));
      setMessage(response.ok ? `Test notification created${result.delivery?.pushed ? " and pushed to this device" : ""}.` : result.error);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Push notifications could not be enabled.");
    } finally {
      setBusy(false);
    }
  }

  async function savePayrollCycle() {
    setCycleSaving(true); setCycleMessage("");
    const response = await fetch("/api/admin/payroll/preferences", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ cycle_start_day: cycleStartDay }) });
    const result = await response.json().catch(() => ({}));
    setCycleMessage(response.ok ? `Salary cycle saved: ${ordinalDay(cycleStartDay)} to ${cycleStartDay === 1 ? "month end" : ordinalDay(cycleStartDay - 1)} of the following cycle.` : result.error || "The salary cycle could not be saved.");
    setCycleSaving(false);
  }

  async function resolveIssue(issue: SupportIssue) {
    const response = await fetch("/api/issues", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: issue.id, status: "resolved" }) });
    const result = await response.json().catch(() => ({}));
    if (response.ok) setIssues((current) => current.map((item) => item.id === issue.id ? result.issue as SupportIssue : item));
  }

  return <><div className="page-heading"><div><span className="eyebrow">SYSTEM CONTROL</span><h1>Settings & setup</h1><p>Backups, delivery services and security controls in one working dashboard.</p></div></div>
    <div className="settings-grid">
      <section className="panel settings-card settings-wide payroll-cycle-settings"><div className="settings-card-head"><span><CalendarRange size={20} /></span><div><h2>Salary calculation dates</h2><p>Choose the first day of every salary cycle. A cycle starting on the 15th automatically closes on the 14th of the next month, without overlapping dates.</p></div></div><div className="payroll-cycle-setting-row"><label className="field"><span>Cycle starts on day</span><input type="number" min="1" max="28" value={cycleStartDay} onChange={(event) => setCycleStartDay(Math.min(28, Math.max(1, Number(event.target.value))))} /></label><div><small>ACCOUNTANT PERIOD</small><strong>{ordinalDay(cycleStartDay)} → {cycleStartDay === 1 ? "month end" : ordinalDay(cycleStartDay - 1)}</strong><p>Salary creation will automatically use this saved date range.</p></div><button className="button button-primary" onClick={() => void savePayrollCycle()} disabled={cycleSaving}><Save size={16} /> {cycleSaving ? "Saving…" : "Save salary dates"}</button></div>{cycleMessage && <small className="settings-message">{cycleMessage}</small>}</section>
      <section className="panel settings-card settings-wide"><div className="settings-card-head"><span><Download size={20} /></span><div><h2>Branch-wise monthly CSV ledgers</h2><p>One clear row per employee and scheduled date, including absence, leave, holiday, weekly-off and attendance details.</p></div></div><div className="backup-list"><a className="backup-row featured" href={`/api/admin/backups/attendance?branch_id=all&start=${start}&end=${today}`}><span className="branch-letter">ALL</span><div><strong>All branches · {format(parseISO(start), "MMMM yyyy")}</strong><small>{start} to {today}</small></div><Download size={18} /></a>{branches.map((branch) => <a className="backup-row" key={branch.id} href={`/api/admin/backups/attendance?branch_id=${branch.id}&start=${start}&end=${today}`}><span className="branch-letter">{branch.code.slice(0, 2)}</span><div><strong>{branch.name} · {format(parseISO(start), "MMMM yyyy")}</strong><small>{branch.code} separate attendance ledger</small></div><Download size={18} /></a>)}</div></section>
      <section className="panel settings-card"><div className="settings-card-head"><span><Bell size={20} /></span><div><h2>Background notifications</h2><p>Web Push powers leave, calendar and shift alerts outside the app.</p></div></div><div className={`system-status ${pushConfigured ? "ready" : "warning"}`}><i />{pushConfigured ? pushActive ? "Push is active on this device" : "Push service is configured" : "VAPID keys are required"}</div><button className="button button-primary button-full" onClick={() => void enablePush()} disabled={!pushConfigured || busy}>{busy ? "Testing..." : pushActive ? "Send test notification" : "Enable on this device"}</button>{message && <small className="settings-message">{message}</small>}</section>
      <section className="panel settings-card"><div className="settings-card-head"><span><Mail size={20} /></span><div><h2>Welcome email delivery</h2><p>New accounts and password resets receive a branded secure email.</p></div></div><div className={`system-status ${emailConfigured ? "ready" : "warning"}`}><i />{emailConfigured ? "Resend delivery is configured" : "Add RESEND_API_KEY and EMAIL_FROM"}</div><p className="settings-detail">If delivery is unavailable, Presence still shows a copy-ready credential receipt so no account is lost.</p></section>
      <section className="panel settings-card"><div className="settings-card-head"><span><ShieldCheck size={20} /></span><div><h2>Session protection</h2><p>Portal sessions lock after 10 minutes without user activity.</p></div></div><ul className="settings-checklist"><li><Check size={15} /> Cross-tab activity tracking</li><li><Check size={15} /> One-minute lock warning</li><li><Check size={15} /> Fresh sign-in after timeout</li></ul></section>
      <section className="panel settings-card"><div className="settings-card-head"><span><MapPin size={20} /></span><div><h2>Attendance integrity</h2><p>Each clock action uses a short-lived server challenge and three fresh agreeing location samples.</p></div></div><ul className="settings-checklist"><li><Check size={15} /> Impossible-movement checks</li><li><Check size={15} /> Server-calculated office distance</li><li><Check size={15} /> Every denied attempt audited</li></ul></section>
      <section className="panel settings-card settings-wide"><div className="settings-card-head"><span><LifeBuoy size={20} /></span><div><h2>Staff issue reports</h2><p>Problems reported from attendance, location, leave, schedule or salary screens.</p></div></div><div className="support-issue-list">{issues.length ? issues.slice(0, 12).map((issue) => <article className={issue.status} key={issue.id}><span><LifeBuoy size={17} /></span><div><small>{issue.category.toUpperCase()} · {format(parseISO(issue.created_at), "d MMM, h:mm a")}</small><strong>{issue.reporter?.full_name || "Staff member"}</strong><p>{issue.message}</p></div>{issue.status === "open" ? <button onClick={() => void resolveIssue(issue)}>Mark resolved</button> : <em><Check size={14} /> Resolved</em>}</article>) : <div className="empty-state"><span><Check size={22} /></span><strong>No staff issues reported</strong><small>New reports will appear here and in admin notifications.</small></div>}</div></section>
    </div>
  </>;
}

function NavButton({ active, icon, label, count, onClick }: { active: boolean; icon: React.ReactNode; label: string; count?: number; onClick: () => void }) { return <button className={active ? "active" : ""} onClick={onClick}>{icon}<span>{label}</span>{count !== undefined && <small>{count}</small>}</button>; }
function StatCard({ label, value, detail, icon, tone }: { label: string; value: string; detail: string; icon: React.ReactNode; tone: string }) { return <article className={`stat-card ${tone}`}><span className={`stat-icon ${tone}`}>{icon}</span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></article>; }
function PanelHead({ eyebrow, title, action, onClick }: { eyebrow: string; title: string; action?: string; onClick?: () => void }) { return <div className="panel-head"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>{action && <button onClick={onClick}>{action} <ChevronDown size={15} /></button>}</div>; }
function initials(name: string) { return name.split(" ").slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }
function roleTitle(role: string) { return role === "branch_admin" ? "Branch admin" : "Staff"; }
function scheduleSummary(schedule: WorkScheduleDay[]) {
  const halfDays = schedule.filter((day) => day.day_type === "half_day");
  if (!halfDays.length) return "No half days · select to edit";
  const first = halfDays[0];
  return `${halfDays.map((day) => WEEKDAYS[day.weekday - 1].slice(0, 3)).join(", ")} half day · ${first.arrival_time.slice(0, 5)}–${first.departure_time.slice(0, 5)}`;
}
function ordinalDay(value: number) { const suffix = value % 10 === 1 && value !== 11 ? "st" : value % 10 === 2 && value !== 12 ? "nd" : value % 10 === 3 && value !== 13 ? "rd" : "th"; return `${value}${suffix}`; }
function formatWorkMinutes(minutes: number) { return `${Math.floor(minutes / 60)}h ${minutes % 60}m`; }
