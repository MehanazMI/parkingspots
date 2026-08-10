"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useRef, useState } from "react";
import ChatPanel from "@/components/ChatPanel";
import SearchBar from "@/components/SearchBar";
import SpotListPanel from "@/components/SpotListPanel";
import { STATUS_LABEL } from "@/lib/statusLabel";
import type { BoundingBox, ParkingSpot } from "@/lib/types";

type SortBy = "distance" | "cost";
type Visibility = { street: boolean; garages: boolean; free: boolean; metered: boolean };

const ParkingMap = dynamic(() => import("@/components/ParkingMap"), {
  ssr: false,
  loading: () => <div className="flex h-full w-full items-center justify-center text-gray-400">Loading map…</div>,
});

const UNION_SQUARE: [number, number] = [40.7359, -73.9911];
const ALL_VISIBLE: Visibility = { street: true, garages: true, free: true, metered: true };

function toggleButtonClass(active: boolean, activeClasses: string): string {
  // Deliberately solid/plain states, not a subtle tint or glow — "on" is a
  // filled, colored pill; "off" is a plain outlined button. No ambiguity
  // about which state a button is in at a glance.
  return active
    ? `flex items-center gap-1.5 rounded px-2.5 py-1 font-medium text-white ${activeClasses}`
    : "flex items-center gap-1.5 rounded border border-gray-300 bg-white px-2.5 py-1 font-medium text-gray-500 hover:bg-gray-50";
}

export default function Home() {
  const [spots, setSpots] = useState<ParkingSpot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number; zoom?: number; spotId?: string } | null>(null);
  const [lastBbox, setLastBbox] = useState<BoundingBox | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [highlightedSpotId, setHighlightedSpotId] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<Visibility>(ALL_VISIBLE);
  const [listOpen, setListOpen] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>("distance");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Live viewport bounds, tracked in a ref so a burst of Leaflet `moveend`
  // events (e.g. during a fly-to animation) never thrashes React state — the
  // state below is only reflected once movement settles, in the debounce.
  const lastBboxRef = useRef<BoundingBox | null>(null);

  // Always fetches both facility types — the four toggles below are pure
  // client-side filters over whatever's loaded, so switching any of them is
  // instant with no network round-trip.
  const loadSpots = useCallback(async (bbox: BoundingBox) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        north: String(bbox.north),
        south: String(bbox.south),
        east: String(bbox.east),
        west: String(bbox.west),
        type: "both",
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
      lastBboxRef.current = bbox;
      setLastBbox(bbox);
      loadSpots(bbox);
    },
    [loadSpots]
  );

  const handleMoveEnd = useCallback(
    (bbox: BoundingBox) => {
      // Record the bounds synchronously (ref, no re-render); only reflect them
      // into React state once the map has been still for 500ms, alongside the
      // fetch. Calling setState on every `moveend` let a fly-to animation's
      // rapid moveend burst schedule an unbounded update cascade ("Maximum
      // update depth exceeded").
      lastBboxRef.current = bbox;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setLastBbox(bbox);
        loadSpots(bbox);
      }, 500);
    },
    [loadSpots]
  );

  const handleSelect = useCallback((result: { lat: number; lng: number; label: string }) => {
    setHighlightedSpotId(null);
    setFlyTo({ lat: result.lat, lng: result.lng, zoom: 17 });
  }, []);

  const handleSelectSpot = useCallback((spot: { id: string; lat: number; lng: number }) => {
    setHighlightedSpotId(spot.id);
    // A chat or list-panel result may be a type/status a toggle is currently
    // hiding — turn everything back on so it's guaranteed to actually be
    // visible and highlightable, not silently do nothing.
    setVisibility(ALL_VISIBLE);
    setFlyTo({ lat: spot.lat, lng: spot.lng, zoom: 18, spotId: spot.id });
  }, []);

  const toggleVisibility = useCallback((key: keyof Visibility) => {
    setVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
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

  // A street spot with an unrecognized status always shows when Street is
  // on — the No cost/Metered toggles only hide/show the two statuses the
  // app actually understands.
  const visibleSpots = useMemo(
    () =>
      spots.filter((s) => {
        if (s.facilityType === "garage") return visibility.garages;
        if (!visibility.street) return false;
        if (s.status.value === "free") return visibility.free;
        if (s.status.value === "metered") return visibility.metered;
        return true;
      }),
    [spots, visibility]
  );

  const counts = useMemo(() => {
    const streetSpots = spots.filter((s): s is Extract<ParkingSpot, { facilityType: "street" }> => s.facilityType === "street");
    const free = streetSpots.filter((s) => s.status.value === "free").length;
    const metered = streetSpots.filter((s) => s.status.value === "metered").length;
    const garages = spots.filter((s) => s.facilityType === "garage").length;
    return { street: streetSpots.length, free, metered, garages };
  }, [spots]);

  // What the AI assistant should default to searching, derived from the
  // same toggles driving the map — if the user's only looking at garages,
  // the assistant should default there too. Falls back to "both" if
  // somehow nothing is toggled on, so the assistant stays useful.
  const agentFacilityFilter = useMemo(() => {
    if (visibility.street && !visibility.garages) return "street";
    if (visibility.garages && !visibility.street) return "garage";
    return "both";
  }, [visibility.street, visibility.garages]);

  return (
    <div className="flex h-dvh w-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">NYC Parking Finder</h1>
          <p className="text-xs text-gray-500">Legal parking status by block, computed live — not a live occupancy feed</p>
        </div>
        <SearchBar onSelect={handleSelect} />
      </header>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => toggleVisibility("street")}
            aria-pressed={visibility.street}
            className={toggleButtonClass(visibility.street, "bg-gray-700")}
          >
            Street ({counts.street})
          </button>
          <button
            type="button"
            onClick={() => toggleVisibility("garages")}
            aria-pressed={visibility.garages}
            className={toggleButtonClass(visibility.garages, "bg-indigo-600")}
          >
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-white" /> Garages ({counts.garages})
          </button>
          {visibility.street && (
            <>
              <button
                type="button"
                onClick={() => toggleVisibility("free")}
                aria-pressed={visibility.free}
                className={toggleButtonClass(visibility.free, "bg-green-600")}
              >
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-white" /> {STATUS_LABEL.free} ({counts.free})
              </button>
              <button
                type="button"
                onClick={() => toggleVisibility("metered")}
                aria-pressed={visibility.metered}
                className={toggleButtonClass(visibility.metered, "bg-red-600")}
              >
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-white" /> Metered ({counts.metered})
              </button>
              <span className="flex items-center gap-1.5 text-gray-500">
                <span className="inline-block h-3 w-3 rounded-full border-2 border-blue-600" /> Crowd-reported opening
              </span>
            </>
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
          onClick={() => lastBboxRef.current && loadSpots(lastBboxRef.current)}
          className="rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
        >
          Refresh
        </button>
      </div>

      <div className="relative flex-1">
        <ParkingMap
          spots={visibleSpots}
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
          spots={visibleSpots}
          center={mapCenter}
          sortBy={sortBy}
          onSortByChange={setSortBy}
          onSelectSpot={handleSelectSpot}
        />

        <ChatPanel
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          onSelectSpot={handleSelectSpot}
          facilityFilter={agentFacilityFilter}
        />
      </div>
    </div>
  );
}
