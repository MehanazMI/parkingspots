import type { BoundingBox, GarageSpot } from "./types";

// NYC DCA "Parking Garage List" — licensed garage/lot registry. No live
// occupancy or rate data exists here (see GARAGE_DATA_RESEARCH.md); this
// gives location + a static total vehicle capacity only.
const RESOURCE_URL = "https://data.cityofnewyork.us/resource/5bhr-pjxt.json";
const MAX_RESULTS = 200;

interface RawGarageRecord {
  license_nbr: string;
  lic_expir_dd?: string;
  business_name?: string;
  address_building?: string;
  address_street_name?: string;
  address_borough?: string;
  detail?: string;
  latitude?: string;
  longitude?: string;
}

function parseCapacity(detail: string | undefined): { vehicle: number | null; bicycle: number | null } {
  if (!detail) return { vehicle: null, bicycle: null };
  const vehicleMatch = detail.match(/Vehicle Capacity:\s*(\d+)/i);
  const bicycleMatch = detail.match(/Bicycle Capacity:\s*(\d+)/i);
  return {
    vehicle: vehicleMatch ? parseInt(vehicleMatch[1], 10) : null,
    bicycle: bicycleMatch ? parseInt(bicycleMatch[1], 10) : null,
  };
}

export async function fetchGarages(bbox: BoundingBox): Promise<GarageSpot[]> {
  const today = new Date().toISOString().slice(0, 10);
  const where =
    `latitude between ${bbox.south} and ${bbox.north} ` +
    `and longitude between ${bbox.west} and ${bbox.east} ` +
    `and lic_expir_dd > '${today}'`;

  const url = new URL(RESOURCE_URL);
  url.searchParams.set("$where", where);
  url.searchParams.set("$limit", String(MAX_RESULTS));

  const headers: Record<string, string> = { Accept: "application/json" };
  if (process.env.NYC_OPEN_DATA_APP_TOKEN) {
    headers["X-App-Token"] = process.env.NYC_OPEN_DATA_APP_TOKEN;
  }

  const res = await fetch(url.toString(), { headers, next: { revalidate: 60 } });
  if (!res.ok) {
    throw new Error(`NYC Open Data (garages) request failed: ${res.status} ${res.statusText}`);
  }

  const records: RawGarageRecord[] = await res.json();

  return records
    .filter((r) => r.latitude && r.longitude)
    .map((r) => {
      const { vehicle, bicycle } = parseCapacity(r.detail);
      const address = [r.address_building, r.address_street_name].filter(Boolean).join(" ");
      return {
        facilityType: "garage",
        id: `garage-${r.license_nbr}`,
        lat: parseFloat(r.latitude as string),
        lng: parseFloat(r.longitude as string),
        name: r.business_name ?? "Parking garage",
        address,
        borough: r.address_borough ?? "",
        vehicleCapacity: vehicle,
        bicycleCapacity: bicycle,
        licenseExpiresAt: r.lic_expir_dd ?? null,
      } satisfies GarageSpot;
    });
}
