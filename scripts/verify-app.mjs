import { createInterface } from "node:readline";
import { createServerClient } from "@supabase/ssr";

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
process.stdout.write("Super-admin password for app verification: ");
rl._writeToOutput = () => {};
const password = await new Promise((resolve) => rl.question("", resolve));
rl.close();
process.stdout.write("\n");

const cookieJar = new Map();
const supabase = createServerClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  {
    cookies: {
      getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => cookieJar.set(name, value)),
    },
  },
);

const { error } = await supabase.auth.signInWithPassword({
  email: "hiranthadiass4@gmail.com",
  password,
});
if (error) throw error;

const cookie = [...cookieJar].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; ");
const options = { redirect: "manual", headers: { cookie } };
const admin = await fetch("http://localhost:3000/admin", options);
const adminBody = admin.status === 200 ? await admin.text() : "";
const forcedReset = admin.status === 307 && admin.headers.get("location")?.includes("/auth/update-password");
if (!forcedReset && (admin.status !== 200 || !adminBody.includes("Attendance board"))) {
  throw new Error(`Authenticated admin page check failed (${admin.status}).`);
}
process.stdout.write(`Local app verification passed: ${forcedReset ? "first-login password gate" : "authenticated admin render"}.\n`);
