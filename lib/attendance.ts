export { distanceInMeters, evaluatePresence } from "./geofence.ts";

export function calculateAttendanceTiming(input: {
  currentMinutes: number;
  arrivalMinutes: number;
  departureMinutes: number;
  lateGraceMinutes: number;
  earlyLeaveGraceMinutes: number;
}) {
  return {
    lateMinutes: Math.max(0, input.currentMinutes - input.arrivalMinutes - input.lateGraceMinutes),
    earlyLeaveMinutes: Math.max(0, input.departureMinutes - input.currentMinutes - input.earlyLeaveGraceMinutes),
  };
}

export function localDateParts(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const year = get("year");
  const month = get("month");
  const day = get("day");
  return {
    date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    minutes: get("hour") * 60 + get("minute"),
  };
}

export function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}
