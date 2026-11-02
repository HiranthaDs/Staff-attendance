import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { getCurrentProfile } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Super admin sign in",
  description: "Secure sign in for Presence platform administrators.",
  robots: { index: false, follow: false, noarchive: true },
};

export default async function SuperAdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; email?: string | string[] }>;
}) {
  const params = await searchParams;
  const profile = await getCurrentProfile().catch(() => null);
  if (profile?.active && profile.role === "super_admin" && !profile.must_reset_password) {
    redirect("/super-admin");
  }

  return (
    <LoginForm
      initialErrorCode={typeof params.error === "string" ? params.error : ""}
      initialEmail={typeof params.email === "string" ? params.email : ""}
      nextPath="/super-admin"
      portal="platform"
    />
  );
}
