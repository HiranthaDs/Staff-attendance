import type { Metadata } from "next";
import { BranchSetupCollector } from "@/components/branch-setup/branch-setup-collector";

export const metadata: Metadata = {
  title: "Secure branch setup",
  description: "Capture verified office location and network details for Presence.",
  robots: { index: false, follow: false },
};

export default async function BranchSetupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <BranchSetupCollector token={token} />;
}
