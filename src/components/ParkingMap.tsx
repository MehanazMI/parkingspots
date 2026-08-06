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

function spotIcon(spot: ParkingSpot) {
  const color = statusColor(spot.status.value);
  const ring = spot.occupancy ? occupancyRingColor(spot.occupancy.status) : null;
  const shadow = ring
    ? `box-shadow:0 0 0 3px ${ring}, 0 0 2px rgba(0,0,0,0.5);`
    : `box-shadow:0 0 2px rgba(0,0,0,0.5);`;
  return L.divIcon({
    className: "",
    html: `<span style="display:block;width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;${shadow}"></span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
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
  onMoveEnd: (bbox: BoundingBox) => void;
  onReady: (bbox: BoundingBox) => void;
  onReport: (spotId: string, status: OccupancyStatus) => Promise<void>;
}

export default function ParkingMap({ spots, center, zoom, flyTo, onMoveEnd, onReady, onReport }: ParkingMapProps) {
  const readyFired = useRef(false);

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
        <Marker key={spot.id} position={[spot.lat, spot.lng]} icon={spotIcon(spot) ?? DEFAULT_ICON}>
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
