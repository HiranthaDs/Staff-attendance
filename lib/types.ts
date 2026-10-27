export type AppRole = "super_admin" | "branch_admin" | "staff";

export type Profile = {
  id: string;
  full_name: string;
  email?: string;
  phone: string | null;
  role: AppRole;
  branch_id: string | null;
  job_title: string | null;
  employee_code: string | null;
  expected_arrival: string;
  expected_departure: string;
  monthly_leave_days: number;
  annual_leave_days: number;
  must_reset_password: boolean;
  active: boolean;
  created_at?: string;
  branch?: Branch | null;
  work_schedule?: WorkScheduleDay[];
};

export type WorkdayType = "full_day" | "half_day" | "off";

export type WorkScheduleDay = {
  user_id: string;
  weekday: number;
  day_type: WorkdayType;
  arrival_time: string;
  departure_time: string;
};

export type Branch = {
  id: string;
  name: string;
  code: string;
  address: string;
  latitude: number;
  longitude: number;
  radius_m: number;
  timezone: string;
  verification_mode: "gps_only";
  max_accuracy_m: number;
  late_grace_minutes: number;
  early_leave_grace_minutes: number;
  active: boolean;
};

export type CalendarNote = {
  id: string;
  note_date: string;
  title: string;
  note: string | null;
  branch_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  branch?: Pick<Branch, "id" | "name" | "code"> | null;
};

export type CompanyHoliday = {
  id: string;
  holiday_date: string;
  end_date: string;
  name: string;
  holiday_type: "poya" | "public" | "company" | "special";
  branch_id: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  source: "official" | "admin" | "staff";
  source_reference: string | null;
  reason: string | null;
  proposed_by: string | null;
  reviewed_by: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
  branch?: Pick<Branch, "id" | "name" | "code"> | null;
  proposer?: Pick<Profile, "full_name" | "employee_code"> | null;
};

export type PayCycle = "calendar_month" | "fifteenth_cycle" | "custom_cycle";

export type PayrollPreferences = {
  cycle_start_day: number;
  updated_at?: string;
};

export type SalarySettings = {
  user_id: string;
  basic_salary: number;
  fixed_allowances: number;
  pay_cycle: PayCycle;
  epf_enabled: boolean;
  currency: "LKR";
  updated_at: string;
};

export type PayrollSummary = {
  period_start: string;
  period_end: string;
  calendar_days: number;
  scheduled_days: number;
  attendance_days: number;
  attendance_units: number;
  full_leave_days: number;
  paid_leave_days: number;
  unpaid_leave_days: number;
  short_leave_count: number;
  short_leave_days: number;
  absent_days: number;
  holiday_days: number;
  off_days: number;
  late_minutes: number;
  early_leave_minutes: number;
  worked_minutes: number;
};

export type PayrollRecord = PayrollSummary & {
  id: string;
  user_id: string;
  cycle_label: string;
  basic_salary: number;
  fixed_allowances: number;
  other_earnings: number;
  attendance_deduction: number;
  other_deductions: number;
  employee_epf: number;
  employer_epf: number;
  employer_etf: number;
  gross_pay: number;
  net_pay: number;
  currency: "LKR";
  status: "draft" | "finalized" | "paid";
  notes: string | null;
  finalized_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AttendanceRecord = {
  id: string;
  user_id: string;
  branch_id: string;
  attendance_date: string;
  clock_in: string | null;
  clock_out: string | null;
  status: "present" | "late" | "partial";
  work_minutes: number | null;
  late_minutes: number;
  early_leave_minutes: number;
  clock_in_distance_m: number | null;
  clock_out_distance_m: number | null;
  profile?: Pick<Profile, "full_name" | "employee_code" | "branch_id">;
  branch?: Pick<Branch, "name" | "code">;
};

export type MissedAttendance = {
  id: string;
  user_id: string;
  branch_id: string;
  attendance_date: string;
  absence_units: number;
  scheduled_arrival: string;
  scheduled_departure: string;
  reason: "missed_attendance";
  acknowledged_at: string | null;
  created_at: string;
};

export type SupportIssue = {
  id: string;
  reporter_id: string;
  category: "attendance" | "location" | "leave" | "schedule" | "payroll" | "app" | "other";
  message: string;
  context: Record<string, unknown>;
  status: "open" | "resolved";
  resolved_at: string | null;
  created_at: string;
  reporter?: Pick<Profile, "full_name" | "employee_code"> | null;
};

export type LeaveRequest = {
  id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  leave_type: "annual" | "monthly" | "medical" | "unpaid";
  portion: "full_day" | "first_half" | "second_half";
  requested_days: number;
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  admin_note: string | null;
  created_at: string;
  profile?: Pick<Profile, "full_name" | "employee_code">;
};

export type BranchSetupInvite = {
  id: string;
  proposed_name: string;
  proposed_code: string;
  radius_m: number;
  verification_mode: Branch["verification_mode"];
  status: "pending" | "submitted" | "approved" | "revoked" | "expired";
  expires_at: string;
  created_at: string;
  submitted_at: string | null;
  approved_at: string | null;
};

export type BranchSetupSubmission = {
  id: string;
  invite_id: string;
  address: string;
  latitude: number;
  longitude: number;
  accuracy_m: number;
  captured_at: string;
  public_ip: string;
  wifi_name: string;
  connection_type: string | null;
  effective_type: string | null;
  downlink_mbps: number | null;
  rtt_ms: number | null;
  save_data: boolean | null;
  device_info: Record<string, unknown>;
  manager_name: string;
  manager_phone: string;
  notes: string | null;
  created_branch_id: string | null;
  submitted_at: string;
  invite?: BranchSetupInvite;
};

export type AppNotification = {
  id: string;
  kind: "attendance" | "calendar" | "leave" | "account" | "system";
  title: string;
  body: string;
  action_url: string;
  read_at: string | null;
  created_at: string;
};

export type NotificationPreferences = {
  push_enabled: boolean;
  attendance_reminders: boolean;
  leave_updates: boolean;
  calendar_updates: boolean;
  reminder_minutes: number;
};
