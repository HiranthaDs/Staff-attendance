import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiActor } from "@/lib/api-auth";
import { isTrustedMutationOrigin } from "@/lib/attendance-backend";

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2_000),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(20).max(500),
    auth: z.string().min(8).max(500),
  }),
});

export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const actor = await getApiActor();
  if ("error" in actor) return actor.error;
  const parsed = subscriptionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "The device notification subscription is invalid." }, { status: 400 });
  const { error } = await actor.admin.from("push_subscriptions").upsert({
    user_id: actor.user.id,
    endpoint: parsed.data.endpoint,
    expiration_time: parsed.data.expirationTime ?? null,
    p256dh: parsed.data.keys.p256dh,
    auth: parsed.data.keys.auth,
    user_agent: request.headers.get("user-agent")?.slice(0, 500) || null,
    active: true,
  }, { onConflict: "endpoint" });
  if (error) return NextResponse.json({ error: "The device could not be registered for notifications." }, { status: 500 });
  await actor.admin.from("notification_preferences").upsert({ user_id: actor.user.id, push_enabled: true }, { onConflict: "user_id" });
  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const actor = await getApiActor();
  if ("error" in actor) return actor.error;
  const parsed = z.object({ endpoint: z.string().url().max(2_000) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid device subscription." }, { status: 400 });
  await actor.admin.from("push_subscriptions").update({ active: false }).eq("user_id", actor.user.id).eq("endpoint", parsed.data.endpoint);
  return NextResponse.json({ success: true });
}
