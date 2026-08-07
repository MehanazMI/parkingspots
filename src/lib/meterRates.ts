import type { BoundingBox, StreetSpot, ZoneRate } from "./types";

// NYC DOT "Parking Meters - Citywide Rate Zones" — large neighborhood/
// borough-level polygons, each with a posted hourly rate. Point-in-polygon
// query via a single representative point (bbox center) rather than a
// query per spot, since these zones are large enough that a map viewport
// essentially never spans more than one (documented limitation: a viewport
// that straddles a zone boundary will show the center's zone rate for the
// whole area).
const RESOURCE_URL = "https://data.cityofnewyork.us/resource/f72k-2u3b.json";

function parseHourlyRate(rateZoneText: string): number | null {
  const match = rateZoneText.match(/All Vehicles:?\s*\$(\d+(?:\.\d+)?)\s*1st\s*Hour/i);
  return match ? parseFloat(match[1]) : null;
}

export async function fetchZoneRate(lat: number, lng: number): Promise<ZoneRate | null> {
  const url = new URL(RESOURCE_URL);
  url.searchParams.set("$select", "zone_name,rate_zone");
  url.searchParams.set("$where", `intersects(the_geom, 'POINT(${lng} ${lat})')`);
  url.searchParams.set("$limit", "1");

  const headers: Record<string, string> = { Accept: "application/json" };
  if (process.env.NYC_OPEN_DATA_APP_TOKEN) {
    headers["X-App-Token"] = process.env.NYC_OPEN_DATA_APP_TOKEN;
  }

  const res = await fetch(url.toString(), { headers, next: { revalidate: 300 } });
  if (!res.ok) return null;

  const records: Array<{ zone_name?: string; rate_zone?: string }> = await res.json();
  const record = records[0];
  if (!record?.rate_zone) return null;

  const hourlyRate = parseHourlyRate(record.rate_zone);
  if (hourlyRate === null) return null;

  return {
    zoneName: record.zone_name ?? "Unknown zone",
    hourlyRate,
    rawRateText: record.rate_zone,
  };
}

/** Looks up the zone rate once for the bbox's center and attaches it to every street spot. */
export async function attachZoneRate(spots: StreetSpot[], bbox: BoundingBox): Promise<StreetSpot[]> {
  if (spots.length === 0) return spots;
  const centerLat = (bbox.north + bbox.south) / 2;
  const centerLng = (bbox.east + bbox.west) / 2;
  const rate = await fetchZoneRate(centerLat, centerLng);
  return spots.map((s) => ({ ...s, rate }));
}
