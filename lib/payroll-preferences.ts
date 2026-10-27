import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isMigrationRequired } from "@/lib/database-errors";
import type { PayrollPreferences } from "@/lib/types";

export const DEFAULT_PAYROLL_START_DAY = 15;

export async function loadPayrollPreferences(client: SupabaseClient): Promise<PayrollPreferences> {
  const result = await client.from("payroll_preferences").select("cycle_start_day,updated_at").eq("id", true).maybeSingle();
  if (result.error && !isMigrationRequired(result.error)) throw result.error;
  return result.data
    ? { cycle_start_day: Number(result.data.cycle_start_day), updated_at: result.data.updated_at }
    : { cycle_start_day: DEFAULT_PAYROLL_START_DAY };
}

export async function savePayrollPreferences(client: SupabaseClient, input: { cycleStartDay: number; updatedBy: string }) {
  const result = await client.from("payroll_preferences").upsert({
    id: true,
    cycle_start_day: input.cycleStartDay,
    updated_by: input.updatedBy,
  }, { onConflict: "id" }).select("cycle_start_day,updated_at").single();
  if (result.error) throw result.error;
  return { cycle_start_day: Number(result.data.cycle_start_day), updated_at: result.data.updated_at } satisfies PayrollPreferences;
}
