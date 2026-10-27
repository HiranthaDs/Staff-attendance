import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiAdmin } from "@/lib/api-auth";
import { isTrustedMutationOrigin } from "@/lib/attendance-backend";
import { sendPasswordResetEmail } from "@/lib/email";
import { notifyUsers } from "@/lib/notifications";

const schema = z.object({ temporary_password: z.string().min(10).max(128) });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const actor = await getApiAdmin();
  if ("error" in actor) return actor.error;
  const userId = z.string().uuid().safeParse((await context.params).id);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!userId.success || !parsed.success) return NextResponse.json({ error: "Choose a valid employee and temporary password." }, { status: 400 });

  const { data: profile } = await actor.admin.from("profiles")
    .select("id,full_name,email,role,active")
    .eq("id", userId.data)
    .neq("role", "super_admin")
    .maybeSingle();
  if (!profile) return NextResponse.json({ error: "The employee account was not found." }, { status: 404 });

  const { error: authError } = await actor.admin.auth.admin.updateUserById(profile.id, {
    password: parsed.data.temporary_password,
  });
  if (authError) return NextResponse.json({ error: "The sign-in password could not be reset." }, { status: 502 });

  const { error: profileError } = await actor.admin.from("profiles")
    .update({ must_reset_password: true })
    .eq("id", profile.id);
  if (profileError) return NextResponse.json({ error: "The password changed, but the first-login reset flag could not be saved." }, { status: 500 });

  const email = await sendPasswordResetEmail({
    fullName: profile.full_name,
    email: profile.email,
    temporaryPassword: parsed.data.temporary_password,
  });
  await notifyUsers({
    recipientIds: [profile.id],
    kind: "account",
    title: "Password reset by your administrator",
    body: "A new temporary password was created for your account. Check your email or contact your administrator, then choose a new password after signing in.",
    actionUrl: "/auth/update-password",
    dedupeKey: `password-reset:${profile.id}:${Date.now()}`,
  });
  return NextResponse.json({ success: true, email });
}
