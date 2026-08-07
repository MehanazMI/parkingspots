import { NextRequest, NextResponse } from "next/server";
import { fetchGarages } from "@/lib/garages";
import { attachZoneRate } from "@/lib/meterRates";
import { fetchStreetSpots } from "@/lib/nycOpenData";
import { attachOccupancy } from "@/lib/occupancy";
import type { ParkingSpot } from "@/lib/types";

type FacilityFilter = "street" | "garage" | "both";

function parseFacilityFilter(value: string | null): FacilityFilter {
  if (value === "street" || value === "garage") return value;
  return "both";
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const north = parseFloat(params.get("north") ?? "");
  const south = parseFloat(params.get("south") ?? "");
  const east = parseFloat(params.get("east") ?? "");
  const west = parseFloat(params.get("west") ?? "");
  const type = parseFacilityFilter(params.get("type"));

  if ([north, south, east, west].some((n) => Number.isNaN(n))) {
    return NextResponse.json(
      { error: "Missing or invalid bounding box params: north, south, east, west" },
      { status: 400 }
    );
  }

  const bbox = { north, south, east, west };

  try {
    const spots: ParkingSpot[] = [];

    if (type === "street" || type === "both") {
      const streetSpots = await fetchStreetSpots(bbox);
      const withOccupancy = await attachOccupancy(streetSpots);
      spots.push(...(await attachZoneRate(withOccupancy, bbox)));
    }
    if (type === "garage" || type === "both") {
      spots.push(...(await fetchGarages(bbox)));
    }

    return NextResponse.json({ spots });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch parking data" }, { status: 502 });
  }
}
