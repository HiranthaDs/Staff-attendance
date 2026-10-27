import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiAdmin } from "@/lib/api-auth";

const schema = z.object({
  full_name: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(7).max(30),
  email: z.string().trim().email().max(200),
  employee_code: z.string().trim().max(30).optional().default(""),
  branch_id: z.string().uuid(),
  role: z.literal("staff").optional().default("staff"),
  job_title: z.string().trim().min(2).max(100),
  temporary_password: z.string().min(10).max(128),
  expected_arrival: z.string().regex(/^\d{2}:\d{2}$/),
  expected_departure: z.string().regex(/^\d{2}:\d{2}$/),
  monthly_leave_days: z.coerce.number().min(0).max(10),
  annual_leave_days: z.coerce.number().min(0).max(60),
});

export async function POST(request: Request) {
  const actor = await getApiAdmin();
  if ("error" in actor) return actor.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check every staff detail and try again." }, { status: 400 });
  const input = parsed.data;
  const { data: branch } = await actor.admin.from("branches").select("id").eq("id", input.branch_id).eq("active", true).maybeSingle();
  if (!branch) return NextResponse.json({ error: "Choose an active branch." }, { status: 400 });

  const { data: created, error: authError } = await actor.admin.auth.admin.createUser({
    email: input.email.toLowerCase(),
    password: input.temporary_password,
    email_confirm: true,
    user_metadata: { full_name: input.full_name },
  });
  if (authError || !created.user) {
    const duplicate = authError?.message.toLowerCase().includes("registered") || authError?.message.toLowerCase().includes("exists");
    return NextResponse.json({ error: duplicate ? "An account already uses that email." : "The sign-in account could not be created." }, { status: 409 });
  }

  const { data: profile, error: profileError } = await actor.admin.from("profiles").insert({
    id: created.user.id,
    full_name: input.full_name,
    email: input.email.toLowerCase(),
    phone: input.phone,
    employee_code: input.employee_code || null,
    branch_id: input.branch_id,
    role: input.role,
    job_title: input.job_title,
    expected_arrival: input.expected_arrival,
    expected_departure: input.expected_departure,
    monthly_leave_days: input.monthly_leave_days,
    annual_leave_days: input.annual_leave_days,
    must_reset_password: true,
    created_by: actor.user.id,
  }).select("*, branch:branches(*)").single();

  if (profileError) {
    await actor.admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: profileError.code === "23505" ? "That employee code is already in use." : "The staff profile could not be saved." }, { status: 409 });
  }
  return NextResponse.json({ profile }, { status: 201 });
}
