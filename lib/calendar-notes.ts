import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { isMigrationRequired } from "@/lib/database-errors";
import type { CalendarNote } from "@/lib/types";

const COMPATIBILITY_BUCKET = "presence-system";
const CALENDAR_NOTES_PATH = "calendar-notes";

function isCalendarNote(value: unknown): value is CalendarNote {
  if (!value || typeof value !== "object") return false;
  const note = value as Record<string, unknown>;
  return typeof note.id === "string"
    && typeof note.note_date === "string"
    && typeof note.title === "string"
    && (typeof note.note === "string" || note.note === null)
    && (typeof note.branch_id === "string" || note.branch_id === null)
    && typeof note.created_by === "string"
    && typeof note.created_at === "string"
    && typeof note.updated_at === "string";
}

async function ensureCompatibilityBucket() {
  const admin = createAdminClient();
  const { data } = await admin.storage.getBucket(COMPATIBILITY_BUCKET);
  if (data) return;
  const { error } = await admin.storage.createBucket(COMPATIBILITY_BUCKET, {
    public: false,
    allowedMimeTypes: ["application/json"],
    fileSizeLimit: 64 * 1024,
  });
  if (error && !/already exists/i.test(error.message)) throw error;
}

async function loadCompatibilityNotes() {
  const admin = createAdminClient();
  const { data: objects, error } = await admin.storage.from(COMPATIBILITY_BUCKET).list(CALENDAR_NOTES_PATH, {
    limit: 1_000,
    sortBy: { column: "name", order: "asc" },
  });
  if (error || !objects?.length) return [];

  const notes = await Promise.all(objects
    .filter((object) => object.name.endsWith(".json"))
    .map(async (object) => {
      const { data, error: downloadError } = await admin.storage
        .from(COMPATIBILITY_BUCKET)
        .download(`${CALENDAR_NOTES_PATH}/${object.name}`);
      if (downloadError || !data) return null;
      try {
        const parsed: unknown = JSON.parse(await data.text());
        return isCalendarNote(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }));
  return notes.filter((note): note is CalendarNote => note !== null);
}

export async function loadCalendarNotes(input: {
  startDate: string;
  endDate: string;
  branchId?: string | null;
  includeAllBranches?: boolean;
}) {
  const admin = createAdminClient();
  const [tableResult, compatibilityNotes] = await Promise.all([
    admin.from("calendar_notes")
      .select("*, branch:branches(id, name, code)")
      .gte("note_date", input.startDate)
      .lte("note_date", input.endDate)
      .order("note_date"),
    loadCompatibilityNotes(),
  ]);
  const tableNotes = tableResult.error && !isMigrationRequired(tableResult.error)
    ? []
    : (tableResult.data ?? []) as CalendarNote[];
  const byId = new Map([...tableNotes, ...compatibilityNotes].map((note) => [note.id, note]));
  return [...byId.values()]
    .filter((note) => note.note_date >= input.startDate && note.note_date <= input.endDate)
    .filter((note) => input.includeAllBranches || note.branch_id === null || note.branch_id === (input.branchId ?? null))
    .sort((first, second) => first.note_date.localeCompare(second.note_date) || first.title.localeCompare(second.title));
}

export async function saveCompatibilityCalendarNote(note: CalendarNote) {
  await ensureCompatibilityBucket();
  const admin = createAdminClient();
  const { error } = await admin.storage.from(COMPATIBILITY_BUCKET).upload(
    `${CALENDAR_NOTES_PATH}/${note.id}.json`,
    Buffer.from(JSON.stringify(note)),
    { contentType: "application/json", upsert: false },
  );
  if (error) throw error;
}

export async function removeCompatibilityCalendarNote(id: string) {
  const admin = createAdminClient();
  const { error } = await admin.storage.from(COMPATIBILITY_BUCKET).remove([
    `${CALENDAR_NOTES_PATH}/${id}.json`,
  ]);
  if (error && !/not found/i.test(error.message)) throw error;
}
