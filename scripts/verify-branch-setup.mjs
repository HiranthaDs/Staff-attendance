import { createInterface } from "node:readline";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
process.stdout.write("Super-admin password for branch setup verification: ");
rl._writeToOutput = () => {};
const password = await new Promise((resolve) => rl.question("", resolve));
rl.close();
process.stdout.write("\n");

const cookieJar = new Map();
const session = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  cookies: {
    getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })),
    setAll: (cookies) => cookies.forEach(({ name, value }) => cookieJar.set(name, value)),
  },
});
const { error: loginError } = await session.auth.signInWithPassword({ email: "hiranthadiass4@gmail.com", password });
if (loginError) throw loginError;
const cookie = [...cookieJar].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; ");
const adminHeaders = { cookie, "content-type": "application/json" };
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

let inviteId = null;
let branchId = null;
try {
  const suffix = String(Date.now()).slice(-6);
  const inviteResponse = await fetch("http://localhost:3000/api/admin/branch-invites", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ proposed_name: `Flow Test ${suffix}`, proposed_code: `T${suffix}`, radius_m: 200, expires_in_hours: 1 }),
  });
  const inviteResult = await inviteResponse.json();
  if (!inviteResponse.ok) throw new Error(`Invite API failed: ${inviteResult.error}`);
  inviteId = inviteResult.invite.id;
  const token = inviteResult.link.split("/").pop();

  const readResponse = await fetch(`http://localhost:3000/api/branch-setup/${token}`);
  const readResult = await readResponse.json();
  if (!readResponse.ok || readResult.invite.status !== "pending") throw new Error("Public setup link could not be read.");

  const submissionResponse = await fetch(`http://localhost:3000/api/branch-setup/${token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      address: "Disposable verification branch, Colombo",
      latitude: 6.927079,
      longitude: 79.861244,
      accuracy_m: 10,
      captured_at: new Date().toISOString(),
      evidence_latitude: 6.927079,
      evidence_longitude: 79.861244,
      sample_count: 1,
      consensus_count: 1,
      spread_m: 0,
      device_info: { platform: "verification-script" },
      manager_name: "Verification Manager",
      manager_phone: "+94 77 000 0000",
      notes: "Automatically removed after verification.",
    }),
  });
  const submissionResult = await submissionResponse.json();
  if (!submissionResponse.ok) throw new Error(`Submission API failed: ${submissionResult.error}`);

  const approvalResponse = await fetch(`http://localhost:3000/api/admin/branch-submissions/${submissionResult.submission_id}/approve`, { method: "POST", headers: adminHeaders });
  const approvalResult = await approvalResponse.json();
  if (!approvalResponse.ok) throw new Error(`Approval API failed: ${approvalResult.error}`);
  branchId = approvalResult.branch.id;
  if (approvalResult.branch.verification_mode !== "gps_only") throw new Error("Approved branch did not use location-only attendance.");
  process.stdout.write("Branch setup verification passed: generated, location captured and approved.\n");
} finally {
  if (branchId) await service.from("branches").delete().eq("id", branchId);
  if (inviteId) await service.from("branch_setup_invites").delete().eq("id", inviteId);
  process.stdout.write("Disposable branch setup records removed.\n");
}
