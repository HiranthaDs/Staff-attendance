import { NextResponse } from "next/server";
import { getApiActor } from "@/lib/api-auth";
import { isTrustedMutationOrigin } from "@/lib/attendance-backend";
import { notifyUsers } from "@/lib/notifications";

export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const actor = await getApiActor();
  if ("error" in actor) return actor.error;
  const delivery = await notifyUsers({
    recipientIds: [actor.user.id],
    kind: "system",
    title: "Presence notifications are ready",
    body: "You will receive important attendance, leave and calendar updates on this device.",
    actionUrl: actor.profile.role === "super_admin" ? "/admin" : "/app",
    dedupeKey: `test:${actor.user.id}:${Date.now()}`,
  });
  return NextResponse.json({ success: true, delivery });
}
