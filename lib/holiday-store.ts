import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { CompanyHoliday } from "@/lib/types";

const BUCKET = "presence-system";
const FOLDER = "holidays";

function isHoliday(value: unknown): value is CompanyHoliday {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<CompanyHoliday>;
  return typeof item.id === "string" && typeof item.holiday_date === "string" && typeof item.name === "string" && typeof item.status === "string";
}

async function ensureBucket() {
  const admin = createAdminClient();
  const { data } = await admin.storage.getBucket(BUCKET);
  if (data) return;
  const { error } = await admin.storage.createBucket(BUCKET, { public: false, allowedMimeTypes: ["application/json"], fileSizeLimit: 128 * 1024 });
  if (error && !/already exists/i.test(error.message)) throw error;
}

export async function loadCompatibilityHolidays() {
  const admin = createAdminClient();
  const { data: objects, error } = await admin.storage.from(BUCKET).list(FOLDER, { limit: 1_000, sortBy: { column: "name", order: "asc" } });
  if (error || !objects?.length) return [];
  const rows = await Promise.all(objects.filter((item) => item.name.endsWith(".json")).map(async (item) => {
    const { data } = await admin.storage.from(BUCKET).download(`${FOLDER}/${item.name}`);
    if (!data) return null;
    try {
      const parsed: unknown = JSON.parse(await data.text());
      if (!isHoliday(parsed)) return null;
      return { ...parsed, end_date: parsed.end_date || parsed.holiday_date } as CompanyHoliday;
    } catch { return null; }
  }));
  return rows.filter((row): row is CompanyHoliday => row !== null);
}

export async function saveCompatibilityHoliday(holiday: CompanyHoliday) {
  await ensureBucket();
  const admin = createAdminClient();
  const { error } = await admin.storage.from(BUCKET).upload(`${FOLDER}/${holiday.id}.json`, Buffer.from(JSON.stringify(holiday)), { contentType: "application/json", upsert: true });
  if (error) throw error;
  return holiday;
}
