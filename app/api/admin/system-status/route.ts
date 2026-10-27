import { NextResponse } from "next/server";
import { getApiAdmin } from "@/lib/api-auth";
import { isPushConfigured } from "@/lib/notifications";

export async function GET() {
  const actor = await getApiAdmin();
  if ("error" in actor) return actor.error;
  return NextResponse.json({
    pushConfigured: isPushConfigured(),
    emailConfigured: Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim()),
    reminderScheduleConfigured: Boolean(process.env.CRON_SECRET?.trim()),
  }, { headers: { "cache-control": "private, no-store" } });
}
