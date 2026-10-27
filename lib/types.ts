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
  branch?: Branch | null;
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
  verification_mode: "gps_and_ip" | "gps_or_ip" | "gps_only";
  max_accuracy_m: number;
  late_grace_minutes: number;
  early_leave_grace_minutes: number;
  active: boolean;
  branch_networks?: BranchNetwork[];
};

export type BranchNetwork = {
  id: string;
  branch_id: string;
  label: string;
  ip_rule: string;
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
