import { z } from "zod";
import { resolveRequestIp } from "@/lib/attendance";
import { AttendanceStorageError } from "@/lib/attendance-verifier/gateway";
import {
  AttendanceServiceError,
  createAttendanceChallenge,
  markAttendance,
  type AttendanceAction,
} from "@/lib/attendance-verifier/service";

export class AttendanceBackendError extends Error {
  constructor(
    message: string,
    public readonly status = 503,
  ) {
    super(message);
  }
}

const markPayloadSchema = z.object({
  action: z.enum(["clock_in", "clock_out"]),
  challenge_id: z.string().uuid(),
  client_request_id: z.string().uuid(),
  capture_started_at: z.string().datetime(),
  capture_ended_at: z.string().datetime(),
  samples: z.array(z.object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    accuracy: z.number().finite().positive().max(2_000),
    altitude: z.number().finite().nullable(),
    altitude_accuracy: z.number().finite().nonnegative().nullable(),
    heading: z.number().finite().min(0).max(360).nullable(),
    speed: z.number().finite().nonnegative().max(500).nullable(),
    captured_at: z.string().datetime(),
  })).min(3).max(20),
});

const DATABASE_MESSAGES: Record<string, [number, string]> = {
  CHALLENGE_ALREADY_USED: [409, "This verification has already been used. Start a new attendance check."],
  CHALLENGE_EXPIRED: [409, "The attendance check expired. Please capture your location again."],
  CHALLENGE_NOT_FOUND: [409, "The attendance check is no longer available. Please start again."],
  CLOCK_IN_REQUIRED_OR_ALREADY_CLOSED: [409, "Clock in before trying to clock out, or this workday is already complete."],
  IP_ALREADY_USED_BY_ANOTHER_EMPLOYEE: [409, "This non-office internet address was already used by another employee today. Connect to the approved office network or contact an administrator."],
  IDEMPOTENCY_CONFLICT: [409, "This attendance request conflicts with an earlier request. Start a new check."],
  EMPLOYEE_INACTIVE_OR_NOT_FOUND: [403, "This employee account is not active."],
  BRANCH_INACTIVE_OR_NOT_FOUND: [403, "The assigned branch is not active."],
  PASSWORD_RESET_REQUIRED: [403, "Reset the temporary password before marking attendance."],
  GPS_DISTANCE_MISMATCH: [403, "Location evidence failed the server check. Capture your location again."],
  GPS_EVIDENCE_INVALID: [403, "Location evidence was not strong enough. Keep the device still and try again."],
  GPS_OUTSIDE_BRANCH_RADIUS: [403, "Your verified location is outside the branch attendance radius."],
  PGRST202: [503, "Attendance database setup is incomplete. Ask an administrator to apply the latest migration."],
  PGRST205: [503, "Attendance database setup is incomplete. Ask an administrator to apply the latest migration."],
};

export async function callAttendanceBackend(
  request: Request,
  actorUserId: string,
  path: "/v1/attendance/challenge" | "/v1/attendance/mark",
  payload: Record<string, unknown>,
) {
  const ipEvidence = await resolveRequestIp(request.headers, {
    allowLocalEgressFallback: process.env.LOCAL_ATTENDANCE_EGRESS_FALLBACK === "true"
      || process.env.NODE_ENV === "development",
  });
  const envelope = {
    actorUserId,
    ipEvidence,
    userAgent: request.headers.get("user-agent")?.slice(0, 500) || null,
  };

  try {
    if (path === "/v1/attendance/challenge") {
      const action = z.enum(["clock_in", "clock_out"]).parse(payload.action) as AttendanceAction;
      const result = await createAttendanceChallenge({ ...envelope, action });
      return { status: 200, result };
    }

    const parsed = markPayloadSchema.parse(payload);
    const result = await markAttendance({
      ...envelope,
      action: parsed.action,
      challengeId: parsed.challenge_id,
      clientRequestId: parsed.client_request_id,
      captureStartedAt: parsed.capture_started_at,
      captureEndedAt: parsed.capture_ended_at,
      samples: parsed.samples.map((sample) => ({
        latitude: sample.latitude,
        longitude: sample.longitude,
        accuracy: sample.accuracy,
        altitude: sample.altitude,
        altitudeAccuracy: sample.altitude_accuracy,
        heading: sample.heading,
        speed: sample.speed,
        capturedAt: sample.captured_at,
      })),
    });
    return { status: 200, result };
  } catch (error) {
    if (error instanceof AttendanceServiceError) {
      return { status: error.status, result: { error: error.message, code: error.code } };
    }
    if (error instanceof AttendanceStorageError) {
      const known = error.code ? DATABASE_MESSAGES[error.code] : undefined;
      if (known) return { status: known[0], result: { error: known[1], code: error.code } };
      console.error("Attendance storage operation failed", { code: error.code || "DATABASE_ERROR", status: error.status });
      const status = [400, 404, 409].includes(error.status) ? 409 : 502;
      return {
        status,
        result: {
          error: "Attendance storage is temporarily unavailable. Please try again.",
          code: error.code || "DATABASE_ERROR",
        },
      };
    }
    if (error instanceof z.ZodError) {
      return { status: 400, result: { error: "The attendance request is invalid.", code: "INVALID_PAYLOAD" } };
    }
    console.error("Attendance verification failed unexpectedly");
    throw new AttendanceBackendError("Attendance verification is temporarily unavailable. Please try again.");
  }
}

export function isTrustedMutationOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const allowed = new Set<string>();
  try {
    allowed.add(new URL(request.url).origin);
  } catch {
    return false;
  }
  try {
    if (process.env.NEXT_PUBLIC_APP_URL) allowed.add(new URL(process.env.NEXT_PUBLIC_APP_URL).origin);
  } catch {
    // A malformed optional app URL should not widen the origin allowlist.
  }
  return allowed.has(origin);
}
