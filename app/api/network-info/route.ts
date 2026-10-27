import { NextResponse } from "next/server";
import { getApiActor } from "@/lib/api-auth";
import { resolveRequestIp } from "@/lib/attendance";

export async function GET(request: Request) {
  const actor = await getApiActor();
  if ("error" in actor) return actor.error;
  const evidence = await resolveRequestIp(request.headers, { allowLocalEgressFallback: true });
  return NextResponse.json({
    ip: evidence.verified ? evidence.ip : null,
    verified: evidence.verified,
    source: evidence.source,
    evidence_count: evidence.evidenceCount,
  });
}
