import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiAdmin } from "@/lib/api-auth";
import { isTrustedMutationOrigin } from "@/lib/attendance-backend";
import { databaseMutationError, isMigrationRequired } from "@/lib/database-errors";

const schema = z.object({
  name: z.string().trim().min(2).max(80),
  code: z.string().trim().min(2).max(8).regex(/^[a-zA-Z0-9-]+$/),
  address: z.string().trim().min(5).max(300),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radius_m: z.coerce.number().int().min(50).max(1000),
  late_grace_minutes: z.coerce.number().int().min(0).max(120).default(10),
  early_leave_grace_minutes: z.coerce.number().int().min(0).max(120).default(10),
});

export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const actor = await getApiAdmin();
  if ("error" in actor) return actor.error;
  if (actor.profile.role !== "super_admin") return NextResponse.json({ error: "Only a super admin can create branches." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the branch details and try again." }, { status: 400 });
  const input = parsed.data;

  const branchValues = {
    name: input.name,
    code: input.code.toUpperCase(),
    address: input.address,
    latitude: input.latitude,
    longitude: input.longitude,
    radius_m: input.radius_m,
    verification_mode: "gps_only",
    late_grace_minutes: input.late_grace_minutes,
    early_leave_grace_minutes: input.early_leave_grace_minutes,
    created_by: actor.user.id,
  };
  let { data: branch, error } = await actor.admin.from("branches").insert(branchValues).select().single();
  let legacySchema = false;
  if (error && isMigrationRequired(error)) {
    const { early_leave_grace_minutes: _omitted, ...legacyValues } = branchValues;
    void _omitted;
    const legacyResult = await actor.admin.from("branches").insert(legacyValues).select().single();
    branch = legacyResult.data;
    error = legacyResult.error;
    legacySchema = !legacyResult.error;
  }
  if (error || !branch) {
    if (error?.code === "23505") return NextResponse.json({ error: "That branch name or code already exists." }, { status: 409 });
    return databaseMutationError(error, "The branch could not be created. Check the database connection and try again.");
  }

  return NextResponse.json({ branch, migrationRequired: legacySchema }, { status: 201 });
}

const updateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  code: z.string().trim().min(2).max(8).regex(/^[a-zA-Z0-9-]+$/),
  address: z.string().trim().min(5).max(300),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radius_m: z.coerce.number().int().min(50).max(1000),
  late_grace_minutes: z.coerce.number().int().min(0).max(120),
  early_leave_grace_minutes: z.coerce.number().int().min(0).max(120),
});

export async function PATCH(request: Request) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const actor = await getApiAdmin();
  if ("error" in actor) return actor.error;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the branch policy values and try again." }, { status: 400 });

  const input = parsed.data;
  const { data: currentBranch, error: currentBranchError } = await actor.admin.from("branches").select("id").eq("id", input.id).maybeSingle();
  if (currentBranchError) return databaseMutationError(currentBranchError, "The branch details could not be loaded.");
  if (!currentBranch) return NextResponse.json({ error: "The branch was not found." }, { status: 404 });

  const branchValues = {
    name: input.name,
    code: input.code.toUpperCase(),
    address: input.address,
    latitude: input.latitude,
    longitude: input.longitude,
    radius_m: input.radius_m,
    verification_mode: "gps_only",
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

  const { data: updated, error: reloadError } = await actor.admin.from("branches").select("*").eq("id", branch.id).single();
  if (reloadError) return databaseMutationError(reloadError, "The branch was saved but could not be reloaded.");
  return NextResponse.json({
    branch: updated,
    migrationRequired: legacySchema,
  });
}
