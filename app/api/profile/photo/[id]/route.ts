import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiActor } from "@/lib/api-auth";
import { canManageProfilePhoto } from "@/lib/profile-photo-access";
import type { Profile } from "@/lib/types";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getApiActor();
  if ("error" in actor) return actor.error;
  const parsed = z.string().uuid().safeParse((await context.params).id);
  if (!parsed.success) return new NextResponse(null, { status: 404 });
  const { data: target } = await actor.serviceAdmin.from("profiles")
    .select("id,organization_id,branch_id,avatar_path")
    .eq("id", parsed.data)
    .maybeSingle();
  if (!target?.avatar_path || !canManageProfilePhoto(actor.profile, target as Profile)) return new NextResponse(null, { status: 404 });
  const { data, error } = await actor.serviceAdmin.storage.from("profile-photos").createSignedUrl(target.avatar_path, 300);
  if (error || !data?.signedUrl) return new NextResponse(null, { status: 404 });
  return NextResponse.redirect(data.signedUrl, { status: 307, headers: { "cache-control": "private, max-age=240" } });
}
