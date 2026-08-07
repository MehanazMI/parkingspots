export type MeterStatusValue = "free" | "metered" | "unknown";

export interface MeterStatus {
  value: MeterStatusValue;
  detail: string;
  /** Minutes a vehicle may stay under the currently active rule; only set when value is "metered". */
  limitMinutes: number | null;
}

export type ConfidenceLevel = "low" | "medium" | "high";

// Only "reported open" is tracked — a "taken" report on a spot that
// represents a whole block-face (often several physical spaces) doesn't
// mean much, since other spaces on the same block could still be open.
// reportCount tracks corroborating reports within the current rolling
// window (resets once REPORT_TTL_SECONDS passes with no new report), giving
// a rough confidence signal instead of one person's single, overwritable tap.
export interface OccupancyReport {
  reportCount: number;
  firstReportedAt: number;
  lastReportedAt: number;
  confidence: ConfidenceLevel;
}

export type FacilityType = "street" | "garage";

/** Posted hourly rate for the meter zone a spot falls in (not spot-specific — a whole zone shares one rate). */
export interface ZoneRate {
  zoneName: string;
  hourlyRate: number;
  rawRateText: string;
}

/** An on-street metered block-face segment, from NYC Open Data's parking meters dataset. */
export interface StreetSpot {
  facilityType: "street";
  id: string;
  lat: number;
  lng: number;
  onStreet: string;
  fromStreet: string;
  toStreet: string;
  sideOfStreet: string;
  borough: string;
  meterHours: string;
  status: MeterStatus;
  occupancy: OccupancyReport | null;
  rate: ZoneRate | null;
}

/**
 * An off-street garage or lot, from NYC's DCA licensed-garage registry.
 * No live occupancy or rate data exists for these in free sources — see
 * GARAGE_DATA_RESEARCH.md. vehicleCapacity is a static total, not a live count.
 */
export interface GarageSpot {
  facilityType: "garage";
  id: string;
  lat: number;
  lng: number;
  name: string;
  address: string;
  borough: string;
  vehicleCapacity: number | null;
  bicycleCapacity: number | null;
  licenseExpiresAt: string | null;
}

export type ParkingSpot = StreetSpot | GarageSpot;

export interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}
