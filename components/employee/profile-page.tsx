"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, BellRing, Building2, CalendarDays, Check, ChevronRight, Clock3, Download, KeyRound, LogOut, Mail, MapPin, Phone, ShieldCheck, Smartphone, UserRound } from "lucide-react";
import { Brand } from "@/components/brand";
import { createClient } from "@/lib/supabase/client";
import type { PresenceInstallPrompt } from "@/components/pwa-register";
import type { AttendanceRecord, LeaveRequest, Profile } from "@/lib/types";

export function EmployeeProfilePage({ profile, attendance, leaves }: { profile: Profile; attendance: AttendanceRecord[]; leaves: LeaveRequest[] }) {
  const router = useRouter();
  const [installPrompt, setInstallPrompt] = useState<PresenceInstallPrompt | null>(null);
  const [platform, setPlatform] = useState<"android" | "ios" | "desktop">("desktop");
  const [standalone, setStandalone] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [installMessage, setInstallMessage] = useState("");

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
    if (!("Notification" in window)) return setNotificationPermission("unsupported");
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission === "granted") new Notification("Presence notifications enabled", { body: "Calendar changes will notify you while the app is running.", icon: "/icons/icon-192.svg" });
  }

  async function logout() {
    await createClient().auth.signOut();
    router.replace("/login");
  }

  return <main className="employee-shell ios-shell profile-page-shell">
    <header className="mobile-header ios-glass compact-app-header"><Link href="/app" className="header-back" aria-label="Back to attendance"><ArrowLeft size={19} /></Link><Brand /><span className="header-spacer" /></header>
    <div className="employee-content profile-content">
      <section className="profile-hero"><span className="avatar profile-avatar">{initials(profile.full_name)}</span><div><span className="eyebrow">YOUR PROFILE</span><h1>{profile.full_name}</h1><p>{profile.job_title || "Team member"} · {profile.branch?.name || "No branch assigned"}</p></div><span className={`profile-status ${profile.active ? "" : "inactive"}`}><Check size={14} /> {profile.active ? "Active" : "Disabled"}</span></section>

      <section className="profile-stat-grid"><article><Clock3 size={19} /><span><small>Total hours this year</small><strong>{formatMinutes(totals.workMinutes)}</strong></span></article><article><CalendarDays size={19} /><span><small>Annual leave remaining</small><strong>{Math.max(0, profile.annual_leave_days - totals.annualUsed)} days</strong></span></article></section>

      <div className="profile-layout">
        <section className="profile-panel"><div className="profile-panel-head"><span><UserRound size={19} /></span><div><h2>Personal details</h2><p>Your employee and contact information.</p></div></div><div className="profile-detail-list"><ProfileRow icon={<Mail />} label="Email" value={profile.email || "Not provided"} /><ProfileRow icon={<Phone />} label="Phone" value={profile.phone || "Not provided"} /><ProfileRow icon={<ShieldCheck />} label="Employee code" value={profile.employee_code || "Not assigned"} /><ProfileRow icon={<Building2 />} label="Branch" value={profile.branch?.name || "Not assigned"} /><ProfileRow icon={<Clock3 />} label="Work hours" value={`${profile.expected_arrival.slice(0, 5)} – ${profile.expected_departure.slice(0, 5)}`} /></div><Link className="profile-action-row" href="/auth/update-password"><KeyRound size={18} /><span><strong>Change password</strong><small>Keep your account secure</small></span><ChevronRight size={17} /></Link></section>

        <section className="profile-panel"><div className="profile-panel-head"><span><MapPin size={19} /></span><div><h2>Attendance rules</h2><p>Rules saved for your assigned branch.</p></div></div><div className="profile-rule-list"><div><MapPin size={18} /><span><small>Accepted office area</small><strong>Anywhere inside {profile.branch?.radius_m ?? 200} metres</strong></span></div><div><ShieldCheck size={18} /><span><small>Verification</small><strong>Current location only · no Wi-Fi or IP required</strong></span></div><div><Clock3 size={18} /><span><small>Timing tolerance</small><strong>{profile.branch?.late_grace_minutes ?? 0} min late · {profile.branch?.early_leave_grace_minutes ?? 0} min early</strong></span></div></div></section>
      </div>

      <section className="profile-panel install-panel"><div className="install-visual"><Smartphone size={31} /><span><Download size={16} /></span></div><div className="install-copy"><span className="eyebrow">INSTALL PRESENCE</span><h2>{standalone ? "Presence is installed" : platform === "android" ? "Add Presence to your Android phone" : "Keep Presence on your home screen"}</h2><p>{standalone ? "You are using the app-like PWA experience." : platform === "android" ? "Install once from Chrome for a full-screen app, faster access and a home-screen icon." : platform === "ios" ? "In Safari, tap Share and then Add to Home Screen." : "Use the install icon in your browser's address bar or menu."}</p>{installMessage && <small className="install-message">{installMessage}</small>}</div>{!standalone && <button className="button button-primary" onClick={installApp}><Download size={17} /> {platform === "android" ? "Install app" : "Installation guide"}</button>}</section>

      <section className="profile-panel notification-panel"><div className="profile-panel-head"><span><BellRing size={19} /></span><div><h2>Calendar notifications</h2><p>Get an alert when an administrator publishes or changes a calendar note.</p></div></div><div className="notification-setting"><div><strong>{notificationPermission === "granted" ? "Notifications are on" : notificationPermission === "denied" ? "Notifications are blocked" : notificationPermission === "unsupported" ? "Not supported by this browser" : "Notifications are off"}</strong><small>{notificationPermission === "denied" ? "Allow notifications in your browser or phone settings." : "Alerts work while Presence is open or installed and running."}</small></div>{notificationPermission !== "granted" && notificationPermission !== "unsupported" && <button className="button button-dark" onClick={enableNotifications}><BellRing size={16} /> Enable</button>}</div></section>

      <button className="profile-signout" onClick={logout}><LogOut size={18} /> Sign out</button>
    </div>

    <nav className="mobile-nav refined-mobile-nav" aria-label="Employee navigation"><Link href="/app#home"><Building2 size={20} /><span>Home</span></Link><Link href="/app#calendar"><CalendarDays size={20} /><span>Calendar</span></Link><Link className="nav-clock" href="/app#home" aria-label="Attendance"><MapPin size={22} /></Link><Link href="/app#leave"><CalendarDays size={20} /><span>Leave</span></Link><Link className="active" href="/profile"><UserRound size={20} /><span>Profile</span></Link></nav>
  </main>;
}

function ProfileRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div>{icon}<span><small>{label}</small><strong>{value}</strong></span></div>; }
function initials(name: string) { return name.split(" ").slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }
function formatMinutes(minutes: number) { return `${Math.floor(minutes / 60)}h ${minutes % 60}m`; }
