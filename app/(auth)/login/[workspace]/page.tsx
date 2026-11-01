import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { createAdminClient } from "@/lib/supabase/admin";

type Props = {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ error?: string | string[]; next?: string | string[]; email?: string | string[] }>;
};

async function loadWorkspace(slug: string) {
  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug)) return null;
  const { data } = await createAdminClient().from("organizations")
    .select("name,slug,status").eq("slug", slug).maybeSingle();
  return data?.status === "active" ? data : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const workspace = await loadWorkspace((await params).workspace);
  return {
    title: workspace ? `${workspace.name} sign in` : "Company sign in",
    description: workspace ? `Secure attendance portal for ${workspace.name}.` : "Secure company attendance portal.",
    robots: { index: false, follow: false, noarchive: true },
  };
}

export default async function WorkspaceLoginPage({ params, searchParams }: Props) {
  const slug = (await params).workspace.toLowerCase();
  const workspace = await loadWorkspace(slug);
  if (!workspace) notFound();
  const query = await searchParams;
  const requestedPath = typeof query.next === "string" ? query.next : "/";
  const nextPath = requestedPath.startsWith("/") && !requestedPath.startsWith("//") ? requestedPath : "/";
  return <LoginForm
    initialErrorCode={typeof query.error === "string" ? query.error : ""}
    initialEmail={typeof query.email === "string" ? query.email : ""}
    nextPath={nextPath}
    workspaceSlug={workspace.slug}
    workspaceName={workspace.name}
  />;
}
