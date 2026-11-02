import "server-only";

import { createHmac } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export type PlatformLoginOutcome =
  | "success"
  | "invalid_credentials"
  | "rate_limited"
  | "profile_missing"
  | "account_disabled"
  | "role_denied"
  | "service_error";

type PlatformLoginContext = {
  emailHash: string;
  ipHash: string | null;
  userAgentHash: string | null;
};

const unavailableFunctionCodes = new Set(["42P01", "42883", "PGRST202", "PGRST205"]);

function auditHash(value: string) {
  const secret = process.env.LOGIN_AUDIT_SALT?.trim() || process.env.SUPABASE_SECRET_KEY?.trim();
  if (!secret) throw new Error("Platform login audit hashing is not configured.");
  return createHmac("sha256", secret).update(value).digest("hex");
}

function clientIp(request: Request) {
  const forwarded = request.headers.get("x-vercel-forwarded-for")
    || request.headers.get("x-forwarded-for")
    || request.headers.get("x-real-ip")
    || "";
  return forwarded.split(",")[0]?.trim().slice(0, 128) || null;
}

export function createPlatformLoginContext(request: Request, email: string): PlatformLoginContext | null {
  try {
    const ip = clientIp(request);
    const userAgent = request.headers.get("user-agent")?.trim().slice(0, 512) || null;
    return {
      emailHash: auditHash(email.trim().toLowerCase()),
      ipHash: ip ? auditHash(ip) : null,
      userAgentHash: userAgent ? auditHash(userAgent) : null,
    };
  } catch {
    // Supabase Auth still applies its own limits if audit hashing has not been
    // configured. This keeps staged deployments from locking out the operator.
    return null;
  }
}

export async function checkPlatformLoginRateLimit(context: PlatformLoginContext | null) {
  if (!context) return { allowed: true, retryAfter: 0, databaseGuardActive: false };

  try {
    const { data, error } = await createAdminClient().rpc("platform_login_is_allowed", {
      p_email_hash: context.emailHash,
      p_ip_hash: context.ipHash,
    });
    if (error) {
      if (!unavailableFunctionCodes.has(error.code)) console.error("Platform login rate-limit check failed", error.code);
      return { allowed: true, retryAfter: 0, databaseGuardActive: false };
    }
    return {
      allowed: data !== false,
      retryAfter: data === false ? 900 : 0,
      databaseGuardActive: true,
    };
  } catch {
    return { allowed: true, retryAfter: 0, databaseGuardActive: false };
  }
}

export async function recordPlatformLoginEvent(
  context: PlatformLoginContext | null,
  outcome: PlatformLoginOutcome,
  userId: string | null = null,
) {
  if (!context) return;

  try {
    const { error } = await createAdminClient().rpc("record_platform_login_event", {
      p_email_hash: context.emailHash,
      p_ip_hash: context.ipHash,
      p_user_agent_hash: context.userAgentHash,
      p_outcome: outcome,
      p_user_id: userId,
    });
    if (error && !unavailableFunctionCodes.has(error.code)) {
      console.error("Platform login audit write failed", error.code);
    }
  } catch {
    // Audit availability must not turn a valid Supabase session into a lockout.
  }
}
