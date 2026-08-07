import { getMeterStatus } from "./meterHours";
import type { BoundingBox, StreetSpot } from "./types";

const RESOURCE_URL = "https://data.cityofnewyork.us/resource/693u-uax6.json";
const MAX_RESULTS = 400;

interface RawMeterRecord {
  objectid: string;
  meter_number?: string;
  status?: string;
  meter_hours?: string;
  facility?: string;
  borough?: string;
  on_street?: string;
  from_street?: string;
  to_street?: string;
  side_of_street?: string;
  lat?: string;
  long?: string;
}

export async function fetchStreetSpots(bbox: BoundingBox): Promise<StreetSpot[]> {
  const where = `within_box(location, ${bbox.north}, ${bbox.west}, ${bbox.south}, ${bbox.east}) AND status='Active'`;

  const url = new URL(RESOURCE_URL);
  url.searchParams.set("$where", where);
  url.searchParams.set("$limit", String(MAX_RESULTS));

  const headers: Record<string, string> = { Accept: "application/json" };
  if (process.env.NYC_OPEN_DATA_APP_TOKEN) {
    headers["X-App-Token"] = process.env.NYC_OPEN_DATA_APP_TOKEN;
  }

  const res = await fetch(url.toString(), { headers, next: { revalidate: 60 } });
  if (!res.ok) {
    throw new Error(`NYC Open Data request failed: ${res.status} ${res.statusText}`);
  }

  const records: RawMeterRecord[] = await res.json();
  const now = new Date();

  return records
    .filter((r) => r.lat && r.long)
    .map((r) => {
      const meterHours = r.meter_hours ?? "";
      return {
        facilityType: "street",
        id: r.objectid,
        lat: parseFloat(r.lat as string),
        lng: parseFloat(r.long as string),
        onStreet: r.on_street ?? "",
        fromStreet: r.from_street ?? "",
        toStreet: r.to_street ?? "",
        sideOfStreet: r.side_of_street ?? "",
        borough: r.borough ?? "",
        meterHours,
        status: getMeterStatus(meterHours, now),
        occupancy: null,
        rate: null,
      } satisfies StreetSpot;
    });
}
