import { redirect } from "next/navigation";

export default async function SuperAdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; email?: string | string[] }>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  if (typeof params.error === "string") query.set("error", params.error);
  if (typeof params.email === "string") query.set("email", params.email);
  redirect(`/system-owner/login${query.size ? `?${query}` : ""}`);
}
