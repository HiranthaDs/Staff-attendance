import { NextResponse } from "next/server";
import { getApiAdmin } from "@/lib/api-auth";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getApiAdmin();
  if ("error" in actor) return actor.error;
  if (actor.profile.role !== "super_admin") {
    return NextResponse.json({ error: "Only a super admin can approve a new branch." }, { status: 403 });
  }
  const { id } = await context.params;
  const { data: branch, error } = await actor.admin.rpc("approve_branch_setup", {
    p_submission_id: id,
    p_admin_id: actor.user.id,
  });
  if (error) {
    const duplicate = error.message.includes("duplicate key") || error.code === "23505";
    return NextResponse.json({ error: duplicate ? "A branch already uses this name or code." : "The branch could not be created." }, { status: 409 });
  }
  const { data: completeBranch } = await actor.admin.from("branches").select("*").eq("id", branch.id).single();
  return NextResponse.json({ branch: completeBranch ?? branch });
}
