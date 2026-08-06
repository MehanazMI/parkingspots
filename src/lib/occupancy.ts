import { getRedis } from "./redis";
import type { OccupancyReport, OccupancyStatus, ParkingSpot } from "./types";

export const REPORT_TTL_SECONDS = 30 * 60; // reports expire after 30 minutes

export function reportKey(spotId: string): string {
  return `report:${spotId}`;
}

export function isOccupancyStatus(value: unknown): value is OccupancyStatus {
  return value === "open" || value === "taken";
}

export function parseReport(raw: unknown): OccupancyReport | null {
  if (!raw || typeof raw !== "object") return null;
  const status = (raw as Record<string, unknown>).status;
  const reportedAt = (raw as Record<string, unknown>).reportedAt;
  if (!isOccupancyStatus(status) || typeof reportedAt !== "number") return null;
  return { status, reportedAt };
}

/** Mutates nothing; returns spots with `occupancy` filled in from any live reports. No-ops if Redis isn't configured. */
export async function attachOccupancy(spots: ParkingSpot[]): Promise<ParkingSpot[]> {
  const redis = getRedis();
  if (!redis || spots.length === 0) return spots;

  const keys = spots.map((s) => reportKey(s.id));
  const raws = await redis.mget<unknown[]>(...keys);

  return spots.map((spot, i) => ({ ...spot, occupancy: parseReport(raws[i]) }));
}
