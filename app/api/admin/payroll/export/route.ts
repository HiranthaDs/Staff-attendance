import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiAdmin } from "@/lib/api-auth";
import { buildPayrollPreview } from "@/lib/payroll-report";
import { payrollCycleForPeriod } from "@/lib/payroll";
import { loadPayrollPreferences } from "@/lib/payroll-preferences";

const schema = z.object({ start: z.string().date(), end: z.string().date(), branch_id: z.union([z.string().uuid(), z.literal("all")]) });
function cell(value: unknown) { let text = value == null ? "" : String(value); if (/^[=+\-@]/.test(text)) text = `'${text}`; return `"${text.replace(/"/g, '""')}"`; }

export async function GET(request: Request) {
  const actor = await getApiAdmin();
  if ("error" in actor) return actor.error;
  const url = new URL(request.url);
  const parsed = schema.safeParse({ start: url.searchParams.get("start"), end: url.searchParams.get("end"), branch_id: url.searchParams.get("branch_id") || "all" });
  const preferences = await loadPayrollPreferences(actor.admin);
  if (!parsed.success || !payrollCycleForPeriod(parsed.data.start, parsed.data.end, preferences.cycle_start_day)) return NextResponse.json({ error: "Choose the complete payroll period configured in Settings." }, { status: 400 });
  const rows = await buildPayrollPreview(actor.admin, { start: parsed.data.start, end: parsed.data.end, branchId: parsed.data.branch_id === "all" ? null : parsed.data.branch_id });
  const lines = [["PAYROLL ATTENDANCE WORKSHEET"], ["Period", parsed.data.start, "to", parsed.data.end], ["Generated", new Date().toISOString()], [], ["Branch", "Employee", "Employee code", "Period start", "Period end", "Scheduled days", "Attendance days", "Full leave days", "Paid leave days", "Unpaid leave days", "Short leave count", "Short leave days", "Absent days", "Holidays", "Off days", "Worked hours", "Late minutes", "Early leave minutes", "Basic salary", "Allowances", "Other earnings", "Attendance deduction", "Other deductions", "Employee EPF", "Employer EPF", "Employer ETF", "Gross salary", "Net salary", "Status", "Notes"]].map((row) => row.map(cell).join(","));
  for (const row of rows) {
    const saved = row.saved;
    lines.push([row.profile.branch?.name, row.profile.full_name, row.profile.employee_code, parsed.data.start, parsed.data.end, row.summary.scheduled_days, row.summary.attendance_days, row.summary.full_leave_days, row.summary.paid_leave_days, row.summary.unpaid_leave_days, row.summary.short_leave_count, row.summary.short_leave_days, row.summary.absent_days, row.summary.holiday_days, row.summary.off_days, `${Math.floor(row.summary.worked_minutes / 60)}:${String(row.summary.worked_minutes % 60).padStart(2, "0")}`, row.summary.late_minutes, row.summary.early_leave_minutes, saved?.basic_salary ?? row.settings.basic_salary, saved?.fixed_allowances ?? row.settings.fixed_allowances, saved?.other_earnings, saved?.attendance_deduction ?? row.suggested_attendance_deduction, saved?.other_deductions, saved?.employee_epf, saved?.employer_epf, saved?.employer_etf, saved?.gross_pay ?? row.preview_money.grossPay, saved?.net_pay ?? row.preview_money.netPay, saved?.status ?? "not prepared", saved?.notes].map(cell).join(","));
  }
  const branch = parsed.data.branch_id === "all" ? "All-Branches" : "Branch";
  const filename = `Presence_Payroll_${branch}_${parsed.data.start}_to_${parsed.data.end}.csv`;
  return new NextResponse(`\uFEFF${lines.join("\r\n")}`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "private, no-store" } });
}
