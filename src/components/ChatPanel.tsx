"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState } from "react";
import type { ParkingAgentUIMessage } from "@/lib/agents/parking-agent";

interface ChatPanelProps {
  open: boolean;
  onClose: () => void;
  onSelectSpot: (spot: { lat: number; lng: number }) => void;
}

const STATUS_COLOR: Record<string, string> = {
  free: "bg-green-600",
  metered: "bg-red-600",
  unknown: "bg-gray-500",
};

interface ToolSpot {
  id: string;
  onStreet: string;
  sideOfStreet: string;
  fromStreet: string;
  toStreet: string;
  lat: number;
  lng: number;
  distanceMeters: number;
  status: string;
  statusDetail: string;
  limitMinutes: number | null;
  occupancy: { status: "open" | "taken"; reportedAt: number } | null;
}

interface FindParkingOutput {
  error?: string;
  area?: string;
  resultCount?: number;
  spots?: ToolSpot[];
}

function SpotResultCard({ spot, onSelect }: { spot: ToolSpot; onSelect: () => void }) {
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
          {spot.status.toUpperCase()}
        </span>
      </div>
      <p className="text-gray-500">
        Between {spot.fromStreet} &amp; {spot.toStreet} · {spot.distanceMeters}m away
      </p>
      {spot.occupancy && (
        <p className={spot.occupancy.status === "open" ? "text-blue-700" : "text-orange-700"}>
          Crowd report: {spot.occupancy.status}
        </p>
      )}
    </button>
  );
}

export default function ChatPanel({ open, onClose, onSelectSpot }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status } = useChat<ParkingAgentUIMessage>({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    sendMessage({ text: input });
    setInput("");
  }

  return (
    <div className="absolute right-0 top-0 z-[1100] flex h-full w-full max-w-sm flex-col border-l border-gray-200 bg-white shadow-xl sm:w-96">
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2.5">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Parking Assistant</h2>
          <p className="text-xs text-gray-500">Ask about parking near an NYC address</p>
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
            Try: &quot;free parking near Union Square&quot; or &quot;a 2-hour spot near Times Square&quot;
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
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-gray-200 p-2.5">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={status !== "ready"}
          placeholder="Ask about parking…"
          className="w-full rounded border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
        />
        <button
          type="submit"
          disabled={status !== "ready"}
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
  onSelectSpot: (spot: { lat: number; lng: number }) => void;
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
        <SpotResultCard key={spot.id} spot={spot} onSelect={() => onSelectSpot({ lat: spot.lat, lng: spot.lng })} />
      ))}
    </div>
  );
}
