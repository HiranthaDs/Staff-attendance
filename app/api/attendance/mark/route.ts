import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiActor } from "@/lib/api-auth";
import {
  AttendanceBackendError,
  callAttendanceBackend,
  isTrustedMutationOrigin,
} from "@/lib/attendance-backend";

export const runtime = "nodejs";

const sampleSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().positive().max(2_000),
  altitude: z.number().finite().nullable(),
  altitudeAccuracy: z.number().finite().nonnegative().nullable(),
  heading: z.number().finite().min(0).max(360).nullable(),
  speed: z.number().finite().nonnegative().max(500).nullable(),
  capturedAt: z.string().datetime(),
});

const markSchema = z.object({
  action: z.enum(["clock_in", "clock_out"]),
  challengeId: z.string().uuid(),
  clientRequestId: z.string().uuid(),
  captureStartedAt: z.string().datetime(),
  captureEndedAt: z.string().datetime(),
  samples: z.array(sampleSchema).min(3).max(20),
});

export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) {
    return NextResponse.json({ error: "This attendance request did not come from the app." }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > 32_768) {
    return NextResponse.json({ error: "The location evidence is too large." }, { status: 413 });
  }

  const actor = await getApiActor();
  if ("error" in actor) return actor.error;
  if (actor.profile.role === "super_admin") {
    return NextResponse.json({ error: "Only employee accounts can mark attendance." }, { status: 403 });
  }
  if (actor.profile.must_reset_password) {
    return NextResponse.json({ error: "Change your temporary password before marking attendance." }, { status: 403 });
  }
  if (!actor.profile.branch_id || !actor.profile.branch) {
    return NextResponse.json({ error: "No branch is assigned to this account." }, { status: 409 });
  }
  if (!actor.profile.branch.active) {
    return NextResponse.json({ error: "Your assigned branch is not active." }, { status: 403 });
  }

  const parsed = markSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "We could not read valid location evidence." }, { status: 400 });
  }

  try {
    const backend = await callAttendanceBackend(
      request,
      actor.user.id,
      "/v1/attendance/mark",
      {
        action: parsed.data.action,
        challenge_id: parsed.data.challengeId,
        client_request_id: parsed.data.clientRequestId,
        capture_started_at: parsed.data.captureStartedAt,
        capture_ended_at: parsed.data.captureEndedAt,
        samples: parsed.data.samples.map((sample) => ({
          latitude: sample.latitude,
          longitude: sample.longitude,
          accuracy: sample.accuracy,
          altitude: sample.altitude,
          altitude_accuracy: sample.altitudeAccuracy,
          heading: sample.heading,
          speed: sample.speed,
          captured_at: sample.capturedAt,
        })),
      },
    );
    return NextResponse.json(backend.result, {
      status: backend.status,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof AttendanceBackendError
      ? error.message
      : "Attendance verification is temporarily unavailable.";
    const status = error instanceof AttendanceBackendError ? error.status : 503;
    return NextResponse.json({ error: message }, { status });
  }
}
