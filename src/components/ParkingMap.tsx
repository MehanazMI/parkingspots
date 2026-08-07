"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { STATUS_LABEL } from "@/lib/statusLabel";
import type { BoundingBox, ConfidenceLevel, GarageSpot, ParkingSpot, StreetSpot } from "@/lib/types";

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

function statusColor(status: StreetSpot["status"]["value"]): string {
  if (status === "free") return "#16a34a";
  if (status === "metered") return "#dc2626";
  return "#6b7280";
}

const OCCUPANCY_RING_COLOR = "#2563eb";
const GARAGE_COLOR = "#4f46e5";

// Leaflet's Marker replaces its DOM icon (and closes any open popup) whenever
// it receives a new Icon *object*, even if it looks identical to the last
// one. Cache by visual signature so unrelated spots refetches — which
// otherwise rebuild every icon from scratch — reuse the same instance for
// markers whose appearance hasn't actually changed.
const iconCache = new Map<string, L.DivIcon>();

function spotIcon(spot: ParkingSpot, isHighlighted: boolean) {
  if (spot.facilityType === "garage") {
    const cacheKey = `garage|${isHighlighted}`;
    const cached = iconCache.get(cacheKey);
    if (cached) return cached;
    const size = isHighlighted ? 20 : 13;
    const border = isHighlighted ? 3 : 2;
    const icon = L.divIcon({
      className: isHighlighted ? "spot-marker-highlight" : "",
      html: `<span style="display:block;width:${size}px;height:${size}px;border-radius:3px;background:${GARAGE_COLOR};border:${border}px solid white;box-shadow:0 0 2px rgba(0,0,0,0.5);"></span>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
    iconCache.set(cacheKey, icon);
    return icon;
  }

  const cacheKey = `${spot.status.value}|${!!spot.occupancy}|${isHighlighted}`;
  const cached = iconCache.get(cacheKey);
  if (cached) return cached;

  const color = statusColor(spot.status.value);
  const shadow = spot.occupancy
    ? `box-shadow:0 0 0 3px ${OCCUPANCY_RING_COLOR}, 0 0 2px rgba(0,0,0,0.5);`
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

const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  low: "Low confidence",
  medium: "Medium confidence",
  high: "High confidence",
};

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
  // useMapEvents re-subscribes (map.off + map.on) whenever this handlers
  // object's identity changes — a fresh object literal here on every render
  // meant it was resubscribing on every single re-render of the map (which
  // happens often, e.g. whenever `spots` updates), not just when `onMoveEnd`
  // itself actually changes.
  const handleMoveEnd = useCallback(
    (map: L.Map) => {
      const b = map.getBounds();
      onMoveEnd({
        north: b.getNorth(),
        south: b.getSouth(),
        east: b.getEast(),
        west: b.getWest(),
      });
    },
    [onMoveEnd]
  );

  const map = useMap();
  const handlers = useMemo(() => ({ moveend: () => handleMoveEnd(map) }), [handleMoveEnd, map]);
  useMapEvents(handlers);
  return null;
}

interface OccupancySectionProps {
  spot: StreetSpot;
  onReport: (spotId: string) => Promise<void>;
}

function OccupancySection({ spot, onReport }: OccupancySectionProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (spot.status.value !== "metered") return null;

  async function handle() {
    setSubmitting(true);
    setError(null);
    try {
      await onReport(spot.id);
    } catch {
      setError("Couldn't submit report — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-2 border-t border-gray-200 pt-2">
      {spot.occupancy ? (
        <p className="text-xs text-gray-600">
          <span className="font-medium" style={{ color: OCCUPANCY_RING_COLOR }}>
            {spot.occupancy.reportCount === 1
              ? "1 person"
              : `${spot.occupancy.reportCount}${spot.occupancy.reportCount >= 5 ? "+" : ""} people`}{" "}
            saw an opening on this block
          </span>{" "}
          ({timeAgo(spot.occupancy.lastReportedAt)}) ·{" "}
          <span className="font-medium">{CONFIDENCE_LABEL[spot.occupancy.confidence]}</span>
        </p>
      ) : (
        <p className="text-xs text-gray-400">No recent crowd reports for this block.</p>
      )}
      <button
        type="button"
        disabled={submitting}
        onClick={handle}
        className="mt-1.5 rounded border border-blue-300 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
      >
        {submitting ? "Sending…" : "I saw an opening here"}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function StreetPopupContent({ spot, onReport }: { spot: StreetSpot; onReport: (spotId: string) => Promise<void> }) {
  return (
    <>
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
          {STATUS_LABEL[spot.status.value].toUpperCase()}
        </span>
      </p>
      <p className="mt-1 text-gray-600">{spot.status.detail}</p>
      <p className="mt-1 text-xs text-gray-400">Posted meter hours: {spot.meterHours || "n/a"}</p>
      {spot.rate && (
        <p className="mt-1 text-xs text-gray-500">
          ${spot.rate.hourlyRate.toFixed(2)}/hr ({spot.rate.zoneName} zone) — 1st hour rate, All Vehicles
        </p>
      )}
      <OccupancySection spot={spot} onReport={onReport} />
    </>
  );
}

function GaragePopupContent({ spot }: { spot: GarageSpot }) {
  return (
    <>
      <p className="font-semibold">{spot.name}</p>
      <p className="text-gray-600">
        {spot.address || "Address unavailable"}
        {spot.borough ? `, ${spot.borough}` : ""}
      </p>
      <p className="mt-1">
        <span
          className="inline-block rounded px-1.5 py-0.5 text-xs font-medium text-white"
          style={{ backgroundColor: GARAGE_COLOR }}
        >
          GARAGE
        </span>
      </p>
      <p className="mt-1 text-gray-600">
        {spot.vehicleCapacity !== null ? `${spot.vehicleCapacity} vehicle capacity (total, not live availability)` : "Capacity not on file"}
      </p>
      {spot.bicycleCapacity !== null && spot.bicycleCapacity > 0 && (
        <p className="text-gray-600">{spot.bicycleCapacity} bicycle capacity</p>
      )}
      <p className="mt-1 text-xs text-gray-400">
        Rate not available in NYC&apos;s open data — check with the garage directly.
      </p>
    </>
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
  onReport: (spotId: string) => Promise<void>;
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
              {spot.facilityType === "garage" ? (
                <GaragePopupContent spot={spot} />
              ) : (
                <StreetPopupContent spot={spot} onReport={onReport} />
              )}
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
