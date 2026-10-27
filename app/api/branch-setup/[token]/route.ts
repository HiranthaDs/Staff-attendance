import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { distanceInMeters } from "@/lib/attendance";

export const dynamic = "force-dynamic";

const submissionSchema = z.object({
  address: z.string().trim().min(5).max(300),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy_m: z.number().int().min(1).max(200),
  captured_at: z.string().datetime(),
  evidence_latitude: z.number().min(-90).max(90),
  evidence_longitude: z.number().min(-180).max(180),
  sample_count: z.number().int().min(1).max(100),
  consensus_count: z.number().int().min(1).max(100),
  spread_m: z.number().min(0).max(200),
  device_info: z.record(z.string(), z.unknown()).optional(),
  manager_name: z.string().trim().min(2).max(100),
  manager_phone: z.string().trim().min(7).max(30),
  notes: z.string().trim().max(500).nullable().optional(),
}).refine((input) => input.consensus_count <= input.sample_count, {
  message: "Consensus count cannot exceed sample count.",
  path: ["consensus_count"],
});

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return NextResponse.json({ error: "This setup link is invalid." }, { status: 404 });
  const admin = createAdminClient();
  const { data: invite } = await admin.from("branch_setup_invites")
    .select("proposed_name, proposed_code, radius_m, verification_mode, status, expires_at")
    .eq("token_hash", hashToken(token)).maybeSingle();
  if (!invite) return NextResponse.json({ error: "This setup link is invalid." }, { status: 404 });
  if (invite.status === "pending" && new Date(invite.expires_at) <= new Date()) {
    await admin.from("branch_setup_invites").update({ status: "expired" }).eq("token_hash", hashToken(token));
    invite.status = "expired";
  }
  return NextResponse.json({ invite });
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return NextResponse.json({ error: "This setup link is invalid." }, { status: 404 });
  const parsed = submissionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const accuracyIssue = parsed.error.issues.some((issue) => issue.path[0] === "accuracy_m");
    return NextResponse.json({ error: accuracyIssue ? "Location accuracy must be 200 m or better." : "Complete all required setup details." }, { status: 400 });
  }
  const input = parsed.data;
  const admin = createAdminClient();
  const { data: invite } = await admin.from("branch_setup_invites")
    .select("id")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!invite) return NextResponse.json({ error: "This setup link is invalid." }, { status: 404 });

  const capturedAt = new Date(input.captured_at);
  const sampleAgeMs = Date.now() - capturedAt.getTime();
  if (sampleAgeMs < -10_000 || sampleAgeMs > 120_000) {
    return NextResponse.json({ error: "The final location check is no longer fresh. Capture again." }, { status: 400 });
  }
  const evidenceToPinM = distanceInMeters(
    { latitude: input.evidence_latitude, longitude: input.evidence_longitude },
    { latitude: input.latitude, longitude: input.longitude },
  );
  const maximumPinAdjustmentM = Math.min(150, input.accuracy_m + 25);
  if (evidenceToPinM > maximumPinAdjustmentM) {
    return NextResponse.json({ error: "The selected office pin does not match the verified device location." }, { status: 400 });
  }

  const { data: submission, error } = await admin.rpc("submit_branch_setup", {
    p_token_hash: hashToken(token),
    p_address: input.address,
    p_latitude: input.latitude,
    p_longitude: input.longitude,
    p_accuracy_m: input.accuracy_m,
    p_captured_at: input.captured_at,
    p_public_ip: "location-only",
    p_wifi_name: "Not collected",
    p_connection_type: null,
    p_effective_type: null,
    p_downlink_mbps: null,
    p_rtt_ms: null,
    p_save_data: null,
    p_device_info: {
      ...(input.device_info ?? {}),
      verifiedLocationEvidence: {
        latitude: input.evidence_latitude,
        longitude: input.evidence_longitude,
        accuracy: input.accuracy_m,
        capturedAt: input.captured_at,
        sampleCount: input.sample_count,
        consensusCount: input.consensus_count,
        spreadM: input.spread_m,
        evidenceToPinM,
      },
      verificationMethod: "location_radius",
    },
    p_user_agent: request.headers.get("user-agent"),
    p_manager_name: input.manager_name,
    p_manager_phone: input.manager_phone,
    p_notes: input.notes || null,
  });
  if (error) {
    const message = error.message.includes("INVITE_EXPIRED") ? "This setup link has expired. Ask the super admin for a new link."
      : error.message.includes("INVITE_ALREADY_USED") ? "This setup link has already been submitted."
        : error.message.includes("STALE_LOCATION") ? "The location sample is too old. Capture the office details again."
          : "The branch details could not be submitted.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
  return NextResponse.json({ success: true, submission_id: submission.id }, { status: 201 });
}
