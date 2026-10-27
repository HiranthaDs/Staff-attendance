import assert from "node:assert/strict";
import {
  distanceInMeters,
  evaluateGpsPosition,
  evaluatePresence,
} from "../lib/geofence.ts";
import {
  betterLocationSample,
  captureBestBrowserLocation,
  isUsableLocationSample,
  selectLocationConsensus,
} from "../lib/browser-location.ts";

function position({ latitude = 6.9271, longitude = 79.8612, accuracy = 50, timestamp = Date.now() } = {}) {
  return {
    coords: {
      latitude,
      longitude,
      accuracy,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    },
    timestamp,
  };
}

assert.equal(distanceInMeters(
  { latitude: 6.9271, longitude: 79.8612 },
  { latitude: 6.9271, longitude: 79.8612 },
), 0);
assert.ok(distanceInMeters(
  { latitude: 0, longitude: 0 },
  { latitude: 0.001, longitude: 0 },
) >= 111);

assert.deepEqual(
  evaluateGpsPosition({ distanceM: 20, accuracyM: 25, radiusM: 200, maxAccuracyM: 80, gpsAvailable: true }),
  { gpsOk: true, accuracyOk: true, method: "precise" },
);

const contained139 = evaluateGpsPosition({
  distanceM: 20,
  accuracyM: 139,
  radiusM: 200,
  maxAccuracyM: 80,
  gpsAvailable: true,
});
assert.equal(contained139.gpsOk, true);
assert.equal(contained139.method, "contained_uncertainty");

assert.equal(evaluateGpsPosition({
  distanceM: 70,
  accuracyM: 139,
  radiusM: 200,
  maxAccuracyM: 80,
  gpsAvailable: true,
}).gpsOk, false);
assert.equal(evaluateGpsPosition({
  distanceM: 0,
  accuracyM: 161,
  radiusM: 500,
  maxAccuracyM: 80,
  gpsAvailable: true,
}).gpsOk, false);

assert.equal(evaluateGpsPosition({
  distanceM: 100,
  accuracyM: 80,
  radiusM: 100,
  maxAccuracyM: 80,
  gpsAvailable: true,
}).gpsOk, true);
assert.equal(evaluateGpsPosition({
  distanceM: 101,
  accuracyM: 80,
  radiusM: 100,
  maxAccuracyM: 80,
  gpsAvailable: true,
}).gpsOk, false);

const strictMissingWifi = evaluatePresence({
  distanceM: 10,
  accuracyM: 15,
  radiusM: 200,
  maxAccuracyM: 80,
  gpsAvailable: true,
  ipAllowed: false,
  verificationMode: "gps_and_ip",
  hasNetworks: true,
});
assert.equal(strictMissingWifi.allowed, false);
assert.match(strictMissingWifi.reason, /approved office (Wi-Fi|internet)/i);

const wifiFallback = evaluatePresence({
  distanceM: 1_000,
  accuracyM: 500,
  radiusM: 200,
  maxAccuracyM: 80,
  gpsAvailable: false,
  ipAllowed: true,
  verificationMode: "gps_or_ip",
  hasNetworks: true,
});
assert.equal(wifiFallback.allowed, true);
assert.equal(wifiFallback.reason, "Verified");

const noConfiguredNetwork = evaluatePresence({
  distanceM: 5,
  accuracyM: 10,
  radiusM: 200,
  maxAccuracyM: 80,
  gpsAvailable: true,
  ipAllowed: false,
  verificationMode: "gps_and_ip",
  hasNetworks: false,
});
assert.equal(noConfiguredNetwork.allowed, false);
assert.match(noConfiguredNetwork.reason, /no office network configured/i);

const now = Date.now();
assert.equal(isUsableLocationSample(position({ timestamp: now }), now), true);
assert.equal(isUsableLocationSample(position({ timestamp: now - 31_000 }), now), false);
assert.equal(isUsableLocationSample(position({ timestamp: now + 11_000 }), now), false);
assert.equal(isUsableLocationSample(position({ accuracy: 0, timestamp: now }), now), false);
assert.equal(isUsableLocationSample(position({ latitude: Number.NaN, timestamp: now }), now), false);
assert.equal(betterLocationSample(position({ accuracy: 139 }), position({ accuracy: 35 })).coords.accuracy, 35);

const consensus = selectLocationConsensus([
  position({ latitude: 6.9301, accuracy: 8, timestamp: now }),
  position({ latitude: 6.92710, accuracy: 35, timestamp: now + 1 }),
  position({ latitude: 6.92712, accuracy: 30, timestamp: now + 2 }),
  position({ latitude: 6.92708, accuracy: 40, timestamp: now + 3 }),
]);
assert.equal(consensus?.consensusCount, 3);
assert.equal(consensus?.ambiguous, false);
assert.ok(Math.abs((consensus?.position.coords.latitude ?? 0) - 6.9271) < 0.0001);

const tiedClusters = selectLocationConsensus([
  position({ latitude: 6.92710, accuracy: 10, timestamp: now + 4 }),
  position({ latitude: 6.92711, accuracy: 10, timestamp: now + 5 }),
  position({ latitude: 6.93010, accuracy: 10, timestamp: now + 6 }),
  position({ latitude: 6.93011, accuracy: 10, timestamp: now + 7 }),
]);
assert.equal(tiedClusters?.ambiguous, true);

globalThis.window = globalThis;
let clearedWatchId = null;
const sampled = await captureBestBrowserLocation({
  desiredAccuracyM: 50,
  minimumWaitMs: 0,
  minimumSampleSpanMs: 0,
  maximumWaitMs: 1_000,
}, {
  watchPosition(success) {
    const capturedNow = Date.now() - 3_000;
    success(position({ latitude: 6.9301, accuracy: 8, timestamp: capturedNow }));
    success(position({ latitude: 6.92710, accuracy: 35, timestamp: capturedNow + 1_000 }));
    success(position({ latitude: 6.92712, accuracy: 30, timestamp: capturedNow + 2_000 }));
    success(position({ latitude: 6.92708, accuracy: 40, timestamp: capturedNow + 3_000 }));
    return 7;
  },
  clearWatch(id) {
    clearedWatchId = id;
  },
});
assert.ok(sampled.accuracy >= 30);
assert.equal(sampled.sampleCount, 4);
assert.equal(sampled.consensusCount, 3);
assert.equal(sampled.samples.length, 4);
assert.ok(sampled.captureStartedAt);
assert.ok(sampled.captureEndedAt);
assert.ok(sampled.captureDurationMs >= 1_500);
assert.equal(clearedWatchId, 7);

let deniedWatcherCleared = false;
await assert.rejects(
  captureBestBrowserLocation({
    desiredAccuracyM: 50,
    minimumWaitMs: 0,
    minimumSampleSpanMs: 0,
    maximumWaitMs: 1_000,
  }, {
    watchPosition(_success, failure) {
      failure?.({ code: 1, message: "denied", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
      return 8;
    },
    clearWatch(id) {
      deniedWatcherCleared = id === 8;
    },
  }),
  /permission is required/i,
);
assert.equal(deniedWatcherCleared, true);

console.log("Location verification checks passed.");
