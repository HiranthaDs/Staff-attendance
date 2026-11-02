import { redirect } from "next/navigation";

export default async function SuperAdminPage() {
  redirect("/system-owner");
}
