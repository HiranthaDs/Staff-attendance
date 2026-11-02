import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiSuperAdmin } from "@/lib/api-auth";
import { isTrustedMutationOrigin } from "@/lib/attendance-backend";
import { createEnrollmentCode, hashEnrollmentCode } from "@/lib/staff-device-security";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  if (!isTrustedMutationOrigin(request)) {
    return NextResponse.json({ error: "This reset request did not come from the app." }, { status: 403 });
  }
  const parsedId = z.string().uuid().safeParse((await params).userId);
  if (!parsedId.success) return NextResponse.json({ error: "Choose a valid staff account." }, { status: 400 });

  const actor = await getApiSuperAdmin();
  if ("error" in actor) return actor.error;
  const enrollmentCode = createEnrollmentCode();
  const enrollmentHash = hashEnrollmentCode(enrollmentCode);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
  const { data, error } = await actor.serviceAdmin.rpc("reset_staff_device", {
    p_actor_id: actor.profile.id,
    p_user_id: parsedId.data,
    p_enrollment_token_hash: enrollmentHash,
    p_expires_at: expiresAt,
  });
  if (error || data !== true) {
    return NextResponse.json({ error: "The registered device could not be reset." }, { status: 400 });
  }
  return NextResponse.json({
    success: true,
    enrollmentCode,
    expiresAt,
  }, { headers: { "cache-control": "no-store" } });
}
