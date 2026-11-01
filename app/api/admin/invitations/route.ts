import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiAdmin } from "@/lib/api-auth";
import { isTrustedMutationOrigin } from "@/lib/attendance-backend";
import { sendInvitationEmail } from "@/lib/email";

const createSchema = z.object({
  full_name: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(7).max(30),
  email: z.string().trim().email().max(254),
  employee_code: z.string().trim().max(30).optional().default(""),
  branch_id: z.string().uuid(),
  role: z.enum(["branch_admin", "staff"]).default("staff"),
  job_title: z.string().trim().min(2).max(100),
  department: z.string().trim().min(2).max(100),
  employment_type: z.enum(["probation", "permanent", "contract", "temporary", "intern"]),
  employment_start_date: z.string().date(),
  probation_end_date: z.union([z.literal(""), z.string().date()]).default(""),
  employment_end_date: z.union([z.literal(""), z.string().date()]).default(""),
  date_of_birth: z.string().date(),
  national_id: z.string().trim().min(4).max(50),
  address: z.string().trim().min(5).max(500),
  emergency_contact_name: z.string().trim().min(2).max(100),
  emergency_contact_phone: z.string().trim().min(7).max(30),
  emergency_contact_relationship: z.string().trim().min(2).max(60),
  expected_arrival: z.string().regex(/^\d{2}:\d{2}$/),
  expected_departure: z.string().regex(/^\d{2}:\d{2}$/),
  monthly_leave_days: z.coerce.number().min(0).max(10),
  annual_leave_days: z.coerce.number().min(0).max(60),
  saturday_type: z.enum(["half_day", "full_day", "off"]).default("half_day"),
  sunday_type: z.enum(["off", "half_day", "full_day"]).default("off"),
  half_day_arrival: z.string().regex(/^\d{2}:\d{2}$/).default("09:00"),
  half_day_departure: z.string().regex(/^\d{2}:\d{2}$/).default("14:00"),
  expires_in_days: z.coerce.number().int().min(1).max(14).default(7),
});

export async function GET() {
  const actor = await getApiAdmin();
  if ("error" in actor) return actor.error;
  if (actor.profile.role !== "company_admin" && actor.profile.role !== "branch_admin") return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  const { data, error } = await actor.admin.from("organization_invitations")
    .select("id,organization_id,branch_id,invited_email,role,full_name,phone,employee_code,job_title,department,employment_type,employment_start_date,probation_end_date,employment_end_date,date_of_birth,national_id,address,emergency_contact_name,emergency_contact_phone,emergency_contact_relationship,status,expires_at,accepted_at,created_at,branch:branches(id,name,code)")
    .order("created_at", { ascending: false }).limit(200);
  if (error) return NextResponse.json({ error: "Invitations could not be loaded." }, { status: 500 });
  return NextResponse.json({ invitations: data }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const actor = await getApiAdmin();
  if ("error" in actor) return actor.error;
  if ((actor.profile.role !== "company_admin" && actor.profile.role !== "branch_admin") || !actor.profile.organization_id || !actor.profile.organization) {
    return NextResponse.json({ error: "Administrator access is required to invite team members." }, { status: 403 });
  }
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check every team member detail and try again." }, { status: 400 });
  const input = parsed.data;
  if (actor.profile.role === "branch_admin" && (input.branch_id !== actor.profile.branch_id || input.role !== "staff")) {
    return NextResponse.json({ error: "Branch administrators can invite staff only to their assigned branch." }, { status: 403 });
  }
  if (input.expected_departure <= input.expected_arrival || input.half_day_departure <= input.half_day_arrival) {
    return NextResponse.json({ error: "Finishing times must be after their starting times." }, { status: 400 });
  }
  if (input.date_of_birth > new Date().toISOString().slice(0, 10) || input.date_of_birth >= input.employment_start_date) {
    return NextResponse.json({ error: "Date of birth must be before the employment start date." }, { status: 400 });
  }
  if (input.employment_type === "probation" && (!input.probation_end_date || input.probation_end_date < input.employment_start_date)) {
    return NextResponse.json({ error: "Add a valid probation end date." }, { status: 400 });
  }
  if (["contract", "temporary", "intern"].includes(input.employment_type) && (!input.employment_end_date || input.employment_end_date < input.employment_start_date)) {
    return NextResponse.json({ error: "Add a valid employment end date for this employment type." }, { status: 400 });
  }
  const email = input.email.toLowerCase();
  const { data: branch } = await actor.admin.from("branches").select("id,name,code").eq("id", input.branch_id).eq("active", true).maybeSingle();
  if (!branch) return NextResponse.json({ error: "Choose an active branch in this company." }, { status: 400 });

  const [{ data: existingProfile }, { data: existingInvitation }] = await Promise.all([
    actor.admin.from("profiles").select("id").eq("email", email).limit(1),
    actor.admin.from("organization_invitations").select("id").eq("invited_email", email).eq("status", "pending").limit(1),
  ]);
  if (existingProfile?.length) return NextResponse.json({ error: "This email already belongs to a member of your company." }, { status: 409 });
  if (existingInvitation?.length) return NextResponse.json({ error: "A pending invitation already exists for this email." }, { status: 409 });

  const schedule = Array.from({ length: 7 }, (_, index) => {
    const weekday = index + 1;
    const dayType = weekday === 6 ? input.saturday_type : weekday === 7 ? input.sunday_type : "full_day";
    return {
      weekday,
      day_type: dayType,
      arrival_time: dayType === "half_day" ? input.half_day_arrival : input.expected_arrival,
      departure_time: dayType === "half_day" ? input.half_day_departure : input.expected_departure,
    };
  });
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + input.expires_in_days * 86_400_000).toISOString();
  const { data: invitation, error } = await actor.admin.from("organization_invitations").insert({
    organization_id: actor.profile.organization_id,
    branch_id: input.branch_id,
    invited_email: email,
    role: input.role,
    full_name: input.full_name,
    phone: input.phone,
    employee_code: input.employee_code || null,
    job_title: input.job_title,
    department: input.department,
    employment_type: input.employment_type,
    employment_start_date: input.employment_start_date,
    probation_end_date: input.probation_end_date || null,
    employment_end_date: input.employment_end_date || null,
    date_of_birth: input.date_of_birth,
    national_id: input.national_id,
    address: input.address,
    emergency_contact_name: input.emergency_contact_name,
    emergency_contact_phone: input.emergency_contact_phone,
    emergency_contact_relationship: input.emergency_contact_relationship,
    expected_arrival: input.expected_arrival,
    expected_departure: input.expected_departure,
    monthly_leave_days: input.monthly_leave_days,
    annual_leave_days: input.annual_leave_days,
    work_schedule: schedule,
    token_hash: tokenHash,
    expires_at: expiresAt,
    created_by: actor.user.id,
  }).select("id,organization_id,branch_id,invited_email,role,full_name,phone,employee_code,job_title,department,employment_type,employment_start_date,probation_end_date,employment_end_date,date_of_birth,national_id,address,emergency_contact_name,emergency_contact_phone,emergency_contact_relationship,status,expires_at,accepted_at,created_at,branch:branches(id,name,code)").single();
  if (error || !invitation) {
    const duplicate = error?.code === "23505";
    return NextResponse.json({ error: duplicate ? "A pending invitation already exists for this email or employee code." : "The invitation could not be created." }, { status: duplicate ? 409 : 500 });
  }
  const origin = new URL(request.url).origin;
  const link = `${origin}/join/${token}`;
  const loginLink = `${origin}/login/${actor.profile.organization.slug}`;
  const emailDelivery = await sendInvitationEmail({
    fullName: input.full_name,
    email,
    organizationName: actor.profile.organization.name,
    invitationLink: link,
    loginLink,
    roleLabel: input.role === "branch_admin" ? "branch administrator" : "staff member",
    expiresAt,
  });
  return NextResponse.json({ invitation, link, loginLink, companyName: actor.profile.organization.name, email: emailDelivery }, { status: 201 });
}

export async function DELETE(request: Request) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const actor = await getApiAdmin();
  if ("error" in actor) return actor.error;
  if (actor.profile.role !== "company_admin" && actor.profile.role !== "branch_admin") return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  const parsed = z.object({ id: z.string().uuid() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid invitation." }, { status: 400 });
  const { data, error } = await actor.admin.from("organization_invitations").update({ status: "revoked" }).eq("id", parsed.data.id).eq("status", "pending").select("id").maybeSingle();
  if (error) return NextResponse.json({ error: "The invitation could not be revoked." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "That invitation is no longer pending." }, { status: 409 });
  return NextResponse.json({ success: true });
}
