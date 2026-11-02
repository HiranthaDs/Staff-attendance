import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiSystemOwner } from "@/lib/api-auth";
import { isTrustedMutationOrigin } from "@/lib/attendance-backend";
import { notifyUsers } from "@/lib/notifications";

const broadcastSchema = z.object({
  audience: z.enum(["everyone", "company_admins", "staff"]),
  organization_id: z.union([z.literal(""), z.string().uuid()]).default(""),
  priority: z.enum(["normal", "urgent"]).default("normal"),
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(5).max(500),
});

export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const actor = await getApiSystemOwner();
  if ("error" in actor) return actor.error;

  const parsed = broadcastSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the audience, title, and message." }, { status: 400 });
  const input = parsed.data;
  const roles = input.audience === "company_admins"
    ? ["company_admin"]
    : input.audience === "staff"
      ? ["branch_admin", "staff"]
      : ["company_admin", "branch_admin", "staff"];

  let recipientsQuery = actor.serviceAdmin.from("profiles").select("id").eq("active", true).in("role", roles).not("organization_id", "is", null);
  if (input.organization_id) recipientsQuery = recipientsQuery.eq("organization_id", input.organization_id);
  const { data: recipients, error } = await recipientsQuery;
  if (error) return NextResponse.json({ error: "The notification audience could not be loaded." }, { status: 500 });

  const title = input.priority === "urgent" ? `Urgent: ${input.title}` : input.title;
  const delivery = await notifyUsers({
    recipientIds: (recipients ?? []).map((recipient) => recipient.id as string),
    kind: "system",
    title,
    body: input.body,
    actionUrl: "/",
    dedupeKey: `system-owner-broadcast:${randomUUID()}`,
  });
  return NextResponse.json({ recipients: recipients?.length ?? 0, delivery });
}
