import { createClient } from "@supabase/supabase-js";

const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data: admins, error: adminError } = await service.from("profiles").select("id").eq("role", "super_admin").limit(1);
if (adminError || !admins?.[0]) throw adminError || new Error("A super-admin profile is required.");

const suffix = Date.now().toString().slice(-6);
let branchId = null;
try {
  const values = {
    name: `Direct Branch Check ${suffix}`,
    code: `V${suffix}`,
    address: "Disposable branch verification, Colombo",
    latitude: 6.927079,
    longitude: 79.861244,
    radius_m: 200,
    verification_mode: "gps_only",
    late_grace_minutes: 10,
    early_leave_grace_minutes: 10,
    created_by: admins[0].id,
  };
  let { data: branch, error } = await service.from("branches").insert(values).select().single();
  let legacySchema = false;
  if (error?.code === "PGRST204" || error?.code === "42703") {
    const { early_leave_grace_minutes: _omitted, ...legacyValues } = values;
    void _omitted;
    const legacy = await service.from("branches").insert(legacyValues).select().single();
    branch = legacy.data;
    error = legacy.error;
    legacySchema = !legacy.error;
  }
  if (error || !branch) throw error || new Error("Direct branch insert returned no branch.");
  branchId = branch.id;
  process.stdout.write(`Direct branch creation passed against the connected database${legacySchema ? " using the compatibility path" : ""}.\n`);
} finally {
  if (branchId) {
    const { data: target, error: targetError } = await service.from("branches").select("id,name").eq("id", branchId).single();
    if (targetError || !target?.name.startsWith("Direct Branch Check ")) throw targetError || new Error("Cleanup target verification failed.");
    const { error: cleanupError } = await service.from("branches").delete().eq("id", branchId);
    if (cleanupError) throw cleanupError;
    process.stdout.write("Disposable branch verification record removed.\n");
  }
}
