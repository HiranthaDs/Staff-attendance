import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiAdmin } from "@/lib/api-auth";

const schema = z.object({
  proposed_name: z.string().trim().min(2).max(80),
  proposed_code: z.string().trim().min(2).max(8).regex(/^[a-zA-Z0-9-]+$/),
  radius_m: z.coerce.number().int().min(50).max(1000),
  expires_in_hours: z.coerce.number().int().min(1).max(168).default(48),
});

export async function POST(request: Request) {
  const actor = await getApiAdmin();
  if ("error" in actor) return actor.error;
  if (actor.profile.role !== "super_admin") {
    return NextResponse.json({ error: "Only a super admin can generate branch setup links." }, { status: 403 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the proposed branch details." }, { status: 400 });
  const input = parsed.data;
  const code = input.proposed_code.toUpperCase();

  const [{ data: existingName }, { data: existingCode }, { data: existingInvite }] = await Promise.all([
    actor.admin.from("branches").select("id").eq("name", input.proposed_name).limit(1),
    actor.admin.from("branches").select("id").eq("code", code).limit(1),
    actor.admin.from("branch_setup_invites").select("id").eq("proposed_code", code).in("status", ["pending", "submitted"]).limit(1),
  ]);
  if (existingName?.length || existingCode?.length) return NextResponse.json({ error: "A branch already uses that name or code." }, { status: 409 });
  if (existingInvite?.length) return NextResponse.json({ error: "An active setup link already exists for that branch code." }, { status: 409 });

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + input.expires_in_hours * 60 * 60 * 1000).toISOString();
  const { data: invite, error } = await actor.admin.from("branch_setup_invites").insert({
    token_hash: tokenHash,
    proposed_name: input.proposed_name,
    proposed_code: code,
    radius_m: input.radius_m,
    verification_mode: "gps_only",
    expires_at: expiresAt,
    created_by: actor.user.id,
  }).select("id, proposed_name, proposed_code, radius_m, verification_mode, status, expires_at, created_at").single();
  if (error) return NextResponse.json({ error: "The setup link could not be generated." }, { status: 500 });

  const origin = new URL(request.url).origin;
  return NextResponse.json({ invite, link: `${origin}/branch-setup/${token}` }, { status: 201 });
}
