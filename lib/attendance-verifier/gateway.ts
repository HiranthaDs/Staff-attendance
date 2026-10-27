import type { PostgrestError } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

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
  "PRESENCE_NOT_VERIFIED",
  "STALE_REQUEST_TIME",
]);

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
  verification_mode: "gps_and_ip" | "gps_or_ip" | "gps_only";
  max_accuracy_m: number;
  late_grace_minutes: number;
  active: boolean;
};

export type AttendanceNetworkContext = {
  id: string;
  branch_id: string;
  label: string;
  ip_rule: string;
  active: boolean;
};

export type AttendanceContext = {
  profile: AttendanceProfileContext;
  branch: AttendanceBranchContext | null;
  networks: AttendanceNetworkContext[];
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
    if (!profile.branch_id) return { profile, branch: null, networks: [] };

    const [branchResult, networkResult] = await Promise.all([
      this.client
        .from("branches")
        .select("id, name, latitude, longitude, radius_m, timezone, verification_mode, max_accuracy_m, late_grace_minutes, active")
        .eq("id", profile.branch_id)
        .maybeSingle(),
      this.client
        .from("branch_networks")
        .select("id, branch_id, label, ip_rule, active")
        .eq("branch_id", profile.branch_id)
        .eq("active", true),
    ]);
    if (branchResult.error) throw storageError(branchResult.error, branchResult.status);
    if (networkResult.error) throw storageError(networkResult.error, networkResult.status);
    return {
      profile,
      branch: branchResult.data as AttendanceBranchContext | null,
      networks: (networkResult.data ?? []) as AttendanceNetworkContext[],
    };
  }

  async insertChallenge(input: {
    userId: string;
    branchId: string;
    action: "clock_in" | "clock_out";
    ipHash: string | null;
    expiresAt: Date;
  }) {
    const challengeId = crypto.randomUUID();
    const result = await this.client.from("attendance_challenges").insert({
      id: challengeId,
      user_id: input.userId,
      branch_id: input.branchId,
      action: input.action,
      request_id: challengeId,
      ip_hash: input.ipHash,
      expires_at: input.expiresAt.toISOString(),
    }).select("id, expires_at").single();
    if (result.error || !result.data) throw storageError(result.error, result.status);
    return result.data as { id: string; expires_at: string };
  }

  async recordMark(payload: Record<string, unknown>) {
    const result = await this.client.rpc("record_attendance_mark_v2", payload);
    if (result.error) throw storageError(result.error, result.status);
    const data = recordFromRpc(result.data);
    if (!data) throw new AttendanceStorageError("attendance function returned an invalid response");
    return data;
  }

  async recordDenial(payload: Record<string, unknown>) {
    const result = await this.client.rpc("record_attendance_denial_v2", payload);
    if (result.error) throw storageError(result.error, result.status);
  }
}
