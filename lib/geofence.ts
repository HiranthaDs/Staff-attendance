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
  const acceptedAccuracyM = Math.max(200, input.maxAccuracyM);
  const accuracyOk = input.gpsAvailable && input.accuracyM <= acceptedAccuracyM;
  const gpsOk = accuracyOk && input.distanceM <= input.radiusM;

  return {
    gpsOk,
    accuracyOk,
    method: gpsOk
      ? (input.accuracyM <= input.maxAccuracyM ? "precise" : "standard")
      : "none",
  } as const;
}

export function evaluatePresence(input: {
  distanceM: number;
  accuracyM: number;
  radiusM: number;
  maxAccuracyM: number;
  gpsAvailable: boolean;
}) {
  const gps = evaluateGpsPosition(input);
  const { gpsOk, accuracyOk } = gps;

  const allowed = gpsOk;

  let reason = "Verified";
  if (!allowed) {
    if (!input.gpsAvailable)
      reason = "Location is unavailable or too old. Enable precise location and try again.";
    else if (!accuracyOk)
      reason = `Location accuracy is +/-${Math.round(input.accuracyM)} m. Enable precise location and try again.`;
    else if (!gpsOk)
      reason = `Your location is ${Math.round(input.distanceM)} m from the office centre, outside the ${input.radiusM} m attendance radius.`;
  }

  return {
    allowed,
    gpsOk,
    accuracyOk,
    reason,
    gpsMethod: gps.method,
  };
}
