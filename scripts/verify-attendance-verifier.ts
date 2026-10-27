import assert from "node:assert/strict";
import {
  GpsEvidenceError,
  buildConsensus,
  distanceM,
  evaluateGeofence,
  type LocationEvidenceSample,
} from "../lib/attendance-verifier/gps.ts";
import { calculateAttendanceTiming } from "../lib/attendance.ts";
import {
  createCompatibilityChallenge,
  verifyCompatibilityChallenge,
} from "../lib/attendance-verifier/compatibility-challenge.ts";

const now = new Date("2026-10-27T08:30:00.000Z");
const stableSamples: LocationEvidenceSample[] = [
  { latitude: 6.927100, longitude: 79.861200, accuracy: 18, capturedAt: new Date(now.getTime() - 5_000) },
  { latitude: 6.927110, longitude: 79.861205, accuracy: 15, capturedAt: new Date(now.getTime() - 3_000) },
  { latitude: 6.927090, longitude: 79.861195, accuracy: 20, capturedAt: new Date(now.getTime() - 1_000) },
];

const consensus = buildConsensus(stableSamples, { now });
assert.equal(consensus.consensusCount, 3);
assert.equal(consensus.sampleCount, 3);
assert.ok(consensus.sampleSpanMs >= 4_000);
assert.ok(consensus.spreadM < 5);

const withOutlier = buildConsensus([
  ...stableSamples,
  { latitude: 6.94, longitude: 79.88, accuracy: 8, capturedAt: new Date(now.getTime() - 2_000) },
], { now });
assert.equal(withOutlier.consensusCount, 3);
assert.ok(Math.abs(withOutlier.latitude - 6.9271) < 0.0001);

assert.throws(() => buildConsensus(stableSamples.map((sample, index) => ({
  ...sample,
  latitude: sample.latitude + index * 0.000001,
  capturedAt: new Date(now.getTime() - index * 100),
})), { now }), /too quickly/);

assert.throws(() => buildConsensus(stableSamples.map((sample) => ({
  ...sample,
  capturedAt: new Date(new Date(sample.capturedAt).getTime() - 120_000),
})), { now }), /stale/);

const futureSamples = stableSamples.map((sample, index) => ({
  ...sample,
  capturedAt: new Date(now.getTime() + [1_000, 4_000, 9_000][index]),
}));
assert.equal(buildConsensus(futureSamples, { now }).consensusCount, 3);
futureSamples[2].capturedAt = new Date(now.getTime() + 11_000);
assert.throws(() => buildConsensus(futureSamples, { now }), /future/);

assert.equal(evaluateGeofence({ distanceFromBranchM: 199, effectiveAccuracyM: 20, radiusM: 200, maxAccuracyM: 80 }).allowed, true);
assert.equal(evaluateGeofence({ distanceFromBranchM: 201, effectiveAccuracyM: 20, radiusM: 200, maxAccuracyM: 80 }).allowed, false);
assert.equal(evaluateGeofence({ distanceFromBranchM: 20, effectiveAccuracyM: 120, radiusM: 200, maxAccuracyM: 80 }).allowed, true);
assert.equal(evaluateGeofence({ distanceFromBranchM: 100, effectiveAccuracyM: 120, radiusM: 200, maxAccuracyM: 80 }).allowed, true);
assert.equal(evaluateGeofence({ distanceFromBranchM: 100, effectiveAccuracyM: 201, radiusM: 200, maxAccuracyM: 80 }).allowed, false);
assert.ok(distanceM(0, 0, 0.001, 0) > 111);
assert.ok(new GpsEvidenceError("test") instanceof Error);

assert.deepEqual(calculateAttendanceTiming({ currentMinutes: 8 * 60 + 40, arrivalMinutes: 8 * 60 + 30, departureMinutes: 17 * 60, lateGraceMinutes: 10, earlyLeaveGraceMinutes: 10 }), { lateMinutes: 0, earlyLeaveMinutes: 490 });
assert.deepEqual(calculateAttendanceTiming({ currentMinutes: 16 * 60 + 55, arrivalMinutes: 8 * 60 + 30, departureMinutes: 17 * 60, lateGraceMinutes: 10, earlyLeaveGraceMinutes: 10 }), { lateMinutes: 495, earlyLeaveMinutes: 0 });

const previousChallengeSecret = process.env.ATTENDANCE_CHALLENGE_SECRET;
process.env.ATTENDANCE_CHALLENGE_SECRET = "attendance-verifier-test-secret-with-sufficient-entropy";
const binding = {
  userId: "0ad4fd1f-2936-43ba-b7b8-00b14824ce7b",
  branchId: "20b2577b-cafc-464e-9496-e95027747519",
  action: "clock_in" as const,
};
const compatibilityChallenge = createCompatibilityChallenge(binding, now);
assert.match(compatibilityChallenge, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
assert.equal(verifyCompatibilityChallenge(compatibilityChallenge, binding, { now, ttlSeconds: 90 }), "valid");
assert.equal(verifyCompatibilityChallenge(compatibilityChallenge, { ...binding, action: "clock_out" }, { now, ttlSeconds: 90 }), "invalid");
assert.equal(verifyCompatibilityChallenge(compatibilityChallenge, binding, { now: new Date(now.getTime() + 91_000), ttlSeconds: 90 }), "expired");
const tamperedChallenge = `${compatibilityChallenge.slice(0, -1)}${compatibilityChallenge.endsWith("0") ? "1" : "0"}`;
assert.equal(verifyCompatibilityChallenge(tamperedChallenge, binding, { now, ttlSeconds: 90 }), "invalid");
if (previousChallengeSecret === undefined) delete process.env.ATTENDANCE_CHALLENGE_SECRET;
else process.env.ATTENDANCE_CHALLENGE_SECRET = previousChallengeSecret;

console.log("Server attendance verifier checks passed: consensus, geofence, timing grace, and signed compatibility challenges.");
