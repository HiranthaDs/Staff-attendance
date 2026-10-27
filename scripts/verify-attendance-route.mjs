import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const baseUrl = "http://localhost:3000";
const service = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);
const suffix = Date.now();
const email = `presence-attendance-${suffix}@example.com`;
const password = `Attendance!${suffix}Aa`;
let userId = null;
let branchId = null;
const cookies = new Map();

function cookieHeader() {
  return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
}

function storeCookies(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  for (const value of values) {
    const [pair] = value.split(";");
    const separator = pair.indexOf("=");
    if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: baseUrl,
      cookie: cookieHeader(),
    },
    body: JSON.stringify(body),
  });
  storeCookies(response);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} failed (${response.status}): ${JSON.stringify(result)}`);
  return result;
}

function locationEvidence(latitude, longitude) {
  const now = Date.now();
  return {
    clientRequestId: crypto.randomUUID(),
    captureStartedAt: new Date(now - 1_000).toISOString(),
    captureEndedAt: new Date(now).toISOString(),
    samples: [
      { latitude, longitude, accuracy: 14, altitude: null, altitudeAccuracy: null, heading: null, speed: null, capturedAt: new Date(now - 500).toISOString() },
    ],
  };
}

try {
  const latitude = 6.927079;
  const longitude = 79.861244;
  const branchResult = await service.from("branches").insert({
    name: `Node Verifier ${suffix}`,
    code: `N${String(suffix).slice(-7)}`,
    address: "Disposable verifier test branch",
    latitude,
    longitude,
    radius_m: 200,
    max_accuracy_m: 80,
    timezone: "Asia/Colombo",
    verification_mode: "gps_only",
    active: true,
  }).select("id").single();
  if (branchResult.error || !branchResult.data) throw branchResult.error || new Error("Test branch creation failed.");
  branchId = branchResult.data.id;

  const userResult = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (userResult.error || !userResult.data.user) throw userResult.error || new Error("Test user creation failed.");
  userId = userResult.data.user.id;
  const profileResult = await service.from("profiles").insert({
    id: userId,
    email,
    full_name: "Node Attendance Verification",
    role: "staff",
    branch_id: branchId,
    expected_arrival: "08:30",
    expected_departure: "17:30",
    must_reset_password: false,
    active: true,
  });
  if (profileResult.error) throw profileResult.error;

  await post("/api/auth/login", { email, password });

  const clockInChallenge = await post("/api/attendance/challenge", { action: "clock_in" });
  const clockInPayload = { action: "clock_in", challengeId: clockInChallenge.challenge_id, ...locationEvidence(latitude, longitude) };
  const clockIn = await post("/api/attendance/mark", clockInPayload);
  assert.equal(clockIn.success, true);
  assert.equal(clockIn.checks.gps, true);
  assert.equal(clockIn.checks.verificationMethod, "location");
  assert.ok(clockIn.record.clock_in);

  const duplicate = await post("/api/attendance/mark", clockInPayload);
  assert.equal(duplicate.record.id, clockIn.record.id);

  const clockOutChallenge = await post("/api/attendance/challenge", { action: "clock_out" });
  const clockOut = await post("/api/attendance/mark", {
    action: "clock_out",
    challengeId: clockOutChallenge.challenge_id,
    ...locationEvidence(latitude, longitude),
  });
  assert.equal(clockOut.record.id, clockIn.record.id);
  assert.ok(clockOut.record.clock_out);

  console.log("Integrated attendance route passed: login, trusted challenge, one location reading, clock-in, idempotent retry, clock-out, and Supabase transaction.");
} finally {
  if (userId) {
    try { await service.auth.admin.deleteUser(userId); } catch { /* best-effort cleanup */ }
  }
  if (branchId) {
    try { await service.from("branches").delete().eq("id", branchId); } catch { /* best-effort cleanup */ }
  }
  console.log("Disposable integrated attendance data removed.");
}
