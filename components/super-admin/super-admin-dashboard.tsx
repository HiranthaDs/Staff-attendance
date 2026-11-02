"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, BarChart3, Building2, CheckCircle2, Clock3, Copy, LoaderCircle, LogOut, Megaphone, MonitorSmartphone, Plus, RotateCcw, Search, Send, ShieldCheck, Sparkles, Users, X } from "lucide-react";
import { Brand } from "@/components/brand";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { HotlineManager } from "@/components/super-admin/hotline-manager";
import { createClient } from "@/lib/supabase/client";
import type { Organization, OrganizationInvitation, PlatformHotline, Profile, StaffDeviceDirectoryRow } from "@/lib/types";

type CreationReceipt = { organization: Organization; link: string; loginLink: string; emailSent: boolean; ownerEmail: string };
export type PlatformDailyRow = { organization_id: string; organization_name: string; active_members: number; present_today: number; late_today: number; open_shifts: number; pending_leave: number };
export type PlatformRegistration = Pick<Profile, "id" | "full_name" | "email" | "role" | "active" | "created_at"> & {
  organization: { name: string; slug: string } | Array<{ name: string; slug: string }> | null;
  branch: { name: string; code: string } | Array<{ name: string; code: string }> | null;
};
export type PlatformGrowthPoint = { label: string; registrations: number };
export type PlatformTotals = { companies: number; activeCompanies: number; companyAdmins: number; employees: number; branches: number; newThisMonth: number };
export type PlatformLateAttendance = {
  id: string;
  clock_in: string | null;
  late_minutes: number;
  profile: { id: string; full_name: string; employee_code: string | null; avatar_path?: string | null; organization_id: string; organization?: { name: string; slug: string } | Array<{ name: string; slug: string }> | null } | null;
  branch: { name: string; code: string } | null;
};

export function SuperAdminDashboard({ admin, initialOrganizations, initialInvitations, dailyByOrganization, lateAttendance, initialHotlines, initialDeviceDirectory, recentRegistrations, registrationGrowth, totals }: { admin: Profile; initialOrganizations: Organization[]; initialInvitations: OrganizationInvitation[]; dailyByOrganization: PlatformDailyRow[]; lateAttendance: PlatformLateAttendance[]; initialHotlines: PlatformHotline[]; initialDeviceDirectory: StaffDeviceDirectoryRow[]; recentRegistrations: PlatformRegistration[]; registrationGrowth: PlatformGrowthPoint[]; totals: PlatformTotals }) {
  const router = useRouter();
  const [organizations, setOrganizations] = useState(initialOrganizations);
  const [invitations, setInvitations] = useState(initialInvitations);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [broadcasting, setBroadcasting] = useState(false);
  const [deviceDirectory, setDeviceDirectory] = useState(initialDeviceDirectory);
  const [deviceQuery, setDeviceQuery] = useState("");
  const [copiedWorkspace, setCopiedWorkspace] = useState("");
  const [resettingDevice, setResettingDevice] = useState<StaffDeviceDirectoryRow | null>(null);
  const filtered = useMemo(() => organizations.filter((item) => `${item.name} ${item.slug} ${item.billing_email}`.toLowerCase().includes(query.toLowerCase())), [organizations, query]);
  const filteredDevices = useMemo(() => deviceDirectory.filter((item) => `${item.full_name} ${item.email || ""} ${item.employee_code || ""} ${item.organization_name || ""} ${item.branch_name || ""}`.toLowerCase().includes(deviceQuery.toLowerCase())), [deviceDirectory, deviceQuery]);
  const pendingOwners = invitations.filter((item) => item.status === "pending" && new Date(item.expires_at) > new Date()).length;
  const presentToday = dailyByOrganization.reduce((sum, item) => sum + item.present_today, 0);
  const lateToday = dailyByOrganization.reduce((sum, item) => sum + item.late_today, 0);
  const openShifts = dailyByOrganization.reduce((sum, item) => sum + item.open_shifts, 0);

  async function logout() { await createClient().auth.signOut(); router.replace("/system-owner/login"); }
  async function copyWorkspaceLogin(slug: string) {
    await navigator.clipboard.writeText(`${window.location.origin}/login/${slug}`);
    setCopiedWorkspace(slug);
    window.setTimeout(() => setCopiedWorkspace((current) => current === slug ? "" : current), 2_000);
  }
  async function toggleStatus(organization: Organization) {
    const status = organization.status === "active" ? "suspended" : "active";
    const response = await fetch("/api/super-admin/organizations", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: organization.id, status }) });
    const result = await response.json().catch(() => ({}));
    if (response.ok) setOrganizations((current) => current.map((item) => item.id === organization.id ? { ...item, ...result.organization } : item));
  }

  return <main className="platform-shell">
    <header className="platform-header"><Brand /><div className="platform-header-actions"><div><strong>{admin.full_name}</strong><small>System owner · Founder access</small></div><button className="icon-button bordered" onClick={logout} aria-label="Sign out"><LogOut size={18} /></button></div></header>
    <section className="platform-content">
      <div className="platform-hero owner-hero"><div><span className="eyebrow"><Sparkles size={14} /> SYSTEM OWNER · FOUNDER CONTROL</span><h1>The whole platform, one signal.</h1><p>Track company growth, employee adoption and live operations—then communicate with every workspace from one private control room.</p></div><div className="platform-hero-actions"><button className="button button-ghost" onClick={() => setBroadcasting(true)}><Megaphone size={18} /> Send announcement</button><button className="button button-primary" onClick={() => setCreating(true)}><Plus size={18} /> Add company super admin</button></div></div>
      <div className="platform-kpi-grid"><PlatformKpi icon={<Building2 />} label="Active companies" value={totals.activeCompanies} detail={`${totals.companies} total companies`} tone="green" /><PlatformKpi icon={<ShieldCheck />} label="Company super admins" value={totals.companyAdmins} detail={`${pendingOwners} invitations pending`} tone="navy" /><PlatformKpi icon={<Users />} label="Registered employees" value={totals.employees} detail={`${totals.newThisMonth} joined this month`} tone="blue" /><PlatformKpi icon={<Activity />} label="Present today" value={presentToday} detail={`${openShifts} currently clocked in`} tone="violet" /><PlatformKpi icon={<Building2 />} label="Company branches" value={totals.branches} detail="Across every workspace" tone="slate" /><PlatformKpi icon={<Clock3 />} label="Late today" value={lateToday} detail={lateToday ? "Review exceptions below" : "No late arrivals"} tone="amber" /></div>
      <div className="owner-insight-grid">
        <section className="panel owner-growth-panel">
          <div className="platform-section-head"><div><span className="eyebrow">PLATFORM GROWTH</span><h2>Employee registrations</h2><p>New company accounts created during the last eight weeks.</p></div><span className="owner-panel-icon"><BarChart3 size={19} /></span></div>
          <div className="owner-growth-bars">{registrationGrowth.map((point) => { const peak = Math.max(1, ...registrationGrowth.map((item) => item.registrations)); return <div key={point.label} className="owner-growth-column"><span><i style={{ height: `${Math.max(8, (point.registrations / peak) * 100)}%` }} /><b>{point.registrations}</b></span><small>{point.label}</small></div>; })}</div>
        </section>
        <section className="panel owner-quick-panel">
          <span className="eyebrow">OWNER ACTIONS</span><h2>Operate without crossing tenant boundaries.</h2><p>Every new super admin is bound to a company. Your founder account remains the only platform-wide identity.</p>
          <div><button className="owner-action" onClick={() => setCreating(true)}><Building2 size={19} /><span><strong>Provision a company</strong><small>Company details + its super admin</small></span></button><button className="owner-action" onClick={() => setBroadcasting(true)}><Megaphone size={19} /><span><strong>Broadcast an update</strong><small>Maintenance, security or service notices</small></span></button></div>
        </section>
      </div>
      <div className="platform-ops-grid">
        <section className="panel platform-ops-panel"><div className="platform-section-head"><div><span className="eyebrow">TODAY · LIVE</span><h2>Late attendance</h2><p>Largest delays across all companies, server-verified from branch attendance.</p></div><span className="status-badge late">{lateToday} late</span></div><div className="platform-late-list">{lateAttendance.length ? lateAttendance.map((row) => { const organization = Array.isArray(row.profile?.organization) ? row.profile?.organization[0] : row.profile?.organization; return <article key={row.id}>{row.profile ? <ProfileAvatar id={row.profile.id} name={row.profile.full_name} avatarPath={row.profile.avatar_path} className="avatar-sm" /> : <span className="avatar avatar-sm">?</span>}<div><strong>{row.profile?.full_name || "Staff member"}</strong><small>{organization?.name || "Company"} · {row.branch?.name || "Branch"}</small></div><time>{row.clock_in ? new Intl.DateTimeFormat("en-LK", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Colombo" }).format(new Date(row.clock_in)) : "—"}</time><b>{row.late_minutes}m late</b></article>; }) : <div className="platform-empty"><CheckCircle2 size={24} /><strong>Everyone is on time</strong><small>No late attendance has been recorded today.</small></div>}</div></section>
        <section className="panel platform-ops-panel"><div className="platform-section-head"><div><span className="eyebrow">COMPANY PULSE</span><h2>Today by workspace</h2><p>Use this summary to spot operational pressure immediately.</p></div></div><div className="platform-pulse-list">{dailyByOrganization.map((row) => <article key={row.organization_id}><div><strong>{row.organization_name}</strong><small>{row.active_members} active users</small></div><span><b>{row.present_today}</b><small>present</small></span><span className={row.late_today ? "warning" : ""}><b>{row.late_today}</b><small>late</small></span><span className={row.pending_leave ? "warning" : ""}><b>{row.pending_leave}</b><small>leave</small></span></article>)}</div></section>
      </div>
      <section className="panel owner-registration-panel">
        <div className="platform-table-head"><div><span className="eyebrow">ACCOUNT ACTIVITY</span><h2>Latest employee registrations</h2><p>Who joined, which company they belong to, and the exact registration date.</p></div><span className="owner-panel-icon"><Users size={19} /></span></div>
        <div className="owner-registration-list">
          <div className="owner-registration-row owner-registration-head"><span>Employee</span><span>Company</span><span>Access</span><span>Registered</span><span>Status</span></div>
          {recentRegistrations.map((registration) => { const organization = Array.isArray(registration.organization) ? registration.organization[0] : registration.organization; const branch = Array.isArray(registration.branch) ? registration.branch[0] : registration.branch; return <article className="owner-registration-row" key={registration.id}><span><ProfileAvatar id={registration.id} name={registration.full_name} className="avatar-sm" /><span><strong>{registration.full_name}</strong><small>{registration.email || "No email"}</small></span></span><span><strong>{organization?.name || "Unassigned"}</strong><small>{branch?.name || "All branches"}</small></span><span><b>{registration.role === "company_admin" ? "Company super admin" : registration.role === "branch_admin" ? "Branch admin" : "Employee"}</b></span><time>{formatRegistrationDate(registration.created_at)}</time><span><i className={`account-dot ${registration.active ? "" : "inactive"}`} />{registration.active ? "Active" : "Disabled"}</span></article>; })}
          {!recentRegistrations.length && <div className="platform-empty"><Users size={24} /><strong>No employee registrations yet</strong><small>New company accounts will appear here.</small></div>}
        </div>
      </section>
      <section className="panel platform-table-panel"><div className="platform-table-head"><div><h2>Company directory</h2><p>Capacity includes super admins, managers, and staff.</p></div><label className="admin-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search companies…" /></label></div>
        <div className="company-table">
          <div className="company-row company-row-head"><span>Company</span><span>Company super admin</span><span>Usage</span><span>Branches</span><span>Status</span><span>Action</span></div>
          {filtered.map((organization) => {
            const invitation = invitations.find((item) => item.organization_id === organization.id && item.status === "pending");
            return <div className="company-row" key={organization.id}>
              <span><strong>{organization.name}</strong><small>{organization.legal_name || `/${organization.slug}`} · {organization.registration_number || organization.plan}</small><button className="company-login-copy" onClick={() => void copyWorkspaceLogin(organization.slug)} aria-label={`Copy ${organization.name} sign-in link`}><Copy size={11} /> {copiedWorkspace === organization.slug ? "Login link copied" : "Copy login link"}</button></span>
              <span className="platform-owner-cell">{organization.owner && <ProfileAvatar id={organization.owner.id} name={organization.owner.full_name} avatarPath={organization.owner.avatar_path} className="avatar-sm" />}<span><strong>{organization.owner?.full_name || invitation?.full_name || "Awaiting super admin"}</strong><small>{organization.owner?.email || invitation?.invited_email || organization.billing_email}</small></span></span>
              <span><strong>{organization.member_count ?? 0} / {organization.staff_limit}</strong><small>{Math.round(((organization.member_count ?? 0) / organization.staff_limit) * 100)}% used</small></span>
              <span><strong>{organization.branch_count ?? 0}</strong><small>active branches</small></span>
              <span><i className={`account-dot ${organization.status === "active" ? "" : "inactive"}`} />{organization.status}</span>
              <span><button className="button button-ghost button-sm" onClick={() => void toggleStatus(organization)}>{organization.status === "active" ? "Suspend" : "Reactivate"}</button></span>
            </div>;
          })}
        </div>
      </section>
      <section className="panel platform-table-panel device-directory-panel">
        <div className="platform-table-head"><div><span className="eyebrow">ANTI-BUDDY-PUNCHING</span><h2>Registered staff devices</h2><p>Attendance accounts can sign in on one registered browser only. Resetting issues a one-time code for a replacement device.</p></div><label className="admin-search"><Search size={18} /><input value={deviceQuery} onChange={(event) => setDeviceQuery(event.target.value)} placeholder="Search staff or company…" /></label></div>
        <div className="device-directory-list">
          {filteredDevices.map((item) => {
            const pending = Boolean(item.enrollment_expires_at && new Date(item.enrollment_expires_at) > new Date());
            return <article key={item.user_id} className={item.device_id ? "registered" : pending ? "pending" : "unregistered"}>
              <ProfileAvatar id={item.user_id} name={item.full_name} className="avatar-sm" />
              <div className="device-person"><strong>{item.full_name}</strong><small>{item.organization_name || "No company"} · {item.branch_name || "No branch"}</small></div>
              <div className="device-browser"><MonitorSmartphone size={17} /><span><strong>{item.device_label || (pending ? "Replacement pending" : "Not registered yet")}</strong><small>{item.last_seen_at ? `Last verified ${formatDeviceTime(item.last_seen_at)}` : pending ? `Code expires ${formatDeviceTime(item.enrollment_expires_at!)}` : "Registers on first staff login"}</small></span></div>
              <span className={`device-state ${item.device_id ? "ready" : pending ? "pending" : "empty"}`}><i />{item.device_id ? "Registered" : pending ? "Reset pending" : "Waiting"}</span>
              <button className="button button-ghost button-sm" onClick={() => setResettingDevice(item)}><RotateCcw size={14} /> {item.device_id || pending ? "Reset device" : "Issue code"}</button>
            </article>;
          })}
          {!filteredDevices.length && <div className="platform-empty"><MonitorSmartphone size={24} /><strong>No matching staff accounts</strong><small>Device-ready staff appear after company employees are created.</small></div>}
        </div>
      </section>
      <HotlineManager initialHotlines={initialHotlines} />
    </section>
    {broadcasting && <BroadcastModal organizations={organizations} onClose={() => setBroadcasting(false)} />}
    {creating && <CreateCompanyModal onClose={() => setCreating(false)} onCreated={(receipt, invitation) => { setOrganizations((current) => [{ ...receipt.organization, member_count: 0, branch_count: 0, owner: null }, ...current]); setInvitations((current) => [invitation, ...current]); }} />}
    {resettingDevice && <ResetStaffDeviceModal employee={resettingDevice} onClose={() => setResettingDevice(null)} onReset={(expiresAt) => setDeviceDirectory((current) => current.map((item) => item.user_id === resettingDevice.user_id ? { ...item, device_id: null, device_label: null, registered_at: null, last_seen_at: null, enrollment_expires_at: expiresAt } : item))} />}
  </main>;
}

function PlatformKpi({ icon, label, value, detail, tone }: { icon: React.ReactNode; label: string; value: number; detail: string; tone: string }) {
  return <article className={`platform-kpi ${tone}`}><span>{icon}</span><div><small>{label}</small><strong>{value.toLocaleString()}</strong><p>{detail}</p></div></article>;
}

function BroadcastModal({ organizations, onClose }: { organizations: Organization[]; onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<{ recipients: number; pushed: number } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch("/api/system-owner/broadcasts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(result.error || "The announcement could not be sent.");
      setLoading(false);
      return;
    }
    setReceipt({ recipients: Number(result.recipients || 0), pushed: Number(result.delivery?.pushed || 0) });
    setLoading(false);
  }

  if (receipt) return <div className="modal-backdrop elevated-modal"><div className="modal invite-receipt-modal" role="dialog" aria-modal="true">
    <div className="credential-success-icon"><Send size={32} /></div>
    <span className="eyebrow">ANNOUNCEMENT SENT</span>
    <h2>Your platform update is live</h2>
    <p>The notification was added to {receipt.recipients.toLocaleString()} active account{receipt.recipients === 1 ? "" : "s"}. {receipt.pushed ? `${receipt.pushed.toLocaleString()} browser push notification${receipt.pushed === 1 ? " was" : "s were"} also delivered.` : "It is ready in each recipient's notification center."}</p>
    <div className="form-alert success"><CheckCircle2 size={16} /> Delivery completed without exposing company data across tenants.</div>
    <div className="modal-actions"><button className="button button-primary" onClick={onClose}>Done</button></div>
  </div></div>;

  return <div className="modal-backdrop"><div className="modal broadcast-modal" role="dialog" aria-modal="true" aria-labelledby="broadcast-title">
    <div className="modal-head"><div><span className="eyebrow">PLATFORM BROADCAST</span><h2 id="broadcast-title">Send an announcement</h2><p>Publish maintenance, service or security information to selected company accounts.</p></div><button className="icon-button bordered" onClick={onClose} aria-label="Close"><X size={20} /></button></div>
    <div className="broadcast-guard"><ShieldCheck size={20} /><p><strong>Tenant-safe delivery</strong><span>Each person receives a private notification in their own workspace.</span></p></div>
    <form className="form-grid" onSubmit={submit}>
      <label className="field"><span>Audience</span><select name="audience" defaultValue="everyone"><option value="everyone">All company accounts</option><option value="company_admins">Company super admins only</option><option value="staff">Employees and branch admins</option></select></label>
      <label className="field"><span>Company</span><select name="organization_id" defaultValue=""><option value="">Every company</option>{organizations.map((organization) => <option value={organization.id} key={organization.id}>{organization.name}</option>)}</select></label>
      <label className="field"><span>Priority</span><select name="priority" defaultValue="normal"><option value="normal">Normal update</option><option value="urgent">Urgent notice</option></select></label>
      <label className="field"><span>Title</span><input name="title" minLength={3} maxLength={120} required placeholder="Scheduled maintenance" /></label>
      <label className="field field-span"><span>Message</span><textarea name="body" minLength={5} maxLength={500} required rows={5} placeholder="Explain what is happening, who is affected, and when normal service will return." /></label>
      {error && <div className="form-alert error field-span" role="alert">{error}</div>}
      <div className="modal-actions field-span"><button type="button" className="button button-ghost" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={loading}>{loading ? <><LoaderCircle className="spin" size={17} /> Sending…</> : <><Send size={17} /> Send notification</>}</button></div>
    </form>
  </div></div>;
}

function ResetStaffDeviceModal({ employee, onClose, onReset }: { employee: StaffDeviceDirectoryRow; onClose: () => void; onReset: (expiresAt: string) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<{ code: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  async function reset() {
    setLoading(true); setError("");
    const response = await fetch(`/api/super-admin/devices/${employee.user_id}`, { method: "POST" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setError(result.error || "The device could not be reset."); setLoading(false); return; }
    const next = { code: String(result.enrollmentCode), expiresAt: String(result.expiresAt) };
    setReceipt(next); onReset(next.expiresAt); setLoading(false);
  }
  if (receipt) return <div className="modal-backdrop elevated-modal"><div className="modal device-reset-modal" role="dialog" aria-modal="true"><div className="credential-success-icon"><MonitorSmartphone size={31} /></div><span className="eyebrow">NEW DEVICE AUTHORIZED</span><h2>Send the one-time code to {employee.full_name}</h2><p>The old registered browser is blocked immediately. This code expires in 24 hours and is consumed when the replacement device signs in.</p><div className="device-enrollment-code"><small>DEVICE REGISTRATION CODE</small><strong>{receipt.code}</strong></div><div className="form-alert warning"><ShieldCheck size={16} /> Share this code privately. It is shown only in this receipt.</div><div className="modal-actions"><button className="button button-ghost" onClick={async () => { await navigator.clipboard.writeText(receipt.code); setCopied(true); }}><Copy size={16} /> {copied ? "Copied" : "Copy code"}</button><button className="button button-primary" onClick={onClose}>Done</button></div></div></div>;
  return <div className="modal-backdrop elevated-modal"><div className="modal device-reset-modal" role="dialog" aria-modal="true" aria-labelledby="device-reset-title"><div className="modal-head"><div><span className="eyebrow">SECURE DEVICE RESET</span><h2 id="device-reset-title">Move {employee.full_name} to a new device?</h2><p>{employee.device_id ? `The current ${employee.device_label || "registered browser"} will lose attendance access immediately.` : "A one-time code will be required before this account can register its first device."}</p></div><button className="icon-button bordered" onClick={onClose} aria-label="Close"><X size={20} /></button></div><div className="device-reset-warning"><ShieldCheck size={20} /><p><strong>Passwords alone will not register the replacement.</strong><span>The employee must enter the new one-time code during sign-in.</span></p></div>{error && <div className="form-alert error">{error}</div>}<div className="modal-actions"><button className="button button-ghost" onClick={onClose}>Cancel</button><button className="button button-primary" onClick={() => void reset()} disabled={loading}>{loading ? <><LoaderCircle className="spin" size={16} /> Resetting…</> : <><RotateCcw size={16} /> Reset & create code</>}</button></div></div></div>;
}

function formatDeviceTime(value: string) {
  return new Intl.DateTimeFormat("en-LK", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Colombo" }).format(new Date(value));
}

function formatRegistrationDate(value: string | undefined) {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat("en-LK", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Colombo" }).format(new Date(value));
}

function CreateCompanyModal({ onClose, onCreated }: { onClose: () => void; onCreated: (receipt: CreationReceipt, invitation: OrganizationInvitation) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [slug, setSlug] = useState("");
  const [receipt, setReceipt] = useState<CreationReceipt | null>(null);
  const [copied, setCopied] = useState(false);
  function deriveSlug(value: string) { setSlug(value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50)); }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch("/api/super-admin/organizations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setError(result.error || "The company could not be created."); setLoading(false); return; }
    const nextReceipt = { organization: result.organization as Organization, link: result.link as string, loginLink: result.loginLink as string, emailSent: Boolean(result.email?.sent), ownerEmail: String(values.owner_email) };
    setReceipt(nextReceipt); onCreated(nextReceipt, result.invitation as OrganizationInvitation); setLoading(false);
  }
  if (receipt) return <div className="modal-backdrop elevated-modal"><div className="modal invite-receipt-modal"><div className="credential-success-icon"><CheckCircle2 size={32} /></div><span className="eyebrow">COMPANY & SUPER ADMIN READY</span><h2>{receipt.organization.name} is ready</h2><p>The private super-admin activation link and permanent company login link are ready to share.</p><div className="invite-link-box"><small>SUPER ADMIN ACTIVATION · ONE TIME</small><strong>{receipt.link}</strong></div><div className="invite-link-box client-login-link"><small>{receipt.organization.name.toUpperCase()} COMPANY LOGIN</small><strong>{receipt.loginLink}</strong></div><div className={`form-alert ${receipt.emailSent ? "success" : "warning"}`}>{receipt.emailSent ? "The invitation email was sent successfully." : "Email is not configured or delivery failed. Copy and send both links securely."}</div><div className="modal-actions"><button className="button button-ghost" onClick={async () => { await navigator.clipboard.writeText(`${receipt.organization.name}\nSuper-admin activation: ${receipt.link}\nCompany login: ${receipt.loginLink}\nSuper-admin email: ${receipt.ownerEmail}`); setCopied(true); }}><Copy size={16} /> {copied ? "Copied" : "Copy welcome message"}</button><button className="button button-primary" onClick={onClose}>Done</button></div></div></div>;
  return <div className="modal-backdrop"><div className="modal modal-wide company-provision-modal"><div className="modal-head"><div><span className="eyebrow">NEW COMPANY TENANT</span><h2>Create a company and its super admin</h2><p>Capture the company identity, subscription controls, and accountable administrator in one setup.</p></div><button className="icon-button bordered" onClick={onClose} aria-label="Close"><X size={20} /></button></div><form className="form-grid" onSubmit={submit}>
    <div className="company-setup-section field-span"><span>01</span><div><strong>Company identity</strong><small>Legal and operational details for the tenant record.</small></div></div>
    <label className="field"><span>Company display name</span><input name="name" minLength={2} maxLength={120} required onChange={(event) => deriveSlug(event.target.value)} placeholder="Acme Holdings" /></label>
    <label className="field"><span>Legal company name</span><input name="legal_name" minLength={2} maxLength={160} required placeholder="Acme Holdings (Pvt) Ltd" /></label>
    <label className="field"><span>Registration number</span><input name="registration_number" minLength={2} maxLength={80} required placeholder="PV 123456" /></label>
    <label className="field"><span>Industry</span><input name="industry" minLength={2} maxLength={100} required placeholder="Technology, retail, logistics…" /></label>
    <label className="field"><span>Company phone</span><input name="company_phone" minLength={7} maxLength={30} required autoComplete="tel" placeholder="+94 11 234 5678" /></label>
    <label className="field"><span>Billing email</span><input name="billing_email" type="email" required placeholder="accounts@company.com" /></label>
    <label className="field field-span"><span>Registered address</span><input name="address" minLength={4} maxLength={300} required autoComplete="street-address" placeholder="Street address" /></label>
    <label className="field"><span>City</span><input name="city" minLength={2} maxLength={100} required autoComplete="address-level2" placeholder="Colombo" /></label>
    <label className="field"><span>Country</span><input name="country" minLength={2} maxLength={100} defaultValue="Sri Lanka" required autoComplete="country-name" /></label>
    <label className="field"><span>Website <small>(optional)</small></span><input name="website" type="url" maxLength={240} placeholder="https://company.com" /></label>
    <label className="field"><span>Timezone</span><select name="timezone" defaultValue="Asia/Colombo" required><option value="Asia/Colombo">Asia/Colombo (Sri Lanka)</option><option value="Asia/Dubai">Asia/Dubai</option><option value="Asia/Singapore">Asia/Singapore</option><option value="Europe/London">Europe/London</option><option value="America/New_York">America/New York</option></select></label>
    <label className="field"><span>Workspace URL</span><div className="suffix-input"><input name="slug" value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} minLength={3} maxLength={50} required /><span>workspace</span></div></label>
    <label className="field"><span>Plan</span><select name="plan" defaultValue="growth"><option value="starter">Starter</option><option value="growth">Growth</option><option value="scale">Scale</option><option value="enterprise">Enterprise</option></select></label>
    <label className="field"><span>Maximum active users</span><input name="staff_limit" type="number" min="1" max="100000" defaultValue="1000" required /></label>
    <div className="company-setup-section field-span"><span>02</span><div><strong>Company super admin</strong><small>This person activates the company and manages its branches and employees.</small></div></div>
    <label className="field"><span>Full name</span><input name="owner_name" minLength={2} maxLength={100} required autoComplete="name" /></label>
    <label className="field"><span>Email address</span><input name="owner_email" type="email" required autoComplete="email" /></label>
    <label className="field"><span>Phone number</span><input name="owner_phone" minLength={7} maxLength={30} required autoComplete="tel" /></label>
    <label className="field"><span>Job title</span><input name="owner_job_title" minLength={2} maxLength={100} defaultValue="Company super admin" required /></label>
    <input type="hidden" name="expires_in_days" value="7" />
    {error && <div className="form-alert error field-span">{error}</div>}
    <div className="modal-actions field-span"><button type="button" className="button button-ghost" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={loading}>{loading ? <><LoaderCircle className="spin" size={17} /> Creating company…</> : "Create company & invite super admin"}</button></div>
  </form></div></div>;
}
