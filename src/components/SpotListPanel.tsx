"use client";

import { useMemo } from "react";
import { haversineMeters } from "@/lib/geo";
import { STATUS_LABEL } from "@/lib/statusLabel";
import type { ParkingSpot } from "@/lib/types";

type SortBy = "distance" | "cost";

interface SpotListPanelProps {
  open: boolean;
  onClose: () => void;
  spots: ParkingSpot[];
  center: { lat: number; lng: number } | null;
  sortBy: SortBy;
  onSortByChange: (sortBy: SortBy) => void;
  onSelectSpot: (spot: { id: string; lat: number; lng: number }) => void;
}

const STATUS_COLOR: Record<string, string> = {
  free: "bg-green-600",
  metered: "bg-red-600",
  unknown: "bg-gray-500",
};

function costRank(spot: ParkingSpot): number {
  return spot.facilityType === "street" && spot.rate ? spot.rate.hourlyRate : Number.POSITIVE_INFINITY;
}

function SpotRow({ spot, distanceMeters, onSelect }: { spot: ParkingSpot; distanceMeters: number | null; onSelect: () => void }) {
  const distanceLabel = distanceMeters !== null ? `${Math.round(distanceMeters)}m away` : null;

  if (spot.facilityType === "garage") {
    return (
      <button
        type="button"
        onClick={onSelect}
        className="block w-full rounded border border-gray-200 bg-white px-2.5 py-1.5 text-left text-xs hover:bg-gray-50"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-gray-900">{spot.name}</span>
          <span className="rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-medium text-white">GARAGE</span>
        </div>
        <p className="text-gray-500">
          {spot.address}
          {distanceLabel ? ` · ${distanceLabel}` : ""}
        </p>
        <p className="text-gray-400">
          {spot.vehicleCapacity !== null ? `${spot.vehicleCapacity} capacity` : "Capacity unknown"} · no rate data
        </p>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className="block w-full rounded border border-gray-200 bg-white px-2.5 py-1.5 text-left text-xs hover:bg-gray-50"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-gray-900">
          {spot.onStreet} ({spot.sideOfStreet})
        </span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium text-white ${STATUS_COLOR[spot.status.value]}`}>
          {STATUS_LABEL[spot.status.value].toUpperCase()}
        </span>
      </div>
      <p className="text-gray-500">
        Between {spot.fromStreet} &amp; {spot.toStreet}
        {distanceLabel ? ` · ${distanceLabel}` : ""}
      </p>
      <p className="text-gray-400">
        {spot.rate ? `$${spot.rate.hourlyRate.toFixed(2)}/hr (${spot.rate.zoneName})` : "no rate data"}
      </p>
    </button>
  );
}

export default function SpotListPanel({ open, onClose, spots, center, sortBy, onSortByChange, onSelectSpot }: SpotListPanelProps) {
  const ranked = useMemo(() => {
    const withDistance = spots.map((spot) => ({
      spot,
      distanceMeters: center ? haversineMeters(center.lat, center.lng, spot.lat, spot.lng) : null,
    }));

    if (sortBy === "cost") {
      return withDistance.sort(
        (a, b) => costRank(a.spot) - costRank(b.spot) || (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0)
      );
    }
    return withDistance.sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0));
  }, [spots, center, sortBy]);

  if (!open) return null;

  return (
    <div className="absolute left-0 top-0 z-[1100] flex h-full w-full max-w-sm flex-col border-r border-gray-200 bg-white shadow-xl sm:w-80">
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2.5">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Spots in view ({ranked.length})</h2>
          <p className="text-xs text-gray-500">Sorted by {sortBy === "cost" ? "cost (no-rate results last)" : "distance"}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <div className="flex items-center gap-1 border-b border-gray-200 bg-gray-50 p-2">
        {(["distance", "cost"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSortByChange(s)}
            className={`rounded px-2.5 py-1 text-xs font-medium ${
              sortBy === s ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-100"
            }`}
          >
            {s === "distance" ? "Distance" : "Cost"}
          </button>
        ))}
      </div>

      <div className="flex-1 space-y-1.5 overflow-y-auto p-2.5">
        {ranked.length === 0 && <p className="text-xs text-gray-400">No spots loaded for this area yet.</p>}
        {ranked.map(({ spot, distanceMeters }) => (
          <SpotRow
            key={spot.id}
            spot={spot}
            distanceMeters={distanceMeters}
            onSelect={() => onSelectSpot({ id: spot.id, lat: spot.lat, lng: spot.lng })}
          />
        ))}
      </div>
    </div>
  );
}
