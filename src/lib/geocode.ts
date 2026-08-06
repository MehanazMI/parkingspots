// NYC bounding box used to bias/restrict geocoding results.
const NYC_VIEWBOX = "-74.26,40.917,-73.70,40.477"; // left,top,right,bottom

export interface GeocodeResult {
  lat: number;
  lng: number;
  label: string;
}

interface RawNominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

export async function geocode(query: string): Promise<GeocodeResult[]> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
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
    throw new Error(`Geocoding failed: ${res.status} ${res.statusText}`);
  }

  const results: RawNominatimResult[] = await res.json();
  return results.map((r) => ({
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    label: r.display_name,
  }));
}
