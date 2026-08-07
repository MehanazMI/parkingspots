"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { BoundingBox, OccupancyStatus, ParkingSpot } from "@/lib/types";

// Default Leaflet marker icons reference files that don't survive bundling;
// point them at the CDN copies instead.
const DEFAULT_ICON = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

function statusColor(status: ParkingSpot["status"]["value"]): string {
  if (status === "free") return "#16a34a";
  if (status === "metered") return "#dc2626";
  return "#6b7280";
}

function occupancyRingColor(status: OccupancyStatus): string {
  return status === "open" ? "#2563eb" : "#ea580c";
}

// Leaflet's Marker replaces its DOM icon (and closes any open popup) whenever
// it receives a new Icon *object*, even if it looks identical to the last
// one. Cache by visual signature so unrelated spots refetches — which
// otherwise rebuild every icon from scratch — reuse the same instance for
// markers whose appearance hasn't actually changed.
const iconCache = new Map<string, L.DivIcon>();

function spotIcon(spot: ParkingSpot, isHighlighted: boolean) {
  const occupancyKey = spot.occupancy?.status ?? "none";
  const cacheKey = `${spot.status.value}|${occupancyKey}|${isHighlighted}`;
  const cached = iconCache.get(cacheKey);
  if (cached) return cached;

  const color = statusColor(spot.status.value);
  const ring = spot.occupancy ? occupancyRingColor(spot.occupancy.status) : null;
  const shadow = ring
    ? `box-shadow:0 0 0 3px ${ring}, 0 0 2px rgba(0,0,0,0.5);`
    : `box-shadow:0 0 2px rgba(0,0,0,0.5);`;
  const size = isHighlighted ? 22 : 14;
  const border = isHighlighted ? 3 : 2;
  const icon = L.divIcon({
    className: isHighlighted ? "spot-marker-highlight" : "",
    html: `<span style="display:block;width:${size}px;height:${size}px;border-radius:50%;background:${color};border:${border}px solid white;${shadow}"></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
  iconCache.set(cacheKey, icon);
  return icon;
}

function timeAgo(reportedAt: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - reportedAt) / 60000));
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 min ago";
  return `${minutes} min ago`;
}

interface FlyToTarget {
  lat: number;
  lng: number;
  zoom?: number;
  spotId?: string;
}

function FlyToController({ target }: { target: FlyToTarget | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) {
      map.flyTo([target.lat, target.lng], target.zoom ?? 17);
    }
  }, [target, map]);
  return null;
}

function MoveEndController({ onMoveEnd }: { onMoveEnd: (bbox: BoundingBox) => void }) {
  const map = useMapEvents({
    moveend: () => {
      const b = map.getBounds();
      onMoveEnd({
        north: b.getNorth(),
        south: b.getSouth(),
        east: b.getEast(),
        west: b.getWest(),
      });
    },
  });
  return null;
}

interface OccupancySectionProps {
  spot: ParkingSpot;
  onReport: (spotId: string, status: OccupancyStatus) => Promise<void>;
}

function OccupancySection({ spot, onReport }: OccupancySectionProps) {
  const [submitting, setSubmitting] = useState<OccupancyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (spot.status.value !== "metered") return null;

  async function handle(status: OccupancyStatus) {
    setSubmitting(status);
    setError(null);
    try {
      await onReport(spot.id, status);
    } catch {
      setError("Couldn't submit report — try again.");
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="mt-2 border-t border-gray-200 pt-2">
      {spot.occupancy ? (
        <p className="text-xs text-gray-600">
          Crowd report:{" "}
          <span
            className="font-medium"
            style={{ color: occupancyRingColor(spot.occupancy.status) }}
          >
            {spot.occupancy.status === "open" ? "someone saw this open" : "someone saw this taken"}
          </span>{" "}
          ({timeAgo(spot.occupancy.reportedAt)})
        </p>
      ) : (
        <p className="text-xs text-gray-400">No recent crowd reports for this spot.</p>
      )}
      <div className="mt-1.5 flex gap-2">
        <button
          type="button"
          disabled={submitting !== null}
          onClick={() => handle("open")}
          className="rounded border border-blue-300 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
        >
          {submitting === "open" ? "Sending…" : "It's open"}
        </button>
        <button
          type="button"
          disabled={submitting !== null}
          onClick={() => handle("taken")}
          className="rounded border border-orange-300 bg-orange-50 px-2 py-1 text-xs font-medium text-orange-700 hover:bg-orange-100 disabled:opacity-50"
        >
          {submitting === "taken" ? "Sending…" : "It's taken"}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

interface ParkingMapProps {
  spots: ParkingSpot[];
  center: [number, number];
  zoom: number;
  flyTo: FlyToTarget | null;
  highlightedSpotId: string | null;
  onMoveEnd: (bbox: BoundingBox) => void;
  onReady: (bbox: BoundingBox) => void;
  onReport: (spotId: string, status: OccupancyStatus) => Promise<void>;
}

export default function ParkingMap({
  spots,
  center,
  zoom,
  flyTo,
  highlightedSpotId,
  onMoveEnd,
  onReady,
  onReport,
}: ParkingMapProps) {
  const readyFired = useRef(false);
  const markerRefs = useRef<Record<string, L.Marker>>({});
  const openedForRef = useRef<string | null>(null);

  // Open the highlighted spot's popup as soon as its marker actually exists —
  // decoupled from the fly-to animation, since a chat-selected spot's data
  // may still be loading (new bbox fetch) when the animation finishes.
  useEffect(() => {
    if (!highlightedSpotId || openedForRef.current === highlightedSpotId) return;
    const marker = markerRefs.current[highlightedSpotId];
    if (marker) {
      marker.openPopup();
      openedForRef.current = highlightedSpotId;
    }
  }, [highlightedSpotId, spots]);

  return (
    <MapContainer
      center={center}
      zoom={zoom}
      className="h-full w-full"
      ref={(map) => {
        if (map && !readyFired.current) {
          readyFired.current = true;
          const b = map.getBounds();
          onReady({
            north: b.getNorth(),
            south: b.getSouth(),
            east: b.getEast(),
            west: b.getWest(),
          });
        }
      }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FlyToController target={flyTo} />
      <MoveEndController onMoveEnd={onMoveEnd} />
      {spots.map((spot) => (
        <Marker
          key={spot.id}
          position={[spot.lat, spot.lng]}
          icon={spotIcon(spot, spot.id === highlightedSpotId) ?? DEFAULT_ICON}
          ref={(m) => {
            if (m) markerRefs.current[spot.id] = m;
            else delete markerRefs.current[spot.id];
          }}
        >
          <Popup>
            <div className="text-sm">
              <p className="font-semibold">
                {spot.onStreet} ({spot.sideOfStreet} side)
              </p>
              <p className="text-gray-600">
                Between {spot.fromStreet} &amp; {spot.toStreet}
              </p>
              <p className="mt-1">
                <span
                  className="inline-block rounded px-1.5 py-0.5 text-xs font-medium text-white"
                  style={{ backgroundColor: statusColor(spot.status.value) }}
                >
                  {spot.status.value.toUpperCase()}
                </span>
              </p>
              <p className="mt-1 text-gray-600">{spot.status.detail}</p>
              <p className="mt-1 text-xs text-gray-400">Posted meter hours: {spot.meterHours || "n/a"}</p>
              <OccupancySection spot={spot} onReport={onReport} />
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
