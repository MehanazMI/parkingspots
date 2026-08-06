import { NextRequest, NextResponse } from "next/server";

// NYC bounding box used to bias/restrict geocoding results.
const NYC_VIEWBOX = "-74.26,40.917,-73.70,40.477"; // left,top,right,bottom

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ error: "Missing query param: q" }, { status: 400 });
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("viewbox", NYC_VIEWBOX);
  url.searchParams.set("bounded", "1");

  const res = await fetch(url.toString(), {
    headers: {
      // Nominatim usage policy requires a descriptive User-Agent.
      "User-Agent": "parkingspots-app/0.1 (https://github.com/)",
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    return NextResponse.json({ error: "Geocoding failed" }, { status: 502 });
  }

  const results = await res.json();
  return NextResponse.json({ results });
}
