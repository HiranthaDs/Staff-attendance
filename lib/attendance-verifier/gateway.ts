import type { PostgrestError } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createCompatibilityChallenge,
  verifyCompatibilityChallenge,
} from "@/lib/attendance-verifier/compatibility-challenge";
import { defaultScheduleDay } from "@/lib/workday";
import { isSriLankaHoliday } from "@/lib/sri-lanka-holidays";
import type { LeaveRequest, WorkScheduleDay } from "@/lib/types";
import { loadCompatibilityHolidays } from "@/lib/holiday-store";

const SAFE_DATABASE_SIGNALS = new Set([
  "ATTENDANCE_BRANCH_CONFLICT",
  "ATTENDANCE_CONFLICT",
  "BRANCH_INACTIVE_OR_NOT_FOUND",
  "CHALLENGE_ALREADY_USED",
  "CHALLENGE_BINDING_MISMATCH",
  "CHALLENGE_EXPIRED",
  "CHALLENGE_IP_BINDING_MISMATCH",
  "CHALLENGE_NOT_FOUND",
  "CLIENT_IP_NETWORK_MISMATCH",
  "CLOCK_IN_REQUIRED",
  "CLOCK_IN_REQUIRED_OR_ALREADY_CLOSED",
  "EMPLOYEE_BRANCH_MISMATCH",
  "EMPLOYEE_INACTIVE_OR_NOT_FOUND",
  "EMPLOYEE_ROLE_NOT_ALLOWED",
  "GPS_DISTANCE_MISMATCH",
  "GPS_EVIDENCE_INVALID",
  "GPS_OUTSIDE_BRANCH_RADIUS",
  "IDEMPOTENCY_CONFLICT",
  "IDEMPOTENT_RECORD_NOT_FOUND",
  "IP_ALREADY_USED_BY_ANOTHER_EMPLOYEE",
  "PASSWORD_RESET_REQUIRED",
  "HOLIDAY",
  "APPROVED_LEAVE",
  "SCHEDULED_OFF",
  "PRESENCE_NOT_VERIFIED",
  "STALE_REQUEST_TIME",
]);

const MIGRATION_ERROR_CODES = new Set(["42703", "PGRST202", "PGRST204", "PGRST205"]);

function isMigrationError(error: PostgrestError | null) {
  return Boolean(error?.code && MIGRATION_ERROR_CODES.has(error.code));
}

function challengeTtlSeconds() {
  const parsed = Number(process.env.ATTENDANCE_CHALLENGE_TTL_SECONDS ?? 90);
  return Number.isInteger(parsed) && parsed >= 30 && parsed <= 300 ? parsed : 90;
}

function requiredPayloadText(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (typeof value !== "string" || !value) {
    throw new AttendanceStorageError("attendance compatibility payload is invalid", 400, "INVALID_PAYLOAD");
  }
  return value;
}

function assertCompatibilityChallenge(payload: Record<string, unknown>) {
  const userId = requiredPayloadText(payload, "p_user_id");
  const branchId = requiredPayloadText(payload, "p_branch_id");
  const action = requiredPayloadText(payload, "p_action");
  const challengeId = requiredPayloadText(payload, "p_challenge_id");
  if (action !== "clock_in" && action !== "clock_out") {
    throw new AttendanceStorageError("attendance action is invalid", 400, "INVALID_PAYLOAD");
  }
  const challengeState = verifyCompatibilityChallenge(challengeId, {
    userId,
    branchId,
    action,
  }, { ttlSeconds: challengeTtlSeconds() });
  if (challengeState === "expired") {
    throw new AttendanceStorageError("attendance compatibility challenge expired", 409, "CHALLENGE_EXPIRED");
  }
  if (challengeState !== "valid") {
    throw new AttendanceStorageError("attendance compatibility challenge is invalid", 409, "CHALLENGE_NOT_FOUND");
  }
  return { userId, branchId, action };
}

export type AttendanceProfileContext = {
  id: string;
  branch_id: string | null;
  active: boolean;
  must_reset_password: boolean;
  role: string;
  expected_arrival: string;
  expected_departure: string;
};

export type AttendanceBranchContext = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_m: number;
  timezone: string;
  max_accuracy_m: number;
  late_grace_minutes: number;
  early_leave_grace_minutes: number;
  active: boolean;
};

export type AttendanceContext = {
  profile: AttendanceProfileContext;
  branch: AttendanceBranchContext | null;
};

export type AttendanceWorkdayPolicy = {
  schedule: WorkScheduleDay;
  holidayName: string | null;
  leave: LeaveRequest | null;
};

export class AttendanceStorageError extends Error {
  constructor(
    message: string,
    public readonly status = 502,
    public readonly code?: string,
  ) {
    super(message);
  }
}

function storageError(error: PostgrestError | null, status = 502) {
  if (!error) return new AttendanceStorageError("database returned no data", status);
  const signal = SAFE_DATABASE_SIGNALS.has(error.message)
    ? error.message
    : error.code?.slice(0, 100) || undefined;
  return new AttendanceStorageError("database operation was rejected", status, signal);
}

function recordFromRpc(data: unknown) {
  const value = Array.isArray(data) ? data[0] : data;
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

export class AttendanceGateway {
  private readonly client = createAdminClient();

  async loadAttendanceContext(userId: string): Promise<AttendanceContext | null> {
    const profileResult = await this.client
      .from("profiles")
      .select("id, branch_id, active, must_reset_password, role, expected_arrival, expected_departure")
      .eq("id", userId)
      .maybeSingle();
    if (profileResult.error) throw storageError(profileResult.error, profileResult.status);
    if (!profileResult.data) return null;
    const profile = profileResult.data as AttendanceProfileContext;
    if (!profile.branch_id) return { profile, branch: null };

    let branchResult = await this.client
      .from("branches")
      .select("id, name, latitude, longitude, radius_m, timezone, max_accuracy_m, late_grace_minutes, early_leave_grace_minutes, active")
      .eq("id", profile.branch_id)
      .maybeSingle();
    if (isMigrationError(branchResult.error)) {
      const legacyBranchResult = await this.client
        .from("branches")
        .select("id, name, latitude, longitude, radius_m, timezone, max_accuracy_m, late_grace_minutes, active")
        .eq("id", profile.branch_id)
        .maybeSingle();
      branchResult = {
        ...legacyBranchResult,
        data: legacyBranchResult.data
          ? { ...legacyBranchResult.data, early_leave_grace_minutes: 0 }
          : null,
      } as typeof branchResult;
    }
    if (branchResult.error) throw storageError(branchResult.error, branchResult.status);
    return {
      profile,
      branch: branchResult.data as AttendanceBranchContext | null,
    };
  }

  async loadWorkdayPolicy(input: {
    userId: string;
    branchId: string;
    date: string;
    weekday: number;
    arrival: string;
    departure: string;
  }): Promise<AttendanceWorkdayPolicy> {
    const [scheduleResult, holidayResult, leaveResult] = await Promise.all([
      this.client.from("employee_work_schedules")
        .select("user_id,weekday,day_type,arrival_time,departure_time")
        .eq("user_id", input.userId).eq("weekday", input.weekday).maybeSingle(),
      this.client.from("company_holidays").select("name")
        .lte("holiday_date", input.date).gte("end_date", input.date).eq("status", "approved")
        .or(`branch_id.is.null,branch_id.eq.${input.branchId}`).limit(1).maybeSingle(),
      this.client.from("leave_requests").select("*")
        .eq("user_id", input.userId).eq("status", "approved")
        .lte("start_date", input.date).gte("end_date", input.date).limit(1).maybeSingle(),
    ]);
    if (scheduleResult.error && !isMigrationError(scheduleResult.error)) throw storageError(scheduleResult.error, scheduleResult.status);
    if (holidayResult.error && !isMigrationError(holidayResult.error)) throw storageError(holidayResult.error, holidayResult.status);
    if (leaveResult.error) throw storageError(leaveResult.error, leaveResult.status);
    const compatibilityHoliday = holidayResult.error && isMigrationError(holidayResult.error)
      ? (await loadCompatibilityHolidays()).find((holiday) => holiday.status === "approved"
        && holiday.holiday_date <= input.date && (holiday.end_date || holiday.holiday_date) >= input.date
        && (holiday.branch_id === null || holiday.branch_id === input.branchId))
      : null;
    return {
      schedule: (scheduleResult.data as WorkScheduleDay | null)
        ?? defaultScheduleDay(input.weekday, input.arrival, input.departure, "half_day", "off", input.userId),
      holidayName: holidayResult.data?.name ?? compatibilityHoliday?.name ?? (isSriLankaHoliday(input.date) ? "Sri Lanka public holiday" : null),
      leave: (leaveResult.data as LeaveRequest | null) ?? null,
    };
  }

  async insertChallenge(input: {
    userId: string;
    branchId: string;
    action: "clock_in" | "clock_out";
    expiresAt: Date;
  }) {
    const challengeId = crypto.randomUUID();
    const result = await this.client.from("attendance_challenges").insert({
      id: challengeId,
      user_id: input.userId,
      branch_id: input.branchId,
      action: input.action,
      request_id: challengeId,
      ip_hash: null,
      expires_at: input.expiresAt.toISOString(),
    }).select("id, expires_at").single();
    if (isMigrationError(result.error)) {
      const ttlSeconds = challengeTtlSeconds();
      const issuedAt = new Date(input.expiresAt.getTime() - ttlSeconds * 1_000);
      try {
        return {
          id: createCompatibilityChallenge({
            userId: input.userId,
            branchId: input.branchId,
            action: input.action,
          }, issuedAt),
          expires_at: input.expiresAt.toISOString(),
        };
      } catch {
        throw new AttendanceStorageError("attendance compatibility challenge could not be created", 503, "SERVER_CONFIG");
      }
    }
    if (result.error || !result.data) throw storageError(result.error, result.status);
    return result.data as { id: string; expires_at: string };
  }

  async recordMark(payload: Record<string, unknown>, attendanceDate: string) {
    const result = await this.client.rpc("record_attendance_mark_v2", payload);
    if (isMigrationError(result.error)) {
      const { userId, branchId, action } = assertCompatibilityChallenge(payload);

      const legacyResult = await this.client.rpc("record_attendance_mark", {
        p_user_id: userId,
        p_branch_id: branchId,
        p_attendance_date: attendanceDate,
        p_action: action,
        p_now: payload.p_now,
        p_latitude: payload.p_latitude,
        p_longitude: payload.p_longitude,
        p_accuracy_m: payload.p_accuracy_m,
        p_distance_m: payload.p_distance_m,
        p_client_ip: null,
        p_gps_passed: payload.p_gps_passed,
        p_ip_passed: payload.p_ip_passed,
        p_status: payload.p_status,
        p_late_minutes: payload.p_late_minutes,
        p_early_leave_minutes: payload.p_early_leave_minutes,
      });
      if (legacyResult.error) throw storageError(legacyResult.error, legacyResult.status);
      const legacyData = recordFromRpc(legacyResult.data);
      if (!legacyData) throw new AttendanceStorageError("attendance function returned an invalid response");
      return legacyData;
    }
    if (result.error) throw storageError(result.error, result.status);
    const data = recordFromRpc(result.data);
    if (!data) throw new AttendanceStorageError("attendance function returned an invalid response");
    return data;
  }

  async recordDenial(payload: Record<string, unknown>) {
    const result = await this.client.rpc("record_attendance_denial_v2", payload);
    if (isMigrationError(result.error)) {
      assertCompatibilityChallenge(payload);
      const legacyResult = await this.client.from("attendance_attempts").insert({
        user_id: payload.p_user_id,
        branch_id: payload.p_branch_id,
        action: payload.p_action,
        allowed: false,
        reason: typeof payload.p_reason === "string" ? payload.p_reason.slice(0, 500) : "Attendance verification failed",
        latitude: payload.p_latitude,
        longitude: payload.p_longitude,
        accuracy_m: payload.p_accuracy_m,
        distance_m: payload.p_distance_m,
        client_ip: payload.p_client_ip,
        gps_passed: Boolean(payload.p_gps_passed),
        ip_passed: Boolean(payload.p_ip_passed),
      });
      if (legacyResult.error) throw storageError(legacyResult.error, legacyResult.status);
      return;
    }
    if (result.error) throw storageError(result.error, result.status);
  }
}
