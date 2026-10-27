"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  Check,
  Clock3,
  ChevronRight,
  CircleAlert,
  History,
  Home,
  LoaderCircle,
  LifeBuoy,
  MapPin,
  MessageSquareWarning,
  Palmtree,
  Plus,
  RefreshCw,
  Sparkles,
  ShieldCheck,
  Timer,
  UserRound,
  X,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { OfficeMap, type StaffMapLocation } from "@/components/employee/office-map";
import { WorkCalendar } from "@/components/calendar/work-calendar";
import { NotificationCenter } from "@/components/notifications/notification-center";
import { FirstVisitInstall } from "@/components/pwa/first-visit-install";
import { captureBestBrowserLocation } from "@/lib/browser-location";
import { createClient } from "@/lib/supabase/client";
import { approvedHolidayForDate, approvedLeaveForDate, scheduleForDate } from "@/lib/workday";
import type { AttendanceRecord, CalendarNote, CompanyHoliday, LeaveRequest, MissedAttendance, Profile, WorkScheduleDay } from "@/lib/types";

type MarkState = "idle" | "locating" | "verifying" | "success" | "error";
type AttendanceAction = "clock_in" | "clock_out";
type AttendanceSuccessReceipt = {
  action: AttendanceAction;
  record: AttendanceRecord;
};
type AttendanceChallenge = {
  challenge_id: string;
  expires_at: string;
  minimum_sample_span_ms?: number;
  maximum_accuracy_m?: number;
  minimum_samples?: number;
};
type VerificationChecks = {
  gps?: boolean;
  distanceM?: number | null;
  accuracyM?: number | null;
  maxAccuracyM?: number;
  gpsMethod?: "precise" | "standard" | "none";
  spreadM?: number;
  verificationMethod?: "location" | "none";
};

export function EmployeeDashboard({
  profile,
  initialNow,
  today,
  todayLabel,
  initialTodayRecord,
  attendance: initialAttendance,
  leaves: initialLeaves,
  calendarNotes,
  holidays,
  workSchedule,
  missedAttendance: initialMissedAttendance,
}: {
  profile: Profile;
  initialNow: string;
  today: string;
  todayLabel: string;
  initialTodayRecord: AttendanceRecord | null;
  attendance: AttendanceRecord[];
  leaves: LeaveRequest[];
  calendarNotes: CalendarNote[];
  holidays: CompanyHoliday[];
  workSchedule: WorkScheduleDay[];
  missedAttendance: MissedAttendance[];
}) {
  const router = useRouter();
  const [todayRecord, setTodayRecord] = useState(initialTodayRecord);
  const [attendance, setAttendance] = useState(initialAttendance);
  const [leaves, setLeaves] = useState(initialLeaves);
  const [markState, setMarkState] = useState<MarkState>("idle");
  const [feedback, setFeedback] = useState("");
  const [checks, setChecks] = useState<VerificationChecks>({});
  const [now, setNow] = useState(() => new Date(initialNow));
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [staffLocation, setStaffLocation] = useState<StaffMapLocation | null>(null);
  const [mapLocating, setMapLocating] = useState(false);
  const [pendingAction, setPendingAction] = useState<AttendanceAction | null>(null);
  const [successReceipt, setSuccessReceipt] = useState<AttendanceSuccessReceipt | null>(null);
  const [missedAttendance, setMissedAttendance] = useState(initialMissedAttendance);
  const [issueOpen, setIssueOpen] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const checkDateRollover = () => {
      const currentDate = branchLocalDate(new Date(), profile.branch?.timezone || "Asia/Colombo");
      if (currentDate === today) return;
      const refreshKey = "presence:last-date-rollover-refresh";
      if (window.sessionStorage.getItem(refreshKey) === currentDate) return;
      window.sessionStorage.setItem(refreshKey, currentDate);
      router.refresh();
    };
    checkDateRollover();
    const timer = window.setInterval(checkDateRollover, 60_000);
    return () => window.clearInterval(timer);
  }, [profile.branch?.timezone, router, today]);

  const usedAnnual = useMemo(
    () => leaves.filter((l) => l.status === "approved" && l.leave_type === "annual").reduce((sum, l) => sum + Number(l.requested_days), 0),
    [leaves],
  );
  const currentMonth = today.slice(0, 7);
  const usedMonthly = useMemo(
    () => leaves.filter((l) => l.status === "approved" && l.leave_type === "monthly" && l.start_date.startsWith(currentMonth)).reduce((sum, l) => sum + Number(l.requested_days), 0),
    [leaves, currentMonth],
  );
  const todaySchedule = scheduleForDate(workSchedule, today, { userId: profile.id, arrival: profile.expected_arrival, departure: profile.expected_departure });
  const monthAttendance = attendance.filter((record) => record.attendance_date.startsWith(currentMonth)).length;
  const remainingAnnual = Math.max(0, profile.annual_leave_days - usedAnnual);
  const todayHoliday = approvedHolidayForDate(holidays, today, profile.branch_id);
  const todayLeave = approvedLeaveForDate(leaves, today);
  const closedReason = todayHoliday?.name
    ?? (todayLeave?.portion === "full_day" ? "Approved full-day leave" : todaySchedule.day_type === "off" ? "Scheduled off day" : null);
  const nextAction = !todayRecord?.clock_in ? (closedReason ? null : "clock_in") : !todayRecord.clock_out ? "clock_out" : null;
  const firstName = profile.full_name.split(" ")[0];
  const locationProblem = markState === "error" && (checks.gps === false || /location|office|radius|accuracy/i.test(feedback));

  function requestAttendanceConfirmation() {
    if (!nextAction || mapLocating || markState === "locating" || markState === "verifying") return;
    setPendingAction(nextAction);
  }

  function closeAttendanceError() {
    setMarkState("idle");
    setFeedback("");
    setChecks({});
  }

  function retryAttendance() {
    closeAttendanceError();
    if (nextAction) setPendingAction(nextAction);
  }

  async function markAttendance(action: AttendanceAction) {
    setPendingAction(null);
    if (action !== nextAction || markState === "locating" || markState === "verifying") return;
    if (!navigator.onLine) {
      setMarkState("error");
      setFeedback("You are offline. Attendance needs a live secure connection.");
      return;
    }
    if (!navigator.geolocation) {
      setMarkState("error");
      setFeedback("This device does not support location services.");
      return;
    }
    setMarkState("verifying");
    setFeedback("Opening a secure attendance check...");
    setChecks({});
    try {
      const challengeResponse = await attendancePost("/api/attendance/challenge", { action });
      const challengeResult = await challengeResponse.json().catch(() => ({}));
      if (!challengeResponse.ok) {
        if (challengeResponse.status === 401) {
          await createClient().auth.signOut();
          router.replace("/login?error=session_expired");
        }
        throw new Error(challengeResult.error || "A secure attendance check could not be started.");
      }
      const challenge = challengeResult as AttendanceChallenge;
      if (!challenge.challenge_id) throw new Error("The attendance challenge was invalid. Please try again.");

      setMarkState("locating");
      setFeedback("Getting your current location...");
      const normalAccuracyM = profile.branch?.max_accuracy_m ?? 80;
      const location = await captureBestBrowserLocation({
        maximumAccuracyM: challenge.maximum_accuracy_m ?? Math.max(200, normalAccuracyM),
        minimumConsensusSamples: challenge.minimum_samples ?? 3,
        minimumSampleSpanMs: challenge.minimum_sample_span_ms ?? 2_000,
        minimumWaitMs: 2_500,
        maximumWaitMs: 15_000,
        onProgress: ({ bestAccuracyM }) => {
          setFeedback(`Location found with +/-${Math.round(bestAccuracyM)} m accuracy...`);
        },
      });
      setStaffLocation({ latitude: location.latitude, longitude: location.longitude, accuracy: location.accuracy, capturedAt: location.capturedAt });
      setMarkState("verifying");
      setFeedback("Checking that you are inside the office radius...");
      const payload = {
        action,
        challengeId: challenge.challenge_id,
        clientRequestId: crypto.randomUUID(),
        captureStartedAt: location.captureStartedAt,
        captureEndedAt: location.captureEndedAt,
        samples: location.samples,
      };
      const response = await attendancePost("/api/attendance/mark", payload);
      const result = await response.json().catch(() => ({}));
      setChecks(result.checks ?? {});
      if (!response.ok) {
        if (response.status === 401) {
          await createClient().auth.signOut();
          router.replace("/login?error=session_expired");
          throw new Error("Please sign in again to continue securely.");
        }
        throw new Error(result.error || "Attendance could not be verified.");
      }
      const record = result.record as AttendanceRecord;
      setTodayRecord(record);
      setAttendance((current) => [record, ...current.filter((item) => item.attendance_date !== record.attendance_date)]);
      setMarkState("success");
      setFeedback(result.message);
      setSuccessReceipt({ action, record });
    } catch (error) {
      setMarkState("error");
      setFeedback(error instanceof Error ? error.message : "Attendance could not be marked.");
    }
  }

  async function attendancePost(path: string, body: Record<string, unknown>) {
    const send = () => fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    let response = await send();
    if (response.status === 401) {
      const { error } = await createClient().auth.refreshSession();
      if (!error) response = await send();
    }
    return response;
  }

  async function locateOnMap() {
    if (markState === "locating" || markState === "verifying" || mapLocating) return;
    if (!navigator.geolocation) {
      setMarkState("error");
      setFeedback("This device does not support location services.");
      return;
    }
    setMapLocating(true);
    setFeedback("");
    try {
      const location = await captureBestBrowserLocation({
        maximumAccuracyM: Math.max(200, profile.branch?.max_accuracy_m ?? 80),
        minimumWaitMs: 500,
        maximumWaitMs: 10_000,
      });
      setStaffLocation({ latitude: location.latitude, longitude: location.longitude, accuracy: location.accuracy, capturedAt: location.capturedAt });
    } catch (error) {
      setMarkState("error");
      setFeedback(error instanceof Error ? error.message : "Your current location could not be found.");
    } finally {
      setMapLocating(false);
    }
  }

  async function acknowledgeMissedAttendance(id: string) {
    const response = await fetch("/api/attendance/missed", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    if (response.ok) setMissedAttendance((current) => current.filter((item) => item.id !== id));
  }

  return (
    <main className="employee-shell ios-shell">
      <header className="mobile-header ios-glass">
        <div className="staff-header-person"><Link className="avatar-button" href="/profile" aria-label="Open profile page">{initials(profile.full_name)}</Link><span><small>Hi, {firstName}</small><strong>{profile.job_title || "Staff member"}</strong></span></div>
        <div className="mobile-header-actions"><NotificationCenter compact /></div>
      </header>

      <div className="employee-content">
        <section className="employee-greeting" id="home">
          <div><h1>Good {greeting(now)},<br />{firstName}!</h1><p>{todayLabel} · Your attendance overview</p></div>
          <span className="live-time">{format(now, "h:mm:ss a")}</span>
        </section>

        <section className="staff-summary-strip" aria-label="Today at a glance">
          <div><small>Today</small><strong>{workdayTypeLabel(todaySchedule.day_type)}</strong></div>
          <div className="accent"><small>Scheduled</small><strong>{todaySchedule.day_type === "off" ? "Day off" : `${formatScheduledTime(todaySchedule.arrival_time)}–${formatScheduledTime(todaySchedule.departure_time)}`}</strong></div>
          <div><small>This month</small><strong>{monthAttendance} day{monthAttendance === 1 ? "" : "s"} marked</strong></div>
          <div><small>Annual leave</small><strong>{remainingAnnual} day{remainingAnnual === 1 ? "" : "s"} left</strong></div>
        </section>

        {profile.must_reset_password && <div className="security-banner"><ShieldCheck size={22} /><div><strong>Secure your account</strong><span>Replace the temporary password before marking attendance.</span></div><Link href="/auth/update-password">Change now <ArrowRight size={16} /></Link></div>}
        {missedAttendance.length > 0 && <section className="missed-attendance-alert"><span><MessageSquareWarning size={22} /></span><div><small>MISSED ATTENDANCE</small><strong>You missed marking attendance on {format(parseISO(missedAttendance[0].attendance_date), "EEEE, d MMMM")}.</strong><p>The day is recorded as {missedAttendance[0].absence_units} absent unit with 0 worked hours. Contact your administrator if this should be leave.</p></div><button onClick={() => void acknowledgeMissedAttendance(missedAttendance[0].id)}>I understand</button></section>}

        <section className={`clock-card ${markState}`}>
          <div className="clock-card-top">
            <div className="branch-chip"><Building2 size={15} /><span>{profile.branch?.name || "No branch"}</span></div>
            <div className="verification-label"><span className="pulse-dot" /> {workdayTypeLabel(todaySchedule.day_type)} · {todaySchedule.day_type === "off" ? "No attendance" : `${formatScheduledTime(todaySchedule.arrival_time)}–${formatScheduledTime(todaySchedule.departure_time)}`}</div>
          </div>
          <div className="clock-main">
            <div className="clock-copy">
              <span className="eyebrow eyebrow-light">TODAY’S ATTENDANCE</span>
              <h2>{nextAction === "clock_in" ? "Ready to start?" : nextAction === "clock_out" ? "You’re on the clock" : closedReason && !todayRecord?.clock_in ? closedReason : "Day complete"}</h2>
              <p>{nextAction ? "We’ll confirm that your current location is inside the office radius." : closedReason && !todayRecord?.clock_in ? "Attendance is not required today. This status is included in your calendar and CSV ledger." : "Your attendance has been safely recorded."}</p>
              <div className="clock-times">
                <div><small>Clock in</small><strong>{todayRecord?.clock_in ? formatTimeInZone(todayRecord.clock_in, profile.branch?.timezone) : "—"}</strong></div>
                <span />
                <div><small>Clock out</small><strong>{todayRecord?.clock_out ? formatTimeInZone(todayRecord.clock_out, profile.branch?.timezone) : "—"}</strong></div>
              </div>
            </div>
            <button className="clock-button" onClick={requestAttendanceConfirmation} disabled={!nextAction || profile.must_reset_password || mapLocating || markState === "locating" || markState === "verifying" || pendingAction !== null} aria-label={nextAction === "clock_out" ? "Clock out" : "Clock in"}>
              <span className="clock-button-inner">
                <span className="clock-button-icon">{markState === "locating" || markState === "verifying" ? <LoaderCircle className="spin" size={21} /> : markState === "success" || !nextAction ? <Check size={22} /> : <MapPin size={21} />}</span>
                <span className="clock-button-copy"><strong>{markState === "locating" ? "Finding you" : markState === "verifying" ? "Verifying" : !nextAction ? closedReason && !todayRecord?.clock_in ? "Not required" : "All done" : nextAction === "clock_in" ? "Clock in" : "Clock out"}</strong>{nextAction && markState === "idle" && <small>{todaySchedule.day_type === "half_day" ? "Secure half-day attendance" : "Secure attendance"}</small>}</span>
                {nextAction && markState === "idle" && <ArrowRight className="clock-button-arrow" size={19} />}
              </span>
            </button>
          </div>
          {markState !== "success" && (feedback || Object.keys(checks).length > 0) && <div className={`verification-result ${markState} ${locationProblem ? "location-problem" : ""}`}>
            {markState === "error" ? <CircleAlert size={19} /> : <LoaderCircle className="spin" size={19} />}
            <span><strong>{locationProblem && checks.gps === false ? "You are not inside the office attendance area." : feedback}</strong>{locationProblem && <small>{checks.gps === false ? "If you are at the office, enable precise location, move near a window and retry." : feedback}</small>}</span>
            {checks.distanceM != null && <small>{checks.distanceM} m from office centre | accuracy +/-{checks.accuracyM ?? "?"} m | location {checks.gps ? "inside radius" : "outside radius"}</small>}
            {markState === "error" && <div className="attendance-error-actions"><button type="button" onClick={() => { setMarkState("idle"); setFeedback(""); setChecks({}); requestAttendanceConfirmation(); }}><RefreshCw size={15} /> Retry</button><button type="button" onClick={() => setIssueOpen(true)}><LifeBuoy size={15} /> Report issue</button></div>}
          </div>}
        </section>

        {profile.branch && <OfficeMap
          office={{ name: profile.branch.name, latitude: Number(profile.branch.latitude), longitude: Number(profile.branch.longitude), radiusM: profile.branch.radius_m, maxAccuracyM: profile.branch.max_accuracy_m }}
          staffLocation={staffLocation}
          locating={mapLocating || markState === "locating" || markState === "verifying"}
          onLocate={locateOnMap}
        />}

        <section className="verification-strip" aria-label="Attendance verification information">
          <div><span className="soft-icon"><MapPin size={18} /></span><div><strong>{profile.branch?.radius_m || 200} m attendance zone</strong><small>Any verified point inside the radius is accepted</small></div></div>
          <div><span className="soft-icon"><ShieldCheck size={18} /></span><div><strong>Location only</strong><small>No office Wi-Fi, IP address or SSID is required</small></div></div>
          <div><span className="soft-icon"><ShieldCheck size={18} /></span><div><strong>Protected</strong><small>Every attempt is audited</small></div></div>
        </section>

        <section className="dashboard-section" id="calendar">
          <WorkCalendar today={today} initialNotes={calendarNotes} initialHolidays={holidays} attendance={attendance} leaves={leaves} workSchedule={workSchedule} canProposeHoliday />
        </section>

        <section className="dashboard-section" id="leave">
          <div className="section-heading"><div><span className="eyebrow">TIME OFF</span><h2>Your leave</h2></div><button className="button button-dark" onClick={() => setLeaveOpen(true)}><Plus size={17} /> Request leave</button></div>
          <div className="leave-grid">
            <LeaveBalanceCard label="Annual leave" icon={<Palmtree size={20} />} used={usedAnnual} total={profile.annual_leave_days} color="green" />
            <LeaveBalanceCard label="Monthly leave" icon={<CalendarDays size={20} />} used={usedMonthly} total={profile.monthly_leave_days} color="amber" />
          </div>
          <div className="list-card compact-list">
            {leaves.length === 0 ? <EmptyState icon={<CalendarDays size={24} />} title="No leave requests yet" text="Your requests and approvals will appear here." /> : leaves.slice(0, 4).map((leave) => <div className="list-row" key={leave.id}><span className="date-tile"><strong>{format(parseISO(leave.start_date), "dd")}</strong><small>{format(parseISO(leave.start_date), "MMM")}</small></span><div className="list-row-main"><strong>{leaveTypeLabel(leave.leave_type)}</strong><small>{leave.start_date === leave.end_date ? format(parseISO(leave.start_date), "d MMM yyyy") : `${format(parseISO(leave.start_date), "d MMM")} – ${format(parseISO(leave.end_date), "d MMM yyyy")}`} · {leave.requested_days} day{Number(leave.requested_days) === 1 ? "" : "s"}</small></div><StatusBadge status={leave.status} /></div>)}
          </div>
        </section>

        <section className="dashboard-section" id="history">
          <div className="section-heading"><div><span className="eyebrow">RECENT ACTIVITY</span><h2>Attendance history</h2></div></div>
          <div className="list-card attendance-list">
            {attendance.length === 0 ? <EmptyState icon={<History size={24} />} title="No attendance yet" text="Your first verified workday will appear here." /> : attendance.map((record) => <div className="list-row" key={record.id}><span className={`status-icon ${record.status}`}><Check size={17} /></span><div className="list-row-main"><strong>{format(parseISO(record.attendance_date), "EEEE, d MMM")}</strong><small>{record.status === "late" && record.late_minutes > 0 ? `${formatDelay(record.late_minutes)} late · ` : ""}{record.branch?.name || profile.branch?.name}</small></div><div className="time-pair"><span>{record.clock_in ? formatTimeInZone(record.clock_in, profile.branch?.timezone) : "—"}</span><ChevronRight size={14} /><span>{record.clock_out ? formatTimeInZone(record.clock_out, profile.branch?.timezone) : "—"}</span></div><StatusBadge status={record.status} /></div>)}
          </div>
        </section>

        <section className="staff-bottom-experience">
          <button className="staff-report-issue" onClick={() => setIssueOpen(true)}><LifeBuoy size={19} /><span><strong>Something not working?</strong><small>Send the problem and attendance context to your administrator.</small></span><ChevronRight size={18} /></button>
          <FirstVisitInstall persistent />
        </section>
      </div>

      <nav className="mobile-nav refined-mobile-nav" aria-label="Employee navigation">
        <a href="#home"><Home size={20} /><span>Home</span></a>
        <a href="#calendar"><CalendarDays size={20} /><span>Calendar</span></a>
        <button className="nav-clock" onClick={requestAttendanceConfirmation} disabled={!nextAction || mapLocating || markState === "locating" || markState === "verifying" || pendingAction !== null}><MapPin size={22} /></button>
        <a href="#leave"><CalendarDays size={20} /><span>Leave</span></a>
        <Link href="/profile"><UserRound size={20} /><span>Profile</span></Link>
      </nav>

      {pendingAction && <AttendanceConfirmation action={pendingAction} branchName={profile.branch?.name || "your assigned branch"} onCancel={() => setPendingAction(null)} onConfirm={() => markAttendance(pendingAction)} />}
      {(markState === "locating" || markState === "verifying") && <AttendanceProgress state={markState} action={nextAction || "clock_in"} feedback={feedback} />}
      {markState === "error" && !issueOpen && <AttendanceError message={feedback} checks={checks} locationProblem={locationProblem} onClose={closeAttendanceError} onRetry={retryAttendance} onReport={() => setIssueOpen(true)} />}
      {successReceipt && <AttendanceSuccess
        receipt={successReceipt}
        firstName={firstName}
        timezone={profile.branch?.timezone || "Asia/Colombo"}
        scheduledTime={successReceipt.action === "clock_in" ? todaySchedule.arrival_time : todaySchedule.departure_time}
        onDone={() => { setSuccessReceipt(null); setMarkState("idle"); setFeedback(""); setChecks({}); }}
      />}
      {leaveOpen && <LeaveRequestModal onClose={() => setLeaveOpen(false)} onCreated={(leave) => { setLeaves((current) => [leave, ...current]); setLeaveOpen(false); }} />}
      {issueOpen && <IssueReportModal defaultCategory={locationProblem ? "location" : "app"} context={{ feedback, checks, branch: profile.branch?.name, date: today }} onClose={() => setIssueOpen(false)} />}
    </main>
  );
}

function LeaveBalanceCard({ label, icon, used, total, color }: { label: string; icon: React.ReactNode; used: number; total: number; color: string }) {
  const remaining = Math.max(0, total - used);
  const percent = total ? Math.min(100, (remaining / total) * 100) : 0;
  return <article className={`leave-card ${color}`}><div className="leave-card-head"><span>{icon}</span><small>{label}</small></div><div className="leave-number"><strong>{remaining}</strong><span>of {total} days left</span></div><div className="progress"><span style={{ width: `${percent}%` }} /></div></article>;
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`status-badge ${status}`}>{status.replace("_", " ")}</span>;
}

function EmptyState({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <div className="empty-state"><span>{icon}</span><strong>{title}</strong><small>{text}</small></div>;
}

function AttendanceConfirmation({
  action,
  branchName,
  onCancel,
  onConfirm,
}: {
  action: AttendanceAction;
  branchName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isClockIn = action === "clock_in";
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}><div className="modal attendance-confirmation" role="dialog" aria-modal="true" aria-labelledby="attendance-confirmation-title"><div className="modal-head"><div><span className="eyebrow">CONFIRM ATTENDANCE</span><h2 id="attendance-confirmation-title">{isClockIn ? "Clock in now?" : "Clock out now?"}</h2><p>{isClockIn ? `Start your workday at ${branchName}.` : `Finish your workday at ${branchName}.`}</p></div><button className="icon-button bordered" onClick={onCancel} aria-label="Cancel"><X size={20} /></button></div><div className="confirmation-checks"><div><MapPin size={18} /><span><strong>Current location</strong><small>We will get one fresh location reading and confirm it is inside the branch radius.</small></span></div><div><ShieldCheck size={18} /><span><strong>Location-only verification</strong><small>No office Wi-Fi, IP address or SSID is collected or required.</small></span></div></div><div className="modal-actions"><button type="button" className="button button-ghost" onClick={onCancel}>Cancel</button><button type="button" className="button button-primary" onClick={onConfirm}>{isClockIn ? "Verify and clock in" : "Verify and clock out"}</button></div></div></div>;
}

function AttendanceProgress({ state, action, feedback }: { state: "locating" | "verifying"; action: AttendanceAction; feedback: string }) {
  const locating = state === "locating";
  return <div className="attendance-motion-backdrop" role="presentation"><section className="attendance-motion-sheet is-loading" role="dialog" aria-modal="true" aria-live="polite" aria-labelledby="attendance-progress-title">
    <div className="fluid-orb loading-orb" aria-hidden="true"><i /><i /><span>{locating ? <MapPin size={34} /> : <ShieldCheck size={34} />}</span></div>
    <span className="motion-kicker">SECURE {action === "clock_in" ? "CLOCK IN" : "CLOCK OUT"}</span>
    <h2 id="attendance-progress-title">{locating ? "Finding you" : "Almost there"}</h2>
    <p>{feedback || (locating ? "Getting a precise location inside your office zone." : "Confirming your location with the office attendance rules.")}</p>
    <div className="motion-progress" aria-hidden="true"><span /></div>
    <small>Keep Presence open for a moment</small>
  </section></div>;
}

function AttendanceError({ message, checks, locationProblem, onClose, onRetry, onReport }: { message: string; checks: VerificationChecks; locationProblem: boolean; onClose: () => void; onRetry: () => void; onReport: () => void }) {
  return <div className="attendance-motion-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="attendance-motion-sheet is-error" role="alertdialog" aria-modal="true" aria-labelledby="attendance-error-title">
    <button className="motion-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
    <div className="fluid-orb error-orb" aria-hidden="true"><i /><i /><span><X size={36} strokeWidth={3} /></span></div>
    <span className="motion-kicker">ATTENDANCE NOT MARKED</span>
    <h2 id="attendance-error-title">{locationProblem ? "You’re outside the office zone" : "Something went wrong"}</h2>
    <p>{message || "Presence could not complete this attendance check."}</p>
    {checks.distanceM != null && <div className="motion-error-detail"><span><small>DISTANCE</small><strong>{checks.distanceM} m</strong></span><span><small>ACCURACY</small><strong>±{checks.accuracyM ?? "?"} m</strong></span></div>}
    {locationProblem && <small className="motion-help">If you are in the office, enable precise location, move near a window, then retry.</small>}
    <div className="motion-error-actions"><button className="motion-primary" onClick={onRetry}><RefreshCw size={17} /> Retry</button><button className="motion-secondary" onClick={onReport}><LifeBuoy size={17} /> Report issue</button></div>
  </section></div>;
}

function AttendanceSuccess({
  receipt,
  firstName,
  timezone,
  scheduledTime,
  onDone,
}: {
  receipt: AttendanceSuccessReceipt;
  firstName: string;
  timezone: string;
  scheduledTime: string;
  onDone: () => void;
}) {
  const isClockIn = receipt.action === "clock_in";
  const recordedAt = isClockIn ? receipt.record.clock_in : receipt.record.clock_out;
  const lateMinutes = isClockIn ? receipt.record.late_minutes : 0;
  const earlyMinutes = !isClockIn ? receipt.record.early_leave_minutes : 0;
  const hasTimingNote = lateMinutes > 0 || earlyMinutes > 0;
  const message = isClockIn
    ? lateMinutes > 0
      ? `${firstName}, your clock-in is safely recorded. A slower start can still become a strong finish.`
      : `${firstName}, your workday has officially begun and your attendance is safely recorded.`
    : earlyMinutes > 0
      ? `${firstName}, your clock-out is safely recorded. Take care, recharge, and come back brighter.`
      : `${firstName}, your day is safely recorded. Now switch off, breathe out, and enjoy what’s next.`;

  return <div className="attendance-success-backdrop" role="presentation" onKeyDown={(event) => event.key === "Escape" && onDone()}><section className={`attendance-success-sheet ${hasTimingNote ? "with-timing-note" : ""}`} role="dialog" aria-modal="true" aria-labelledby="attendance-success-title" aria-describedby="attendance-success-message">
    <div className="success-confetti" aria-hidden="true"><i /><i /><i /><i /></div>
    <div className="success-seal" aria-hidden="true"><Check size={39} strokeWidth={3.2} /></div>
    <span className="success-kicker"><Sparkles size={14} /> Attendance confirmed</span>
    <h2 id="attendance-success-title">Successful</h2>
    <p id="attendance-success-message">{message}</p>
    <div className="success-time-card">
      <div><span className="success-stat-icon"><Clock3 size={18} /></span><small>{isClockIn ? "Clocked in" : "Clocked out"}</small><strong>{recordedAt ? formatTimeInZone(recordedAt, timezone) : "Recorded"}</strong></div>
      <div><span className="success-stat-icon"><Timer size={18} /></span><small>Scheduled</small><strong>{formatScheduledTime(scheduledTime)}</strong></div>
    </div>
    {lateMinutes > 0 && <div className="success-delay-note"><span><Timer size={18} /></span><div><small>ARRIVAL NOTE</small><strong>{formatDelay(lateMinutes)} later than your allowed arrival time</strong></div><b>{formatDelay(lateMinutes)}</b></div>}
    {earlyMinutes > 0 && <div className="success-delay-note early"><span><Timer size={18} /></span><div><small>DEPARTURE NOTE</small><strong>Clocked out {formatDelay(earlyMinutes)} before schedule</strong></div><b>{formatDelay(earlyMinutes)}</b></div>}
    <button className="success-done-button" type="button" onClick={onDone} autoFocus>Done <ArrowRight size={18} /></button>
  </section></div>;
}

function LeaveRequestModal({ onClose, onCreated }: { onClose: () => void; onCreated: (leave: LeaveRequest) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true); setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/leave", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(form)) });
    const json = await response.json();
    if (!response.ok) { setError(json.error); setLoading(false); return; }
    onCreated(json.leave);
  }
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className="modal"><div className="modal-head"><div><span className="eyebrow">TIME OFF</span><h2>Request leave</h2></div><button className="icon-button bordered" onClick={onClose}><X size={20} /></button></div><form onSubmit={submit} className="form-grid"><label className="field"><span>Leave type</span><select name="leave_type" required defaultValue="annual"><option value="annual">Annual leave</option><option value="monthly">Monthly leave</option><option value="medical">Medical leave</option><option value="unpaid">Unpaid leave</option></select></label><label className="field"><span>Duration</span><select name="portion" required defaultValue="full_day"><option value="full_day">Full day</option><option value="first_half">First half</option><option value="second_half">Second half</option></select></label><label className="field"><span>Start date</span><input name="start_date" type="date" required /></label><label className="field"><span>End date</span><input name="end_date" type="date" required /></label><label className="field field-span"><span>Reason</span><textarea name="reason" minLength={4} maxLength={500} required placeholder="Share a short reason for your request" /></label>{error && <div className="form-alert error field-span">{error}</div>}<div className="modal-actions field-span"><button type="button" className="button button-ghost" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={loading}>{loading ? <span className="spinner" /> : "Send request"}</button></div></form></div></div>;
}

function IssueReportModal({ defaultCategory, context, onClose }: { defaultCategory: string; context: Record<string, unknown>; onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch("/api/issues", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...values, context }) });
    const result = await response.json().catch(() => ({}));
    if (response.ok) setSent(true);
    else setError(result.error || "The issue could not be sent.");
    setLoading(false);
  }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="modal issue-report-modal" role="dialog" aria-modal="true" aria-labelledby="issue-report-title"><div className="modal-head"><div><span className="eyebrow">HELP & SUPPORT</span><h2 id="issue-report-title">Report an issue</h2><p>Your administrator receives this report with the current app context.</p></div><button className="icon-button bordered" onClick={onClose}><X size={20} /></button></div>{sent ? <div className="issue-sent"><Check size={25} /><strong>Report sent</strong><p>Your administrator has been notified.</p><button className="button button-primary" onClick={onClose}>Done</button></div> : <form className="stack-lg" onSubmit={submit}><label className="field"><span>Problem area</span><select name="category" defaultValue={defaultCategory}><option value="attendance">Attendance</option><option value="location">Office location</option><option value="leave">Leave</option><option value="schedule">Work schedule</option><option value="payroll">Salary or payroll</option><option value="app">App problem</option><option value="other">Other</option></select></label><label className="field"><span>What happened?</span><textarea name="message" required minLength={4} maxLength={1000} placeholder="Tell the administrator what you tried and what went wrong." /></label>{error && <div className="form-alert error">{error}</div>}<div className="modal-actions"><button type="button" className="button button-ghost" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={loading}>{loading ? "Sending…" : "Send to admin"}</button></div></form>}</div></div>;
}

function greeting(date: Date) {
  const hour = date.getHours();
  return hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
}
function branchLocalDate(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}
function formatTimeInZone(value: string, timezone = "Asia/Colombo") {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}
function formatScheduledTime(value: string) {
  const [hours = "0", minutes = "0"] = value.split(":");
  const date = new Date(2000, 0, 1, Number(hours), Number(minutes));
  return format(date, "h:mm a");
}
function formatDelay(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}
function initials(name: string) { return name.split(" ").slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }
function leaveTypeLabel(value: string) { return `${value.charAt(0).toUpperCase()}${value.slice(1)} leave`; }
function workdayTypeLabel(value: WorkScheduleDay["day_type"]) { return value === "half_day" ? "Half day" : value === "off" ? "Day off" : "Full day"; }
