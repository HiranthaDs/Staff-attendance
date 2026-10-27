import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiActor } from "@/lib/api-auth";
import { isTrustedMutationOrigin } from "@/lib/attendance-backend";

const schema = z.object({
  push_enabled: z.boolean(),
  attendance_reminders: z.boolean(),
  leave_updates: z.boolean(),
  calendar_updates: z.boolean(),
  reminder_minutes: z.coerce.number().int().min(0).max(60),
});

export async function PATCH(request: Request) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const actor = await getApiActor();
  if ("error" in actor) return actor.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the notification preferences and try again." }, { status: 400 });
  const { data: preferences, error } = await actor.admin.from("notification_preferences").upsert({
    user_id: actor.user.id,
    ...parsed.data,
  }, { onConflict: "user_id" }).select().single();
  if (error) return NextResponse.json({ error: "Notification preferences could not be saved." }, { status: 500 });
  return NextResponse.json({ preferences });
}
