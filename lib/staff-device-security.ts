import "server-only";

import { createHmac, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const STAFF_DEVICE_COOKIE = "presence-attendance-device";

export type StaffDeviceCredentialInput = {
  id: string;
  secret: string;
  label: string;
};

type DeviceDecision = {
  allowed: boolean;
  status: "registered" | "verified" | "device_mismatch" | "device_claimed" | "enrollment_required" | "enrollment_expired" | "not_eligible" | "service_error";
  label: string | null;
  credential: StaffDeviceCredentialInput | null;
};

function securityKey() {
  const key = process.env.DEVICE_BINDING_PEPPER?.trim() || process.env.SUPABASE_SECRET_KEY?.trim();
  if (!key) throw new Error("Device binding hashing is not configured.");
  return key;
}

function digest(scope: string, value: string) {
  return createHmac("sha256", securityKey()).update(`${scope}:${value}`).digest("hex");
}

function validCredential(value: unknown): value is StaffDeviceCredentialInput {
  if (!value || typeof value !== "object") return false;
  const credential = value as Partial<StaffDeviceCredentialInput>;
  return typeof credential.id === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(credential.id)
    && typeof credential.secret === "string"
    && /^[A-Za-z0-9_-]{43}$/.test(credential.secret)
    && typeof credential.label === "string"
    && credential.label.trim().length >= 2
    && credential.label.length <= 120;
}

function parseCredentialCookie(rawCookie: string | undefined): StaffDeviceCredentialInput | null {
  if (!rawCookie) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(decodeURIComponent(rawCookie), "base64url").toString("utf8"));
    return validCredential(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function credentialFromCookie(request: Request): StaffDeviceCredentialInput | null {
  const rawCookie = request.headers.get("cookie")?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${STAFF_DEVICE_COOKIE}=`))
    ?.slice(STAFF_DEVICE_COOKIE.length + 1);
  return parseCredentialCookie(rawCookie);
}

function clientIpHash(request: Request) {
  const forwarded = request.headers.get("x-vercel-forwarded-for")
    || request.headers.get("x-forwarded-for")
    || request.headers.get("x-real-ip")
    || "";
  const ip = forwarded.split(",")[0]?.trim().slice(0, 128);
  return ip ? digest("ip", ip) : null;
}

export function serializeStaffDeviceCookie(credential: StaffDeviceCredentialInput) {
  return Buffer.from(JSON.stringify(credential), "utf8").toString("base64url");
}

export const staffDeviceCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
};

export function normalizeEnrollmentCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashEnrollmentCode(value: string) {
  const normalized = normalizeEnrollmentCode(value);
  return normalized ? digest("enrollment", normalized) : null;
}

export function createEnrollmentCode() {
  const compact = randomBytes(10).toString("hex").toUpperCase();
  return compact.match(/.{1,4}/g)?.join("-") ?? compact;
}

export async function verifyOrRegisterStaffDevice(input: {
  request: Request;
  userId: string;
  submittedCredential?: StaffDeviceCredentialInput | null;
  enrollmentCode?: string | null;
}): Promise<DeviceDecision> {
  const cookieCredential = credentialFromCookie(input.request);
  const credential = cookieCredential || (validCredential(input.submittedCredential) ? input.submittedCredential : null);
  if (!credential) return { allowed: false, status: "device_mismatch", label: null, credential: null };

  try {
    const { data, error } = await createAdminClient().rpc("verify_or_register_staff_device", {
      p_user_id: input.userId,
      p_device_id: credential.id,
      p_secret_hash: digest("device", credential.secret),
      p_device_label: credential.label.trim(),
      p_ip_hash: clientIpHash(input.request),
      p_enrollment_token_hash: input.enrollmentCode ? hashEnrollmentCode(input.enrollmentCode) : null,
    });
    if (error) return { allowed: false, status: "service_error", label: null, credential };
    const row = (Array.isArray(data) ? data[0] : data) as { allowed?: boolean; status?: DeviceDecision["status"]; registered_label?: string | null } | null;
    return {
      allowed: row?.allowed === true,
      status: row?.status || "service_error",
      label: row?.registered_label || null,
      credential,
    };
  } catch {
    return { allowed: false, status: "service_error", label: null, credential };
  }
}

export async function verifyStaffDeviceRequest(input: {
  request: Request;
  userId: string;
  context: "attendance_challenge" | "attendance_mark" | "logout";
  serviceAdmin?: SupabaseClient;
}) {
  const credential = credentialFromCookie(input.request);
  if (!credential) return { allowed: false, response: deviceDeniedResponse("This browser is not registered for this attendance account.") };
  try {
    const admin = input.serviceAdmin ?? createAdminClient();
    const { data, error } = await admin.rpc("verify_staff_device", {
      p_user_id: input.userId,
      p_device_id: credential.id,
      p_secret_hash: digest("device", credential.secret),
      p_ip_hash: clientIpHash(input.request),
      p_context: input.context,
    });
    if (error) return { allowed: false, response: deviceDeniedResponse("Device verification is temporarily unavailable.", 503) };
    if (data !== true) return { allowed: false, response: deviceDeniedResponse("This attendance account is registered to another device. Ask the super admin to reset it.") };
    return { allowed: true as const, credential };
  } catch {
    return { allowed: false, response: deviceDeniedResponse("Device verification is temporarily unavailable.", 503) };
  }
}

export async function verifyCurrentStaffDevice(userId: string) {
  try {
    const cookieStore = await cookies();
    const credential = parseCredentialCookie(cookieStore.get(STAFF_DEVICE_COOKIE)?.value);
    if (!credential) return false;
    const { data, error } = await createAdminClient().rpc("verify_staff_device", {
      p_user_id: userId,
      p_device_id: credential.id,
      p_secret_hash: digest("device", credential.secret),
      p_ip_hash: null,
      p_context: "protected_page",
    });
    return !error && data === true;
  } catch {
    return false;
  }
}

function deviceDeniedResponse(message: string, status = 403) {
  return NextResponse.json({ error: message, code: "device_verification_failed" }, {
    status,
    headers: { "cache-control": "no-store" },
  });
}
