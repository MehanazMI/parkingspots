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

export interface ParkingSpot {
  id: string;
  lat: number;
  lng: number;
  onStreet: string;
  fromStreet: string;
  toStreet: string;
  sideOfStreet: string;
  borough: string;
  facility: string;
  meterHours: string;
  status: MeterStatus;
  occupancy: OccupancyReport | null;
}

export interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}
