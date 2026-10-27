import { NextResponse } from "next/server";
import { z } from "zod";
import ipaddr from "ipaddr.js";
import { getApiAdmin } from "@/lib/api-auth";
import { networkRuleForIp } from "@/lib/attendance";

const schema = z.object({
  name: z.string().trim().min(2).max(80),
  code: z.string().trim().min(2).max(8).regex(/^[a-zA-Z0-9-]+$/),
  address: z.string().trim().min(5).max(300),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radius_m: z.coerce.number().int().min(50).max(1000),
  verification_mode: z.enum(["gps_and_ip", "gps_or_ip", "gps_only"]),
  network_label: z.string().trim().max(80).optional().default("Office Wi-Fi"),
  ip_rule: z.string().trim().max(80).optional().default(""),
});

function validIpRule(value: string) {
  if (!value) return true;
  try {
    if (value.includes("/")) ipaddr.parseCIDR(value);
    else ipaddr.parse(value);
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const actor = await getApiAdmin();
  if ("error" in actor) return actor.error;
  if (actor.profile.role !== "super_admin") return NextResponse.json({ error: "Only a super admin can create branches." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the branch details and try again." }, { status: 400 });
  const input = parsed.data;
  if (input.verification_mode !== "gps_only" && !input.ip_rule) return NextResponse.json({ error: "Add the office public IP for network verification." }, { status: 400 });
  if (!validIpRule(input.ip_rule)) return NextResponse.json({ error: "Enter a valid IPv4, IPv6 or CIDR network." }, { status: 400 });

  const { data: branch, error } = await actor.admin.from("branches").insert({
    name: input.name,
    code: input.code.toUpperCase(),
    address: input.address,
    latitude: input.latitude,
    longitude: input.longitude,
    radius_m: input.radius_m,
    verification_mode: input.verification_mode,
    created_by: actor.user.id,
  }).select().single();
  if (error) return NextResponse.json({ error: error.code === "23505" ? "That branch name or code already exists." : "The branch could not be created." }, { status: 409 });

  let networks = [];
  if (input.ip_rule) {
    const safeRule = input.ip_rule.includes("/") ? input.ip_rule : networkRuleForIp(input.ip_rule);
    const { data } = await actor.admin.from("branch_networks").insert({ branch_id: branch.id, label: input.network_label || "Office Wi-Fi", ip_rule: safeRule || input.ip_rule }).select();
    networks = data ?? [];
  }
  return NextResponse.json({ branch: { ...branch, branch_networks: networks } }, { status: 201 });
}
