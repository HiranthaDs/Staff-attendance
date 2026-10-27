import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiActor } from "@/lib/api-auth";

const schema = z.object({ password: z.string().min(10).max(128) });

export async function POST(request: Request) {
  const actor = await getApiActor();
  if ("error" in actor) return actor.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Use a password with at least 10 characters." }, { status: 400 });
  // Keep the current browser session valid while changing its password. An
  // admin-level password change revokes the user's refresh token.
  const { error } = await actor.sessionClient.auth.updateUser({ password: parsed.data.password });
  if (error) return NextResponse.json({ error: "Password could not be updated." }, { status: 500 });
  await actor.admin.from("profiles").update({ must_reset_password: false }).eq("id", actor.user.id);
  return NextResponse.json({ success: true });
}
