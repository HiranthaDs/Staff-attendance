import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { getCurrentProfile } from "@/lib/auth";
import { isPlatformOwnerProfile } from "@/lib/platform-owner";

export const metadata: Metadata = {
  title: "System owner sign in",
  description: "Private access for the Presence system owner.",
  robots: { index: false, follow: false, noarchive: true },
};

export default async function SystemOwnerLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; email?: string | string[] }>;
}) {
  const params = await searchParams;
  const profile = await getCurrentProfile().catch(() => null);
  if (profile?.active && isPlatformOwnerProfile(profile) && !profile.must_reset_password) {
    redirect("/system-owner");
  }

  return <LoginForm
    initialErrorCode={typeof params.error === "string" ? params.error : ""}
    initialEmail={typeof params.email === "string" ? params.email : ""}
    nextPath="/system-owner"
    portal="owner"
  />;
}
