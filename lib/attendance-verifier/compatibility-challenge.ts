import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const CHALLENGE_CONTEXT = "presence-attendance-compatibility-v1";
const UUID_HEX_LENGTH = 32;

export type CompatibilityChallengeBinding = {
  userId: string;
  branchId: string;
  action: "clock_in" | "clock_out";
  ipHash: string | null;
};

function challengeSecret() {
  const secret = process.env.ATTENDANCE_CHALLENGE_SECRET?.trim()
    || process.env.SUPABASE_SECRET_KEY?.trim();
  if (!secret) throw new Error("A server attendance challenge secret is not configured.");
  return secret;
}

function signature(header: Uint8Array, binding: CompatibilityChallengeBinding) {
  return createHmac("sha256", challengeSecret())
    .update(CHALLENGE_CONTEXT, "utf8")
    .update(header)
    .update(binding.userId, "utf8")
    .update("\0", "utf8")
    .update(binding.branchId, "utf8")
    .update("\0", "utf8")
    .update(binding.action, "utf8")
    .update("\0", "utf8")
    .update(binding.ipHash || "", "ascii")
    .digest();
}

function formatUuid(bytes: Uint8Array) {
  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function parseUuid(value: string) {
  const hex = value.replaceAll("-", "").toLowerCase();
  if (hex.length !== UUID_HEX_LENGTH || !/^[0-9a-f]+$/.test(hex)) return null;
  const bytes = Buffer.from(hex, "hex");
  if ((bytes[6] & 0xf0) !== 0x80 || (bytes[8] & 0xc0) !== 0x80) return null;
  return bytes;
}

function expectedAuthenticator(header: Uint8Array, binding: CompatibilityChallengeBinding) {
  const digest = signature(header, binding);
  const authenticator = Buffer.alloc(8);
  authenticator[0] = (digest[0] & 0x3f) | 0x80;
  digest.copy(authenticator, 1, 1, 8);
  return authenticator;
}

export function createCompatibilityChallenge(
  binding: CompatibilityChallengeBinding,
  now = new Date(),
) {
  const issuedAtSeconds = Math.floor(now.getTime() / 1_000);
  if (!Number.isFinite(issuedAtSeconds) || issuedAtSeconds < 0 || issuedAtSeconds > 0xffff_ffff) {
    throw new Error("The attendance challenge time is invalid.");
  }

  const bytes = Buffer.alloc(16);
  bytes.writeUInt32BE(issuedAtSeconds, 0);
  randomBytes(4).copy(bytes, 4);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  expectedAuthenticator(bytes.subarray(0, 8), binding).copy(bytes, 8);
  return formatUuid(bytes);
}

export function verifyCompatibilityChallenge(
  challengeId: string,
  binding: CompatibilityChallengeBinding,
  options: { now?: Date; ttlSeconds?: number } = {},
): "valid" | "expired" | "invalid" {
  const bytes = parseUuid(challengeId);
  if (!bytes) return "invalid";

  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1_000);
  const issuedAtSeconds = bytes.readUInt32BE(0);
  const ttlSeconds = options.ttlSeconds ?? 90;
  if (!Number.isFinite(nowSeconds) || issuedAtSeconds > nowSeconds + 10) return "invalid";
  if (nowSeconds > issuedAtSeconds + ttlSeconds) return "expired";

  const expected = expectedAuthenticator(bytes.subarray(0, 8), binding);
  return timingSafeEqual(expected, bytes.subarray(8)) ? "valid" : "invalid";
}
