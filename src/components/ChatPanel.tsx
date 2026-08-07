"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState } from "react";
import type { ParkingAgentUIMessage } from "@/lib/agents/parking-agent";
import { STATUS_LABEL } from "@/lib/statusLabel";

type FacilityFilter = "street" | "garage" | "both";

interface ChatPanelProps {
  open: boolean;
  onClose: () => void;
  onSelectSpot: (spot: { id: string; lat: number; lng: number }) => void;
  facilityFilter: FacilityFilter;
}

const STATUS_COLOR: Record<string, string> = {
  free: "bg-green-600",
  metered: "bg-red-600",
  unknown: "bg-gray-500",
};

interface StreetToolSpot {
  facilityType: "street";
  id: string;
  onStreet: string;
  sideOfStreet: string;
  fromStreet: string;
  toStreet: string;
  lat: number;
  lng: number;
  distanceMeters: number;
  status: "free" | "metered" | "unknown";
  statusDetail: string;
  limitMinutes: number | null;
  occupancy: { reportCount: number; confidence: "low" | "medium" | "high" } | null;
  hourlyRate: number | null;
  rateZone: string | null;
}

interface GarageToolSpot {
  facilityType: "garage";
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  distanceMeters: number;
  vehicleCapacity: number | null;
}

type ToolSpot = StreetToolSpot | GarageToolSpot;

interface FindParkingOutput {
  error?: string;
  area?: string;
  resultCount?: number;
  spots?: ToolSpot[];
}

function SpotResultCard({ spot, onSelect }: { spot: ToolSpot; onSelect: () => void }) {
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
          {spot.address} · {spot.distanceMeters}m away
        </p>
        <p className="text-gray-500">
          {spot.vehicleCapacity !== null ? `${spot.vehicleCapacity} vehicle capacity (total, not live)` : "Capacity not on file"}
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
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium text-white ${STATUS_COLOR[spot.status]}`}>
          {STATUS_LABEL[spot.status].toUpperCase()}
        </span>
      </div>
      <p className="text-gray-500">
        Between {spot.fromStreet} &amp; {spot.toStreet} · {spot.distanceMeters}m away
      </p>
      <p className="text-gray-400">
        {spot.hourlyRate !== null ? `$${spot.hourlyRate.toFixed(2)}/hr (${spot.rateZone})` : "no rate data"}
      </p>
      {spot.occupancy && (
        <p className="text-blue-700">
          {spot.occupancy.reportCount === 1 ? "1 crowd report" : `${spot.occupancy.reportCount} crowd reports`} of an
          opening on this block ({spot.occupancy.confidence} confidence)
        </p>
      )}
    </button>
  );
}

export default function ChatPanel({ open, onClose, onSelectSpot, facilityFilter }: ChatPanelProps) {
  const [input, setInput] = useState("");
  // Must stay referentially stable across renders — a fresh transport object
  // every render (this component's hooks run even while `open` is false)
  // caused an infinite update loop previously.
  const [transport] = useState(() => new DefaultChatTransport({ api: "/api/chat" }));
  const { messages, sendMessage, status, error, clearError } = useChat<ParkingAgentUIMessage>({ transport });

  if (!open) return null;

  // "error" must stay usable, not stuck disabled forever — a failed request
  // (rate limit, network blip, etc.) shouldn't brick the panel with no way
  // to retry.
  const inputDisabled = status === "submitted" || status === "streaming";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    if (error) clearError();
    // Read facilityFilter fresh here (a plain prop read in an event handler,
    // not during render) so the assistant's default search always matches
    // whatever's currently shown on the map.
    sendMessage({ text: input }, { body: { facilityFilter } });
    setInput("");
  }

  return (
    <div className="absolute right-0 top-0 z-[1100] flex h-full w-full max-w-sm flex-col border-l border-gray-200 bg-white shadow-xl sm:w-96">
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2.5">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Parking Assistant</h2>
          <p className="text-xs text-gray-500">Ask about street parking or garages near an NYC address</p>
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

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <p className="text-xs text-gray-400">
            Try: &quot;free parking near Union Square&quot; or &quot;a garage near Times Square&quot;
          </p>
        )}
        {messages.map((message) => (
          <div key={message.id} className={message.role === "user" ? "text-right" : "text-left"}>
            <div
              className={`inline-block max-w-[90%] rounded-lg px-2.5 py-1.5 text-sm ${
                message.role === "user" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-900"
              }`}
            >
              {message.parts.map((part, i) => {
                if (part.type === "text") {
                  return (
                    <p key={i} className="whitespace-pre-wrap">
                      {part.text}
                    </p>
                  );
                }
                if (part.type === "tool-findParking") {
                  if (part.state === "output-available") {
                    return <ToolResultBridge key={i} output={part.output as FindParkingOutput} onSelectSpot={onSelectSpot} />;
                  }
                  if (part.state === "output-error") {
                    return (
                      <p key={i} className="text-xs text-red-600">
                        Couldn&apos;t search for parking — try again.
                      </p>
                    );
                  }
                  return (
                    <p key={i} className="text-xs text-gray-500">
                      Searching…
                    </p>
                  );
                }
                return null;
              })}
            </div>
          </div>
        ))}
        {status === "submitted" && <p className="text-xs text-gray-400">Thinking…</p>}
        {error && (
          <p className="text-xs text-red-600">
            Something went wrong ({error.message || "request failed"}) — try sending your message again.
          </p>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-gray-200 p-2.5">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={inputDisabled}
          placeholder="Ask about parking…"
          className="w-full rounded border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
        />
        <button
          type="submit"
          disabled={inputDisabled}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}

function ToolResultBridge({
  output,
  onSelectSpot,
}: {
  output: FindParkingOutput;
  onSelectSpot: (spot: { id: string; lat: number; lng: number }) => void;
}) {
  if (output.error) {
    return <p className="text-xs text-red-600">{output.error}</p>;
  }
  if (!output.spots || output.spots.length === 0) {
    return <p className="text-xs text-gray-500">No matching spots found nearby.</p>;
  }
  return (
    <div className="mt-1 space-y-1.5">
      {output.spots.map((spot) => (
        <SpotResultCard
          key={spot.id}
          spot={spot}
          onSelect={() => onSelectSpot({ id: spot.id, lat: spot.lat, lng: spot.lng })}
        />
      ))}
    </div>
  );
}
