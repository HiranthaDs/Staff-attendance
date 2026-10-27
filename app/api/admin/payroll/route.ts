import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiAdmin } from "@/lib/api-auth";
import { isTrustedMutationOrigin } from "@/lib/attendance-backend";
import { calculatePayrollMoney, payrollCycleForPeriod } from "@/lib/payroll";
import { buildPayrollPreview } from "@/lib/payroll-report";
import { savePayrollRecord, saveSalarySettings } from "@/lib/payroll-store";
import { loadPayrollPreferences } from "@/lib/payroll-preferences";
import { notifyUsers } from "@/lib/notifications";
import type { PayrollRecord, SalarySettings } from "@/lib/types";

const querySchema = z.object({
  start: z.string().date(),
  end: z.string().date(),
  branch_id: z.union([z.string().uuid(), z.literal("all")]).default("all"),
});

const saveSchema = z.object({
  user_id: z.string().uuid(), start: z.string().date(), end: z.string().date(),
  basic_salary: z.coerce.number().min(0).max(100_000_000),
  fixed_allowances: z.coerce.number().min(0).max(100_000_000),
  pay_cycle: z.enum(["calendar_month", "fifteenth_cycle", "custom_cycle"]), epf_enabled: z.boolean(),
  other_earnings: z.coerce.number().min(0).max(100_000_000).default(0),
  attendance_deduction: z.coerce.number().min(0).max(100_000_000).default(0),
  other_deductions: z.coerce.number().min(0).max(100_000_000).default(0),
  status: z.enum(["draft", "finalized", "paid"]), notes: z.string().trim().max(1000).optional(),
});

function validRange(start: string, end: string) {
  if (end < start) return false;
  return (new Date(`${end}T12:00:00Z`).getTime() - new Date(`${start}T12:00:00Z`).getTime()) / 86_400_000 <= 62;
}

export async function GET(request: Request) {
  const actor = await getApiAdmin();
  if ("error" in actor) return actor.error;
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ start: url.searchParams.get("start"), end: url.searchParams.get("end"), branch_id: url.searchParams.get("branch_id") || "all" });
  const preferences = await loadPayrollPreferences(actor.admin);
  if (!parsed.success || !validRange(parsed.data.start, parsed.data.end) || !payrollCycleForPeriod(parsed.data.start, parsed.data.end, preferences.cycle_start_day)) return NextResponse.json({ error: "Choose the complete payroll period configured in Settings." }, { status: 400 });
  try {
    const rows = await buildPayrollPreview(actor.admin, { start: parsed.data.start, end: parsed.data.end, branchId: parsed.data.branch_id === "all" ? null : parsed.data.branch_id });
    return NextResponse.json({ rows });
  } catch {
    return NextResponse.json({ error: "The payroll attendance worksheet could not be prepared." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const actor = await getApiAdmin();
  if ("error" in actor) return actor.error;
  const parsed = saveSchema.safeParse(await request.json().catch(() => null));
  const preferences = await loadPayrollPreferences(actor.admin);
  if (!parsed.success || !validRange(parsed.data.start, parsed.data.end) || payrollCycleForPeriod(parsed.data.start, parsed.data.end, preferences.cycle_start_day) !== parsed.data.pay_cycle) return NextResponse.json({ error: "The dates do not match the payroll cycle saved in Settings. Refresh the worksheet and try again." }, { status: 400 });
  const input = parsed.data;
  const rows = await buildPayrollPreview(actor.admin, { start: input.start, end: input.end, userId: input.user_id });
  const preview = rows[0];
  if (!preview) return NextResponse.json({ error: "The employee was not found." }, { status: 404 });
  const now = new Date().toISOString();
  const settings = await saveSalarySettings(actor.admin, {
    user_id: input.user_id, basic_salary: input.basic_salary, fixed_allowances: input.fixed_allowances,
    pay_cycle: input.pay_cycle, epf_enabled: input.epf_enabled, currency: "LKR", updated_at: now, updated_by: actor.user.id,
  } as SalarySettings & { updated_by: string });
  const money = calculatePayrollMoney({ basicSalary: input.basic_salary, fixedAllowances: input.fixed_allowances, otherEarnings: input.other_earnings, attendanceDeduction: input.attendance_deduction, otherDeductions: input.other_deductions, epfEnabled: input.epf_enabled });
  const existing = preview.saved;
  const record: PayrollRecord & { generated_by: string } = {
    id: existing?.id ?? crypto.randomUUID(), user_id: input.user_id,
    ...preview.summary, cycle_label: `${input.start} to ${input.end}`,
    basic_salary: input.basic_salary, fixed_allowances: input.fixed_allowances, other_earnings: input.other_earnings,
    attendance_deduction: input.attendance_deduction, other_deductions: input.other_deductions,
    employee_epf: money.employeeEpf, employer_epf: money.employerEpf, employer_etf: money.employerEtf,
    gross_pay: money.grossPay, net_pay: money.netPay, currency: "LKR", status: input.status,
    notes: input.notes || null, finalized_at: input.status === "draft" ? null : existing?.finalized_at ?? now,
    paid_at: input.status === "paid" ? existing?.paid_at ?? now : null,
    created_at: existing?.created_at ?? now, updated_at: now, generated_by: actor.user.id,
  };
  const saved = await savePayrollRecord(actor.admin, record);
  if (input.status !== "draft") {
    await notifyUsers({ recipientIds: [input.user_id], kind: "account", title: input.status === "paid" ? "Salary marked as paid" : "Salary statement is ready", body: `${record.cycle_label}: net salary LKR ${record.net_pay.toLocaleString("en-LK", { minimumFractionDigits: 2 })}.`, actionUrl: "/profile#salary", dedupeKey: `payroll:${saved.id}:${input.status}` });
  }
  return NextResponse.json({ record: saved, settings });
}
