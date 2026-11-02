import { NextResponse } from "next/server";
import { getApiActor } from "@/lib/api-auth";
import { isTrustedMutationOrigin } from "@/lib/attendance-backend";
import { verifyStaffDeviceRequest } from "@/lib/staff-device-security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) {
    return NextResponse.json({ error: "This sign-out request did not come from the app." }, { status: 403 });
  }

  const actor = await getApiActor();
  if ("error" in actor) return actor.error;
  const isAttendanceAccount = actor.profile.role === "staff" || actor.profile.role === "branch_admin";
  let closedRecord: Record<string, unknown> | null = null;

  if (isAttendanceAccount) {
    const device = await verifyStaffDeviceRequest({
      request,
      userId: actor.user.id,
      context: "logout",
      serviceAdmin: actor.serviceAdmin,
    });
    if (!device.allowed) return device.response;

    const { data, error } = await actor.serviceAdmin.rpc("logout_and_close_attendance", {
      p_user_id: actor.user.id,
    });
    if (error) {
      return NextResponse.json({
        error: "Presence could not safely close your open attendance record. You are still signed in; try again.",
      }, { status: 503, headers: { "cache-control": "no-store" } });
    }
    closedRecord = data as Record<string, unknown> | null;
  }

  const { error: signOutError } = await actor.sessionClient.auth.signOut();
  if (signOutError) {
    return NextResponse.json({ error: "Your session could not be closed. Please try again." }, { status: 503 });
  }

  return NextResponse.json({
    success: true,
    clockedOut: Boolean(closedRecord),
    clockOutAt: typeof closedRecord?.clock_out === "string" ? closedRecord.clock_out : null,
    clockOutSource: closedRecord ? "logout" : null,
  }, { headers: { "cache-control": "no-store" } });
}
