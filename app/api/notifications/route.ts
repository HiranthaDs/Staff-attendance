import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiActor } from "@/lib/api-auth";
import { isTrustedMutationOrigin } from "@/lib/attendance-backend";
import { isPushConfigured } from "@/lib/notifications";

const patchSchema = z.object({
  id: z.string().uuid().optional(),
  all: z.boolean().optional(),
}).refine((value) => value.id || value.all, "Choose a notification.");

export async function GET() {
  const actor = await getApiActor();
  if ("error" in actor) return actor.error;
  const [{ data: notifications, error }, { data: preferences }] = await Promise.all([
    actor.admin.from("notifications")
      .select("id,kind,title,body,action_url,read_at,created_at")
      .eq("recipient_id", actor.user.id)
      .order("created_at", { ascending: false })
      .limit(40),
    actor.admin.from("notification_preferences")
      .select("push_enabled,attendance_reminders,leave_updates,calendar_updates,reminder_minutes")
      .eq("user_id", actor.user.id)
      .maybeSingle(),
  ]);
  if (error) {
    return NextResponse.json({
      notifications: [],
      unread: 0,
      migrationRequired: true,
      pushConfigured: isPushConfigured(),
      preferences: null,
    });
  }
  return NextResponse.json({
    notifications: notifications ?? [],
    unread: (notifications ?? []).filter((notification) => !notification.read_at).length,
    preferences,
    pushConfigured: isPushConfigured(),
  }, { headers: { "cache-control": "private, no-store" } });
}

export async function PATCH(request: Request) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const actor = await getApiActor();
  if ("error" in actor) return actor.error;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a notification to mark as read." }, { status: 400 });
  let query = actor.admin.from("notifications").update({ read_at: new Date().toISOString() }).eq("recipient_id", actor.user.id).is("read_at", null);
  if (parsed.data.id) query = query.eq("id", parsed.data.id);
  const { error } = await query;
  if (error) return NextResponse.json({ error: "The notification could not be updated." }, { status: 500 });
  return NextResponse.json({ success: true });
}
