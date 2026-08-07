"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useRef, useState } from "react";
import ChatPanel from "@/components/ChatPanel";
import SearchBar from "@/components/SearchBar";
import SpotListPanel from "@/components/SpotListPanel";
import { STATUS_LABEL } from "@/lib/statusLabel";
import type { BoundingBox, ParkingSpot } from "@/lib/types";

type FacilityFilter = "street" | "garage" | "both";
type SortBy = "distance" | "cost";

const ParkingMap = dynamic(() => import("@/components/ParkingMap"), {
  ssr: false,
  loading: () => <div className="flex h-full w-full items-center justify-center text-gray-400">Loading map…</div>,
});

const UNION_SQUARE: [number, number] = [40.7359, -73.9911];

export default function Home() {
  const [spots, setSpots] = useState<ParkingSpot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number; zoom?: number; spotId?: string } | null>(null);
  const [lastBbox, setLastBbox] = useState<BoundingBox | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [highlightedSpotId, setHighlightedSpotId] = useState<string | null>(null);
  const [facilityFilter, setFacilityFilter] = useState<FacilityFilter>("both");
  const [listOpen, setListOpen] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>("distance");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadSpots = useCallback(
    async (bbox: BoundingBox, filter: FacilityFilter) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          north: String(bbox.north),
          south: String(bbox.south),
          east: String(bbox.east),
          west: String(bbox.west),
          type: filter,
        });
        const res = await fetch(`/api/parking?${params.toString()}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load parking data");
        setSpots(data.spots ?? []);
      } catch {
        setError("Couldn't load parking data for this area. Try panning or searching again.");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const handleReady = useCallback(
    (bbox: BoundingBox) => {
      setLastBbox(bbox);
      loadSpots(bbox, facilityFilter);
    },
    [loadSpots, facilityFilter]
  );

  const handleMoveEnd = useCallback(
    (bbox: BoundingBox) => {
      setLastBbox(bbox);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => loadSpots(bbox, facilityFilter), 500);
    },
    [loadSpots, facilityFilter]
  );

  const handleFilterChange = useCallback(
    (filter: FacilityFilter) => {
      setFacilityFilter(filter);
      if (lastBbox) loadSpots(lastBbox, filter);
    },
    [lastBbox, loadSpots]
  );

  const handleSelect = useCallback((result: { lat: number; lng: number; label: string }) => {
    setHighlightedSpotId(null);
    setFlyTo({ lat: result.lat, lng: result.lng, zoom: 17 });
  }, []);

  const handleSelectSpot = useCallback((spot: { id: string; lat: number; lng: number }) => {
    setHighlightedSpotId(spot.id);
    // A chat or list-panel result may be a type the current filter is hiding
    // (e.g. a garage while "Street" is selected) — switch to "Both" so it's
    // guaranteed to actually load and be highlightable, not silently do nothing.
    setFacilityFilter("both");
    setFlyTo({ lat: spot.lat, lng: spot.lng, zoom: 18, spotId: spot.id });
  }, []);

  const handleReport = useCallback(async (spotId: string) => {
    const res = await fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spotId }),
    });
    if (!res.ok) throw new Error("Report failed");
    const occupancy = await res.json();
    setSpots((prev) =>
      prev.map((s) => (s.facilityType === "street" && s.id === spotId ? { ...s, occupancy } : s))
    );
  }, []);

  const mapCenter = useMemo(() => {
    if (!lastBbox) return null;
    return { lat: (lastBbox.north + lastBbox.south) / 2, lng: (lastBbox.east + lastBbox.west) / 2 };
  }, [lastBbox]);

  const counts = useMemo(() => {
    const streetSpots = spots.filter((s): s is Extract<ParkingSpot, { facilityType: "street" }> => s.facilityType === "street");
    const free = streetSpots.filter((s) => s.status.value === "free").length;
    const metered = streetSpots.filter((s) => s.status.value === "metered").length;
    const garages = spots.filter((s) => s.facilityType === "garage").length;
    return { free, metered, garages, total: spots.length };
  }, [spots]);

  return (
    <div className="flex h-dvh w-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">NYC Parking Finder</h1>
          <p className="text-xs text-gray-500">Legal parking status by block, computed live — not a live occupancy feed</p>
        </div>
        <SearchBar onSelect={handleSelect} />
      </header>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-700">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1 rounded-md border border-gray-300 bg-white p-0.5">
            {(["both", "street", "garage"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => handleFilterChange(f)}
                className={`rounded px-2.5 py-1 text-xs font-medium ${
                  facilityFilter === f ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {f === "both" ? "Both" : f === "street" ? "Street" : "Garages"}
              </button>
            ))}
          </div>
          {facilityFilter !== "garage" && (
            <>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-full bg-green-600" /> {STATUS_LABEL.free} now ({counts.free})
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-full bg-red-600" /> Metered now ({counts.metered})
              </span>
              <span className="flex items-center gap-1.5 text-gray-500">
                <span className="inline-block h-3 w-3 rounded-full border-2 border-blue-600" /> Crowd-reported opening
              </span>
            </>
          )}
          {facilityFilter !== "street" && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-indigo-600" /> Garages ({counts.garages})
            </span>
          )}
          <span
            className="flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-gray-300 text-[10px] font-semibold text-gray-500"
            title="Each street marker covers a block-face segment (curb between two cross streets), which often includes multiple parking spaces — not a single space. 'No cost'/'Metered' reflects the posted legal status, computed live — 'No cost' means no payment is required right now, not that a space is confirmed empty. A crowd report means someone recently saw an opening somewhere on that block, not that the whole block (or any specific space) is open. Garage markers show total licensed capacity, not live availability or rates."
          >
            i
          </span>
          {loading && <span className="text-gray-400">Loading…</span>}
          {error && <span className="text-red-600">{error}</span>}
        </div>
        <button
          type="button"
          onClick={() => lastBbox && loadSpots(lastBbox, facilityFilter)}
          className="rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
        >
          Refresh
        </button>
      </div>

      <div className="relative flex-1">
        <ParkingMap
          spots={spots}
          center={UNION_SQUARE}
          zoom={16}
          flyTo={flyTo}
          highlightedSpotId={highlightedSpotId}
          onMoveEnd={handleMoveEnd}
          onReady={handleReady}
          onReport={handleReport}
        />

        {!chatOpen && (
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            className="absolute bottom-4 right-4 z-[1000] rounded-full bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg hover:bg-blue-700"
          >
            Ask AI
          </button>
        )}

        {!listOpen && (
          <button
            type="button"
            onClick={() => setListOpen(true)}
            className="absolute bottom-20 left-4 z-[1000] rounded-full border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-lg hover:bg-gray-50"
          >
            List
          </button>
        )}

        <SpotListPanel
          open={listOpen}
          onClose={() => setListOpen(false)}
          spots={spots}
          center={mapCenter}
          sortBy={sortBy}
          onSortByChange={setSortBy}
          onSelectSpot={handleSelectSpot}
        />

        <ChatPanel
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          onSelectSpot={handleSelectSpot}
          facilityFilter={facilityFilter}
        />
      </div>
    </div>
  );
}
