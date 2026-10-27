export type CapturedBrowserLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  altitudeAccuracy: number | null;
  heading: number | null;
  speed: number | null;
  capturedAt: string;
  sampleCount: number;
  consensusCount: number;
  spreadM: number;
  captureDurationMs: number;
  captureStartedAt: string;
  captureEndedAt: string;
  samples: BrowserLocationSample[];
};

export type BrowserLocationSample = {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  altitudeAccuracy: number | null;
  heading: number | null;
  speed: number | null;
  capturedAt: string;
};

export type LocationCaptureProgress = {
  bestAccuracyM: number;
  sampleCount: number;
  consensusCount: number;
  spreadM: number;
  elapsedMs: number;
};

type CaptureOptions = {
  desiredAccuracyM: number;
  maximumAccuracyM?: number;
  minimumConsensusSamples?: number;
  minimumSampleSpanMs?: number;
  minimumWaitMs?: number;
  maximumWaitMs?: number;
  pollIntervalMs?: number;
  onProgress?: (progress: LocationCaptureProgress) => void;
};

type GeolocationLike = Pick<Geolocation, "watchPosition" | "clearWatch">
  & Partial<Pick<Geolocation, "getCurrentPosition">>;

export type LocationConsensus = {
  position: GeolocationPosition;
  consensusCount: number;
  spreadM: number;
  ambiguous: boolean;
};

const MAX_SAMPLE_AGE_MS = 30_000;
const MAX_FUTURE_SKEW_MS = 10_000;
const MAX_RETAINED_SAMPLES = 20;
const MIN_DISTINCT_SAMPLE_INTERVAL_MS = 350;

export function isUsableLocationSample(position: GeolocationPosition, nowMs = Date.now()) {
  const { latitude, longitude, accuracy } = position.coords;
  return Number.isFinite(latitude)
    && latitude >= -90
    && latitude <= 90
    && Number.isFinite(longitude)
    && longitude >= -180
    && longitude <= 180
    && Number.isFinite(accuracy)
    && accuracy > 0
    && Number.isFinite(position.timestamp)
    && position.timestamp >= nowMs - MAX_SAMPLE_AGE_MS
    && position.timestamp <= nowMs + MAX_FUTURE_SKEW_MS;
}

export function betterLocationSample(
  current: GeolocationPosition | null,
  candidate: GeolocationPosition,
) {
  if (!current) return candidate;
  if (candidate.coords.accuracy < current.coords.accuracy) return candidate;
  if (candidate.coords.accuracy === current.coords.accuracy && candidate.timestamp > current.timestamp) return candidate;
  return current;
}

export function selectLocationConsensus(samples: GeolocationPosition[]): LocationConsensus | null {
  if (samples.length === 0) return null;

  const candidateClusters = new Map<string, number[]>();
  samples.forEach((center, centerIndex) => {
    const members = samples
      .map((sample, index) => samplesAgree(center, sample) ? index : -1)
      .filter((index) => index >= 0);
    const key = [...members].sort((a, b) => a - b).join(",");
    candidateClusters.set(key || String(centerIndex), members);
  });

  const ranked = [...candidateClusters.values()]
    .map((members) => summarizeCluster(samples, members))
    .sort((a, b) => b.consensusCount - a.consensusCount
      || a.totalDistanceM - b.totalDistanceM
      || a.position.coords.accuracy - b.position.coords.accuracy
      || b.position.timestamp - a.position.timestamp);
  const best = ranked[0];
  if (!best) return null;

  const competing = ranked.find((cluster) => {
    if (cluster === best || cluster.consensusCount !== best.consensusCount) return false;
    return distanceBetweenPositions(cluster.position, best.position) > agreementDistanceM(cluster.position, best.position);
  });

  return {
    position: best.position,
    consensusCount: best.consensusCount,
    spreadM: best.spreadM,
    ambiguous: Boolean(competing),
  };
}

export function captureBestBrowserLocation(
  options: CaptureOptions,
  geolocation: GeolocationLike = navigator.geolocation,
): Promise<CapturedBrowserLocation> {
  const desiredAccuracyM = Math.max(1, options.desiredAccuracyM);
  const minimumConsensusSamples = Math.max(2, options.minimumConsensusSamples ?? 3);
  const minimumSampleSpanMs = Math.max(0, options.minimumSampleSpanMs ?? 2_500);
  const minimumWaitMs = Math.max(1_500, options.minimumWaitMs ?? 6_000);
  const maximumWaitMs = Math.max(minimumWaitMs + 2_000, options.maximumWaitMs ?? 25_000);
  const pollIntervalMs = Math.max(2_000, options.pollIntervalMs ?? 3_000);

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const samples: GeolocationPosition[] = [];
    let watchId: number | null = null;
    let deadlineId: number | null = null;
    let minimumWaitId: number | null = null;
    let pollId: number | null = null;
    let pollInFlight = false;
    let finished = false;

    const cleanUp = () => {
      if (watchId !== null) geolocation.clearWatch(watchId);
      if (deadlineId !== null) window.clearTimeout(deadlineId);
      if (minimumWaitId !== null) window.clearTimeout(minimumWaitId);
      if (pollId !== null) window.clearInterval(pollId);
    };

    const fail = (message: string) => {
      if (finished) return;
      finished = true;
      cleanUp();
      reject(new Error(message));
    };

    const finish = (atDeadline = false) => {
      if (finished) return;
      const consensus = selectLocationConsensus(samples);
      if (!consensus) {
        if (atDeadline) fail("No fresh location reading was received. Turn on precise location and try again.");
        return;
      }
      if (consensus.ambiguous) {
        if (atDeadline) fail("Location readings disagree. Keep the device still in one place and try again.");
        return;
      }
      if (consensus.consensusCount < minimumConsensusSamples) {
        if (atDeadline) fail(`Only ${consensus.consensusCount} matching location reading${consensus.consensusCount === 1 ? " was" : "s were"} received. Keep the device still and retry.`);
        return;
      }
      const consensusSamples = samples.filter((sample) => samplesAgree(consensus.position, sample));
      const sampleSpanMs = sampleTimeSpanMs(consensusSamples);
      if (sampleSpanMs < minimumSampleSpanMs) {
        if (atDeadline) fail("Location readings arrived too close together to verify movement. Keep the device still and try again.");
        return;
      }
      if (!atDeadline && Date.now() - startedAt < minimumWaitMs) return;
      if (!atDeadline && consensus.position.coords.accuracy > desiredAccuracyM) return;
      if (options.maximumAccuracyM !== undefined && consensus.position.coords.accuracy > options.maximumAccuracyM) {
        if (atDeadline) fail(`The stable location reading was +/-${Math.round(consensus.position.coords.accuracy)} m. Move to an open area and try again.`);
        return;
      }

      finished = true;
      cleanUp();
      const selected = consensus.position;
      const endedAt = Date.now();
      resolve({
        latitude: selected.coords.latitude,
        longitude: selected.coords.longitude,
        accuracy: selected.coords.accuracy,
        altitude: selected.coords.altitude,
        altitudeAccuracy: selected.coords.altitudeAccuracy,
        heading: selected.coords.heading,
        speed: selected.coords.speed,
        capturedAt: new Date(selected.timestamp).toISOString(),
        sampleCount: samples.length,
        consensusCount: consensus.consensusCount,
        spreadM: consensus.spreadM,
        captureDurationMs: endedAt - startedAt,
        captureStartedAt: new Date(startedAt).toISOString(),
        captureEndedAt: new Date(endedAt).toISOString(),
        samples: samples.slice(-20).map(toBrowserLocationSample),
      });
    };

    const handlePosition = (position: GeolocationPosition) => {
      pollInFlight = false;
      if (finished || !isUsableLocationSample(position) || isDuplicateSample(samples, position) || isTooSoonAfterLastSample(samples, position)) return;
      samples.push(position);
      if (samples.length > MAX_RETAINED_SAMPLES) samples.shift();
      const consensus = selectLocationConsensus(samples);
      if (consensus) {
        options.onProgress?.({
          bestAccuracyM: consensus.position.coords.accuracy,
          sampleCount: samples.length,
          consensusCount: consensus.consensusCount,
          spreadM: consensus.spreadM,
          elapsedMs: Date.now() - startedAt,
        });
      }
      finish(false);
    };

    const handleError = (error: GeolocationPositionError) => {
      pollInFlight = false;
      if (!finished && error.code === 1) {
        fail("Precise location permission is required. Enable it in browser settings and try again.");
      }
    };

    const assignedWatchId = geolocation.watchPosition(
      handlePosition,
      handleError,
      { enableHighAccuracy: true, maximumAge: 0, timeout: maximumWaitMs },
    );
    watchId = assignedWatchId;
    if (finished) {
      geolocation.clearWatch(assignedWatchId);
      return;
    }

    if (geolocation.getCurrentPosition) {
      pollInFlight = true;
      geolocation.getCurrentPosition(
        handlePosition,
        handleError,
        { enableHighAccuracy: true, maximumAge: 0, timeout: Math.min(8_000, maximumWaitMs) },
      );
    }

    minimumWaitId = window.setTimeout(() => finish(false), minimumWaitMs);
    deadlineId = window.setTimeout(() => finish(true), maximumWaitMs);
    if (geolocation.getCurrentPosition) {
      pollId = window.setInterval(() => {
        if (finished || pollInFlight) return;
        pollInFlight = true;
        geolocation.getCurrentPosition?.(
          handlePosition,
          handleError,
          { enableHighAccuracy: true, maximumAge: 0, timeout: Math.min(8_000, maximumWaitMs) },
        );
      }, pollIntervalMs);
    }
  });
}

function summarizeCluster(samples: GeolocationPosition[], members: number[]) {
  const candidates = members.map((index) => samples[index]);
  const ranked = candidates.map((position) => ({
    position,
    totalDistanceM: candidates.reduce((sum, sample) => sum + distanceBetweenPositions(position, sample), 0),
  })).sort((a, b) => a.totalDistanceM - b.totalDistanceM
    || a.position.coords.accuracy - b.position.coords.accuracy
    || b.position.timestamp - a.position.timestamp);
  const medoid = ranked[0];
  return {
    position: medoid.position,
    totalDistanceM: medoid.totalDistanceM,
    consensusCount: members.length,
    spreadM: Math.round(Math.max(0, ...candidates.map((sample) => distanceBetweenPositions(medoid.position, sample)))),
  };
}

function samplesAgree(first: GeolocationPosition, second: GeolocationPosition) {
  return distanceBetweenPositions(first, second) <= agreementDistanceM(first, second);
}

function agreementDistanceM(first: GeolocationPosition, second: GeolocationPosition) {
  return Math.max(20, Math.min(80, Math.max(first.coords.accuracy, second.coords.accuracy) * 0.6));
}

function isDuplicateSample(samples: GeolocationPosition[], candidate: GeolocationPosition) {
  return samples.some((sample) => sample.timestamp === candidate.timestamp
    && sample.coords.latitude === candidate.coords.latitude
    && sample.coords.longitude === candidate.coords.longitude
    && sample.coords.accuracy === candidate.coords.accuracy);
}

function isTooSoonAfterLastSample(samples: GeolocationPosition[], candidate: GeolocationPosition) {
  const latest = samples[samples.length - 1];
  if (!latest) return false;
  return candidate.timestamp > latest.timestamp
    && candidate.timestamp - latest.timestamp < MIN_DISTINCT_SAMPLE_INTERVAL_MS;
}

function sampleTimeSpanMs(samples: GeolocationPosition[]) {
  if (samples.length < 2) return 0;
  const timestamps = samples.map((sample) => sample.timestamp);
  return Math.max(...timestamps) - Math.min(...timestamps);
}

function toBrowserLocationSample(position: GeolocationPosition): BrowserLocationSample {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
    altitude: position.coords.altitude,
    altitudeAccuracy: position.coords.altitudeAccuracy,
    heading: position.coords.heading,
    speed: position.coords.speed,
    capturedAt: new Date(position.timestamp).toISOString(),
  };
}

function distanceBetweenPositions(first: GeolocationPosition, second: GeolocationPosition) {
  const radians = (value: number) => value * Math.PI / 180;
  const dLat = radians(second.coords.latitude - first.coords.latitude);
  const dLng = radians(second.coords.longitude - first.coords.longitude);
  const firstLat = radians(first.coords.latitude);
  const secondLat = radians(second.coords.latitude);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(firstLat) * Math.cos(secondLat) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
