"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useRef, useState } from "react";
import ChatPanel from "@/components/ChatPanel";
import SearchBar from "@/components/SearchBar";
import type { BoundingBox, ParkingSpot } from "@/lib/types";

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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadSpots = useCallback(async (bbox: BoundingBox) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        north: String(bbox.north),
        south: String(bbox.south),
        east: String(bbox.east),
        west: String(bbox.west),
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
  }, []);

  const handleReady = useCallback(
    (bbox: BoundingBox) => {
      setLastBbox(bbox);
      loadSpots(bbox);
    },
    [loadSpots]
  );

  const handleMoveEnd = useCallback(
    (bbox: BoundingBox) => {
      setLastBbox(bbox);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => loadSpots(bbox), 500);
    },
    [loadSpots]
  );

  const handleSelect = useCallback((result: { lat: number; lng: number; label: string }) => {
    setHighlightedSpotId(null);
    setFlyTo({ lat: result.lat, lng: result.lng, zoom: 17 });
  }, []);

  const handleSelectSpotFromChat = useCallback((spot: { id: string; lat: number; lng: number }) => {
    setHighlightedSpotId(spot.id);
    setFlyTo({ lat: spot.lat, lng: spot.lng, zoom: 18, spotId: spot.id });
  }, []);

  const handleReport = useCallback(async (spotId: string) => {
    const res = await fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spotId }),
    });
    if (!res.ok) throw new Error("Report failed");
    const data = await res.json();
    setSpots((prev) => prev.map((s) => (s.id === spotId ? { ...s, occupancy: { reportedAt: data.reportedAt } } : s)));
  }, []);

  const counts = useMemo(() => {
    const free = spots.filter((s) => s.status.value === "free").length;
    const metered = spots.filter((s) => s.status.value === "metered").length;
    return { free, metered, total: spots.length };
  }, [spots]);

  return (
    <div className="flex h-dvh w-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">NYC Parking Finder</h1>
          <p className="text-xs text-gray-500">Metered on-street parking, live-computed status</p>
        </div>
        <SearchBar onSelect={handleSelect} />
      </header>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-700">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-full bg-green-600" /> Free now ({counts.free})
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-full bg-red-600" /> Metered now ({counts.metered})
          </span>
          <span className="flex items-center gap-1.5 text-gray-500">
            <span className="inline-block h-3 w-3 rounded-full border-2 border-blue-600" /> Crowd-reported opening
          </span>
          {loading && <span className="text-gray-400">Loading…</span>}
          {error && <span className="text-red-600">{error}</span>}
        </div>
        <button
          type="button"
          onClick={() => lastBbox && loadSpots(lastBbox)}
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

        <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} onSelectSpot={handleSelectSpotFromChat} />
      </div>
    </div>
  );
}
