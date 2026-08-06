"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { BoundingBox, ParkingSpot } from "@/lib/types";

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

function spotIcon(status: ParkingSpot["status"]["value"]) {
  const color = statusColor(status);
  return L.divIcon({
    className: "",
    html: `<span style="display:block;width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 2px rgba(0,0,0,0.5);"></span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
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

interface ParkingMapProps {
  spots: ParkingSpot[];
  center: [number, number];
  zoom: number;
  flyTo: FlyToTarget | null;
  onMoveEnd: (bbox: BoundingBox) => void;
  onReady: (bbox: BoundingBox) => void;
}

export default function ParkingMap({ spots, center, zoom, flyTo, onMoveEnd, onReady }: ParkingMapProps) {
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
        <Marker key={spot.id} position={[spot.lat, spot.lng]} icon={spotIcon(spot.status.value) ?? DEFAULT_ICON}>
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
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
