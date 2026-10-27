export const APP_NAME = "Presence";
export const APP_DESCRIPTION = "Secure, effortless office attendance.";
export const DEFAULT_TIMEZONE = "Asia/Colombo";

export const roleLabels = {
  super_admin: "Super admin",
  branch_admin: "Branch admin",
  staff: "Staff",
} as const;

export const verificationModeLabels = {
  gps_only: "Location only",
  gps_or_ip: "Flexible · Location or office IP",
  gps_and_ip: "Required · Location + office IP",
} as const;

export const verificationModeHelp = {
  gps_only: "The employee can mark attendance when their verified device location is anywhere inside the branch radius.",
  gps_or_ip: "Attendance passes with either a verified location inside the radius or the approved office public IP.",
  gps_and_ip: "Attendance passes only when both the verified location and approved office public IP match.",
} as const;
