import { tool } from "ai";
import { z } from "zod";
import { fetchGarages } from "@/lib/garages";
import { geocode } from "@/lib/geocode";
import { haversineMeters } from "@/lib/geo";
import { attachZoneRate } from "@/lib/meterRates";
import { fetchStreetSpots } from "@/lib/nycOpenData";
import { attachOccupancy } from "@/lib/occupancy";
import type { GarageSpot, ParkingSpot, StreetSpot } from "@/lib/types";

// Roughly a 500m-ish box around the center point — similar to what the map
// shows at its default search zoom level.
const LAT_DELTA = 0.004;
const LNG_DELTA = 0.005;
const MAX_RESULTS = 8;

const CONFIDENCE_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

function relevanceRank(spot: ParkingSpot): number {
  if (spot.facilityType === "street" && spot.occupancy) return CONFIDENCE_RANK[spot.occupancy.confidence]; // 0-2
  if (spot.facilityType === "street" && spot.status.value === "free") return 3;
  if (spot.facilityType === "street" && spot.status.value === "metered") return 4;
  if (spot.facilityType === "garage") return 5;
  return 6; // street, unknown status
}

// Garages have no rate data (see GARAGE_DATA_RESEARCH.md), and street spots
// only have a rate when they fall inside a known meter rate zone — both
// sort to the end when the user asked for cheapest-first, since "no data"
// isn't the same as "free."
function costRank(spot: ParkingSpot): number {
  return spot.facilityType === "street" && spot.rate ? spot.rate.hourlyRate : Number.POSITIVE_INFINITY;
}

function formatStreetResult(spot: StreetSpot, distanceMeters: number) {
  return {
    facilityType: "street" as const,
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
    hourlyRate: spot.rate?.hourlyRate ?? null,
    rateZone: spot.rate?.zoneName ?? null,
  };
}

function formatGarageResult(spot: GarageSpot, distanceMeters: number) {
  return {
    facilityType: "garage" as const,
    id: spot.id,
    name: spot.name,
    address: spot.address,
    lat: spot.lat,
    lng: spot.lng,
    distanceMeters,
    vehicleCapacity: spot.vehicleCapacity,
  };
}

export const findParkingTool = tool({
  description:
    "Find real, currently-tracked NYC parking near a given area: on-street metered spots " +
    "and/or off-street garages, optionally requiring a minimum parking duration, and optionally " +
    "sorted by cost. Only returns results the app actually has data for right now — never invent " +
    "results beyond what this tool returns. Street spots often (not always) have a posted hourly " +
    "rate from NYC's meter rate-zone data; garages have no rate data in any current source.",
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
        "If the user specifies how long they need to park, pass it in minutes so on-street results " +
          "can be filtered to spots whose posted meter limit is long enough. Garages aren't filtered " +
          "by this since they don't have posted time limits."
      ),
    facilityType: z
      .enum(["street", "garage", "both"])
      .optional()
      .describe(
        "Only pass this if the user specifically asks for on-street parking, a garage/lot, or both. " +
          "Omit it (defaults to both) if they didn't specify."
      ),
    sortBy: z
      .enum(["relevance", "cost"])
      .optional()
      .describe(
        "Pass \"cost\" only if the user explicitly asks for the cheapest/lowest-cost option. This " +
          "ranks street spots with a known hourly rate lowest-first; spots and garages with no rate " +
          "data sort to the end (not treated as free). Omit otherwise (defaults to relevance: " +
          "crowd-confirmed openings, then free, then metered, then garages, closest first within each)."
      ),
  }),
  execute: async ({ area, durationMinutes, facilityType = "both", sortBy = "relevance" }) => {
    const geocoded = await geocode(area);
    const center = geocoded[0];
    if (!center) {
      return { error: `Couldn't find "${area}" in NYC. Try a more specific address or neighborhood.` };
    }

    const bbox = {
      north: center.lat + LAT_DELTA,
      south: center.lat - LAT_DELTA,
      east: center.lng + LNG_DELTA,
      west: center.lng - LNG_DELTA,
    };

    const candidates: ParkingSpot[] = [];

    if (facilityType === "street" || facilityType === "both") {
      const withOccupancy = await attachOccupancy(await fetchStreetSpots(bbox));
      const withRate = await attachZoneRate(withOccupancy, bbox);
      let filtered = withRate.filter((s) => s.status.value !== "unknown");
      if (durationMinutes) {
        filtered = filtered.filter(
          (s) => s.status.value === "free" || (s.status.limitMinutes ?? 0) >= durationMinutes
        );
      }
      candidates.push(...filtered);
    }
    if (facilityType === "garage" || facilityType === "both") {
      candidates.push(...(await fetchGarages(bbox)));
    }

    const withDistance = candidates.map((s) => ({
      spot: s,
      distanceMeters: Math.round(haversineMeters(center.lat, center.lng, s.lat, s.lng)),
    }));

    const ranked =
      sortBy === "cost"
        ? withDistance.sort((a, b) => costRank(a.spot) - costRank(b.spot) || a.distanceMeters - b.distanceMeters)
        : withDistance.sort(
            (a, b) => relevanceRank(a.spot) - relevanceRank(b.spot) || a.distanceMeters - b.distanceMeters
          );

    const top = ranked.slice(0, MAX_RESULTS);

    return {
      area: center.label,
      center: { lat: center.lat, lng: center.lng },
      resultCount: top.length,
      sortedBy: sortBy,
      spots: top.map(({ spot, distanceMeters }) =>
        spot.facilityType === "street" ? formatStreetResult(spot, distanceMeters) : formatGarageResult(spot, distanceMeters)
      ),
    };
  },
});
