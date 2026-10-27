"use client";

import { useEffect, useMemo, useState } from "react";
import { addMonths, format, parseISO } from "date-fns";
import { Banknote, Building2, CalendarRange, ChevronLeft, ChevronRight, Clock3, Download, FileCheck2, LoaderCircle, Save, ShieldCheck, UserCheck, X } from "lucide-react";
import { calculatePayrollMoney, payrollCycleForStartDay, payrollPeriod, type PayrollDayRecord } from "@/lib/payroll";
import type { Branch, PayCycle, PayrollRecord, PayrollSummary, Profile, SalarySettings } from "@/lib/types";

type PayrollRow = {
  profile: Profile;
  summary: PayrollSummary;
  settings: SalarySettings;
  saved: PayrollRecord | null;
  suggested_attendance_deduction: number;
  preview_money: ReturnType<typeof calculatePayrollMoney>;
  daily_records: PayrollDayRecord[];
};

export function PayrollView({ branches, today }: { branches: Branch[]; today: string }) {
  const [cycleStartDay, setCycleStartDay] = useState(15);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [referenceMonth, setReferenceMonth] = useState(today.slice(0, 7));
  const [branchId, setBranchId] = useState("all");
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [selected, setSelected] = useState<PayrollRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const cycle = payrollCycleForStartDay(cycleStartDay);
  const period = useMemo(() => payrollPeriod(referenceMonth, cycle, cycleStartDay), [cycle, cycleStartDay, referenceMonth]);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/payroll/preferences", { cache: "no-store" })
      .then((response) => response.json())
      .then((result) => { if (active) setCycleStartDay(Number(result.preferences?.cycle_start_day ?? 15)); })
      .catch(() => undefined)
      .finally(() => active && setPreferencesReady(true));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;
    let active = true;
    fetch(`/api/admin/payroll?start=${period.start}&end=${period.end}&branch_id=${encodeURIComponent(branchId)}`, { cache: "no-store" })
      .then(async (response) => { const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error || "Payroll could not be loaded."); return result; })
      .then((result) => { if (active) setRows(result.rows as PayrollRow[]); })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : "Payroll could not be loaded."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [branchId, period.end, period.start, preferencesReady]);

  function moveMonth(amount: number) {
    const next = addMonths(parseISO(`${referenceMonth}-01T12:00:00`), amount);
    setLoading(true);
    setError("");
    setReferenceMonth(format(next, "yyyy-MM"));
  }

  function changeBranch(next: string) {
    setLoading(true);
    setError("");
    setBranchId(next);
  }

  const totals = rows.reduce((result, row) => ({
    attendance: result.attendance + row.summary.attendance_days,
    absent: result.absent + row.summary.absent_days,
    shortLeave: result.shortLeave + row.summary.short_leave_count,
    net: result.net + Number(row.saved?.net_pay ?? row.preview_money.netPay),
  }), { attendance: 0, absent: 0, shortLeave: 0, net: 0 });

  return <>
    <div className="page-heading payroll-heading"><div><span className="eyebrow">ACCOUNTANT WORKSPACE</span><h1>Salary creation</h1><p>One employee per line, with scheduled dates, attendance, leave, absences and salary totals together.</p></div><div className="payroll-cycle-badge"><CalendarRange size={18} /><span><small>CYCLE FROM SETTINGS</small><strong>Starts on the {ordinal(cycleStartDay)}</strong></span></div></div>
    <section className="panel payroll-control-bar"><div className="payroll-period-stepper"><button onClick={() => moveMonth(-1)} aria-label="Previous payroll period"><ChevronLeft size={18} /></button><span><small>SALARY PERIOD</small><strong>{format(parseISO(`${period.start}T12:00:00`), "d MMM yyyy")} – {format(parseISO(`${period.end}T12:00:00`), "d MMM yyyy")}</strong></span><button onClick={() => moveMonth(1)} aria-label="Next payroll period"><ChevronRight size={18} /></button></div><label className="filter-select"><Building2 size={16} /><select value={branchId} onChange={(event) => changeBranch(event.target.value)}><option value="all">All branches</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><span className="payroll-period-note"><CalendarRange size={16} /> Change the salary start date in Settings.</span><a className="button button-ghost payroll-export" href={`/api/admin/payroll/export?start=${period.start}&end=${period.end}&branch_id=${encodeURIComponent(branchId)}`}><Download size={16} /> CSV</a></section>
    {message && <div className="form-alert success payroll-feedback">{message}</div>}{error && <div className="form-alert error payroll-feedback">{error}</div>}
    <div className="payroll-stat-grid"><article><span><UserCheck /></span><div><small>Attendance marks</small><strong>{totals.attendance}</strong></div></article><article><span><Clock3 /></span><div><small>Short leaves</small><strong>{totals.shortLeave}</strong></div></article><article><span><CalendarRange /></span><div><small>Absent-day units</small><strong>{totals.absent}</strong></div></article><article><span><Banknote /></span><div><small>Period net total</small><strong>{money(totals.net)}</strong></div></article></div>
    <section className="panel payroll-table-panel">{loading ? <div className="detail-loading"><LoaderCircle className="spin" /> Building attendance worksheet…</div> : <div className="data-table"><div className="table-row payroll-table table-head"><span>Employee</span><span>Scheduled</span><span>Attended</span><span>Full leave</span><span>Short leave</span><span>Absent</span><span>Salary</span><span>Statement</span></div>{rows.map((row) => <button className="table-row payroll-table payroll-row" key={row.profile.id} onClick={() => setSelected(row)}><span className="person-cell"><span className="avatar avatar-sm">{initials(row.profile.full_name)}</span><span><strong>{row.profile.full_name}</strong><small>{row.profile.branch?.name} · {row.profile.employee_code || "No code"}</small></span></span><span>{row.summary.scheduled_days} days</span><span>{row.summary.attendance_days} marks</span><span>{row.summary.full_leave_days}</span><span>{row.summary.short_leave_count} ({row.summary.short_leave_days}d)</span><span className={row.summary.absent_days > 0 ? "payroll-alert-value" : ""}>{row.summary.absent_days}</span><span>{money(row.saved?.net_pay ?? row.preview_money.netPay)}</span><span><i className={`payroll-status ${row.saved?.status || "unprepared"}`} />{row.saved?.status || "Review"}</span></button>)}</div>}{!loading && !rows.length && <div className="empty-state"><span><FileCheck2 /></span><strong>No employees in this period</strong><small>Choose another branch or payroll month.</small></div>}</section>
    {selected && <PayrollReviewModal row={selected} start={period.start} end={period.end} cycle={cycle} onClose={() => setSelected(null)} onSaved={(record, settings) => { setRows((current) => current.map((item) => item.profile.id === selected.profile.id ? { ...item, saved: record, settings } : item)); setMessage(`${selected.profile.full_name}'s ${record.status} salary statement was saved.`); setSelected(null); }} />}
  </>;
}

function PayrollReviewModal({ row, start, end, cycle, onClose, onSaved }: { row: PayrollRow; start: string; end: string; cycle: PayCycle; onClose: () => void; onSaved: (record: PayrollRecord, settings: SalarySettings) => void }) {
  const existing = row.saved;
  const [basic, setBasic] = useState(Number(existing?.basic_salary ?? row.settings.basic_salary));
  const [allowances, setAllowances] = useState(Number(existing?.fixed_allowances ?? row.settings.fixed_allowances));
  const [otherEarnings, setOtherEarnings] = useState(Number(existing?.other_earnings ?? 0));
  const [attendanceDeduction, setAttendanceDeduction] = useState(Number(existing?.attendance_deduction ?? row.suggested_attendance_deduction));
  const [otherDeductions, setOtherDeductions] = useState(Number(existing?.other_deductions ?? 0));
  const [epfEnabled, setEpfEnabled] = useState(row.settings.epf_enabled);
  const [status, setStatus] = useState<PayrollRecord["status"]>(existing?.status ?? "draft");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const calculation = calculatePayrollMoney({ basicSalary: basic, fixedAllowances: allowances, otherEarnings, attendanceDeduction, otherDeductions, epfEnabled });
  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    const response = await fetch("/api/admin/payroll", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user_id: row.profile.id, start, end, basic_salary: basic, fixed_allowances: allowances, pay_cycle: cycle, epf_enabled: epfEnabled, other_earnings: otherEarnings, attendance_deduction: attendanceDeduction, other_deductions: otherDeductions, status, notes }) });
    const result = await response.json().catch(() => ({}));
    if (response.ok) onSaved(result.record, result.settings);
    else { setError(result.error || "The salary statement could not be saved."); setSaving(false); }
  }
  return <div className="modal-backdrop elevated-modal" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="modal modal-wide payroll-review-modal"><div className="modal-head"><div><span className="eyebrow">SALARY REVIEW · {start} TO {end}</span><h2>{row.profile.full_name}</h2><p>Attendance totals are recalculated by the server when this statement is saved.</p></div><button className="icon-button bordered" onClick={onClose}><X size={20} /></button></div><form onSubmit={save} className="payroll-review-layout"><section className="payroll-evidence"><div className="payroll-evidence-title"><ShieldCheck size={19} /><div><strong>Verified attendance evidence</strong><small>Read-only totals from attendance, leave, schedule and holiday records.</small></div></div><div className="payroll-evidence-grid"><PayrollFact label="Scheduled" value={`${row.summary.scheduled_days} days`} /><PayrollFact label="Attendance" value={`${row.summary.attendance_days} days`} /><PayrollFact label="Full leave" value={`${row.summary.full_leave_days} days`} /><PayrollFact label="Short leave" value={`${row.summary.short_leave_count} requests`} /><PayrollFact label="Absent" value={`${row.summary.absent_days} days`} alert={row.summary.absent_days > 0} /><PayrollFact label="Worked" value={duration(row.summary.worked_minutes)} /><PayrollFact label="Late" value={`${row.summary.late_minutes} min`} /><PayrollFact label="Early leave" value={`${row.summary.early_leave_minutes} min`} /></div><div className="payroll-daily-ledger"><div className="payroll-daily-head"><strong>Daily attendance records</strong><small>{row.daily_records.filter((day) => day.clock_in).length} dates attended</small></div><div>{row.daily_records.map((day) => <article key={day.date}><time>{format(parseISO(`${day.date}T12:00:00`), "dd MMM")}</time><span><strong>{day.status_label}</strong><small>{day.day_type === "off" ? "Weekly off" : `${day.scheduled_start.slice(0, 5)}–${day.scheduled_finish.slice(0, 5)}`}</small></span><span className="daily-clock">{day.clock_in ? format(parseISO(day.clock_in), "h:mm a") : "—"} → {day.clock_out ? format(parseISO(day.clock_out), "h:mm a") : "—"}</span><b className={day.status}>{day.work_minutes ? duration(day.work_minutes) : day.status === "absent" ? "0h" : "—"}</b></article>)}</div></div><div className="suggested-deduction"><span><Banknote size={17} /></span><div><small>SYSTEM SUGGESTION</small><strong>{money(row.suggested_attendance_deduction)}</strong><p>Based only on basic salary, absent units and unpaid leave. Review before using.</p></div><button type="button" onClick={() => setAttendanceDeduction(row.suggested_attendance_deduction)}>Use suggestion</button></div></section><section className="payroll-money-form"><div className="payroll-form-grid"><MoneyField label="Basic salary" value={basic} onChange={setBasic} /><MoneyField label="Fixed allowances" value={allowances} onChange={setAllowances} /><MoneyField label="Other earnings" value={otherEarnings} onChange={setOtherEarnings} /><MoneyField label="Attendance deduction" value={attendanceDeduction} onChange={setAttendanceDeduction} /><MoneyField label="Other deductions" value={otherDeductions} onChange={setOtherDeductions} /></div><label className="payroll-epf-toggle"><input type="checkbox" checked={epfEnabled} onChange={(event) => setEpfEnabled(event.target.checked)} /><span><strong>Calculate EPF & ETF</strong><small>Employee EPF 8% · employer EPF 12% · employer ETF 3%</small></span></label><div className="payroll-calculation"><div><small>Gross salary</small><strong>{money(calculation.grossPay)}</strong></div><div><small>Employee EPF</small><strong>− {money(calculation.employeeEpf)}</strong></div><div className="net"><small>Net salary</small><strong>{money(calculation.netPay)}</strong></div><p>Employer: EPF {money(calculation.employerEpf)} · ETF {money(calculation.employerEtf)}</p></div><label className="field"><span>Accountant note</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} placeholder="Optional explanation for adjustments" /></label><label className="field"><span>Statement status</span><select value={status} onChange={(event) => setStatus(event.target.value as PayrollRecord["status"])}><option value="draft">Draft · accountant only</option><option value="finalized">Finalized · visible to staff</option><option value="paid">Paid · visible to staff</option></select></label>{error && <div className="form-alert error">{error}</div>}<div className="modal-actions"><button type="button" className="button button-ghost" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={saving}><Save size={16} /> {saving ? "Saving…" : "Save statement"}</button></div></section></form></div></div>;
}

function MoneyField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <label className="field"><span>{label} (LKR)</span><input type="number" min="0" max="100000000" step="0.01" value={value} onChange={(event) => onChange(Number(event.target.value))} required /></label>; }
function PayrollFact({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) { return <div className={alert ? "alert" : ""}><small>{label}</small><strong>{value}</strong></div>; }
function initials(name: string) { return name.split(" ").slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }
function money(value: number) { return `LKR ${Number(value || 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function duration(minutes: number) { return `${Math.floor(minutes / 60)}h ${minutes % 60}m`; }
function ordinal(value: number) { const suffix = value % 10 === 1 && value !== 11 ? "st" : value % 10 === 2 && value !== 12 ? "nd" : value % 10 === 3 && value !== 13 ? "rd" : "th"; return `${value}${suffix}`; }
