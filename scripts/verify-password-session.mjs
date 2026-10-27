import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const service = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const suffix = Date.now();
const email = `presence-session-${suffix}@example.com`;
const temporaryPassword = `Temporary!${suffix}Aa`;
const replacementPassword = `Replacement!${suffix}Bb`;
let userId = null;

function cookieHeader(jar) {
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

function storeResponseCookies(response, jar) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  for (const value of values) {
    const [pair] = value.split(";");
    const separator = pair.indexOf("=");
    if (separator > 0) jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

try {
  const { data: branch } = await service.from("branches").select("id").eq("active", true).limit(1).single();
  if (!branch) throw new Error("An active branch is required for the session verification.");
  const { data: created, error: createError } = await service.auth.admin.createUser({ email, password: temporaryPassword, email_confirm: true });
  if (createError || !created.user) throw createError || new Error("Test user creation failed.");
  userId = created.user.id;
  const { error: profileError } = await service.from("profiles").insert({
    id: userId,
    email,
    full_name: "Session Verification",
    role: "staff",
    branch_id: branch.id,
    must_reset_password: true,
    active: true,
  });
  if (profileError) throw profileError;

  const jar = new Map();
  const loginResponse = await fetch("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify({ email, password: temporaryPassword }),
  });
  if (!loginResponse.ok) throw new Error(`Login route failed (${loginResponse.status}): ${await loginResponse.text()}`);
  storeResponseCookies(loginResponse, jar);

  const passwordResponse = await fetch("http://localhost:3000/api/account/password", {
    method: "POST",
    headers: { cookie: cookieHeader(jar), "content-type": "application/json" },
    body: JSON.stringify({ password: replacementPassword }),
  });
  if (!passwordResponse.ok) throw new Error(`Password route failed (${passwordResponse.status}): ${await passwordResponse.text()}`);
  storeResponseCookies(passwordResponse, jar);

  const employeePage = await fetch("http://localhost:3000/app", { headers: { cookie: cookieHeader(jar) }, redirect: "manual" });
  const employeeHtml = await employeePage.text();
  if (employeePage.status !== 200 || !employeeHtml.includes("ios-shell") || !employeeHtml.includes("LIVE OFFICE MAP")) {
    throw new Error(`Liquid Glass employee portal or office map did not render (${employeePage.status}).`);
  }

  const freshLogin = createClient(url, publicKey, { auth: { persistSession: false } });
  const { error: newPasswordError } = await freshLogin.auth.signInWithPassword({ email, password: replacementPassword });
  if (newPasswordError) throw newPasswordError;
  process.stdout.write("Password-session verification passed: active session, replacement password, Liquid Glass portal and office map.\n");
} finally {
  if (userId) await service.auth.admin.deleteUser(userId);
  process.stdout.write("Disposable session-verification user removed.\n");
}
