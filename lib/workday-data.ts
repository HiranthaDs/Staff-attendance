import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isMigrationRequired } from "@/lib/database-errors";
import { sriLankaHolidaysForRange } from "@/lib/sri-lanka-holidays";
import { defaultScheduleDay } from "@/lib/workday";
import type { CompanyHoliday, WorkScheduleDay } from "@/lib/types";
import { loadCompatibilityHolidays } from "@/lib/holiday-store";

export async function loadWorkSchedule(
  client: SupabaseClient,
  input: { userId: string; arrival?: string; departure?: string },
) {
  const result = await client.from("employee_work_schedules").select("user_id,weekday,day_type,arrival_time,departure_time").eq("user_id", input.userId).order("weekday");
  if (!result.error) return (result.data ?? []) as WorkScheduleDay[];
  if (!isMigrationRequired(result.error)) throw result.error;
  return Array.from({ length: 7 }, (_, index) => defaultScheduleDay(index + 1, input.arrival, input.departure, "half_day", "off", input.userId));
}

export async function loadCompanyHolidays(
  client: SupabaseClient,
  input: { startDate: string; endDate: string; branchId?: string | null; includePending?: boolean; includeAllBranches?: boolean },
) {
  let query = client.from("company_holidays")
    .select("*, branch:branches(id,name,code), proposer:profiles!company_holidays_proposed_by_fkey(full_name,employee_code)")
    .lte("holiday_date", input.endDate)
    .gte("end_date", input.startDate)
    .order("holiday_date");
  query = input.includePending ? query.in("status", ["approved", "pending"]) : query.eq("status", "approved");
  const [result, compatibilityRows] = await Promise.all([query, loadCompatibilityHolidays()]);
  let rows: CompanyHoliday[] = [];
  if (!result.error) rows = (result.data ?? []) as unknown as CompanyHoliday[];
  else if (!isMigrationRequired(result.error)) throw result.error;

  const officialFallback: CompanyHoliday[] = sriLankaHolidaysForRange(input.startDate, input.endDate).map((holiday, index) => ({
    id: `official-${holiday.date}-${index}`,
    holiday_date: holiday.date,
    end_date: holiday.date,
    name: holiday.name,
    holiday_type: holiday.kind,
    branch_id: null,
    status: "approved",
    source: "official",
    source_reference: null,
    reason: null,
    proposed_by: null,
    reviewed_by: null,
    review_note: null,
    created_at: `${holiday.date}T00:00:00.000Z`,
    updated_at: `${holiday.date}T00:00:00.000Z`,
  }));
  const merged = new Map<string, CompanyHoliday>();
  for (const holiday of [...officialFallback, ...compatibilityRows, ...rows]) {
    const normalized = { ...holiday, end_date: holiday.end_date || holiday.holiday_date };
    if (normalized.holiday_date > input.endDate || normalized.end_date < input.startDate) continue;
    if (!input.includePending && normalized.status !== "approved") continue;
    if (input.includePending && normalized.status !== "approved" && normalized.status !== "pending") continue;
    merged.set(`${normalized.holiday_date}:${normalized.name}:${normalized.branch_id ?? "all"}`, normalized);
  }
  return [...merged.values()]
    .filter((holiday) => input.includeAllBranches || holiday.branch_id === null || holiday.branch_id === (input.branchId ?? null))
    .sort((first, second) => first.holiday_date.localeCompare(second.holiday_date) || first.name.localeCompare(second.name));
}
