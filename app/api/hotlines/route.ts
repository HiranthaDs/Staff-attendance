import { NextResponse } from "next/server";
import { getApiActor } from "@/lib/api-auth";

export async function GET() {
  const actor = await getApiActor();
  if ("error" in actor) return actor.error;

  const { data, error } = await actor.serviceAdmin
    .from("platform_hotlines")
    .select("id,label,phone_e164,availability,call_enabled,whatsapp_enabled,active,sort_order,created_at,updated_at")
    .eq("active", true)
    .order("sort_order")
    .order("created_at");

  if (error) {
    return NextResponse.json({ hotlines: [], migrationRequired: true }, { headers: { "cache-control": "private, no-store" } });
  }
  return NextResponse.json({ hotlines: data ?? [] }, { headers: { "cache-control": "private, no-store" } });
}
