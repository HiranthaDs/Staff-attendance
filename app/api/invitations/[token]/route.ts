import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isTrustedMutationOrigin } from "@/lib/attendance-backend";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const passwordSchema = z.string().min(12).max(128)
  .regex(/[a-z]/, "Add a lowercase letter.")
  .regex(/[A-Z]/, "Add an uppercase letter.")
  .regex(/[0-9]/, "Add a number.")
  .regex(/[^A-Za-z0-9]/, "Add a symbol.");

function tokenHash(token: string) { return createHash("sha256").update(token).digest("hex"); }

async function findInvitation(token: string) {
  if (!/^[A-Za-z0-9_-]{32,100}$/.test(token)) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("organization_invitations")
    .select("id,organization_id,branch_id,invited_email,role,full_name,job_title,status,expires_at,organization:organizations(id,name,slug,status),branch:branches(id,name,code,active)")
    .eq("token_hash", tokenHash(token)).maybeSingle();
  return data;
}

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const invitation = await findInvitation(token);
  if (!invitation) return NextResponse.json({ error: "This invitation link is not valid." }, { status: 404 });
  const organization = Array.isArray(invitation.organization) ? invitation.organization[0] : invitation.organization;
  const branch = Array.isArray(invitation.branch) ? invitation.branch[0] : invitation.branch;
  const expired = invitation.status === "pending" && new Date(invitation.expires_at).getTime() <= Date.now();
  const unavailable = invitation.status !== "pending" || expired || organization?.status !== "active" || (branch && !branch.active);
  return NextResponse.json({
    invitation: {
      full_name: invitation.full_name,
      invited_email: invitation.invited_email,
      role: invitation.role,
      job_title: invitation.job_title,
      status: expired ? "expired" : invitation.status,
      expires_at: invitation.expires_at,
      organization: organization ? { name: organization.name, slug: organization.slug } : null,
      branch: branch ? { name: branch.name, code: branch.code } : null,
    },
    available: !unavailable,
  }, { status: unavailable ? 410 : 200, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const { token } = await context.params;
  const parsed = z.object({ password: passwordSchema, confirm_password: z.string() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Use a stronger password." }, { status: 400 });
  if (parsed.data.password !== parsed.data.confirm_password) return NextResponse.json({ error: "The passwords do not match." }, { status: 400 });
  const invitation = await findInvitation(token);
  if (!invitation) return NextResponse.json({ error: "This invitation link is not valid." }, { status: 404 });
  const organization = Array.isArray(invitation.organization) ? invitation.organization[0] : invitation.organization;
  const branch = Array.isArray(invitation.branch) ? invitation.branch[0] : invitation.branch;
  if (invitation.status !== "pending") return NextResponse.json({ error: "This invitation has already been used or revoked." }, { status: 410 });
  if (new Date(invitation.expires_at).getTime() <= Date.now()) return NextResponse.json({ error: "This invitation has expired. Ask your administrator for a new link." }, { status: 410 });
  if (organization?.status !== "active" || (branch && !branch.active)) return NextResponse.json({ error: "This workspace or branch is not active." }, { status: 403 });

  const admin = createAdminClient();
  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email: invitation.invited_email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: { full_name: invitation.full_name, organization_id: invitation.organization_id },
  });
  if (authError || !created.user) {
    const duplicate = /registered|exists/i.test(authError?.message || "");
    return NextResponse.json({ error: duplicate ? "An account already uses this email. Sign in or ask the administrator for help." : "The sign-in account could not be created." }, { status: duplicate ? 409 : 500 });
  }

  const { data: profile, error: profileError } = await admin.rpc("accept_organization_invitation", {
    p_token_hash: tokenHash(token),
    p_user_id: created.user.id,
  });
  if (profileError || !profile) {
    await admin.auth.admin.deleteUser(created.user.id);
    const message = profileError?.message || "";
    const limit = message.includes("ORGANIZATION_STAFF_LIMIT_REACHED");
    const duplicateCode = profileError?.code === "23505";
    return NextResponse.json({ error: limit ? "This company has reached its active-user limit." : duplicateCode ? "That employee code, national ID, or email is already in use." : "The invitation could not be completed. Ask your administrator for a new link." }, { status: limit || duplicateCode ? 409 : 500 });
  }
  return NextResponse.json({ success: true, email: invitation.invited_email, role: invitation.role }, { status: 201, headers: { "cache-control": "no-store" } });
}
