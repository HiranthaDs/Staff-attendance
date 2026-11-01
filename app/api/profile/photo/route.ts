import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiActor } from "@/lib/api-auth";
import { isTrustedMutationOrigin } from "@/lib/attendance-backend";
import { canManageProfilePhoto } from "@/lib/profile-photo-access";
import { readProfileImageDimensions } from "@/lib/profile-photo-server";
import type { Profile } from "@/lib/types";

const targetSchema = z.string().uuid();
const allowedTypes = new Map([["image/webp", "webp"], ["image/jpeg", "jpg"]]);
const maximumBytes = 100 * 1024;

export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const actor = await getApiActor();
  if ("error" in actor) return actor.error;
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "The image upload could not be read." }, { status: 400 });
  const file = form.get("photo");
  const requestedId = String(form.get("user_id") || actor.user.id);
  const parsedId = targetSchema.safeParse(requestedId);
  if (!parsedId.success || !(file instanceof File)) return NextResponse.json({ error: "Choose a valid profile image." }, { status: 400 });
  const extension = allowedTypes.get(file.type);
  if (!extension || file.size < 100 || file.size > maximumBytes) {
    return NextResponse.json({ error: "Use a compressed WebP or JPEG profile image smaller than 100 KB." }, { status: 400 });
  }

  const { data: target } = await actor.serviceAdmin.from("profiles")
    .select("id,organization_id,branch_id,avatar_path,active")
    .eq("id", parsedId.data)
    .maybeSingle();
  if (!target || !target.active) return NextResponse.json({ error: "The staff profile was not found or is disabled." }, { status: 404 });
  if (!canManageProfilePhoto(actor.profile, target as Profile)) return NextResponse.json({ error: "You cannot update this profile image." }, { status: 403 });

  const scope = target.organization_id || "platform";
  const path = `${scope}/${target.id}/${crypto.randomUUID()}.${extension}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const dimensions = readProfileImageDimensions(bytes, file.type);
  if (!dimensions || dimensions.width !== 192 || dimensions.height !== 192) {
    return NextResponse.json({ error: "Profile photos must be the app-compressed 192 × 192 format." }, { status: 400 });
  }
  const { error: uploadError } = await actor.serviceAdmin.storage.from("profile-photos").upload(path, bytes, {
    contentType: file.type,
    cacheControl: "31536000",
    upsert: false,
  });
  if (uploadError) return NextResponse.json({ error: "The profile image could not be uploaded." }, { status: 500 });

  const { error: updateError } = await actor.serviceAdmin.from("profiles").update({ avatar_path: path }).eq("id", target.id);
  if (updateError) {
    await actor.serviceAdmin.storage.from("profile-photos").remove([path]);
    return NextResponse.json({ error: "The profile image could not be attached to the staff record." }, { status: 500 });
  }
  if (target.avatar_path) await actor.serviceAdmin.storage.from("profile-photos").remove([target.avatar_path]);
  return NextResponse.json({ avatar_path: path, photo_url: `/api/profile/photo/${target.id}?v=${Date.now()}` });
}
export async function DELETE(request: Request) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const actor = await getApiActor();
  if ("error" in actor) return actor.error;
  const body = await request.json().catch(() => ({}));
  const parsedId = targetSchema.safeParse(body.user_id || actor.user.id);
  if (!parsedId.success) return NextResponse.json({ error: "Choose a valid profile." }, { status: 400 });
  const { data: target } = await actor.serviceAdmin.from("profiles").select("id,organization_id,branch_id,avatar_path").eq("id", parsedId.data).maybeSingle();
  if (!target) return NextResponse.json({ error: "The staff profile was not found." }, { status: 404 });
  if (!canManageProfilePhoto(actor.profile, target as Profile)) return NextResponse.json({ error: "You cannot update this profile image." }, { status: 403 });
  const { error } = await actor.serviceAdmin.from("profiles").update({ avatar_path: null }).eq("id", target.id);
  if (error) return NextResponse.json({ error: "The profile image could not be removed." }, { status: 500 });
  if (target.avatar_path) await actor.serviceAdmin.storage.from("profile-photos").remove([target.avatar_path]);
  return NextResponse.json({ success: true });
}
