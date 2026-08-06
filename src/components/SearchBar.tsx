"use client";

import { useState } from "react";

interface GeocodeResult {
  lat: string;
  lon: string;
  display_name: string;
}

interface SearchBarProps {
  onSelect: (result: { lat: number; lng: number; label: string }) => void;
}

export default function SearchBar({ onSelect }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      setResults(data.results ?? []);
      if (data.results?.length === 0) {
        setError("No matches found in NYC. Try a more specific address or neighborhood.");
      }
    } catch {
      setError("Search failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function pick(r: GeocodeResult) {
    onSelect({ lat: parseFloat(r.lat), lng: parseFloat(r.lon), label: r.display_name });
    setResults([]);
    setQuery(r.display_name);
  }

  return (
    <div className="relative w-full max-w-md">
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search an NYC address or neighborhood…"
          className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "…" : "Search"}
        </button>
      </form>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {results.length > 0 && (
        <ul className="absolute z-[1000] mt-1 w-full rounded border border-gray-200 bg-white shadow-lg">
          {results.map((r, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => pick(r)}
                className="block w-full px-3 py-2 text-left text-sm text-gray-900 hover:bg-gray-100"
              >
                {r.display_name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
