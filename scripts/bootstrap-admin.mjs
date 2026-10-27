import { createInterface } from "node:readline";
import { createClient } from "@supabase/supabase-js";

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
process.stdout.write("Initial super-admin password: ");
rl._writeToOutput = () => {};
const password = await new Promise((resolve) => rl.question("", resolve));
rl.close();
process.stdout.write("\n");

const email = "hiranthadiass4@gmail.com";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let page = 1;
let user = null;
while (!user) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
  if (error) throw error;
  user = data.users.find((candidate) => candidate.email?.toLowerCase() === email);
  if (user || data.users.length < 100) break;
  page += 1;
}

if (!user) {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: "Hirantha Dias" },
  });
  if (error) throw error;
  user = data.user;
} else {
  const { data, error } = await supabase.auth.admin.updateUserById(user.id, {
    password,
    email_confirm: true,
    user_metadata: { ...user.user_metadata, full_name: user.user_metadata?.full_name || "Hirantha Dias" },
  });
  if (error) throw error;
  user = data.user;
}

const { error: profileError } = await supabase.from("profiles").upsert({
  id: user.id,
  email,
  full_name: user.user_metadata?.full_name || "Hirantha Dias",
  role: "super_admin",
  branch_id: null,
  job_title: "Super administrator",
  must_reset_password: true,
  active: true,
});
if (profileError) throw profileError;
process.stdout.write("\nSuper-admin account is ready.\n");
