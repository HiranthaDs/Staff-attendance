import { NextResponse } from "next/server";
import { getApiAdmin } from "@/lib/api-auth";
import { isTrustedMutationOrigin } from "@/lib/attendance-backend";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedMutationOrigin(request)) return NextResponse.json({ error: "This request did not come from the app." }, { status: 403 });
  const actor = await getApiAdmin();
  if ("error" in actor) return actor.error;
  if (actor.profile.role !== "company_admin") {
    return NextResponse.json({ error: "Only a company owner can approve a new branch." }, { status: 403 });
  }
  const { id } = await context.params;
  const { data: visibleSubmission } = await actor.admin.from("branch_setup_submissions").select("id").eq("id", id).maybeSingle();
  if (!visibleSubmission) return NextResponse.json({ error: "The branch submission was not found." }, { status: 404 });
  const { data: branch, error } = await actor.serviceAdmin.rpc("approve_branch_setup", {
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
