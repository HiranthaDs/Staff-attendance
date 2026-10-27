import "server-only";
import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";

export type NotificationKind = "attendance" | "calendar" | "leave" | "account" | "system";

type NotificationInput = {
  recipientIds: string[];
  kind: NotificationKind;
  title: string;
  body: string;
  actionUrl: string;
  dedupeKey?: string;
};

function configureWebPush() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:admin@example.com";
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

export function isPushConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() && process.env.VAPID_PRIVATE_KEY?.trim());
}

export async function notifyUsers(input: NotificationInput) {
  const recipientIds = [...new Set(input.recipientIds.filter(Boolean))];
  if (!recipientIds.length) return { created: 0, pushed: 0 };
  const admin = createAdminClient();
  const rows = recipientIds.map((recipientId) => ({
    recipient_id: recipientId,
    kind: input.kind,
    title: input.title.slice(0, 120),
    body: input.body.slice(0, 500),
    action_url: input.actionUrl.startsWith("/") ? input.actionUrl : "/app",
    dedupe_key: input.dedupeKey ? `${input.dedupeKey}:${recipientId}`.slice(0, 240) : null,
  }));

  const insert = await admin.from("notifications").upsert(rows, {
    onConflict: "recipient_id,dedupe_key",
    ignoreDuplicates: true,
  }).select("recipient_id");
  if (insert.error) {
    // Notification delivery must never roll back the business action that triggered it.
    console.error("Presence notification storage failed", { code: insert.error.code });
    return { created: 0, pushed: 0 };
  }
  const createdRecipients = [...new Set((insert.data ?? []).map((row) => row.recipient_id as string))];
  if (!createdRecipients.length || !configureWebPush()) return { created: createdRecipients.length, pushed: 0 };

  const [{ data: subscriptions }, { data: preferences }] = await Promise.all([
    admin.from("push_subscriptions").select("id,user_id,endpoint,p256dh,auth").in("user_id", createdRecipients).eq("active", true),
    admin.from("notification_preferences").select("user_id,push_enabled,attendance_reminders,leave_updates,calendar_updates").in("user_id", createdRecipients),
  ]);
  const preferenceMap = new Map((preferences ?? []).map((preference) => [preference.user_id as string, preference]));
  const payload = JSON.stringify({
    title: input.title,
    body: input.body,
    icon: "/icons/presence-192-v2.png",
    badge: "/icons/presence-192-v2.png",
    url: input.actionUrl,
    kind: input.kind,
  });
  let pushed = 0;
  await Promise.all((subscriptions ?? []).map(async (subscription) => {
    const preference = preferenceMap.get(subscription.user_id as string);
    const kindEnabled = input.kind === "attendance"
      ? preference?.attendance_reminders !== false
      : input.kind === "leave"
        ? preference?.leave_updates !== false
        : input.kind === "calendar"
          ? preference?.calendar_updates !== false
          : true;
    if (preference?.push_enabled === false || !kindEnabled) return;
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint as string,
        keys: { p256dh: subscription.p256dh as string, auth: subscription.auth as string },
      }, payload, { TTL: 60 * 60 * 6, urgency: input.kind === "attendance" ? "high" : "normal" });
      pushed += 1;
    } catch (error) {
      const statusCode = typeof error === "object" && error && "statusCode" in error ? Number(error.statusCode) : 0;
      if (statusCode === 404 || statusCode === 410) {
        await admin.from("push_subscriptions").update({ active: false }).eq("id", subscription.id);
      }
    }
  }));
  return { created: createdRecipients.length, pushed };
}

export async function activeUserIds(branchId?: string | null) {
  const admin = createAdminClient();
  let query = admin.from("profiles").select("id").eq("active", true).neq("role", "super_admin");
  if (branchId) query = query.eq("branch_id", branchId);
  const { data } = await query;
  return (data ?? []).map((profile) => profile.id as string);
}

export async function superAdminIds() {
  const admin = createAdminClient();
  const { data } = await admin.from("profiles").select("id").eq("active", true).eq("role", "super_admin");
  return (data ?? []).map((profile) => profile.id as string);
}
