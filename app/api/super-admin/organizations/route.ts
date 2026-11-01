import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiSuperAdmin } from "@/lib/api-auth";
import { isTrustedMutationOrigin } from "@/lib/attendance-backend";
import { sendInvitationEmail } from "@/lib/email";

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().min(3).max(50).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/),
  billing_email: z.string().trim().email().max(254),
  plan: z.enum(["starter", "growth", "scale", "enterprise"]).default("growth"),
  staff_limit: z.coerce.number().int().min(1).max(100_000).default(1000),
  owner_name: z.string().trim().min(2).max(100),
  owner_email: z.string().trim().email().max(254),
  owner_phone: z.string().trim().min(7).max(30),
  expires_in_days: z.coerce.number().int().min(1).max(14).default(7),
});

const updateSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["active", "suspended"]).optional(),
  staff_limit: z.coerce.number().int().min(1).max(100_000).optional(),
}).refine((value) => value.status !== undefined || value.staff_limit !== undefined);

export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const actor = await getApiSuperAdmin();
  if ("error" in actor) return actor.error;
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the company and owner details." }, { status: 400 });
  const input = parsed.data;
  const email = input.owner_email.toLowerCase();

  const [{ data: existingSlug }, { data: existingOwner }, { data: pendingOwner }] = await Promise.all([
    actor.serviceAdmin.from("organizations").select("id").eq("slug", input.slug).limit(1),
    actor.serviceAdmin.from("profiles").select("id").eq("email", email).limit(1),
    actor.serviceAdmin.from("organization_invitations").select("id").eq("invited_email", email).eq("status", "pending").limit(1),
  ]);
  if (existingSlug?.length) return NextResponse.json({ error: "That company URL is already in use." }, { status: 409 });
  if (existingOwner?.length || pendingOwner?.length) return NextResponse.json({ error: "That owner email already has an account or pending invitation." }, { status: 409 });

  const { data: organization, error: organizationError } = await actor.serviceAdmin.from("organizations").insert({
    name: input.name,
    slug: input.slug,
    billing_email: input.billing_email.toLowerCase(),
    plan: input.plan,
    staff_limit: input.staff_limit,
    created_by: actor.user.id,
  }).select("*").single();
  if (organizationError || !organization) {
    return NextResponse.json({ error: organizationError?.code === "23505" ? "That company URL is already in use." : "The company workspace could not be created." }, { status: organizationError?.code === "23505" ? 409 : 500 });
  }
  await actor.serviceAdmin.from("payroll_preferences").insert({ organization_id: organization.id, id: true, cycle_start_day: 15 });

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + input.expires_in_days * 86_400_000).toISOString();
  const { data: invitation, error: invitationError } = await actor.serviceAdmin.from("organization_invitations").insert({
    organization_id: organization.id,
    invited_email: email,
    role: "company_admin",
    full_name: input.owner_name,
    phone: input.owner_phone,
    job_title: "Company owner",
    token_hash: tokenHash,
    expires_at: expiresAt,
    created_by: actor.user.id,
  }).select("id,organization_id,invited_email,role,full_name,status,expires_at,created_at").single();
  if (invitationError || !invitation) {
    await actor.serviceAdmin.from("organizations").delete().eq("id", organization.id);
    return NextResponse.json({ error: "The owner invitation could not be created." }, { status: 500 });
  }

  const origin = new URL(request.url).origin;
  const link = `${origin}/join/${token}`;
  const loginLink = `${origin}/login/${organization.slug}`;
  const emailDelivery = await sendInvitationEmail({
    fullName: input.owner_name,
    email,
    organizationName: organization.name,
    invitationLink: link,
    loginLink,
    roleLabel: "company owner",
    expiresAt,
  });
  return NextResponse.json({ organization, invitation, link, loginLink, email: emailDelivery }, { status: 201 });
}

export async function PATCH(request: Request) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const actor = await getApiSuperAdmin();
  if ("error" in actor) return actor.error;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid company update." }, { status: 400 });
  const input = parsed.data;
  const { data, error } = await actor.serviceAdmin.rpc("update_organization_controls", {
    p_actor_id: actor.user.id,
    p_organization_id: input.id,
    p_status: input.status ?? null,
    p_staff_limit: input.staff_limit ?? null,
  });
  if (error) {
    if (error.message.includes("ORGANIZATION_NOT_FOUND")) return NextResponse.json({ error: "The company workspace was not found." }, { status: 404 });
    if (error.message.includes("STAFF_LIMIT_BELOW_ACTIVE_MEMBERS")) return NextResponse.json({ error: "The user limit cannot be lower than the company's current active-member count." }, { status: 409 });
    return NextResponse.json({ error: "The company workspace could not be updated." }, { status: 500 });
  }
  const organization = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ organization });
}
