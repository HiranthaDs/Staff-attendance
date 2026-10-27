const EARTH_RADIUS_M = 6_371_000;

export function distanceInMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
) {
  const radians = (value: number) => (value * Math.PI) / 180;
  const dLat = radians(to.latitude - from.latitude);
  const dLon = radians(to.longitude - from.longitude);
  const lat1 = radians(from.latitude);
  const lat2 = radians(to.latitude);
  const a =
    Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return Math.round(EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export function evaluateGpsPosition(input: {
  distanceM: number;
  accuracyM: number;
  radiusM: number;
  maxAccuracyM: number;
  gpsAvailable: boolean;
}) {
  const preciseAccuracy = input.accuracyM <= input.maxAccuracyM;
  const preciseInside = preciseAccuracy && input.distanceM <= input.radiusM;

  // A coarse reading may pass only when all of its reported uncertainty fits
  // inside the geofence. The hard ceiling prevents very broad fixes from being
  // accepted merely because an administrator configured a large radius.
  const containedAccuracyLimitM = Math.max(
    input.maxAccuracyM,
    Math.min(200, input.maxAccuracyM * 2),
  );
  const uncertaintyContained = input.accuracyM <= containedAccuracyLimitM
    && input.distanceM + input.accuracyM <= input.radiusM;
  const gpsOk = input.gpsAvailable && (preciseInside || uncertaintyContained);

  return {
    gpsOk,
    accuracyOk: input.gpsAvailable && (preciseAccuracy || uncertaintyContained),
    method: gpsOk
      ? (uncertaintyContained && !preciseInside ? "contained_uncertainty" : "precise")
      : "none",
  } as const;
}

export function evaluatePresence(input: {
  distanceM: number;
  accuracyM: number;
  radiusM: number;
  maxAccuracyM: number;
  gpsAvailable: boolean;
  ipAllowed: boolean;
  verificationMode: "gps_and_ip" | "gps_or_ip" | "gps_only";
  hasNetworks: boolean;
}) {
  const gps = evaluateGpsPosition(input);
  const { gpsOk, accuracyOk } = gps;

  let allowed = gpsOk;
  if (input.verificationMode === "gps_and_ip") {
    allowed = gpsOk && input.hasNetworks && input.ipAllowed;
  } else if (input.verificationMode === "gps_or_ip") {
    allowed = gpsOk || (input.hasNetworks && input.ipAllowed);
  }

  let reason = "Verified";
  if (!allowed) {
    if (input.verificationMode === "gps_and_ip" && !input.hasNetworks)
      reason = "This branch has no office network configured. Ask an administrator for help.";
    else if (input.verificationMode === "gps_and_ip" && gpsOk && !input.ipAllowed)
      reason = "Connect through the approved office internet connection and try again.";
    else if (!input.gpsAvailable)
      reason = "Location is unavailable or too old. Enable precise location and try again.";
    else if (!accuracyOk)
      reason = `GPS uncertainty is +/-${Math.round(input.accuracyM)} m at this position. Keep the device still in an open area and retry (target +/-${input.maxAccuracyM} m).`;
    else if (!gpsOk)
      reason = `Your location is ${Math.round(input.distanceM)} m from the office, outside its verified zone.`;
  }

  return {
    allowed,
    gpsOk,
    accuracyOk,
    reason,
    gpsMethod: gps.method,
  };
}
