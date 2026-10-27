"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, Check, Crosshair, LoaderCircle, MapPin, Navigation, X } from "lucide-react";
import { distanceInMeters, evaluateGpsPosition } from "@/lib/geofence";

export type StaffMapLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: string;
};

export function OfficeMap({
  office,
  staffLocation,
  locating,
  onLocate,
}: {
  office: { name: string; latitude: number; longitude: number; radiusM: number; maxAccuracyM: number };
  staffLocation: StaffMapLocation | null;
  locating: boolean;
  onLocate: () => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const officeCircleRef = useRef<import("leaflet").Circle | null>(null);
  const staffMarkerRef = useRef<import("leaflet").Marker | null>(null);
  const accuracyCircleRef = useRef<import("leaflet").Circle | null>(null);
  const [clockMs, setClockMs] = useState<number | null>(null);

  const distanceM = useMemo(
    () => staffLocation ? distanceInMeters(office, staffLocation) : null,
    [office, staffLocation],
  );
  const sampleAgeMs = staffLocation && clockMs !== null ? clockMs - new Date(staffLocation.capturedAt).getTime() : null;
  const sampleFresh = sampleAgeMs !== null && sampleAgeMs >= -10_000 && sampleAgeMs <= 120_000;
  const gpsEvaluation = distanceM !== null && staffLocation
    ? evaluateGpsPosition({
      distanceM,
      accuracyM: staffLocation.accuracy,
      radiusM: office.radiusM,
      maxAccuracyM: office.maxAccuracyM,
      gpsAvailable: sampleFresh,
    })
    : null;
  const locationState = staffLocation && !sampleFresh
    ? "stale"
    : gpsEvaluation?.gpsOk
    ? "inside"
    : distanceM !== null && staffLocation && Math.max(0, distanceM - staffLocation.accuracy) <= office.radiusM
      ? "uncertain"
      : "outside";

  useEffect(() => {
    const updateClock = () => setClockMs(Date.now());
    updateClock();
    const timer = window.setInterval(updateClock, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!element.current || mapRef.current) return;
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !element.current) return;
      leafletRef.current = L;
      const point: [number, number] = [office.latitude, office.longitude];
      const map = L.map(element.current, { zoomControl: false, attributionControl: true, dragging: true }).setView(point, 17);
      L.control.zoom({ position: "bottomright" }).addTo(map);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);
      const officeIcon = L.divIcon({ className: "office-location-icon", html: '<span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 10h.01M15 10h.01M9 14h.01M15 14h.01M10 21v-3h4v3"/></svg></span>', iconSize: [48, 52], iconAnchor: [24, 48] });
      L.marker(point, { icon: officeIcon, interactive: false }).addTo(map).bindTooltip(office.name, { direction: "top", offset: [0, -38] });
      const officeCircle = L.circle(point, { radius: office.radiusM, color: "#6e875e", fillColor: "#dfff72", fillOpacity: 0.2, weight: 2, dashArray: "7 6", interactive: false }).addTo(map);
      map.fitBounds(officeCircle.getBounds(), { padding: [28, 28], maxZoom: 17 });
      mapRef.current = map;
      officeCircleRef.current = officeCircle;
      window.setTimeout(() => map.invalidateSize(), 100);
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      leafletRef.current = null;
      officeCircleRef.current = null;
      staffMarkerRef.current = null;
      accuracyCircleRef.current = null;
    };
  }, [office.latitude, office.longitude, office.name, office.radiusM]);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const officeCircle = officeCircleRef.current;
    if (!L || !map || !officeCircle || !staffLocation) return;
    const point: [number, number] = [staffLocation.latitude, staffLocation.longitude];
    if (!staffMarkerRef.current) {
      const staffIcon = L.divIcon({ className: "staff-location-icon", html: '<span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3"/><path d="M6.5 20c.7-4 2.5-6 5.5-6s4.8 2 5.5 6"/></svg></span>', iconSize: [36, 36], iconAnchor: [18, 18] });
      staffMarkerRef.current = L.marker(point, { icon: staffIcon, interactive: false }).addTo(map).bindTooltip("Your location", { direction: "top", offset: [0, -16] });
      accuracyCircleRef.current = L.circle(point, { radius: staffLocation.accuracy, color: "#26322a", fillColor: "#9ca99e", fillOpacity: 0.12, weight: 1, interactive: false }).addTo(map);
    } else {
      staffMarkerRef.current.setLatLng(point);
      accuracyCircleRef.current?.setLatLng(point).setRadius(staffLocation.accuracy);
    }
    const bounds = officeCircle.getBounds();
    bounds.extend(point);
    map.fitBounds(bounds, { padding: [34, 34], maxZoom: 17, animate: true });
  }, [staffLocation]);

  return (
    <section className="staff-office-map-card">
      <div className="staff-map-head">
        <div><span className="eyebrow">LIVE OFFICE MAP</span><h2>Are you at the office?</h2><p>{office.name} · {office.radiusM} m attendance zone</p></div>
        <button className="ios-map-locate" onClick={onLocate} disabled={locating}>{locating ? <LoaderCircle className="spin" size={18} /> : <Crosshair size={18} />}<span>{locating ? "Locating…" : staffLocation ? "Refresh" : "Show me"}</span></button>
      </div>
      <div className="staff-map-wrap">
        <div ref={element} className="staff-office-map" aria-label={`Map showing ${office.name} and your current location`} />
        <div className="map-glass-legend"><span><i className="office" /><Building2 size={13} /> Office</span><span><i className="staff" /><Navigation size={13} /> You</span></div>
        {staffLocation && <div className={`map-distance-pill ${locationState}`}>{locationState === "inside" ? <Check size={14} /> : locationState === "uncertain" || locationState === "stale" ? <Crosshair size={14} /> : <X size={14} />}<strong>{locationState === "inside" ? "You are inside the office zone" : locationState === "uncertain" ? "Your location is not accurate enough yet" : locationState === "stale" ? "Your location expired — refresh it" : "You are not inside the office zone"}</strong><span>{distanceM} m from office · ±{Math.round(staffLocation.accuracy)} m accuracy</span></div>}
        {!staffLocation && <div className="map-location-prompt"><MapPin size={16} /><span>Tap <strong>Show me</strong> to display your live position.</span></div>}
      </div>
    </section>
  );
}
