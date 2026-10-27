"use client";

import { useEffect, useRef } from "react";
import type { Branch } from "@/lib/types";

export function BranchMap({ branch, interactive = false, className = "branch-live-map" }: { branch: Branch; interactive?: boolean; className?: string }) {
  const element = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);

  useEffect(() => {
    if (!element.current || mapRef.current) return;
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !element.current) return;
      const point: [number, number] = [Number(branch.latitude), Number(branch.longitude)];
      const map = L.map(element.current, {
        attributionControl: interactive,
        dragging: interactive,
        scrollWheelZoom: interactive,
        doubleClickZoom: interactive,
        boxZoom: interactive,
        keyboard: interactive,
        zoomControl: interactive,
        tapHold: interactive,
      }).setView(point, 16);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);
      const icon = L.divIcon({ className: "branch-location-icon", html: "<span><i></i></span>", iconSize: [34, 40], iconAnchor: [17, 38] });
      L.marker(point, { icon, interactive: false }).addTo(map);
      const circle = L.circle(point, {
        radius: branch.radius_m,
        color: "#4351f4",
        fillColor: "#8e97ff",
        fillOpacity: .16,
        weight: 2,
        interactive: false,
      }).addTo(map);
      map.fitBounds(circle.getBounds(), { padding: [20, 20], maxZoom: 17 });
      mapRef.current = map;
      window.setTimeout(() => map.invalidateSize(), 120);
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [branch, interactive]);

  return <div ref={element} className={className} aria-label={`Map showing ${branch.name}`} />;
}
