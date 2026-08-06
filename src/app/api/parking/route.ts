import { NextRequest, NextResponse } from "next/server";
import { fetchParkingSpots } from "@/lib/nycOpenData";
import { attachOccupancy } from "@/lib/occupancy";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const north = parseFloat(params.get("north") ?? "");
  const south = parseFloat(params.get("south") ?? "");
  const east = parseFloat(params.get("east") ?? "");
  const west = parseFloat(params.get("west") ?? "");

  if ([north, south, east, west].some((n) => Number.isNaN(n))) {
    return NextResponse.json(
      { error: "Missing or invalid bounding box params: north, south, east, west" },
      { status: 400 }
    );
  }

  try {
    const spots = await fetchParkingSpots({ north, south, east, west });
    const withOccupancy = await attachOccupancy(spots);
    return NextResponse.json({ spots: withOccupancy });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to fetch parking data" }, { status: 502 });
  }
}
