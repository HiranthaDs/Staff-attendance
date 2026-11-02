import { NextResponse } from "next/server";
import { z } from "zod";
import { isTrustedMutationOrigin } from "@/lib/attendance-backend";
import {
  checkPlatformLoginRateLimit,
  createPlatformLoginContext,
  recordPlatformLoginEvent,
  type PlatformLoginOutcome,
} from "@/lib/platform-login-security";
import {
  STAFF_DEVICE_COOKIE,
  serializeStaffDeviceCookie,
  staffDeviceCookieOptions,
  verifyOrRegisterStaffDevice,
} from "@/lib/staff-device-security";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const schema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
  workspace: z.string().trim().toLowerCase().min(3).max(50).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/).optional(),
  portal: z.enum(["company", "platform"]).default("company"),
  device: z.object({
    id: z.string().uuid(),
    secret: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    label: z.string().trim().min(2).max(120),
  }).optional(),
  deviceEnrollmentCode: z.string().trim().min(8).max(40).optional(),
}).superRefine((value, context) => {
  if (value.portal === "platform" && value.workspace) {
    context.addIssue({ code: "custom", path: ["workspace"], message: "Platform access cannot use a company workspace." });
  }
});

function json(body: Record<string, unknown>, status = 200, extraHeaders?: HeadersInit) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store", ...extraHeaders },
  });
}

export async function POST(request: Request) {
  if (!isTrustedMutationOrigin(request)) {
    return json({ error: "This sign-in request did not come from the app." }, 403);
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "Enter a valid email address and password." }, 400);
  }

  const isPlatformPortal = parsed.data.portal === "platform";
  const securityContext = isPlatformPortal
    ? createPlatformLoginContext(request, parsed.data.email)
    : null;
  const rateLimit = isPlatformPortal
    ? await checkPlatformLoginRateLimit(securityContext)
    : { allowed: true, retryAfter: 0 };

  if (!rateLimit.allowed) {
    await recordPlatformLoginEvent(securityContext, "rate_limited");
    return json(
      { error: "Platform sign-in is temporarily locked after repeated attempts. Try again in 15 minutes.", retryAfter: rateLimit.retryAfter },
      429,
      { "retry-after": String(rateLimit.retryAfter) },
    );
  }

  const audit = (outcome: PlatformLoginOutcome, userId: string | null = null) =>
    isPlatformPortal ? recordPlatformLoginEvent(securityContext, outcome, userId) : Promise.resolve();

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    if (error || !data.user) {
      const throttled = error?.status === 429;
      const unavailable = !error?.status || error.status >= 500;
      await audit(unavailable ? "service_error" : throttled ? "rate_limited" : "invalid_credentials");
      return json({
        error: unavailable
          ? "The sign-in service could not be reached. Please try again in a moment."
          : throttled
          ? "Too many sign-in attempts. Wait a moment and try again."
          : "Email or password is incorrect. Please try again.",
      }, unavailable ? 503 : throttled ? 429 : 401, throttled ? { "retry-after": "60" } : undefined);
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, active, must_reset_password, organization_id, organization:organizations(status,slug)")
      .eq("id", data.user.id)
      .single();

    if (profileError && profileError.code !== "PGRST116") {
      await supabase.auth.signOut();
      await audit("service_error", data.user.id);
      return json({ error: "The account service could not verify platform access. Please try again in a moment." }, 503);
    }
    if (!profile) {
      await supabase.auth.signOut();
      await audit("profile_missing", data.user.id);
      return json({ error: "This account is not connected to an active profile. Contact your administrator." }, 403);
    }
    if (!profile.active) {
      await supabase.auth.signOut();
      await audit("account_disabled", data.user.id);
      return json({ error: "This account has been disabled." }, 403);
    }
    if (isPlatformPortal && (profile.role !== "super_admin" || profile.organization_id !== null)) {
      await supabase.auth.signOut();
      await audit("role_denied", data.user.id);
      return json({ error: "This sign-in page is only for platform super administrators. Use company sign in instead." }, 403);
    }
    if (!isPlatformPortal && profile.role === "super_admin") {
      await supabase.auth.signOut();
      return json({ error: "Platform administrators must use the dedicated super-admin sign-in page." }, 403);
    }
    const organization = Array.isArray(profile.organization) ? profile.organization[0] : profile.organization;
    if (parsed.data.workspace && organization?.slug !== parsed.data.workspace) {
      await supabase.auth.signOut();
      return json({ error: "This account does not belong to this company portal. Use the login link provided by your administrator." }, 403);
    }
    if (organization && organization.status !== "active") {
      await supabase.auth.signOut();
      return json({ error: "This company workspace is suspended. Contact the platform administrator." }, 403);
    }

    const isAttendanceAccount = profile.role === "staff" || profile.role === "branch_admin";
    const deviceDecision = isAttendanceAccount
      ? await verifyOrRegisterStaffDevice({
        request,
        userId: data.user.id,
        submittedCredential: parsed.data.device,
        enrollmentCode: parsed.data.deviceEnrollmentCode,
      })
      : null;
    if (deviceDecision && !deviceDecision.allowed) {
      await supabase.auth.signOut();
      if (deviceDecision.status === "enrollment_required") {
        return json({
          error: "A super-admin device registration code is required to finish moving this account to a new device.",
          code: "device_enrollment_required",
        }, 403);
      }
      if (deviceDecision.status === "enrollment_expired") {
        return json({ error: "The device registration code has expired. Ask the super admin to issue a new reset code.", code: "device_enrollment_expired" }, 403);
      }
      if (deviceDecision.status === "device_claimed") {
        return json({ error: "This browser is already registered to another staff account. Use the employee's own registered device.", code: "device_claimed" }, 403);
      }
      if (deviceDecision.status === "service_error") {
        return json({ error: "Device verification is temporarily unavailable. Attendance accounts stay locked until it is restored." }, 503);
      }
      return json({
        error: "This attendance account is registered to another device. Ask the super admin to reset device access.",
        code: "device_mismatch",
      }, 403);
    }

    const redirectTo = profile.must_reset_password
      ? "/auth/update-password"
      : profile.role === "super_admin"
        ? "/super-admin"
        : profile.role === "company_admin" || profile.role === "branch_admin" ? "/admin" : "/app";
    await audit("success", data.user.id);
    const response = json({ success: true, redirectTo, deviceStatus: deviceDecision?.status ?? null });
    if (deviceDecision?.credential) {
      response.cookies.set(STAFF_DEVICE_COOKIE, serializeStaffDeviceCookie(deviceDecision.credential), staffDeviceCookieOptions);
    }
    return response;
  } catch {
    await audit("service_error");
    return json({
      error: "The sign-in service could not be reached. Please try again in a moment.",
    }, 503);
  }
}
