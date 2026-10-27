import { isSriLankaHoliday } from "@/lib/sri-lanka-holidays";

export function businessLeaveDays(start: string, end: string, halfDay: boolean) {
  const first = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  let count = 0;
  for (let cursor = first; cursor <= last; cursor = new Date(cursor.getTime() + 86_400_000)) {
    const day = cursor.getUTCDay();
    const date = cursor.toISOString().slice(0, 10);
    if (day !== 0 && day !== 6 && !isSriLankaHoliday(date)) count += 1;
  }
  return halfDay && start === end ? 0.5 : count;
}
