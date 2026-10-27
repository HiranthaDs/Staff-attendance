import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; next?: string | string[] }>;
}) {
  const params = await searchParams;
  const errorCode = typeof params.error === "string" ? params.error : "";
  const requestedPath = typeof params.next === "string" ? params.next : "/";
  const nextPath = requestedPath.startsWith("/") && !requestedPath.startsWith("//")
    ? requestedPath
    : "/";
  return <LoginForm initialErrorCode={errorCode} nextPath={nextPath} />;
}
