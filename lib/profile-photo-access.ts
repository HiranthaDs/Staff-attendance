import type { Profile } from "@/lib/types";

export function canManageProfilePhoto(actor: Profile, target: Pick<Profile, "id" | "organization_id" | "branch_id">) {
  if (actor.id === target.id || actor.role === "super_admin") return true;
  if (!actor.organization_id || actor.organization_id !== target.organization_id) return false;
  if (actor.role === "company_admin") return true;
  return actor.role === "branch_admin" && Boolean(actor.branch_id) && actor.branch_id === target.branch_id;
}
