export type MeterStatusValue = "free" | "metered" | "unknown";

export interface MeterStatus {
  value: MeterStatusValue;
  detail: string;
  /** Minutes a vehicle may stay under the currently active rule; only set when value is "metered". */
  limitMinutes: number | null;
}

export type OccupancyStatus = "open" | "taken";

export interface OccupancyReport {
  status: OccupancyStatus;
  reportedAt: number;
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
