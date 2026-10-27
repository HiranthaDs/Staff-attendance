import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";

export default async function Home() {
  const profile = await requireProfile();
  redirect(profile.role === "super_admin" ? "/admin" : "/app");
}
