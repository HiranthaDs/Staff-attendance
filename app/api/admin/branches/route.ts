import { NextResponse } from "next/server";
import { z } from "zod";
import ipaddr from "ipaddr.js";
import { getApiAdmin } from "@/lib/api-auth";
import { networkRuleForIp } from "@/lib/attendance";
import { isTrustedMutationOrigin } from "@/lib/attendance-backend";
import { databaseMutationError, isMigrationRequired } from "@/lib/database-errors";

const schema = z.object({
  name: z.string().trim().min(2).max(80),
  code: z.string().trim().min(2).max(8).regex(/^[a-zA-Z0-9-]+$/),
  address: z.string().trim().min(5).max(300),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radius_m: z.coerce.number().int().min(50).max(1000),
  verification_mode: z.enum(["gps_and_ip", "gps_or_ip", "gps_only"]),
  late_grace_minutes: z.coerce.number().int().min(0).max(120).default(10),
  early_leave_grace_minutes: z.coerce.number().int().min(0).max(120).default(10),
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
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
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
    late_grace_minutes: input.late_grace_minutes,
    early_leave_grace_minutes: input.early_leave_grace_minutes,
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

const updateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  code: z.string().trim().min(2).max(8).regex(/^[a-zA-Z0-9-]+$/),
  address: z.string().trim().min(5).max(300),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radius_m: z.coerce.number().int().min(50).max(1000),
  verification_mode: z.enum(["gps_and_ip", "gps_or_ip", "gps_only"]),
  late_grace_minutes: z.coerce.number().int().min(0).max(120),
  early_leave_grace_minutes: z.coerce.number().int().min(0).max(120),
  network_label: z.string().trim().max(80).optional().default("Office Wi-Fi"),
  ip_rule: z.string().trim().max(80).optional().default(""),
});

export async function PATCH(request: Request) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const actor = await getApiAdmin();
  if ("error" in actor) return actor.error;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the branch policy values and try again." }, { status: 400 });

  const input = parsed.data;
  if (!validIpRule(input.ip_rule)) return NextResponse.json({ error: "Enter a valid IPv4, IPv6 or CIDR network." }, { status: 400 });
  const { data: currentBranch, error: currentBranchError } = await actor.admin.from("branches").select("id, branch_networks(id, label, ip_rule, active)").eq("id", input.id).maybeSingle();
  if (currentBranchError) return databaseMutationError(currentBranchError, "The branch details could not be loaded.");
  if (!currentBranch) return NextResponse.json({ error: "The branch was not found." }, { status: 404 });
  const activeNetworks = (currentBranch.branch_networks ?? []).filter((network) => network.active);
  if (input.verification_mode !== "gps_only") {
    if (!input.ip_rule && !activeNetworks.length) return NextResponse.json({ error: "Add an active office public IP before requiring network verification." }, { status: 409 });
  }

  const branchValues = {
    name: input.name,
    code: input.code.toUpperCase(),
    address: input.address,
    latitude: input.latitude,
    longitude: input.longitude,
    radius_m: input.radius_m,
    verification_mode: input.verification_mode,
    late_grace_minutes: input.late_grace_minutes,
    early_leave_grace_minutes: input.early_leave_grace_minutes,
  };
  let { data: branch, error } = await actor.admin.from("branches").update(branchValues).eq("id", input.id).select().single();
  let legacySchema = false;
  if (error && isMigrationRequired(error)) {
    const legacyBranchValues = {
      name: branchValues.name,
      code: branchValues.code,
      address: branchValues.address,
      latitude: branchValues.latitude,
      longitude: branchValues.longitude,
      radius_m: branchValues.radius_m,
      verification_mode: branchValues.verification_mode,
      late_grace_minutes: branchValues.late_grace_minutes,
    };
    const legacyResult = await actor.admin.from("branches").update(legacyBranchValues).eq("id", input.id).select().single();
    branch = legacyResult.data;
    error = legacyResult.error;
    legacySchema = !legacyResult.error;
  }
  if (error || !branch) {
    if (error?.code === "23505") return NextResponse.json({ error: "That branch name or code is already in use." }, { status: 409 });
    return databaseMutationError(error, "The branch details could not be saved.");
  }

  if (input.ip_rule) {
    const safeRule = input.ip_rule.includes("/") ? input.ip_rule : networkRuleForIp(input.ip_rule);
    const primaryNetwork = activeNetworks[0];
    const networkMutation = primaryNetwork
      ? await actor.admin.from("branch_networks").update({ label: input.network_label || "Office Wi-Fi", ip_rule: safeRule || input.ip_rule, active: true }).eq("id", primaryNetwork.id)
      : await actor.admin.from("branch_networks").insert({ branch_id: input.id, label: input.network_label || "Office Wi-Fi", ip_rule: safeRule || input.ip_rule, active: true });
    if (networkMutation.error) {
      if (isMigrationRequired(networkMutation.error)) return databaseMutationError(networkMutation.error, "The office network could not be saved.");
      return NextResponse.json({ error: networkMutation.error.code === "23505" ? "That office network is already registered for this branch." : "The branch details were saved, but the office network could not be updated." }, { status: 409 });
    }
  }

  const { data: updated, error: reloadError } = await actor.admin.from("branches").select("*, branch_networks(*)").eq("id", branch.id).single();
  if (reloadError) return databaseMutationError(reloadError, "The branch was saved but could not be reloaded.");
  return NextResponse.json({
    branch: updated,
    migrationRequired: legacySchema,
  });
}
