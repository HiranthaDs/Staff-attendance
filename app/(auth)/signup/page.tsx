import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CompanySignupForm } from "@/components/auth/company-signup-form";
import { getCurrentProfile } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Create a company account",
  description: "Create a company workspace and its first company super-admin account.",
  robots: { index: false, follow: false, noarchive: true },
};

export default async function CompanySignupPage() {
  const profile = await getCurrentProfile().catch(() => null);
  if (profile?.active) redirect(profile.role === "super_admin" ? "/system-owner" : profile.role === "company_admin" || profile.role === "branch_admin" ? "/admin" : "/app");
  return <CompanySignupForm />;
}
