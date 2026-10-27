import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiActor } from "@/lib/api-auth";
import {
  AttendanceBackendError,
  callAttendanceBackend,
  isTrustedMutationOrigin,
} from "@/lib/attendance-backend";

export const runtime = "nodejs";

const schema = z.object({
  action: z.enum(["clock_in", "clock_out"]),
});

export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) {
    return NextResponse.json({ error: "This attendance request did not come from the app." }, { status: 403 });
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

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose a valid attendance action." }, { status: 400 });
  }

  try {
    const backend = await callAttendanceBackend(
      request,
      actor.user.id,
      "/v1/attendance/challenge",
      { action: parsed.data.action },
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
