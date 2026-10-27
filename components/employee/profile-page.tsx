"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { ArrowLeft, Banknote, BellOff, BellRing, Building2, CalendarDays, Check, ChevronRight, Clock3, Download, KeyRound, LogOut, Mail, MapPin, Phone, Save, ShieldCheck, Smartphone, UserRound } from "lucide-react";
import { Brand } from "@/components/brand";
import { NotificationCenter } from "@/components/notifications/notification-center";
import { createClient } from "@/lib/supabase/client";
import { currentPushSubscription, disablePushNotifications, enablePushNotifications } from "@/lib/push-client";
import type { PresenceInstallPrompt } from "@/components/pwa-register";
import type { AttendanceRecord, LeaveRequest, NotificationPreferences, PayrollRecord, Profile, SalarySettings } from "@/lib/types";

export function EmployeeProfilePage({ profile, attendance, leaves, salarySettings, payrollRecords }: { profile: Profile; attendance: AttendanceRecord[]; leaves: LeaveRequest[]; salarySettings: SalarySettings | null; payrollRecords: PayrollRecord[] }) {
  const router = useRouter();
  const [installPrompt, setInstallPrompt] = useState<PresenceInstallPrompt | null>(null);
  const [platform, setPlatform] = useState<"android" | "ios" | "desktop">("desktop");
  const [standalone, setStandalone] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [installMessage, setInstallMessage] = useState("");
  const [notificationMessage, setNotificationMessage] = useState("");
  const [pushActive, setPushActive] = useState(false);
  const [pushConfigured, setPushConfigured] = useState(true);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [preferences, setPreferences] = useState<NotificationPreferences>({
    push_enabled: true,
    attendance_reminders: true,
    leave_updates: true,
    calendar_updates: true,
    reminder_minutes: 10,
  });
  const saturday = profile.work_schedule?.find((day) => day.weekday === 6);
  const sunday = profile.work_schedule?.find((day) => day.weekday === 7);
  const salaryHistory = payrollRecords.filter((record) => record.status === "finalized" || record.status === "paid").slice(0, 6).reverse();
  const maxNetSalary = Math.max(1, ...salaryHistory.map((record) => Number(record.net_pay)));

  useEffect(() => {
    const initialize = window.setTimeout(() => {
      const userAgent = navigator.userAgent;
      setPlatform(/Android/i.test(userAgent) ? "android" : /iPad|iPhone|iPod/i.test(userAgent) ? "ios" : "desktop");
      setStandalone(window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
      setInstallPrompt(window.__presenceInstallPrompt ?? null);
      if ("Notification" in window) setNotificationPermission(Notification.permission);
    }, 0);
    const ready = () => setInstallPrompt(window.__presenceInstallPrompt ?? null);
    window.addEventListener("presence:install-ready", ready);
    return () => { window.clearTimeout(initialize); window.removeEventListener("presence:install-ready", ready); };
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/notifications", { cache: "no-store" }).then((response) => response.json()),
      currentPushSubscription().catch(() => null),
    ]).then(([result, subscription]) => {
      if (!active) return;
      if (result.preferences) setPreferences(result.preferences as NotificationPreferences);
      setPushConfigured(result.pushConfigured !== false);
      setPushActive(Boolean(subscription));
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const totals = useMemo(() => {
    const workMinutes = attendance.reduce((sum, row) => sum + (row.work_minutes ?? 0), 0);
    const annualUsed = leaves.filter((leave) => leave.status === "approved" && leave.leave_type === "annual").reduce((sum, leave) => sum + Number(leave.requested_days), 0);
    return { workMinutes, annualUsed };
  }, [attendance, leaves]);

  async function installApp() {
    const prompt = installPrompt ?? window.__presenceInstallPrompt;
    if (!prompt) { setInstallMessage(platform === "android" ? "Open Chrome's menu and choose Install app or Add to Home screen." : "Use your browser's Add to Home Screen option."); return; }
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === "accepted") { setStandalone(true); setInstallMessage("Presence is installing on this device."); }
    else setInstallMessage("Installation was cancelled. You can try again at any time.");
    window.__presenceInstallPrompt = undefined;
    setInstallPrompt(null);
  }

  async function enableNotifications() {
    setNotificationMessage("");
    try {
      await enablePushNotifications();
      setNotificationPermission(Notification.permission);
      setPushActive(true);
      setPreferences((current) => ({ ...current, push_enabled: true }));
      await fetch("/api/notifications/test", { method: "POST" });
      setNotificationMessage("This device is ready for attendance, leave and calendar notifications.");
    } catch (reason) {
      setNotificationPermission("Notification" in window ? Notification.permission : "unsupported");
      setNotificationMessage(reason instanceof Error ? reason.message : "Notifications could not be enabled.");
    }
  }

  async function disableNotifications() {
    setNotificationMessage("");
    await disablePushNotifications().catch(() => undefined);
    setPushActive(false);
    const next = { ...preferences, push_enabled: false };
    setPreferences(next);
    await savePreferences(next);
    setNotificationMessage("Push notifications are off for this device.");
  }

  async function savePreferences(next = preferences) {
    setSavingPreferences(true);
    setNotificationMessage("");
    try {
      const response = await fetch("/api/notifications/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Notification preferences could not be saved.");
      setPreferences(result.preferences as NotificationPreferences);
      setNotificationMessage("Notification preferences saved.");
    } catch (reason) {
      setNotificationMessage(reason instanceof Error ? reason.message : "Notification preferences could not be saved.");
    } finally {
      setSavingPreferences(false);
    }
  }

  async function logout() {
    await createClient().auth.signOut();
    router.replace("/login");
  }

  return <main className="employee-shell ios-shell profile-page-shell">
    <header className="mobile-header ios-glass compact-app-header"><Link href="/app" className="header-back" aria-label="Back to attendance"><ArrowLeft size={19} /></Link><Brand /><NotificationCenter compact /></header>
    <div className="employee-content profile-content">
      <section className="profile-hero"><span className="avatar profile-avatar">{initials(profile.full_name)}</span><div><span className="eyebrow">YOUR PROFILE</span><h1>{profile.full_name}</h1><p>{profile.job_title || "Team member"} · {profile.branch?.name || "No branch assigned"}</p></div><span className={`profile-status ${profile.active ? "" : "inactive"}`}><Check size={14} /> {profile.active ? "Active" : "Disabled"}</span></section>

      <section className="profile-stat-grid"><article><Clock3 size={19} /><span><small>Total hours this year</small><strong>{formatMinutes(totals.workMinutes)}</strong></span></article><article><CalendarDays size={19} /><span><small>Annual leave remaining</small><strong>{Math.max(0, profile.annual_leave_days - totals.annualUsed)} days</strong></span></article></section>

      <div className="profile-layout">
        <section className="profile-panel"><div className="profile-panel-head"><span><UserRound size={19} /></span><div><h2>Personal details</h2><p>Your employee and contact information.</p></div></div><div className="profile-detail-list"><ProfileRow icon={<Mail />} label="Email" value={profile.email || "Not provided"} /><ProfileRow icon={<Phone />} label="Phone" value={profile.phone || "Not provided"} /><ProfileRow icon={<ShieldCheck />} label="Employee code" value={profile.employee_code || "Not assigned"} /><ProfileRow icon={<Building2 />} label="Branch" value={profile.branch?.name || "Not assigned"} /><ProfileRow icon={<Clock3 />} label="Work hours" value={`${profile.expected_arrival.slice(0, 5)} – ${profile.expected_departure.slice(0, 5)}`} /></div><Link className="profile-action-row" href="/auth/update-password"><KeyRound size={18} /><span><strong>Change password</strong><small>Keep your account secure</small></span><ChevronRight size={17} /></Link></section>

        <section className="profile-panel"><div className="profile-panel-head"><span><MapPin size={19} /></span><div><h2>Attendance rules</h2><p>Rules saved for your assigned branch.</p></div></div><div className="profile-rule-list"><div><MapPin size={18} /><span><small>Accepted office area</small><strong>Anywhere inside {profile.branch?.radius_m ?? 200} metres</strong></span></div><div><ShieldCheck size={18} /><span><small>Verification</small><strong>Current location only · no Wi-Fi or IP required</strong></span></div><div><Clock3 size={18} /><span><small>Saturday</small><strong>{scheduleLabel(saturday?.day_type ?? "half_day", saturday?.arrival_time, saturday?.departure_time)}</strong></span></div><div><CalendarDays size={18} /><span><small>Sunday</small><strong>{scheduleLabel(sunday?.day_type ?? "off", sunday?.arrival_time, sunday?.departure_time)}</strong></span></div><div><Clock3 size={18} /><span><small>Timing tolerance</small><strong>{profile.branch?.late_grace_minutes ?? 0} min late · {profile.branch?.early_leave_grace_minutes ?? 0} min early</strong></span></div></div></section>
      </div>

      <section className="profile-panel salary-profile-panel" id="salary"><div className="profile-panel-head"><span><Banknote size={19} /></span><div><h2>Salary & attendance statements</h2><p>Finalized figures shared by your payroll administrator.</p></div></div><div className="salary-profile-summary"><div><small>Basic salary</small><strong>{salarySettings ? formatMoney(salarySettings.basic_salary) : "Not configured"}</strong></div><div><small>Fixed allowances</small><strong>{salarySettings ? formatMoney(salarySettings.fixed_allowances) : "—"}</strong></div><div><small>Pay cycle</small><strong>{salarySettings?.pay_cycle === "calendar_month" ? "Calendar month" : salarySettings?.pay_cycle === "fifteenth_cycle" ? "15th–14th" : "Company cycle"}</strong></div><div><small>Latest net salary</small><strong>{salaryHistory.length ? formatMoney(salaryHistory.at(-1)!.net_pay) : "No statement"}</strong></div></div>{salaryHistory.length ? <div className="salary-chart"><div className="salary-chart-head"><strong>Net salary history</strong><small>Tap a bar’s label to see the pay period</small></div><div className="salary-chart-bars">{salaryHistory.map((record) => <div key={record.id} title={`${record.period_start} to ${record.period_end}: ${formatMoney(record.net_pay)}`}><span className={record.status} style={{ height: `${Math.max(12, Number(record.net_pay) / maxNetSalary * 100)}%` }} /><small>{format(parseISO(record.period_end), "MMM")}</small><strong>{compactMoney(record.net_pay)}</strong></div>)}</div><div className="salary-latest-detail"><Banknote size={17} /><span><small>{salaryHistory.at(-1)!.period_start} to {salaryHistory.at(-1)!.period_end}</small><strong>{salaryHistory.at(-1)!.attendance_days} attendance days · {salaryHistory.at(-1)!.short_leave_count} short leaves · {salaryHistory.at(-1)!.absent_days} absent units</strong></span><em className={`salary-record-status ${salaryHistory.at(-1)!.status}`}>{salaryHistory.at(-1)!.status}</em></div></div> : <div className="salary-empty"><Banknote size={22} /><strong>No finalized salary statement yet</strong><small>Your chart appears after payroll finalizes the first cycle.</small></div>}</section>

      <section className="profile-panel install-panel"><div className="install-visual"><Smartphone size={31} /><span><Download size={16} /></span></div><div className="install-copy"><span className="eyebrow">INSTALL PRESENCE</span><h2>{standalone ? "Presence is installed" : platform === "android" ? "Add Presence to your Android phone" : "Keep Presence on your home screen"}</h2><p>{standalone ? "You are using the app-like PWA experience." : platform === "android" ? "Install once from Chrome for a full-screen app, faster access and a home-screen icon." : platform === "ios" ? "In Safari, tap Share and then Add to Home Screen." : "Use the install icon in your browser's address bar or menu."}</p>{installMessage && <small className="install-message">{installMessage}</small>}</div>{!standalone && <button className="button button-primary" onClick={installApp}><Download size={17} /> {platform === "android" ? "Install app" : "Installation guide"}</button>}</section>

      <section className="profile-panel notification-panel"><div className="profile-panel-head"><span><BellRing size={19} /></span><div><h2>Smart notifications</h2><p>Receive attendance reminders, leave decisions and calendar updates even when Presence is closed.</p></div></div>
        <div className="notification-setting"><div><strong>{pushActive ? "Push notifications are on" : notificationPermission === "denied" ? "Notifications are blocked" : notificationPermission === "unsupported" ? "Not supported by this browser" : "Push notifications are off"}</strong><small>{!pushConfigured ? "Add VAPID keys to the deployment settings to activate push delivery." : notificationPermission === "denied" ? "Allow notifications in your browser or phone settings." : pushActive ? "This device is registered for background alerts." : "Enable once to register this phone or computer."}</small></div>{pushActive ? <button className="button button-ghost" onClick={disableNotifications}><BellOff size={16} /> Turn off</button> : notificationPermission !== "unsupported" && <button className="button button-dark" onClick={enableNotifications} disabled={!pushConfigured}><BellRing size={16} /> Enable</button>}</div>
        <div className="notification-preferences">
          <label><input type="checkbox" checked={preferences.attendance_reminders} onChange={(event) => setPreferences((current) => ({ ...current, attendance_reminders: event.target.checked }))} /><span><strong>Start and finish reminders</strong><small>Alert before your scheduled arrival and departure.</small></span></label>
          <label><input type="checkbox" checked={preferences.leave_updates} onChange={(event) => setPreferences((current) => ({ ...current, leave_updates: event.target.checked }))} /><span><strong>Leave decisions</strong><small>Show approvals, rejections and admin notes clearly.</small></span></label>
          <label><input type="checkbox" checked={preferences.calendar_updates} onChange={(event) => setPreferences((current) => ({ ...current, calendar_updates: event.target.checked }))} /><span><strong>Team calendar changes</strong><small>Notify when office notes are added or removed.</small></span></label>
          <label className="notification-reminder-time"><span><strong>Reminder timing</strong><small>How early to alert you.</small></span><select value={preferences.reminder_minutes} onChange={(event) => setPreferences((current) => ({ ...current, reminder_minutes: Number(event.target.value) }))}><option value={0}>At scheduled time</option><option value={5}>5 minutes before</option><option value={10}>10 minutes before</option><option value={15}>15 minutes before</option><option value={30}>30 minutes before</option></select></label>
        </div>
        <div className="notification-save-row">{notificationMessage && <small>{notificationMessage}</small>}<button className="button button-primary" onClick={() => void savePreferences()} disabled={savingPreferences}><Save size={16} /> {savingPreferences ? "Saving..." : "Save preferences"}</button></div>
      </section>

      <button className="profile-signout" onClick={logout}><LogOut size={18} /> Sign out</button>
    </div>

    <nav className="mobile-nav refined-mobile-nav" aria-label="Employee navigation"><Link href="/app#home"><Building2 size={20} /><span>Home</span></Link><Link href="/app#calendar"><CalendarDays size={20} /><span>Calendar</span></Link><Link className="nav-clock" href="/app#home" aria-label="Attendance"><MapPin size={22} /></Link><Link href="/app#leave"><CalendarDays size={20} /><span>Leave</span></Link><Link className="active" href="/profile"><UserRound size={20} /><span>Profile</span></Link></nav>
  </main>;
}

function ProfileRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div>{icon}<span><small>{label}</small><strong>{value}</strong></span></div>; }
function initials(name: string) { return name.split(" ").slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }
function formatMinutes(minutes: number) { return `${Math.floor(minutes / 60)}h ${minutes % 60}m`; }
function formatMoney(value: number) { return `LKR ${Number(value || 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function compactMoney(value: number) { return new Intl.NumberFormat("en-LK", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value || 0)); }
function scheduleLabel(type: "full_day" | "half_day" | "off", arrival?: string, departure?: string) {
  if (type === "off") return "Weekly off day";
  return `${type === "half_day" ? "Half day" : "Full day"} · ${(arrival || "09:00").slice(0, 5)}–${(departure || (type === "half_day" ? "14:00" : "17:00")).slice(0, 5)}`;
}
