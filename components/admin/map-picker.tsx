"use client";

import { useEffect, useRef } from "react";

export function MapPicker({ latitude, longitude, radius, onChange }: { latitude: number; longitude: number; radius: number; onChange: (lat: number, lng: number) => void }) {
  const element = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markerRef = useRef<import("leaflet").Marker | null>(null);
  const circleRef = useRef<import("leaflet").Circle | null>(null);
  const callbackRef = useRef(onChange);

  useEffect(() => {
    callbackRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!element.current || mapRef.current) return;
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !element.current) return;
      const map = L.map(element.current, { zoomControl: true }).setView([latitude, longitude], 15);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);
      const icon = L.divIcon({ className: "map-pin-icon", html: "<span></span>", iconSize: [28, 36], iconAnchor: [14, 34] });
      const marker = L.marker([latitude, longitude], { draggable: true, icon }).addTo(map);
      const circle = L.circle([latitude, longitude], { radius, color: "#4351f4", fillColor: "#8e97ff", fillOpacity: 0.15, weight: 2 }).addTo(map);
      marker.on("dragend", () => { const point = marker.getLatLng(); circle.setLatLng(point); callbackRef.current(point.lat, point.lng); });
      map.on("click", (event: import("leaflet").LeafletMouseEvent) => { marker.setLatLng(event.latlng); circle.setLatLng(event.latlng); callbackRef.current(event.latlng.lat, event.latlng.lng); });
      mapRef.current = map; markerRef.current = marker; circleRef.current = circle;
      window.setTimeout(() => map.invalidateSize(), 100);
    });
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; };
    // Initialized once; later updates are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapRef.current || !markerRef.current || !circleRef.current) return;
    const next: [number, number] = [latitude, longitude];
    markerRef.current.setLatLng(next);
    circleRef.current.setLatLng(next).setRadius(radius);
  }, [latitude, longitude, radius]);

  return <div ref={element} className="map-picker" aria-label="Choose the branch location on the map" />;
}
