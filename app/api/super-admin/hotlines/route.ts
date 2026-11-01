import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiSuperAdmin } from "@/lib/api-auth";
import { isTrustedMutationOrigin } from "@/lib/attendance-backend";

const contactFields = z.object({
  label: z.string().trim().min(2).max(60),
  phone: z.string().trim().min(7).max(30),
  availability: z.string().trim().max(100).optional().default(""),
  call_enabled: z.boolean().default(true),
  whatsapp_enabled: z.boolean().default(true),
  active: z.boolean().default(true),
  sort_order: z.coerce.number().int().min(0).max(1000).default(0),
});
const contactSchema = contactFields.refine((input) => input.call_enabled || input.whatsapp_enabled, {
  message: "Enable calling, WhatsApp, or both.",
});

const updateSchema = contactFields.partial().extend({ id: z.string().uuid() });
const deleteSchema = z.object({ id: z.string().uuid() });

function normalizePhone(value: string) {
  const compact = value.trim().replace(/[\s()-]/g, "");
  const normalized = compact.startsWith("00")
    ? `+${compact.slice(2)}`
    : compact.startsWith("+")
      ? compact
      : compact.startsWith("0")
        ? `+94${compact.slice(1)}`
        : `+${compact}`;
  return /^\+[1-9][0-9]{7,14}$/.test(normalized) ? normalized : null;
}
export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const actor = await getApiSuperAdmin();
  if ("error" in actor) return actor.error;
  const parsed = contactSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Check the support contact details." }, { status: 400 });
  const phone = normalizePhone(parsed.data.phone);
  if (!phone) return NextResponse.json({ error: "Enter a valid phone number with its country code." }, { status: 400 });

  const { data, error } = await actor.serviceAdmin.from("platform_hotlines").insert({
    label: parsed.data.label,
    phone_e164: phone,
    availability: parsed.data.availability || null,
    call_enabled: parsed.data.call_enabled,
    whatsapp_enabled: parsed.data.whatsapp_enabled,
    active: parsed.data.active,
    sort_order: parsed.data.sort_order,
    created_by: actor.user.id,
  }).select("id,label,phone_e164,availability,call_enabled,whatsapp_enabled,active,sort_order,created_at,updated_at").single();
  if (error) return NextResponse.json({ error: "The support contact could not be created." }, { status: 500 });
  return NextResponse.json({ hotline: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const actor = await getApiSuperAdmin();
  if ("error" in actor) return actor.error;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Check the support contact update." }, { status: 400 });
  const { id, phone, ...input } = parsed.data;
  const { data: existing } = await actor.serviceAdmin.from("platform_hotlines").select("call_enabled,whatsapp_enabled").eq("id", id).maybeSingle();
  if (!existing) return NextResponse.json({ error: "The support contact was not found." }, { status: 404 });
  if (!(input.call_enabled ?? existing.call_enabled) && !(input.whatsapp_enabled ?? existing.whatsapp_enabled)) {
    return NextResponse.json({ error: "Enable calling, WhatsApp, or both." }, { status: 400 });
  }
  const phoneE164 = phone === undefined ? undefined : normalizePhone(phone);
  if (phone !== undefined && !phoneE164) return NextResponse.json({ error: "Enter a valid phone number with its country code." }, { status: 400 });
  const update = {
    ...input,
    ...(phoneE164 ? { phone_e164: phoneE164 } : {}),
    ...(input.availability !== undefined ? { availability: input.availability || null } : {}),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await actor.serviceAdmin.from("platform_hotlines").update(update)
    .eq("id", id)
    .select("id,label,phone_e164,availability,call_enabled,whatsapp_enabled,active,sort_order,created_at,updated_at")
    .maybeSingle();
  if (error) return NextResponse.json({ error: "The support contact could not be updated." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "The support contact was not found." }, { status: 404 });
  return NextResponse.json({ hotline: data });
}

export async function DELETE(request: Request) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const actor = await getApiSuperAdmin();
  if ("error" in actor) return actor.error;
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid support contact." }, { status: 400 });
  const { data, error } = await actor.serviceAdmin.from("platform_hotlines")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("id", parsed.data.id)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: "The support contact could not be disabled." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "The support contact was not found." }, { status: 404 });
  return NextResponse.json({ success: true });
}
