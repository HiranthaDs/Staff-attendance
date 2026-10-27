import { calculateAttendanceTiming, localDateParts, timeToMinutes } from "@/lib/attendance";
import { AttendanceGateway, type AttendanceContext, type AttendanceWorkdayPolicy } from "@/lib/attendance-verifier/gateway";
import { isoWeekday } from "@/lib/workday";
import { buildConsensus, distanceM, evaluateGeofence, GpsEvidenceError, type GpsConsensus, type LocationEvidenceSample } from "@/lib/attendance-verifier/gps";

const POLICY_VERSION = "2026-10-27.v6-location-consensus";

export type AttendanceAction = "clock_in" | "clock_out";

export type AttendanceEnvelope = {
  actorUserId: string;
  action: AttendanceAction;
  userAgent: string | null;
};

export type AttendanceMarkInput = AttendanceEnvelope & {
  challengeId: string;
  clientRequestId: string;
  captureStartedAt: string;
  captureEndedAt: string;
  samples: Array<LocationEvidenceSample & {
    altitude?: number | null;
    altitudeAccuracy?: number | null;
    heading?: number | null;
    speed?: number | null;
  }>;
};

export type VerificationChecks = {
  gps: boolean;
  distanceM: number | null;
  radiusM: number;
  accuracyM: number | null;
  maxAccuracyM: number;
  consensusCount: number;
  sampleCount: number;
  sampleSpanMs: number;
  spreadM: number;
  gpsMethod: "precise" | "standard" | "none";
  verificationMethod: "location" | "none";
  policyVersion: string;
};

export class AttendanceServiceError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = "INVALID_REQUEST",
  ) {
    super(message);
  }
}

function requireActiveContext(context: AttendanceContext | null, userId: string) {
  if (!context || context.profile.id !== userId) {
    throw new AttendanceServiceError("Employee profile was not found.", 404, "PROFILE_NOT_FOUND");
  }
  if (!context.profile.active) throw new AttendanceServiceError("This account is not active.", 403, "ACCOUNT_INACTIVE");
  if (context.profile.role === "super_admin") throw new AttendanceServiceError("Attendance is available to employee accounts only.", 403, "ROLE_NOT_ALLOWED");
  if (context.profile.must_reset_password) {
    throw new AttendanceServiceError("Reset the temporary password before marking attendance.", 403, "PASSWORD_RESET_REQUIRED");
  }
  if (!context.branch) throw new AttendanceServiceError("No branch is assigned to this account.", 409, "BRANCH_REQUIRED");
  if (!context.branch.active) throw new AttendanceServiceError("The assigned branch is inactive.", 403, "BRANCH_INACTIVE");
  return context as AttendanceContext & { branch: NonNullable<AttendanceContext["branch"]> };
}

function boundedInteger(name: string, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(process.env[name] ?? fallback);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

export async function createAttendanceChallenge(
  request: AttendanceEnvelope,
  gateway = new AttendanceGateway(),
  now = new Date(),
) {
  const context = requireActiveContext(await gateway.loadAttendanceContext(request.actorUserId), request.actorUserId);
  const localDate = localDateParts(now, context.branch.timezone).date;
  const workday = await gateway.loadWorkdayPolicy({
    userId: request.actorUserId,
    branchId: context.branch.id,
    date: localDate,
    weekday: isoWeekday(localDate),
    arrival: context.profile.expected_arrival,
    departure: context.profile.expected_departure,
  });
  requireMarkableWorkday(request.action, workday);
  const ttlSeconds = boundedInteger("ATTENDANCE_CHALLENGE_TTL_SECONDS", 90, 30, 300);
  const result = await gateway.insertChallenge({
    userId: request.actorUserId,
    branchId: context.branch.id,
    action: request.action,
    expiresAt: new Date(now.getTime() + ttlSeconds * 1_000),
  });
  const normalAccuracy = context.branch.max_accuracy_m;
  return {
    challenge_id: result.id,
    expires_at: result.expires_at,
    minimum_samples: 3,
    minimum_sample_span_ms: 2_000,
    maximum_samples: 20,
    maximum_accuracy_m: Math.max(200, normalAccuracy),
  };
}

export async function markAttendance(
  request: AttendanceMarkInput,
  gateway = new AttendanceGateway(),
  now = new Date(),
) {
  const context = requireActiveContext(await gateway.loadAttendanceContext(request.actorUserId), request.actorUserId);
  const branch = context.branch;
  const attendanceDate = localDateParts(now, branch.timezone).date;
  const workday = await gateway.loadWorkdayPolicy({
    userId: request.actorUserId,
    branchId: branch.id,
    date: attendanceDate,
    weekday: isoWeekday(attendanceDate),
    arrival: context.profile.expected_arrival,
    departure: context.profile.expected_departure,
  });
  requireMarkableWorkday(request.action, workday);

  let consensus: GpsConsensus | null = null;
  if (request.samples.length) {
    validateCaptureWindow(request);
    try {
      consensus = buildConsensus(request.samples, { now, minimumSamples: 3, minimumSpanMs: 2_000 });
    } catch (error) {
      if (!(error instanceof GpsEvidenceError)) throw error;
      await gateway.recordDenial(invalidGpsDenialPayload({ request, branchId: branch.id, now, reason: error.message }));
      throw new AttendanceServiceError("A fresh location could not be verified. Enable precise location and try again.", 403, "GPS_EVIDENCE_REJECTED");
    }
  } else {
    throw new AttendanceServiceError("Live location is required to mark attendance.", 403, "GPS_EVIDENCE_REQUIRED");
  }

  const distance = consensus ? distanceM(branch.latitude, branch.longitude, consensus.latitude, consensus.longitude) : null;
  const gps = consensus ? evaluateGeofence({
    distanceFromBranchM: distance!,
    effectiveAccuracyM: consensus.effectiveAccuracyM,
    radiusM: branch.radius_m,
    maxAccuracyM: branch.max_accuracy_m,
  }) : { allowed: false, method: "none" as const, reason: "Live location is unavailable." };
  const allowed = gps.allowed;

  const checks: VerificationChecks = {
    gps: gps.allowed,
    distanceM: distance === null ? null : Math.round(distance),
    radiusM: branch.radius_m,
    accuracyM: consensus ? Math.round(consensus.effectiveAccuracyM) : null,
    maxAccuracyM: branch.max_accuracy_m,
    consensusCount: consensus?.consensusCount ?? 0,
    sampleCount: consensus?.sampleCount ?? 0,
    sampleSpanMs: consensus?.sampleSpanMs ?? 0,
    spreadM: consensus ? Math.round(consensus.spreadM) : 0,
    gpsMethod: gps.method === "precise_radius" ? "precise" : gps.method === "standard_radius" ? "standard" : "none",
    verificationMethod: gps.allowed ? "location" : "none",
    policyVersion: POLICY_VERSION,
  };
  const common = rpcPayload({ request, context, consensus, checks, now, workday });

  if (!allowed) {
    const reason = gps.reason;
    await gateway.recordDenial({ ...common, p_reason: reason });
    throw new AttendanceServiceError(reason, 403, "PRESENCE_NOT_VERIFIED");
  }

  const result = await gateway.recordMark(common, attendanceDate);
  const possibleRecord = result.record;
  const record = possibleRecord && typeof possibleRecord === "object"
    ? possibleRecord as Record<string, unknown>
    : result;
  return {
    success: true,
    message: request.action === "clock_in" ? "You're clocked in." : "You're clocked out.",
    record,
    checks,
  };
}

function requireMarkableWorkday(action: AttendanceAction, workday: AttendanceWorkdayPolicy) {
  if (action === "clock_out") return;
  if (workday.holidayName) {
    throw new AttendanceServiceError(`Today is ${workday.holidayName}. Attendance is not required.`, 409, "HOLIDAY");
  }
  if (workday.leave?.portion === "full_day") {
    throw new AttendanceServiceError("You have approved full-day leave today. Attendance is not required.", 409, "APPROVED_LEAVE");
  }
  if (workday.schedule.day_type === "off") {
    throw new AttendanceServiceError("Today is a scheduled off day. Attendance is not required.", 409, "SCHEDULED_OFF");
  }
}

function validateCaptureWindow(request: AttendanceMarkInput) {
  const started = new Date(request.captureStartedAt);
  const ended = new Date(request.captureEndedAt);
  if (!Number.isFinite(started.getTime()) || !Number.isFinite(ended.getTime())) {
    throw new AttendanceServiceError("The location capture time is invalid.", 400, "INVALID_PAYLOAD");
  }
  const durationMs = ended.getTime() - started.getTime();
  if (durationMs < 0 || durationMs > 120_000) {
    throw new AttendanceServiceError("The location capture duration is invalid.", 400, "INVALID_PAYLOAD");
  }
  const times = request.samples.map((sample) => new Date(sample.capturedAt).getTime());
  if (times.some((time) => !Number.isFinite(time))) {
    throw new AttendanceServiceError("A location sample has an invalid time.", 400, "INVALID_PAYLOAD");
  }
  if (Math.min(...times) < started.getTime() - 5_000 || Math.max(...times) > ended.getTime() + 5_000) {
    throw new AttendanceServiceError("Location samples do not match the capture window.", 400, "INVALID_PAYLOAD");
  }
}

function rpcPayload(input: {
  request: AttendanceMarkInput;
  context: AttendanceContext & { branch: NonNullable<AttendanceContext["branch"]> };
  consensus: GpsConsensus | null;
  checks: VerificationChecks;
  now: Date;
  workday: AttendanceWorkdayPolicy;
}) {
  let currentMinutes: number;
  try {
    currentMinutes = localDateParts(input.now, input.context.branch.timezone).minutes;
  } catch {
    throw new AttendanceServiceError("The branch timezone is invalid.", 500, "BRANCH_CONFIG");
  }
  const arrival = timeToMinutes(input.workday.schedule.arrival_time);
  const departure = timeToMinutes(input.workday.schedule.departure_time);
  if (![arrival, departure].every(Number.isFinite)) {
    throw new AttendanceServiceError("Employee work hours are invalid.", 500, "PROFILE_CONFIG");
  }
  const { lateMinutes, earlyLeaveMinutes } = calculateAttendanceTiming({
    currentMinutes,
    arrivalMinutes: arrival,
    departureMinutes: departure,
    lateGraceMinutes: input.context.branch.late_grace_minutes,
    earlyLeaveGraceMinutes: input.context.branch.early_leave_grace_minutes ?? 0,
  });
  return {
    p_user_id: input.request.actorUserId,
    p_branch_id: input.context.branch.id,
    p_action: input.request.action,
    p_now: input.now.toISOString(),
    p_request_id: input.request.challengeId,
    p_challenge_id: input.request.challengeId,
    p_latitude: input.consensus?.latitude ?? null,
    p_longitude: input.consensus?.longitude ?? null,
    p_accuracy_m: input.checks.accuracyM,
    p_distance_m: input.checks.distanceM,
    p_client_ip: null,
    p_ip_source: "location_only",
    p_matched_network_id: null,
    p_gps_passed: input.checks.gps,
    p_ip_passed: false,
    p_status: lateMinutes ? "late" : "present",
    p_late_minutes: lateMinutes,
    p_early_leave_minutes: earlyLeaveMinutes,
    p_sample_count: input.checks.sampleCount,
    p_sample_span_ms: input.checks.sampleSpanMs,
    p_spread_m: input.checks.spreadM,
    p_policy_version: POLICY_VERSION,
  };
}

function invalidGpsDenialPayload(input: {
  request: AttendanceMarkInput;
  branchId: string;
  now: Date;
  reason: string;
}) {
  const timestamps = input.request.samples
    .map((sample) => new Date(sample.capturedAt).getTime())
    .filter(Number.isFinite);
  const span = timestamps.length < 2 ? 0 : Math.max(0, Math.min(120_000, Math.round(Math.max(...timestamps) - Math.min(...timestamps))));
  return {
    p_user_id: input.request.actorUserId,
    p_branch_id: input.branchId,
    p_action: input.request.action,
    p_now: input.now.toISOString(),
    p_request_id: input.request.challengeId,
    p_challenge_id: input.request.challengeId,
    p_latitude: null,
    p_longitude: null,
    p_accuracy_m: null,
    p_distance_m: null,
    p_client_ip: null,
    p_ip_source: "location_only",
    p_matched_network_id: null,
    p_gps_passed: false,
    p_ip_passed: false,
    p_status: null,
    p_late_minutes: 0,
    p_early_leave_minutes: 0,
    p_sample_count: Math.min(100, input.request.samples.length),
    p_sample_span_ms: span,
    p_spread_m: 0,
    p_policy_version: POLICY_VERSION,
    p_reason: input.reason.slice(0, 500),
  };
}
