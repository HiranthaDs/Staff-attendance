import { createInterface } from "node:readline";
import { createClient } from "@supabase/supabase-js";

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
process.stdout.write("Super-admin password for verification: ");
rl._writeToOutput = () => {};
const password = await new Promise((resolve) => rl.question("", resolve));
rl.close();
process.stdout.write("\n");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const anonymous = createClient(url, key, { auth: { persistSession: false } });

const anonRead = await anonymous.from("profiles").select("id").limit(1);
if (!anonRead.error) throw new Error("Anonymous profile reads should be denied by RLS/grants.");

const auth = createClient(url, key, { auth: { persistSession: false } });
const { data: signedIn, error: signInError } = await auth.auth.signInWithPassword({
  email: "hiranthadiass4@gmail.com",
  password,
});
if (signInError || !signedIn.user) throw signInError || new Error("Could not sign in.");

const { data: profile, error: profileError } = await auth.from("profiles").select("role, active").eq("id", signedIn.user.id).single();
if (profileError || profile?.role !== "super_admin" || !profile.active) {
  throw profileError || new Error("Super-admin profile is not active.");
}

const forbiddenRpc = await auth.rpc("record_attendance_mark", {
  p_user_id: signedIn.user.id,
  p_branch_id: "00000000-0000-0000-0000-000000000000",
  p_attendance_date: "2026-01-01",
  p_action: "clock_in",
  p_now: new Date().toISOString(),
  p_latitude: 0,
  p_longitude: 0,
  p_accuracy_m: 1,
  p_distance_m: 0,
  p_client_ip: "127.0.0.1",
  p_gps_passed: true,
  p_ip_passed: true,
  p_status: "present",
  p_late_minutes: 0,
  p_early_leave_minutes: 0,
});
if (!forbiddenRpc.error) throw new Error("Attendance RPC must not be callable by authenticated browser clients.");

await auth.auth.signOut();
process.stdout.write("Live verification passed: auth, super-admin profile, anonymous denial and RPC permissions.\n");
