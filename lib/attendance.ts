import ipaddr from "ipaddr.js";
import type { BranchNetwork } from "./types.ts";

export { distanceInMeters, evaluatePresence } from "./geofence.ts";

export function normalizeIp(raw: string | null) {
  if (!raw) return null;
  let value = raw.trim().replace(/^"|"$/g, "");
  if (/^\[[0-9a-f:]+\]:\d+$/i.test(value)) value = value.slice(1, value.lastIndexOf("]"));
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(value)) value = value.slice(0, value.lastIndexOf(":"));
  if (!value) return null;
  if (value.startsWith("::ffff:")) value = value.slice(7);
  if (value === "::1") return "127.0.0.1";
  try {
    return ipaddr.parse(value).toNormalizedString();
  } catch {
    return null;
  }
}

export function getRequestIp(headers: Headers) {
  if (process.env.VERCEL === "1") {
    return firstForwardedIp(headers.get("x-vercel-forwarded-for"));
  }
  if (process.env.TRUSTED_PROXY_PROVIDER === "cloudflare") {
    return normalizeIp(headers.get("cf-connecting-ip"));
  }
  if (process.env.TRUST_PROXY_HEADERS === "true") {
    const forwarded = forwardedIpAtTrustedBoundary(
      headers.get("x-forwarded-for"),
      Number(process.env.TRUSTED_PROXY_HOPS || "1"),
    );
    return forwarded ?? normalizeIp(headers.get("x-real-ip"));
  }
  return null;
}

function firstForwardedIp(value: string | null) {
  const first = value?.split(",")[0]?.trim() ?? null;
  return normalizeIp(first);
}

function forwardedIpAtTrustedBoundary(value: string | null, trustedHops: number) {
  if (!value || !Number.isInteger(trustedHops) || trustedHops < 1 || trustedHops > 10) return null;
  const chain = value.split(",").map((entry) => normalizeIp(entry)).filter((entry): entry is string => Boolean(entry));
  if (chain.length < trustedHops) return null;
  return chain[chain.length - trustedHops] ?? null;
}

export function isPublicIp(raw: string | null) {
  const normalized = normalizeIp(raw);
  if (!normalized) return false;
  try {
    return ipaddr.parse(normalized).range() === "unicast";
  } catch {
    return false;
  }
}

export function networkRuleForIp(raw: string) {
  const normalized = normalizeIp(raw);
  if (!normalized) return null;
  try {
    const address = ipaddr.parse(normalized);
    return address.toNormalizedString();
  } catch {
    return null;
  }
}

export function calculateAttendanceTiming(input: {
  currentMinutes: number;
  arrivalMinutes: number;
  departureMinutes: number;
  lateGraceMinutes: number;
  earlyLeaveGraceMinutes: number;
}) {
  return {
    lateMinutes: Math.max(0, input.currentMinutes - input.arrivalMinutes - input.lateGraceMinutes),
    earlyLeaveMinutes: Math.max(0, input.departureMinutes - input.currentMinutes - input.earlyLeaveGraceMinutes),
  };
}

export type RequestIpEvidence = {
  ip: string | null;
  verified: boolean;
  source: "vercel_client" | "cloudflare_client" | "trusted_proxy" | "local_egress_consensus" | "unavailable";
  evidenceCount: number;
};

let localEgressCache: { ip: string; expiresAt: number; evidenceCount: number } | null = null;

export async function resolveRequestIp(
  headers: Headers,
  options: { allowLocalEgressFallback?: boolean } = {},
): Promise<RequestIpEvidence> {
  const directIp = getRequestIp(headers);
  if (isPublicIp(directIp)) {
    const source = process.env.VERCEL === "1"
      ? "vercel_client"
      : process.env.TRUSTED_PROXY_PROVIDER === "cloudflare"
        ? "cloudflare_client"
        : "trusted_proxy";
    return {
      ip: directIp,
      verified: true,
      source,
      evidenceCount: 1,
    };
  }

  if (options.allowLocalEgressFallback && localEgressDetectionAllowed()) {
    const consensus = await detectLocalServerEgressIp();
    if (consensus) {
      return {
        ip: consensus.ip,
        verified: true,
        source: "local_egress_consensus",
        evidenceCount: consensus.evidenceCount,
      };
    }
  }

  return {
    ip: null,
    verified: false,
    source: "unavailable",
    evidenceCount: 0,
  };
}

function localEgressDetectionAllowed() {
  if (process.env.VERCEL === "1") return false;
  try {
    const hostname = new URL(process.env.NEXT_PUBLIC_APP_URL || "").hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

async function detectLocalServerEgressIp() {
  if (localEgressCache && localEgressCache.expiresAt > Date.now()) return localEgressCache;

  const providers = [
    async () => {
      const response = await fetch("https://api.ipify.org?format=json", { cache: "no-store", signal: AbortSignal.timeout(5_000) });
      if (!response.ok) return null;
      const result = await response.json();
      return normalizeIp(typeof result.ip === "string" ? result.ip : null);
    },
    async () => {
      const response = await fetch("https://1.1.1.1/cdn-cgi/trace", { cache: "no-store", signal: AbortSignal.timeout(5_000) });
      if (!response.ok) return null;
      const match = (await response.text()).match(/^ip=(.+)$/m);
      return normalizeIp(match?.[1] ?? null);
    },
    async () => {
      const response = await fetch("https://icanhazip.com", { cache: "no-store", signal: AbortSignal.timeout(5_000) });
      if (!response.ok) return null;
      return normalizeIp((await response.text()).trim());
    },
  ];
  const settled = await Promise.allSettled(providers.map((provider) => provider()));
  const publicIps = settled
    .filter((result): result is PromiseFulfilledResult<string | null> => result.status === "fulfilled")
    .map((result) => result.value)
    .filter((ip): ip is string => Boolean(ip) && isPublicIp(ip));
  const counts = new Map<string, number>();
  publicIps.forEach((ip) => counts.set(ip, (counts.get(ip) ?? 0) + 1));
  const winner = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!winner || winner[1] < 2) return null;

  localEgressCache = { ip: winner[0], evidenceCount: winner[1], expiresAt: Date.now() + 30_000 };
  return localEgressCache;
}

export function ipMatchesRule(clientIp: string | null, rule: string) {
  if (!clientIp) return false;
  try {
    const address = ipaddr.parse(clientIp);
    const normalizedRule = rule.trim();
    if (!normalizedRule.includes("/")) {
      return address.toNormalizedString() === ipaddr.parse(normalizedRule).toNormalizedString();
    }
    const [range, prefix] = ipaddr.parseCIDR(normalizedRule);
    if (address.kind() !== range.kind()) return false;
    return address.match(range, prefix);
  } catch {
    return false;
  }
}

export function networkIsAllowed(clientIp: string | null, networks: BranchNetwork[]) {
  return networks.some((network) => network.active && ipMatchesRule(clientIp, network.ip_rule));
}

export function localDateParts(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const year = get("year");
  const month = get("month");
  const day = get("day");
  return {
    date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    minutes: get("hour") * 60 + get("minute"),
  };
}

export function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}
