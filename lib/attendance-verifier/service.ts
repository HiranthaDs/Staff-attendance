import { createHash } from "node:crypto";
import { ipMatchesRule, isPublicIp, localDateParts, normalizeIp, timeToMinutes, type RequestIpEvidence } from "@/lib/attendance";
import { AttendanceGateway, type AttendanceContext, type AttendanceNetworkContext } from "@/lib/attendance-verifier/gateway";
import { buildConsensus, distanceM, evaluateGeofence, GpsEvidenceError, type GpsConsensus, type LocationEvidenceSample } from "@/lib/attendance-verifier/gps";

const POLICY_VERSION = "2026-10-27.v3-node";

export type AttendanceAction = "clock_in" | "clock_out";

export type AttendanceEnvelope = {
  actorUserId: string;
  action: AttendanceAction;
  ipEvidence: RequestIpEvidence;
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
  wifi: boolean;
  distanceM: number;
  radiusM: number;
  accuracyM: number;
  maxAccuracyM: number;
  consensusCount: number;
  sampleCount: number;
  sampleSpanMs: number;
  spreadM: number;
  gpsMethod: "precise" | "contained_uncertainty" | "none";
  verificationMethod: "precise_gps" | "contained_uncertainty" | "office_network" | "none";
  ipSource: RequestIpEvidence["source"];
  matchedNetworkId: string | null;
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

function evidenceIp(evidence: RequestIpEvidence) {
  if (!evidence.verified) return null;
  const normalized = normalizeIp(evidence.ip);
  if (!normalized || !isPublicIp(normalized)) throw new AttendanceServiceError("Verified client IP is invalid.", 400, "INVALID_IP");
  return normalized;
}

function matchingNetwork(clientIp: string | null, networks: AttendanceNetworkContext[]) {
  return networks.find((network) => network.active && ipMatchesRule(clientIp, network.ip_rule)) ?? null;
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
  const clientIp = evidenceIp(request.ipEvidence);
  const ttlSeconds = boundedInteger("ATTENDANCE_CHALLENGE_TTL_SECONDS", 90, 30, 300);
  const result = await gateway.insertChallenge({
    userId: request.actorUserId,
    branchId: context.branch.id,
    action: request.action,
    ipHash: clientIp ? createHash("sha256").update(clientIp, "ascii").digest("hex") : null,
    expiresAt: new Date(now.getTime() + ttlSeconds * 1_000),
  });
  const normalAccuracy = context.branch.max_accuracy_m;
  return {
    challenge_id: result.id,
    expires_at: result.expires_at,
    minimum_samples: 3,
    minimum_sample_span_ms: 2_000,
    maximum_samples: 20,
    maximum_accuracy_m: Math.max(normalAccuracy, Math.min(200, normalAccuracy * 2)),
  };
}

export async function markAttendance(
  request: AttendanceMarkInput,
  gateway = new AttendanceGateway(),
  now = new Date(),
) {
  validateCaptureWindow(request);
  const context = requireActiveContext(await gateway.loadAttendanceContext(request.actorUserId), request.actorUserId);
  const branch = context.branch;
  const clientIp = evidenceIp(request.ipEvidence);
  const network = matchingNetwork(clientIp, context.networks);
  const ipAllowed = Boolean(network);

  let consensus: GpsConsensus;
  try {
    consensus = buildConsensus(request.samples, { now });
  } catch (error) {
    if (!(error instanceof GpsEvidenceError)) throw error;
    await gateway.recordDenial(invalidGpsDenialPayload({
      request,
      branchId: branch.id,
      now,
      clientIp,
      network,
      ipAllowed,
      reason: error.message,
    }));
    throw new AttendanceServiceError(error.message, 403, "GPS_EVIDENCE_REJECTED");
  }

  const distance = distanceM(branch.latitude, branch.longitude, consensus.latitude, consensus.longitude);
  const gps = evaluateGeofence({
    distanceFromBranchM: distance,
    effectiveAccuracyM: consensus.effectiveAccuracyM,
    radiusM: branch.radius_m,
    maxAccuracyM: branch.max_accuracy_m,
  });
  const hasNetworks = context.networks.length > 0;
  let allowed: boolean;
  if (branch.verification_mode === "gps_and_ip") allowed = gps.allowed && ipAllowed && hasNetworks;
  else if (branch.verification_mode === "gps_or_ip") allowed = gps.allowed || (ipAllowed && hasNetworks);
  else if (branch.verification_mode === "gps_only") allowed = gps.allowed;
  else throw new AttendanceServiceError("Branch verification mode is invalid.", 500, "BRANCH_CONFIG");

  const checks: VerificationChecks = {
    gps: gps.allowed,
    wifi: ipAllowed,
    distanceM: Math.round(distance),
    radiusM: branch.radius_m,
    accuracyM: Math.round(consensus.effectiveAccuracyM),
    maxAccuracyM: branch.max_accuracy_m,
    consensusCount: consensus.consensusCount,
    sampleCount: consensus.sampleCount,
    sampleSpanMs: consensus.sampleSpanMs,
    spreadM: Math.round(consensus.spreadM),
    gpsMethod: gps.method === "precise_radius" ? "precise" : gps.method,
    verificationMethod: gps.allowed && gps.method === "precise_radius"
      ? "precise_gps"
      : gps.allowed ? "contained_uncertainty" : allowed && ipAllowed ? "office_network" : "none",
    ipSource: request.ipEvidence.source,
    matchedNetworkId: network?.id ?? null,
    policyVersion: POLICY_VERSION,
  };
  const common = rpcPayload({ request, context, consensus, checks, clientIp, now });

  if (!allowed) {
    const reason = branch.verification_mode === "gps_and_ip" && !hasNetworks
      ? "This branch has no approved office network. Contact an administrator."
      : branch.verification_mode === "gps_and_ip" && gps.allowed && !ipAllowed
        ? "Connect to the approved office network and try again."
        : gps.reason;
    await gateway.recordDenial({ ...common, p_reason: reason });
    throw new AttendanceServiceError(reason, 403, "PRESENCE_NOT_VERIFIED");
  }

  const result = await gateway.recordMark(common);
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

function validateCaptureWindow(request: AttendanceMarkInput) {
  const started = new Date(request.captureStartedAt);
  const ended = new Date(request.captureEndedAt);
  if (!Number.isFinite(started.getTime()) || !Number.isFinite(ended.getTime())) {
    throw new AttendanceServiceError("The location capture time is invalid.", 400, "INVALID_PAYLOAD");
  }
  const durationMs = ended.getTime() - started.getTime();
  if (durationMs < 2_000 || durationMs > 120_000) {
    throw new AttendanceServiceError("Location capture must take between 2 and 120 seconds.", 400, "INVALID_PAYLOAD");
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
  consensus: GpsConsensus;
  checks: VerificationChecks;
  clientIp: string | null;
  now: Date;
}) {
  let currentMinutes: number;
  try {
    currentMinutes = localDateParts(input.now, input.context.branch.timezone).minutes;
  } catch {
    throw new AttendanceServiceError("The branch timezone is invalid.", 500, "BRANCH_CONFIG");
  }
  const arrival = timeToMinutes(input.context.profile.expected_arrival);
  const departure = timeToMinutes(input.context.profile.expected_departure);
  if (![arrival, departure].every(Number.isFinite)) {
    throw new AttendanceServiceError("Employee work hours are invalid.", 500, "PROFILE_CONFIG");
  }
  const lateMinutes = Math.max(0, currentMinutes - arrival - input.context.branch.late_grace_minutes);
  const earlyLeaveMinutes = Math.max(0, departure - currentMinutes);
  return {
    p_user_id: input.request.actorUserId,
    p_branch_id: input.context.branch.id,
    p_action: input.request.action,
    p_now: input.now.toISOString(),
    p_request_id: input.request.challengeId,
    p_challenge_id: input.request.challengeId,
    p_latitude: input.consensus.latitude,
    p_longitude: input.consensus.longitude,
    p_accuracy_m: input.checks.accuracyM,
    p_distance_m: input.checks.distanceM,
    p_client_ip: input.clientIp,
    p_ip_source: input.request.ipEvidence.source,
    p_matched_network_id: input.checks.matchedNetworkId,
    p_gps_passed: input.checks.gps,
    p_ip_passed: input.checks.wifi,
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
  clientIp: string | null;
  network: AttendanceNetworkContext | null;
  ipAllowed: boolean;
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
    p_client_ip: input.clientIp,
    p_ip_source: input.request.ipEvidence.source,
    p_matched_network_id: input.network?.id ?? null,
    p_gps_passed: false,
    p_ip_passed: input.ipAllowed,
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
