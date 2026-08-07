import { tool } from "ai";
import { z } from "zod";
import { geocode } from "@/lib/geocode";
import { fetchParkingSpots } from "@/lib/nycOpenData";
import { attachOccupancy } from "@/lib/occupancy";
import type { ParkingSpot } from "@/lib/types";

// Roughly a 500m-ish box around the center point — similar to what the map
// shows at its default search zoom level.
const LAT_DELTA = 0.004;
const LNG_DELTA = 0.005;
const MAX_RESULTS = 8;

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

function rankScore(spot: ParkingSpot): number {
  if (spot.occupancy) return 0;
  if (spot.status.value === "free") return 1;
  if (spot.status.value === "metered") return 2;
  return 3;
}

export const findParkingTool = tool({
  description:
    "Find real, currently-tracked NYC metered parking spots near a given area, optionally " +
    "requiring a minimum parking duration. Only returns spots the app actually has data for " +
    "right now — never invent spots beyond what this tool returns.",
  inputSchema: z.object({
    area: z
      .string()
      .describe("An NYC address, intersection, or neighborhood, e.g. 'Union Square' or 'Times Square'."),
    durationMinutes: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "If the user specifies how long they need to park, pass it in minutes so results can be " +
          "filtered to spots whose posted meter limit is long enough."
      ),
  }),
  execute: async ({ area, durationMinutes }) => {
    const geocoded = await geocode(area);
    const center = geocoded[0];
    if (!center) {
      return { error: `Couldn't find "${area}" in NYC. Try a more specific address or neighborhood.` };
    }

    const spots = await fetchParkingSpots({
      north: center.lat + LAT_DELTA,
      south: center.lat - LAT_DELTA,
      east: center.lng + LNG_DELTA,
      west: center.lng - LNG_DELTA,
    });
    const withOccupancy = await attachOccupancy(spots);

    let candidates = withOccupancy.filter((s) => s.status.value !== "unknown");
    if (durationMinutes) {
      candidates = candidates.filter(
        (s) => s.status.value === "free" || (s.status.limitMinutes ?? 0) >= durationMinutes
      );
    }

    const ranked = candidates
      .map((s) => ({ spot: s, distanceMeters: Math.round(haversineMeters(center.lat, center.lng, s.lat, s.lng)) }))
      .sort((a, b) => rankScore(a.spot) - rankScore(b.spot) || a.distanceMeters - b.distanceMeters)
      .slice(0, MAX_RESULTS);

    return {
      area: center.label,
      center: { lat: center.lat, lng: center.lng },
      resultCount: ranked.length,
      spots: ranked.map(({ spot, distanceMeters }) => ({
        id: spot.id,
        onStreet: spot.onStreet,
        sideOfStreet: spot.sideOfStreet,
        fromStreet: spot.fromStreet,
        toStreet: spot.toStreet,
        lat: spot.lat,
        lng: spot.lng,
        distanceMeters,
        status: spot.status.value,
        statusDetail: spot.status.detail,
        limitMinutes: spot.status.limitMinutes,
        occupancy: spot.occupancy,
      })),
    };
  },
});
