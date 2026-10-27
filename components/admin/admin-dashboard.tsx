"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import {
  Bell,
  Building2,
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronDown,
  ClipboardCheck,
  Clock3,
  Download,
  Gauge,
  HelpCircle,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  LogOut,
  MapPin,
  Mail,
  Menu,
  MoreHorizontal,
  Plus,
  Phone,
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
import { captureBestBrowserLocation } from "@/lib/browser-location";
import { createClient } from "@/lib/supabase/client";
import type { AttendanceRecord, Branch, BranchSetupInvite, BranchSetupSubmission, CalendarNote, LeaveRequest, Profile } from "@/lib/types";

type Tab = "overview" | "branches" | "staff" | "attendance" | "leave" | "calendar" | "setup";

export function AdminDashboard({ admin, today, initialBranches, initialStaff, attendance, initialLeaves, initialSetupInvites, initialSetupSubmissions, initialCalendarNotes }: { admin: Profile; today: string; initialBranches: Branch[]; initialStaff: Profile[]; attendance: AttendanceRecord[]; initialLeaves: LeaveRequest[]; initialSetupInvites: BranchSetupInvite[]; initialSetupSubmissions: BranchSetupSubmission[]; initialCalendarNotes: CalendarNote[] }) {
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
  const attendanceRate = activeStaff.length ? Math.round((todaysAttendance.length / activeStaff.length) * 100) : 0;

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
        <NavButton active={tab === "calendar"} icon={<CalendarDays />} label="Team calendar" onClick={() => navigate("calendar")} />
        {isSuperAdmin && <NavButton active={tab === "setup"} icon={<Link2 />} label="Branch setup" count={initialSetupSubmissions.filter((item) => !item.created_branch_id).length || undefined} onClick={() => navigate("setup")} />}
      </nav>
      <div className="side-nav secondary"><button onClick={() => isSuperAdmin && navigate("setup")}><Settings size={19} /><span>Settings</span></button><button><HelpCircle size={19} /><span>Help & setup</span></button></div>
      <div className="sidebar-user"><span className="avatar avatar-sm">{initials(admin.full_name)}</span><div><strong>{admin.full_name}</strong><small>{isSuperAdmin ? "Super administrator" : "Branch administrator"}</small></div><button onClick={logout}><LogOut size={17} /></button></div>
    </aside>
    {sidebarOpen && <button className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="Close navigation" />}

    <section className="admin-main">
      <header className="admin-topbar">
        <button className="menu-button" onClick={() => setSidebarOpen(true)}><Menu size={22} /></button>
        <div className="admin-search"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people, branches or records…" /></div>
        <div className="topbar-actions"><button className="icon-button bordered"><Bell size={19} /><span className="notification-dot" /></button><span className="topbar-divider" /><div className="topbar-user"><span className="avatar avatar-sm">{initials(admin.full_name)}</span><div><strong>{admin.full_name}</strong><small>{isSuperAdmin ? "Super admin" : "Branch admin"}</small></div></div></div>
      </header>

      <div className="admin-content">
        {tab === "overview" && <Overview admin={admin} branches={branches} staff={activeStaff} today={today} todaysAttendance={todaysAttendance} pendingLeaves={pendingLeaves} attendanceRate={attendanceRate} onAddStaff={() => openStaffModal()} onAddBranch={() => setBranchModal(true)} onNavigate={navigate} canManageBranches={isSuperAdmin} />}
        {tab === "branches" && <BranchesView branches={branches} staff={staff} onAdd={() => setBranchModal(true)} onAddStaff={openStaffModal} canAdd={isSuperAdmin} onUpdated={(updated) => setBranches((current) => current.map((branch) => branch.id === updated.id ? updated : branch))} />}
        {tab === "staff" && <StaffView staff={filteredStaff} branches={branches} today={today} calendarNotes={initialCalendarNotes} onAdd={() => openStaffModal()} onRecordLeave={(userId) => setLeaveModalUserId(userId)} />}
        {tab === "attendance" && <AttendanceView rows={attendance} branches={branches} />}
        {tab === "leave" && <LeaveView leaves={leaves} onUpdate={(updated) => setLeaves((current) => current.map((leave) => leave.id === updated.id ? updated : leave))} onCreate={() => setLeaveModalUserId("")} />}
        {tab === "calendar" && <><div className="page-heading"><div><span className="eyebrow">TEAM SCHEDULE</span><h1>Calendar</h1><p>Publish notes alongside official Sri Lankan holidays and Poya days.</p></div></div><WorkCalendar today={today} initialNotes={initialCalendarNotes} canManage branches={branches} title="Company calendar" /></>}
        {tab === "setup" && isSuperAdmin && <BranchSetupView initialInvites={initialSetupInvites} initialSubmissions={initialSetupSubmissions} onBranchCreated={(branch) => setBranches((current) => current.some((item) => item.id === branch.id) ? current : [...current, branch])} />}
      </div>
    </section>

    {branchModal && isSuperAdmin && <BranchModal onClose={() => setBranchModal(false)} onCreated={(branch) => { setBranches((current) => [...current, branch]); setBranchModal(false); }} />}
    {staffModal && <StaffModal branches={branches} defaultBranchId={staffModalBranchId} onClose={() => setStaffModal(false)} onCreated={(person) => { setStaff((current) => [...current, person]); setStaffModal(false); }} />}
    {leaveModalUserId !== null && <AdminLeaveModal staff={staff} defaultUserId={leaveModalUserId || undefined} onClose={() => setLeaveModalUserId(null)} onCreated={(leave) => { setLeaves((current) => [leave, ...current]); setLeaveModalUserId(null); }} />}
  </main>;
}

function Overview({ admin, branches, staff, today, todaysAttendance, pendingLeaves, attendanceRate, onAddStaff, onAddBranch, onNavigate, canManageBranches }: { admin: Profile; branches: Branch[]; staff: Profile[]; today: string; todaysAttendance: AttendanceRecord[]; pendingLeaves: LeaveRequest[]; attendanceRate: number; onAddStaff: () => void; onAddBranch: () => void; onNavigate: (tab: Tab) => void; canManageBranches: boolean }) {
  const late = todaysAttendance.filter((row) => row.status === "late").length;
  return <>
    <div className="page-heading"><div><span className="eyebrow">{format(parseISO(today), "EEEE, d MMMM yyyy")}</span><h1>Good {new Date().getHours() < 12 ? "morning" : "afternoon"}, {admin.full_name.split(" ")[0]}.</h1><p>Here’s what’s happening across your offices today.</p></div><div className="heading-actions"><button className="button button-ghost"><Download size={17} /> Export</button><button className="button button-primary" onClick={onAddStaff}><Plus size={17} /> Add staff</button></div></div>
    <div className="stats-grid">
      <StatCard label="Present today" value={`${todaysAttendance.length}`} detail={`of ${staff.length} active staff`} icon={<ClipboardCheck />} tone="green" />
      <StatCard label="Attendance rate" value={`${attendanceRate}%`} detail={attendanceRate >= 90 ? "Strong start today" : "Across all branches"} icon={<Gauge />} tone="navy" />
      <StatCard label="Late arrivals" value={`${late}`} detail={late ? "Need attention" : "Everyone is on time"} icon={<Clock3 />} tone="amber" />
      <StatCard label="Pending leave" value={`${pendingLeaves.length}`} detail="Awaiting your review" icon={<CalendarCheck />} tone="violet" />
    </div>
    <div className="overview-grid">
      <section className="panel attendance-panel"><PanelHead eyebrow="LIVE TODAY" title="Attendance board" action="View all" onClick={() => onNavigate("attendance")} /><div className="attendance-overview"><div className="donut" style={{ "--percent": `${attendanceRate * 3.6}deg` } as React.CSSProperties}><div><strong>{attendanceRate}%</strong><small>present</small></div></div><div className="legend"><span><i className="green" />Present<strong>{todaysAttendance.length}</strong></span><span><i className="amber" />Late<strong>{late}</strong></span><span><i className="slate" />Not marked<strong>{Math.max(0, staff.length - todaysAttendance.length)}</strong></span></div></div><div className="mini-people">{todaysAttendance.slice(0, 5).map((row) => <div key={row.id}><span className="avatar avatar-sm">{initials(row.profile?.full_name || "Staff")}</span><div><strong>{row.profile?.full_name}</strong><small>{row.branch?.name}</small></div><time>{row.clock_in ? format(parseISO(row.clock_in), "h:mm a") : "—"}</time><span className={`status-badge ${row.status}`}>{row.status}</span></div>)}{!todaysAttendance.length && <div className="inline-empty">No one has clocked in yet today.</div>}</div></section>
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

function StaffView({ staff, branches, today, calendarNotes, onAdd, onRecordLeave }: { staff: Profile[]; branches: Branch[]; today: string; calendarNotes: CalendarNote[]; onAdd: () => void; onRecordLeave: (userId: string) => void }) {
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
    {selected && <EmployeeDetailModal employee={selected} today={today} calendarNotes={calendarNotes} onClose={() => setSelected(null)} onRecordLeave={() => { onRecordLeave(selected.id); setSelected(null); }} />}
  </>;
}

function EmployeeDetailModal({ employee, today, calendarNotes, onClose, onRecordLeave }: { employee: Profile; today: string; calendarNotes: CalendarNote[]; onClose: () => void; onRecordLeave: () => void }) {
  const [detail, setDetail] = useState<{ profile: Profile; attendance: AttendanceRecord[]; leaves: LeaveRequest[] } | null>(null);
  const [error, setError] = useState("");

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

  return <div className="modal-backdrop employee-detail-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="modal modal-wide employee-detail-modal" role="dialog" aria-modal="true" aria-labelledby="employee-detail-title">
    <div className="modal-head employee-profile-head"><div className="employee-profile-identity"><span className="avatar employee-avatar">{initials(profile.full_name)}</span><div><span className="eyebrow">EMPLOYEE PROFILE</span><h2 id="employee-detail-title">{profile.full_name}</h2><p>{profile.job_title || roleTitle(profile.role)} · {profile.branch?.name || "No branch assigned"}</p></div></div><div className="heading-actions"><button className="button button-primary" onClick={onRecordLeave}><CalendarPlus size={16} /> Record leave</button><button className="icon-button bordered" onClick={onClose} aria-label="Close"><X size={20} /></button></div></div>
    {error && <div className="form-alert error">{error}</div>}
    {!detail && !error ? <div className="detail-loading"><LoaderCircle className="spin" size={25} /> Loading employee details…</div> : <>
      <div className="employee-profile-grid">
        <section className="employee-contact-card"><span className="eyebrow">DETAILS</span><div><Mail size={17} /><span><small>Email</small><strong>{profile.email || "Not provided"}</strong></span></div><div><Phone size={17} /><span><small>Phone</small><strong>{profile.phone || "Not provided"}</strong></span></div><div><Building2 size={17} /><span><small>Employee code</small><strong>{profile.employee_code || "Not assigned"}</strong></span></div><div><Clock3 size={17} /><span><small>Work schedule</small><strong>{profile.expected_arrival.slice(0, 5)} – {profile.expected_departure.slice(0, 5)}</strong></span></div></section>
        <div className="employee-summary-grid"><StatCard label="Total hours" value={formatWorkMinutes(totalMinutes)} detail={`${rows.length} recorded workday${rows.length === 1 ? "" : "s"} this year`} icon={<Clock3 />} tone="navy" /><StatCard label="Approved leave" value={`${leaveDays}`} detail={`${profile.annual_leave_days} annual days allocated`} icon={<CalendarCheck />} tone="violet" /><StatCard label="Timing flags" value={`${timingFlags}`} detail="Late arrivals or early departures" icon={<Gauge />} tone="amber" /></div>
      </div>
      <WorkCalendar today={today} initialNotes={calendarNotes} attendance={rows} leaves={leaves} title={`${profile.full_name}'s calendar`} />
      <section className="employee-recent-records"><div className="branch-detail-section-head"><div><span className="eyebrow">RECENT RECORDS</span><h3>Attendance detail</h3></div></div><div className="data-table"><div className="table-row employee-record-row table-head"><span>Date</span><span>Clock in</span><span>Clock out</span><span>Worked</span><span>Timing</span></div>{rows.slice(0, 12).map((row) => <div className="table-row employee-record-row" key={row.id}><span>{format(parseISO(row.attendance_date), "d MMM yyyy")}</span><span>{row.clock_in ? format(parseISO(row.clock_in), "h:mm a") : "—"}</span><span>{row.clock_out ? format(parseISO(row.clock_out), "h:mm a") : "—"}</span><span>{formatWorkMinutes(row.work_minutes ?? 0)}</span><span>{row.late_minutes > 0 ? `${row.late_minutes}m late` : row.early_leave_minutes > 0 ? `${row.early_leave_minutes}m early` : "On time"}</span></div>)}</div></section>
    </>}
  </div></div>;
}

function AttendanceView({ rows, branches }: { rows: AttendanceRecord[]; branches: Branch[] }) {
  return <><div className="page-heading"><div><span className="eyebrow">VERIFIED RECORDS</span><h1>Attendance</h1><p>Server-verified check-ins and check-outs across every branch.</p></div><button className="button button-ghost"><Download size={17} /> Export CSV</button></div><div className="panel table-panel"><div className="table-tools"><span className="filter-chip">This month <ChevronDown size={15} /></span><span className="filter-chip">{branches.length} branches <ChevronDown size={15} /></span></div><div className="data-table"><div className="table-row attendance-table table-head"><span>Employee</span><span>Date</span><span>Branch</span><span>Clock in</span><span>Clock out</span><span>Hours</span><span>Status</span></div>{rows.map((row) => <div className="table-row attendance-table" key={row.id}><span className="person-cell"><span className="avatar avatar-sm">{initials(row.profile?.full_name || "Staff")}</span><strong>{row.profile?.full_name}</strong></span><span>{format(parseISO(row.attendance_date), "d MMM yyyy")}</span><span>{row.branch?.name}</span><span>{row.clock_in ? format(parseISO(row.clock_in), "h:mm a") : "—"}</span><span>{row.clock_out ? format(parseISO(row.clock_out), "h:mm a") : "—"}</span><span>{row.work_minutes ? `${Math.floor(row.work_minutes / 60)}h ${row.work_minutes % 60}m` : "—"}</span><span><span className={`status-badge ${row.status}`}>{row.status}</span></span></div>)}</div></div></>;
}

function LeaveView({ leaves, onUpdate, onCreate }: { leaves: LeaveRequest[]; onUpdate: (leave: LeaveRequest) => void; onCreate: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  async function decide(id: string, status: "approved" | "rejected") { setBusy(id); const response = await fetch(`/api/admin/leave/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) }); const json = await response.json(); if (response.ok) onUpdate(json.leave); else window.alert(json.error); setBusy(null); }
  return <><div className="page-heading"><div><span className="eyebrow">TIME OFF</span><h1>Leave requests</h1><p>Review requests, submit leave for an employee and keep balances accurate.</p></div><button className="button button-primary" onClick={onCreate}><CalendarPlus size={17} /> Record employee leave</button></div><div className="leave-admin-grid"><section className="panel"><PanelHead eyebrow="NEEDS REVIEW" title={`${leaves.filter((l) => l.status === "pending").length} pending requests`} /> <div className="request-list">{leaves.filter((l) => l.status === "pending").map((leave) => <article key={leave.id}><div className="request-person"><span className="avatar">{initials(leave.profile?.full_name || "Staff")}</span><div><strong>{leave.profile?.full_name}</strong><small>{leave.profile?.employee_code}</small></div><span className="status-badge pending">pending</span></div><div className="request-dates"><CalendarCheck size={18} /><div><strong>{format(parseISO(leave.start_date), "d MMM")} – {format(parseISO(leave.end_date), "d MMM yyyy")}</strong><small>{leave.requested_days} day{Number(leave.requested_days) === 1 ? "" : "s"} · {leave.leave_type} leave</small></div></div><p>{leave.reason}</p><div className="request-actions"><button className="button button-ghost" disabled={busy === leave.id} onClick={() => decide(leave.id, "rejected")}>Decline</button><button className="button button-primary" disabled={busy === leave.id} onClick={() => decide(leave.id, "approved")}><Check size={16} /> Approve</button></div></article>)}{!leaves.some((l) => l.status === "pending") && <div className="empty-state"><span><Check size={24} /></span><strong>All caught up</strong><small>There are no requests waiting for review.</small></div>}</div></section><section className="panel"><PanelHead eyebrow="RECENT" title="Decision history" /><div className="decision-list">{leaves.filter((l) => l.status !== "pending").slice(0, 12).map((leave) => <div key={leave.id}><span className={`status-icon ${leave.status}`}><Check size={16} /></span><div><strong>{leave.profile?.full_name}</strong><small>{leave.leave_type} · {leave.requested_days} day(s)</small></div><span className={`status-badge ${leave.status}`}>{leave.status}</span></div>)}</div></section></div></>;
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
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch("/api/admin/branches", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...data, latitude: lat, longitude: lng, radius_m: radius }) });
    const json = await response.json();
    if (!response.ok) { setError(json.error); setLoading(false); return; }
    onCreated(json.branch);
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

  function generatePassword() {
    const value = `Welcome!${crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 7)}A9`;
    setTemporaryPassword(value);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch("/api/admin/staff", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values) });
    const json = await response.json();
    if (!response.ok) { setError(json.error); setLoading(false); return; }
    onCreated(json.profile);
  }

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
      <label className="field"><span>Arrival time</span><input name="expected_arrival" type="time" required defaultValue="08:30" /></label>
      <label className="field"><span>Leaving time</span><input name="expected_departure" type="time" required defaultValue="17:00" /></label>
      <label className="field"><span>Monthly leave days</span><input name="monthly_leave_days" type="number" min="0" max="10" step="0.5" required defaultValue="1" /></label>
      <label className="field"><span>Annual leave days</span><input name="annual_leave_days" type="number" min="0" max="60" step="0.5" required defaultValue="14" /></label>
      {error && <div className="form-alert error field-span">{error}</div>}
      <div className="modal-actions field-span"><button type="button" className="button button-ghost" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={loading}>{loading ? "Creating…" : "Create account"}</button></div>
    </form>
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

function NavButton({ active, icon, label, count, onClick }: { active: boolean; icon: React.ReactNode; label: string; count?: number; onClick: () => void }) { return <button className={active ? "active" : ""} onClick={onClick}>{icon}<span>{label}</span>{count !== undefined && <small>{count}</small>}</button>; }
function StatCard({ label, value, detail, icon, tone }: { label: string; value: string; detail: string; icon: React.ReactNode; tone: string }) { return <article className={`stat-card ${tone}`}><span className={`stat-icon ${tone}`}>{icon}</span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></article>; }
function PanelHead({ eyebrow, title, action, onClick }: { eyebrow: string; title: string; action?: string; onClick?: () => void }) { return <div className="panel-head"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>{action && <button onClick={onClick}>{action} <ChevronDown size={15} /></button>}</div>; }
function initials(name: string) { return name.split(" ").slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }
function roleTitle(role: string) { return role === "branch_admin" ? "Branch admin" : "Staff"; }
function formatWorkMinutes(minutes: number) { return `${Math.floor(minutes / 60)}h ${minutes % 60}m`; }
