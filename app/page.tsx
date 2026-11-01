import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";

export default async function Home() {
  const profile = await requireProfile();
  redirect(profile.role === "super_admin" ? "/super-admin" : profile.role === "company_admin" || profile.role === "branch_admin" ? "/admin" : "/app");
}
