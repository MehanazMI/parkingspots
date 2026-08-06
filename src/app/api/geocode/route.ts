import { NextRequest, NextResponse } from "next/server";
import { geocode } from "@/lib/geocode";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ error: "Missing query param: q" }, { status: 400 });
  }

  try {
    const results = await geocode(q);
    // Keep the response shape the existing SearchBar client expects.
    return NextResponse.json({
      results: results.map((r) => ({ lat: String(r.lat), lon: String(r.lng), display_name: r.label })),
    });
  } catch {
    return NextResponse.json({ error: "Geocoding failed" }, { status: 502 });
  }
}
