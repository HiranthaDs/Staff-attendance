import { NextResponse } from "next/server";
import { z } from "zod";
import { isTrustedMutationOrigin } from "@/lib/attendance-backend";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const signupSchema = z.object({
  name: z.string().trim().min(2).max(120),
  legal_name: z.string().trim().min(2).max(160),
  registration_number: z.string().trim().min(2).max(80).regex(/^[A-Za-z0-9 .\/-]+$/),
  industry: z.string().trim().min(2).max(100),
  company_phone: z.string().trim().min(7).max(30),
  billing_email: z.string().trim().email().max(254),
  website: z.union([z.literal(""), z.string().trim().url().max(240)]).default(""),
  address: z.string().trim().min(4).max(300),
  city: z.string().trim().min(2).max(100),
  country: z.string().trim().min(2).max(100).default("Sri Lanka"),
  timezone: z.string().trim().min(3).max(80).default("Asia/Colombo"),
  slug: z.string().trim().toLowerCase().min(3).max(50).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/),
  plan: z.enum(["starter", "growth", "scale"]).default("growth"),
  admin_name: z.string().trim().min(2).max(100),
  admin_email: z.string().trim().email().max(254),
  admin_phone: z.string().trim().min(7).max(30),
  admin_job_title: z.string().trim().min(2).max(100).default("Company super admin"),
  password: z.string().min(12).max(128)
    .regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/).regex(/[^A-Za-z0-9]/),
  confirm_password: z.string().min(1).max(128),
  company_fax: z.string().max(0).optional().default(""),
}).refine((value) => value.password === value.confirm_password, { path: ["confirm_password"] });

const planLimits = { starter: 50, growth: 250, scale: 1000 } as const;
const signupAttempts = new Map<string, number[]>();

function rateLimitKey(request: Request) {
  return request.headers.get("cf-connecting-ip")
    || request.headers.get("x-real-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "local";
}

function isRateLimited(request: Request) {
  const key = rateLimitKey(request);
  const cutoff = Date.now() - 60 * 60 * 1000;
  const recent = (signupAttempts.get(key) ?? []).filter((attempt) => attempt > cutoff);
  if (recent.length >= 5) return true;
  recent.push(Date.now());
  signupAttempts.set(key, recent);
  return false;
}

export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const parsed = signupSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check every company, administrator, and password field." }, { status: 400 });
  if (isRateLimited(request)) return NextResponse.json({ error: "Too many company registrations were attempted. Try again later." }, { status: 429, headers: { "retry-after": "3600" } });
  const input = parsed.data;
  const adminEmail = input.admin_email.toLowerCase();
  const service = createAdminClient();

  const [slugResult, registrationResult, emailResult] = await Promise.all([
    service.from("organizations").select("id").eq("slug", input.slug).limit(1),
    service.from("organizations").select("id").ilike("registration_number", input.registration_number).limit(1),
    service.from("profiles").select("id").eq("email", adminEmail).limit(1),
  ]);
  if (slugResult.error || registrationResult.error || emailResult.error) {
    return NextResponse.json({ error: "Company registration is waiting for the database setup to be completed." }, { status: 503 });
  }
  const slugMatch = slugResult.data;
  const registrationMatch = registrationResult.data;
  const emailMatch = emailResult.data;
  if (slugMatch?.length) return NextResponse.json({ error: "That company sign-in URL is already in use." }, { status: 409 });
  if (registrationMatch?.length) return NextResponse.json({ error: "That company registration number is already in use." }, { status: 409 });
  if (emailMatch?.length) return NextResponse.json({ error: "That administrator email already has an account." }, { status: 409 });

  const session = await createClient();
  const origin = new URL(request.url).origin;
  const { data: authResult, error: authError } = await session.auth.signUp({
    email: adminEmail,
    password: input.password,
    options: {
      data: { full_name: input.admin_name },
      emailRedirectTo: `${origin}/auth/callback?next=/admin`,
    },
  });
  const user = authResult.user;
  if (authError || !user || user.identities?.length === 0) {
    const duplicate = authError?.message.toLowerCase().includes("already") || authError?.status === 422;
    return NextResponse.json({ error: duplicate ? "That administrator email already has an account." : "The administrator account could not be created." }, { status: duplicate ? 409 : 500 });
  }

  let organizationId: string | null = null;
  const cleanup = async () => {
    if (organizationId) {
      await service.from("profiles").delete().eq("id", user.id);
      await service.from("organizations").delete().eq("id", organizationId);
    }
    await service.auth.admin.deleteUser(user.id);
  };

  const { data: organization, error: organizationError } = await service.from("organizations").insert({
    name: input.name,
    legal_name: input.legal_name,
    registration_number: input.registration_number,
    industry: input.industry,
    phone: input.company_phone,
    billing_email: input.billing_email.toLowerCase(),
    website: input.website || null,
    address: input.address,
    city: input.city,
    country: input.country,
    timezone: input.timezone,
    slug: input.slug,
    plan: input.plan,
    staff_limit: planLimits[input.plan],
    status: "active",
    created_by: user.id,
  }).select("id,name,slug").single();
  if (organizationError || !organization) {
    await cleanup();
    return NextResponse.json({ error: organizationError?.code === "23505" ? "That company URL or registration number is already in use." : "The company workspace could not be created." }, { status: organizationError?.code === "23505" ? 409 : 500 });
  }
  organizationId = organization.id;

  const { error: profileError } = await service.from("profiles").insert({
    id: user.id,
    organization_id: organization.id,
    branch_id: null,
    email: adminEmail,
    full_name: input.admin_name,
    phone: input.admin_phone,
    job_title: input.admin_job_title,
    role: "company_admin",
    must_reset_password: false,
    active: true,
  });
  if (profileError) {
    await cleanup();
    return NextResponse.json({ error: "The company super-admin profile could not be created." }, { status: 500 });
  }

  const { error: payrollError } = await service.from("payroll_preferences").insert({ organization_id: organization.id, id: true, cycle_start_day: 15 });
  if (payrollError) {
    await cleanup();
    return NextResponse.json({ error: "The company workspace could not finish setup." }, { status: 500 });
  }

  const loginUrl = `/login/${encodeURIComponent(organization.slug)}?email=${encodeURIComponent(adminEmail)}`;
  return NextResponse.json({
    success: true,
    signedIn: Boolean(authResult.session),
    confirmationRequired: !authResult.session,
    redirectTo: authResult.session ? "/admin" : loginUrl,
    organization: { name: organization.name, slug: organization.slug },
    email: adminEmail,
  }, { status: 201, headers: { "cache-control": "no-store" } });
}
