export const APP_NAME = "Presence";
export const APP_DESCRIPTION = "Secure, effortless office attendance.";
export const DEFAULT_TIMEZONE = "Asia/Colombo";

export const roleLabels = {
  super_admin: "Super admin",
  branch_admin: "Branch admin",
  staff: "Staff",
} as const;

export const verificationModeLabels = {
  gps_and_ip: "Strict · GPS + office public IP",
  gps_or_ip: "Flexible · GPS or office public IP",
  gps_only: "GPS only",
} as const;
