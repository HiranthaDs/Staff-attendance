const EARTH_RADIUS_M = 6_371_008.8;

export type LocationEvidenceSample = {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: string | Date;
};

type PositionSample = {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: Date;
};

export type GpsConsensus = {
  latitude: number;
  longitude: number;
  reportedAccuracyM: number;
  effectiveAccuracyM: number;
  spreadM: number;
  sampleCount: number;
  consensusCount: number;
  sampleSpanMs: number;
  capturedAt: Date;
};

export type GpsDecision = {
  allowed: boolean;
  method: "precise_radius" | "standard_radius" | "none";
  reason: string;
};

export class GpsEvidenceError extends Error {}

export function distanceM(lat1Value: number, lng1Value: number, lat2Value: number, lng2Value: number) {
  const radians = (value: number) => value * Math.PI / 180;
  const lat1 = radians(lat1Value);
  const lat2 = radians(lat2Value);
  const deltaLatitude = radians(lat2Value - lat1Value);
  const deltaLongitude = radians(lng2Value - lng1Value);
  const a = Math.min(1, Math.max(0,
    Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLongitude / 2) ** 2,
  ));
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function agreementDistance(first: PositionSample, second: PositionSample) {
  return Math.max(30, Math.min(120, Math.max(first.accuracy, second.accuracy)));
}

function separation(first: PositionSample, second: PositionSample) {
  return distanceM(first.latitude, first.longitude, second.latitude, second.longitude);
}

function clusterSummary(samples: PositionSample[], indexes: number[]) {
  const members = indexes.map((index) => samples[index]);
  const candidates = members.map((candidate) => ({
    candidate,
    total: members.reduce((sum, member) => sum + separation(candidate, member), 0),
  }));
  candidates.sort((a, b) =>
    a.total - b.total
    || a.candidate.accuracy - b.candidate.accuracy
    || b.candidate.capturedAt.getTime() - a.candidate.capturedAt.getTime(),
  );
  const medoid = candidates[0].candidate;
  return {
    medoid,
    total: candidates[0].total,
    spread: Math.max(...members.map((member) => separation(medoid, member))),
  };
}

export function buildConsensus(
  rawSamples: LocationEvidenceSample[],
  options: {
    now?: Date;
    maxSampleAgeSeconds?: number;
    maxFutureSkewSeconds?: number;
    minimumSamples?: number;
    minimumSpanMs?: number;
  } = {},
): GpsConsensus {
  const {
    now = new Date(),
    maxSampleAgeSeconds = 45,
    maxFutureSkewSeconds = 10,
    minimumSamples = 3,
    minimumSpanMs = 2_000,
  } = options;
  if (rawSamples.length < minimumSamples) throw new GpsEvidenceError(`at least ${minimumSamples} location samples are required`);
  if (rawSamples.length > 20) throw new GpsEvidenceError("at most 20 location samples are accepted");
  if (!Number.isFinite(now.getTime())) throw new GpsEvidenceError("the verification time is invalid");

  const seen = new Set<string>();
  const samples: PositionSample[] = [];
  for (const raw of rawSamples) {
    const capturedAt = raw.capturedAt instanceof Date ? raw.capturedAt : new Date(raw.capturedAt);
    if (
      !Number.isFinite(raw.latitude) || raw.latitude < -90 || raw.latitude > 90
      || !Number.isFinite(raw.longitude) || raw.longitude < -180 || raw.longitude > 180
      || !Number.isFinite(raw.accuracy) || raw.accuracy <= 0 || raw.accuracy > 1_000
      || !Number.isFinite(capturedAt.getTime())
    ) throw new GpsEvidenceError("location sample contains invalid coordinates, accuracy, or time");

    const ageMs = now.getTime() - capturedAt.getTime();
    if (ageMs > maxSampleAgeSeconds * 1_000) throw new GpsEvidenceError("location samples are stale");
    if (ageMs < -maxFutureSkewSeconds * 1_000) throw new GpsEvidenceError("location samples are dated in the future");
    const key = `${raw.latitude}|${raw.longitude}|${raw.accuracy}|${capturedAt.toISOString()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    samples.push({ latitude: raw.latitude, longitude: raw.longitude, accuracy: raw.accuracy, capturedAt });
  }

  if (samples.length < minimumSamples) throw new GpsEvidenceError("not enough distinct location samples were received");
  const ordered = [...samples].sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
  const fullSpanMs = Math.round(ordered.at(-1)!.capturedAt.getTime() - ordered[0].capturedAt.getTime());
  if (fullSpanMs < minimumSpanMs) throw new GpsEvidenceError("location readings were collected too quickly");

  const clusterKeys = new Set<string>();
  const clusters: number[][] = [];
  for (const center of samples) {
    const indexes = samples
      .map((sample, index) => separation(center, sample) <= agreementDistance(center, sample) ? index : -1)
      .filter((index) => index >= 0);
    const key = indexes.join(",");
    if (!clusterKeys.has(key)) {
      clusterKeys.add(key);
      clusters.push(indexes);
    }
  }

  const summaries = clusters.map((indexes) => ({ indexes, ...clusterSummary(samples, indexes) }));
  summaries.sort((a, b) =>
    b.indexes.length - a.indexes.length
    || a.total - b.total
    || a.medoid.accuracy - b.medoid.accuracy
    || b.medoid.capturedAt.getTime() - a.medoid.capturedAt.getTime(),
  );
  const best = summaries[0];
  const required = Math.max(minimumSamples, Math.ceil(samples.length * 0.6));
  if (best.indexes.length < required) throw new GpsEvidenceError("location readings do not form a stable consensus");

  for (const competitor of summaries.slice(1)) {
    if (competitor.indexes.length !== best.indexes.length || competitor.indexes.join(",") === best.indexes.join(",")) continue;
    if (separation(best.medoid, competitor.medoid) > agreementDistance(best.medoid, competitor.medoid)) {
      throw new GpsEvidenceError("location readings contain two competing positions");
    }
  }

  const members = best.indexes.map((index) => samples[index]).sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
  const consensusSpanMs = Math.round(members.at(-1)!.capturedAt.getTime() - members[0].capturedAt.getTime());
  if (consensusSpanMs < minimumSpanMs) throw new GpsEvidenceError("matching location readings were collected too quickly");
  for (let index = 1; index < members.length; index += 1) {
    const earlier = members[index - 1];
    const later = members[index];
    const seconds = (later.capturedAt.getTime() - earlier.capturedAt.getTime()) / 1_000;
    if (seconds <= 0) continue;
    const unexplained = Math.max(0, separation(earlier, later) - earlier.accuracy - later.accuracy);
    if (unexplained / seconds > 80) throw new GpsEvidenceError("location readings imply impossible movement");
  }

  return {
    latitude: best.medoid.latitude,
    longitude: best.medoid.longitude,
    reportedAccuracyM: best.medoid.accuracy,
    effectiveAccuracyM: Math.max(best.medoid.accuracy, best.spread),
    spreadM: best.spread,
    sampleCount: samples.length,
    consensusCount: best.indexes.length,
    sampleSpanMs: consensusSpanMs,
    capturedAt: members.at(-1)!.capturedAt,
  };
}

export function evaluateGeofence(input: {
  distanceFromBranchM: number;
  effectiveAccuracyM: number;
  radiusM: number;
  maxAccuracyM: number;
}): GpsDecision {
  const acceptedAccuracyM = Math.max(200, input.maxAccuracyM);
  if (input.effectiveAccuracyM > acceptedAccuracyM) {
    return { allowed: false, method: "none", reason: `Location accuracy is too low (+/-${Math.round(input.effectiveAccuracyM)} m). Enable precise location and try again.` };
  }
  if (input.distanceFromBranchM <= input.radiusM) {
    return {
      allowed: true,
      method: input.effectiveAccuracyM <= input.maxAccuracyM ? "precise_radius" : "standard_radius",
      reason: "Location is inside the branch radius",
    };
  }
  return { allowed: false, method: "none", reason: `You are not inside the office attendance area. Your location is ${Math.round(input.distanceFromBranchM)} m from the office centre and the allowed radius is ${input.radiusM} m. If you are at the office, enable precise location and retry.` };
}
