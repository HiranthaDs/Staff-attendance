import { JoinWorkspaceForm } from "@/components/auth/join-workspace-form";

export default async function JoinWorkspacePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <main className="join-page"><section className="join-brand-panel"><div><span className="eyebrow">PRESENCE FOR TEAMS</span><h1>One secure workspace for every office.</h1><p>Your invitation connects you to the right company and branch automatically.</p><div className="join-trust"><span>✓ One-time invitation</span><span>✓ Company-isolated data</span><span>✓ Secure password setup</span></div></div></section><section className="join-form-panel"><JoinWorkspaceForm token={token} /></section></main>;
}
