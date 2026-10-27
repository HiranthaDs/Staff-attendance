import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMigrationRequired } from "@/lib/database-errors";
import type { PayrollRecord, SalarySettings } from "@/lib/types";

const BUCKET = "presence-system";

async function ensureBucket() {
  const admin = createAdminClient();
  const { data } = await admin.storage.getBucket(BUCKET);
  if (data) return;
  const { error } = await admin.storage.createBucket(BUCKET, { public: false, allowedMimeTypes: ["application/json"], fileSizeLimit: 256 * 1024 });
  if (error && !/already exists/i.test(error.message)) throw error;
}

async function loadFolder<T>(folder: string, check: (value: unknown) => value is T): Promise<T[]> {
  const admin = createAdminClient();
  const { data: objects, error } = await admin.storage.from(BUCKET).list(folder, { limit: 2_000, sortBy: { column: "name", order: "asc" } });
  if (error || !objects?.length) return [];
  const values: Array<T | null> = await Promise.all(objects.filter((item) => item.name.endsWith(".json")).map(async (item): Promise<T | null> => {
    const { data } = await admin.storage.from(BUCKET).download(`${folder}/${item.name}`);
    if (!data) return null;
    try { const parsed: unknown = JSON.parse(await data.text()); return check(parsed) ? parsed : null; } catch { return null; }
  }));
  const valid: T[] = [];
  for (const value of values) if (value !== null) valid.push(value);
  return valid;
}

async function saveFile<T>(folder: string, name: string, value: T) {
  await ensureBucket();
  const admin = createAdminClient();
  const { error } = await admin.storage.from(BUCKET).upload(`${folder}/${name}.json`, Buffer.from(JSON.stringify(value)), { contentType: "application/json", upsert: true });
  if (error) throw error;
  return value;
}

function isSalarySettings(value: unknown): value is SalarySettings {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<SalarySettings>;
  return typeof row.user_id === "string" && typeof row.basic_salary === "number" && typeof row.pay_cycle === "string";
}

function isPayrollRecord(value: unknown): value is PayrollRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<PayrollRecord>;
  return typeof row.id === "string" && typeof row.user_id === "string" && typeof row.period_start === "string" && typeof row.net_pay === "number";
}

export async function loadSalarySettings(client: SupabaseClient, userIds: string[]) {
  if (!userIds.length) return [];
  const [table, compatibility] = await Promise.all([
    client.from("salary_settings").select("*").in("user_id", userIds),
    loadFolder("salary-settings", isSalarySettings),
  ]);
  if (table.error && !isMigrationRequired(table.error)) throw table.error;
  const merged = new Map<string, SalarySettings>();
  for (const row of compatibility.filter((item) => userIds.includes(item.user_id))) merged.set(row.user_id, row);
  for (const row of (table.data ?? []) as SalarySettings[]) merged.set(row.user_id, row);
  return [...merged.values()];
}

export async function saveSalarySettings(client: SupabaseClient, settings: SalarySettings & { updated_by?: string }) {
  const result = await client.from("salary_settings").upsert(settings, { onConflict: "user_id" }).select("*").single();
  if (!result.error) return result.data as SalarySettings;
  if (!isMigrationRequired(result.error)) throw result.error;
  return saveFile("salary-settings", settings.user_id, settings);
}

export async function loadPayrollRecords(client: SupabaseClient, input: { userIds: string[]; start?: string; end?: string; staffVisibleOnly?: boolean }) {
  if (!input.userIds.length) return [];
  let query = client.from("payroll_records").select("*").in("user_id", input.userIds).order("period_end", { ascending: false });
  if (input.start) query = query.gte("period_end", input.start);
  if (input.end) query = query.lte("period_start", input.end);
  if (input.staffVisibleOnly) query = query.in("status", ["finalized", "paid"]);
  const [table, compatibility] = await Promise.all([query, loadFolder("payroll-records", isPayrollRecord)]);
  if (table.error && !isMigrationRequired(table.error)) throw table.error;
  const relevant = compatibility.filter((row) => input.userIds.includes(row.user_id)
    && (!input.start || row.period_end >= input.start) && (!input.end || row.period_start <= input.end)
    && (!input.staffVisibleOnly || row.status === "finalized" || row.status === "paid"));
  const merged = new Map<string, PayrollRecord>();
  for (const row of relevant) merged.set(`${row.user_id}:${row.period_start}:${row.period_end}`, row);
  for (const row of (table.data ?? []) as PayrollRecord[]) merged.set(`${row.user_id}:${row.period_start}:${row.period_end}`, row);
  return [...merged.values()].sort((a, b) => b.period_end.localeCompare(a.period_end));
}

export async function savePayrollRecord(client: SupabaseClient, record: PayrollRecord & { generated_by?: string }) {
  const result = await client.from("payroll_records").upsert(record, { onConflict: "user_id,period_start,period_end" }).select("*").single();
  if (!result.error) return result.data as PayrollRecord;
  if (!isMigrationRequired(result.error)) throw result.error;
  return saveFile("payroll-records", record.id, record);
}
