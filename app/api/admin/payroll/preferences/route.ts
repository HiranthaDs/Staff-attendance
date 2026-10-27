import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiAdmin } from "@/lib/api-auth";
import { isTrustedMutationOrigin } from "@/lib/attendance-backend";
import { databaseMutationError } from "@/lib/database-errors";
import { loadPayrollPreferences, savePayrollPreferences } from "@/lib/payroll-preferences";

export async function GET() {
  const actor = await getApiAdmin();
  if ("error" in actor) return actor.error;
  try {
    return NextResponse.json({ preferences: await loadPayrollPreferences(actor.admin) });
  } catch (error) {
    return databaseMutationError(error && typeof error === "object" ? error as { code?: string | null } : null, "Payroll cycle settings could not be loaded.");
  }
}

export async function PATCH(request: Request) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const actor = await getApiAdmin();
  if ("error" in actor) return actor.error;
  const parsed = z.object({ cycle_start_day: z.coerce.number().int().min(1).max(28) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a payroll start date from 1 to 28." }, { status: 400 });
  try {
    const preferences = await savePayrollPreferences(actor.admin, { cycleStartDay: parsed.data.cycle_start_day, updatedBy: actor.user.id });
    return NextResponse.json({ preferences });
  } catch (error) {
    return databaseMutationError(error && typeof error === "object" ? error as { code?: string | null } : null, "Payroll cycle settings could not be saved.");
  }
}
