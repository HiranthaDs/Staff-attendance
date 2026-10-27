import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiAdmin } from "@/lib/api-auth";
import { isTrustedMutationOrigin } from "@/lib/attendance-backend";
import { saveSalarySettings } from "@/lib/payroll-store";
import { loadPayrollPreferences } from "@/lib/payroll-preferences";
import { payrollCycleForStartDay } from "@/lib/payroll";
import type { SalarySettings } from "@/lib/types";

const schema = z.object({
  basic_salary: z.coerce.number().min(0).max(100_000_000),
  fixed_allowances: z.coerce.number().min(0).max(100_000_000),
  epf_enabled: z.boolean(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const actor = await getApiAdmin();
  if ("error" in actor) return actor.error;
  const userId = z.string().uuid().safeParse((await context.params).id);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!userId.success || !parsed.success) return NextResponse.json({ error: "Check each salary setting." }, { status: 400 });
  const { data: employee } = await actor.admin.from("profiles").select("id").eq("id", userId.data).neq("role", "super_admin").maybeSingle();
  if (!employee) return NextResponse.json({ error: "The employee was not found." }, { status: 404 });
  try {
    const preferences = await loadPayrollPreferences(actor.admin);
    const settings = await saveSalarySettings(actor.admin, { user_id: userId.data, ...parsed.data, pay_cycle: payrollCycleForStartDay(preferences.cycle_start_day), currency: "LKR", updated_at: new Date().toISOString(), updated_by: actor.user.id } as SalarySettings & { updated_by: string });
    return NextResponse.json({ settings });
  } catch {
    return NextResponse.json({ error: "The salary settings could not be saved." }, { status: 500 });
  }
}
