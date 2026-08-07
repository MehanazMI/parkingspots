import { getRedis } from "./redis";
import type { OccupancyReport, ParkingSpot } from "./types";

export const REPORT_TTL_SECONDS = 30 * 60; // reports expire after 30 minutes

export function reportKey(spotId: string): string {
  return `report:${spotId}`;
}

export function parseReport(raw: unknown): OccupancyReport | null {
  if (!raw || typeof raw !== "object") return null;
  const reportedAt = (raw as Record<string, unknown>).reportedAt;
  if (typeof reportedAt !== "number") return null;
  return { reportedAt };
}

/** Mutates nothing; returns spots with `occupancy` filled in from any live reports. No-ops if Redis isn't configured. */
export async function attachOccupancy(spots: ParkingSpot[]): Promise<ParkingSpot[]> {
  const redis = getRedis();
  if (!redis || spots.length === 0) return spots;

  const keys = spots.map((s) => reportKey(s.id));
  const raws = await redis.mget<unknown[]>(...keys);

  return spots.map((spot, i) => ({ ...spot, occupancy: parseReport(raws[i]) }));
}
