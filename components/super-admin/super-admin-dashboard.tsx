"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, Building2, CalendarCheck, CheckCircle2, Clock3, Copy, LoaderCircle, LogOut, MonitorSmartphone, Plus, RotateCcw, Search, ShieldCheck, Users, X } from "lucide-react";
import { Brand } from "@/components/brand";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { HotlineManager } from "@/components/super-admin/hotline-manager";
import { createClient } from "@/lib/supabase/client";
import type { Organization, OrganizationInvitation, PlatformHotline, Profile, StaffDeviceDirectoryRow } from "@/lib/types";

type CreationReceipt = { organization: Organization; link: string; loginLink: string; emailSent: boolean; ownerEmail: string };
export type PlatformDailyRow = { organization_id: string; organization_name: string; active_members: number; present_today: number; late_today: number; open_shifts: number; pending_leave: number };
export type PlatformLateAttendance = {
  id: string;
  clock_in: string | null;
  late_minutes: number;
  profile: { id: string; full_name: string; employee_code: string | null; avatar_path?: string | null; organization_id: string; organization?: { name: string; slug: string } | Array<{ name: string; slug: string }> | null } | null;
  branch: { name: string; code: string } | null;
};

export function SuperAdminDashboard({ admin, today, initialOrganizations, initialInvitations, dailyByOrganization, lateAttendance, initialHotlines, initialDeviceDirectory }: { admin: Profile; today: string; initialOrganizations: Organization[]; initialInvitations: OrganizationInvitation[]; dailyByOrganization: PlatformDailyRow[]; lateAttendance: PlatformLateAttendance[]; initialHotlines: PlatformHotline[]; initialDeviceDirectory: StaffDeviceDirectoryRow[] }) {
  const router = useRouter();
  const [organizations, setOrganizations] = useState(initialOrganizations);
  const [invitations, setInvitations] = useState(initialInvitations);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [deviceDirectory, setDeviceDirectory] = useState(initialDeviceDirectory);
  const [deviceQuery, setDeviceQuery] = useState("");
  const [resettingDevice, setResettingDevice] = useState<StaffDeviceDirectoryRow | null>(null);
  const filtered = useMemo(() => organizations.filter((item) => `${item.name} ${item.slug} ${item.billing_email}`.toLowerCase().includes(query.toLowerCase())), [organizations, query]);
  const filteredDevices = useMemo(() => deviceDirectory.filter((item) => `${item.full_name} ${item.email || ""} ${item.employee_code || ""} ${item.organization_name || ""} ${item.branch_name || ""}`.toLowerCase().includes(deviceQuery.toLowerCase())), [deviceDirectory, deviceQuery]);
  const totalMembers = organizations.reduce((sum, item) => sum + (item.member_count ?? 0), 0);
  const pendingOwners = invitations.filter((item) => item.status === "pending" && new Date(item.expires_at) > new Date()).length;
  const presentToday = dailyByOrganization.reduce((sum, item) => sum + item.present_today, 0);
  const lateToday = dailyByOrganization.reduce((sum, item) => sum + item.late_today, 0);
  const pendingLeave = dailyByOrganization.reduce((sum, item) => sum + item.pending_leave, 0);
  const openShifts = dailyByOrganization.reduce((sum, item) => sum + item.open_shifts, 0);

  async function logout() { await createClient().auth.signOut(); router.replace("/super-admin/login"); }
  async function toggleStatus(organization: Organization) {
    const status = organization.status === "active" ? "suspended" : "active";
    const response = await fetch("/api/super-admin/organizations", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: organization.id, status }) });
    const result = await response.json().catch(() => ({}));
    if (response.ok) setOrganizations((current) => current.map((item) => item.id === organization.id ? { ...item, ...result.organization } : item));
  }

  return <main className="platform-shell">
    <header className="platform-header"><Brand /><div className="platform-header-actions"><div><strong>{admin.full_name}</strong><small>Platform super admin</small></div><button className="icon-button bordered" onClick={logout} aria-label="Sign out"><LogOut size={18} /></button></div></header>
    <section className="platform-content">
      <div className="platform-hero"><div><span className="eyebrow">{new Intl.DateTimeFormat("en-LK", { dateStyle: "full", timeZone: "Asia/Colombo" }).format(new Date(`${today}T12:00:00+05:30`))}</span><h1>Platform command center</h1><p>Live attendance, leave pressure, tenant health and company provisioning in one operational view.</p></div><button className="button button-primary" onClick={() => setCreating(true)}><Plus size={18} /> Add company</button></div>
      <div className="platform-kpi-grid"><PlatformKpi icon={<Building2 />} label="Active companies" value={organizations.filter((item) => item.status === "active").length} detail={`${organizations.length} total workspaces`} tone="green" /><PlatformKpi icon={<Users />} label="Active users" value={totalMembers} detail="Across every tenant" tone="navy" /><PlatformKpi icon={<Activity />} label="Present today" value={presentToday} detail={`${openShifts} currently clocked in`} tone="blue" /><PlatformKpi icon={<Clock3 />} label="Late today" value={lateToday} detail={lateToday ? "Review exceptions below" : "No late arrivals"} tone="amber" /><PlatformKpi icon={<CalendarCheck />} label="Pending leave" value={pendingLeave} detail="Awaiting company review" tone="violet" /><PlatformKpi icon={<ShieldCheck />} label="Owner setup" value={pendingOwners} detail="Pending invitations" tone="slate" /></div>
      <div className="platform-ops-grid">
        <section className="panel platform-ops-panel"><div className="platform-section-head"><div><span className="eyebrow">TODAY · LIVE</span><h2>Late attendance</h2><p>Largest delays across all companies, server-verified from branch attendance.</p></div><span className="status-badge late">{lateToday} late</span></div><div className="platform-late-list">{lateAttendance.length ? lateAttendance.map((row) => { const organization = Array.isArray(row.profile?.organization) ? row.profile?.organization[0] : row.profile?.organization; return <article key={row.id}>{row.profile ? <ProfileAvatar id={row.profile.id} name={row.profile.full_name} avatarPath={row.profile.avatar_path} className="avatar-sm" /> : <span className="avatar avatar-sm">?</span>}<div><strong>{row.profile?.full_name || "Staff member"}</strong><small>{organization?.name || "Company"} · {row.branch?.name || "Branch"}</small></div><time>{row.clock_in ? new Intl.DateTimeFormat("en-LK", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Colombo" }).format(new Date(row.clock_in)) : "—"}</time><b>{row.late_minutes}m late</b></article>; }) : <div className="platform-empty"><CheckCircle2 size={24} /><strong>Everyone is on time</strong><small>No late attendance has been recorded today.</small></div>}</div></section>
        <section className="panel platform-ops-panel"><div className="platform-section-head"><div><span className="eyebrow">COMPANY PULSE</span><h2>Today by workspace</h2><p>Use this summary to spot operational pressure immediately.</p></div></div><div className="platform-pulse-list">{dailyByOrganization.map((row) => <article key={row.organization_id}><div><strong>{row.organization_name}</strong><small>{row.active_members} active users</small></div><span><b>{row.present_today}</b><small>present</small></span><span className={row.late_today ? "warning" : ""}><b>{row.late_today}</b><small>late</small></span><span className={row.pending_leave ? "warning" : ""}><b>{row.pending_leave}</b><small>leave</small></span></article>)}</div></section>
      </div>
      <section className="panel platform-table-panel"><div className="platform-table-head"><div><h2>Company directory</h2><p>Capacity includes owners, managers, and staff.</p></div><label className="admin-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search companies…" /></label></div>
        <div className="company-table"><div className="company-row company-row-head"><span>Company</span><span>Owner</span><span>Usage</span><span>Branches</span><span>Status</span><span>Action</span></div>{filtered.map((organization) => { const invitation = invitations.find((item) => item.organization_id === organization.id && item.status === "pending"); return <div className="company-row" key={organization.id}><span><strong>{organization.name}</strong><small>/{organization.slug} · {organization.plan}</small></span><span className="platform-owner-cell">{organization.owner && <ProfileAvatar id={organization.owner.id} name={organization.owner.full_name} avatarPath={organization.owner.avatar_path} className="avatar-sm" />}<span><strong>{organization.owner?.full_name || invitation?.full_name || "Awaiting owner"}</strong><small>{organization.owner?.email || invitation?.invited_email || organization.billing_email}</small></span></span><span><strong>{organization.member_count ?? 0} / {organization.staff_limit}</strong><small>{Math.round(((organization.member_count ?? 0) / organization.staff_limit) * 100)}% used</small></span><span><strong>{organization.branch_count ?? 0}</strong><small>active branches</small></span><span><i className={`account-dot ${organization.status === "active" ? "" : "inactive"}`} />{organization.status}</span><span><button className="button button-ghost button-sm" onClick={() => void toggleStatus(organization)}>{organization.status === "active" ? "Suspend" : "Reactivate"}</button></span></div>; })}</div>
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
    {creating && <CreateCompanyModal onClose={() => setCreating(false)} onCreated={(receipt, invitation) => { setOrganizations((current) => [{ ...receipt.organization, member_count: 0, branch_count: 0, owner: null }, ...current]); setInvitations((current) => [invitation, ...current]); }} />}
    {resettingDevice && <ResetStaffDeviceModal employee={resettingDevice} onClose={() => setResettingDevice(null)} onReset={(expiresAt) => setDeviceDirectory((current) => current.map((item) => item.user_id === resettingDevice.user_id ? { ...item, device_id: null, device_label: null, registered_at: null, last_seen_at: null, enrollment_expires_at: expiresAt } : item))} />}
  </main>;
}

function PlatformKpi({ icon, label, value, detail, tone }: { icon: React.ReactNode; label: string; value: number; detail: string; tone: string }) {
  return <article className={`platform-kpi ${tone}`}><span>{icon}</span><div><small>{label}</small><strong>{value.toLocaleString()}</strong><p>{detail}</p></div></article>;
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
  if (receipt) return <div className="modal-backdrop elevated-modal"><div className="modal invite-receipt-modal"><div className="credential-success-icon"><CheckCircle2 size={32} /></div><span className="eyebrow">WORKSPACE READY</span><h2>{receipt.organization.name} is ready</h2><p>The private owner activation link and permanent client portal link are separate, but hosted in the same app.</p><div className="invite-link-box"><small>OWNER ACTIVATION · ONE TIME</small><strong>{receipt.link}</strong></div><div className="invite-link-box client-login-link"><small>{receipt.organization.name.toUpperCase()} CLIENT LOGIN</small><strong>{receipt.loginLink}</strong></div><div className={`form-alert ${receipt.emailSent ? "success" : "warning"}`}>{receipt.emailSent ? "The invitation email was sent successfully." : "Email is not configured or delivery failed. Copy and send both links securely."}</div><div className="modal-actions"><button className="button button-ghost" onClick={async () => { await navigator.clipboard.writeText(`${receipt.organization.name}\nOwner activation: ${receipt.link}\nCompany login: ${receipt.loginLink}\nOwner email: ${receipt.ownerEmail}`); setCopied(true); }}><Copy size={16} /> {copied ? "Copied" : "Copy welcome message"}</button><button className="button button-primary" onClick={onClose}>Done</button></div></div></div>;
  return <div className="modal-backdrop"><div className="modal modal-wide"><div className="modal-head"><div><span className="eyebrow">NEW TENANT</span><h2>Create a company workspace</h2><p>The owner receives a private registration link. Their company data remains isolated.</p></div><button className="icon-button bordered" onClick={onClose}><X size={20} /></button></div><form className="form-grid" onSubmit={submit}><label className="field"><span>Company name</span><input name="name" minLength={2} maxLength={120} required onChange={(event) => deriveSlug(event.target.value)} placeholder="Acme Holdings" /></label><label className="field"><span>Workspace URL</span><div className="suffix-input"><input name="slug" value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} minLength={3} maxLength={50} required /><span>workspace</span></div></label><label className="field"><span>Billing email</span><input name="billing_email" type="email" required placeholder="accounts@company.com" /></label><label className="field"><span>Plan</span><select name="plan" defaultValue="growth"><option value="starter">Starter</option><option value="growth">Growth</option><option value="scale">Scale</option><option value="enterprise">Enterprise</option></select></label><label className="field"><span>Maximum active users</span><input name="staff_limit" type="number" min="1" max="100000" defaultValue="1000" required /></label><label className="field"><span>Owner full name</span><input name="owner_name" minLength={2} maxLength={100} required /></label><label className="field"><span>Owner email</span><input name="owner_email" type="email" required /></label><label className="field"><span>Owner phone</span><input name="owner_phone" minLength={7} maxLength={30} required /></label><input type="hidden" name="expires_in_days" value="7" />{error && <div className="form-alert error field-span">{error}</div>}<div className="modal-actions field-span"><button type="button" className="button button-ghost" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={loading}>{loading ? <><LoaderCircle className="spin" size={17} /> Creating…</> : "Create & invite owner"}</button></div></form></div></div>;
}
