import { getRedis } from "./redis";
import type { ConfidenceLevel, OccupancyReport, StreetSpot } from "./types";

export const REPORT_TTL_SECONDS = 30 * 60; // rolling window: resets after 30 min with no new report
const MAX_TRACKED_REPORTS = 5; // corroboration signal, not a precise count — cap it

export function reportKey(spotId: string): string {
  return `report:${spotId}`;
}

export function confidenceFor(reportCount: number): ConfidenceLevel {
  if (reportCount >= 3) return "high";
  if (reportCount === 2) return "medium";
  return "low";
}

interface StoredReport {
  reportCount: number;
  firstReportedAt: number;
  lastReportedAt: number;
}

function parseStoredReport(raw: unknown): StoredReport | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.reportCount !== "number" ||
    typeof r.firstReportedAt !== "number" ||
    typeof r.lastReportedAt !== "number"
  ) {
    return null;
  }
  return { reportCount: r.reportCount, firstReportedAt: r.firstReportedAt, lastReportedAt: r.lastReportedAt };
}

function toOccupancyReport(stored: StoredReport): OccupancyReport {
  return { ...stored, confidence: confidenceFor(stored.reportCount) };
}

export function parseReport(raw: unknown): OccupancyReport | null {
  const stored = parseStoredReport(raw);
  return stored ? toOccupancyReport(stored) : null;
}

/**
 * Records a new corroborating report for a spot. If a report is still within
 * the rolling window, increments its count (capped); otherwise starts a
 * fresh window at count 1. Returns the updated report.
 */
export async function recordReport(spotId: string): Promise<OccupancyReport> {
  const redis = getRedis();
  if (!redis) throw new Error("Occupancy reporting isn't configured");

  const key = reportKey(spotId);
  const existing = parseStoredReport(await redis.get(key));
  const now = Date.now();

  const stored: StoredReport = existing
    ? { reportCount: Math.min(existing.reportCount + 1, MAX_TRACKED_REPORTS), firstReportedAt: existing.firstReportedAt, lastReportedAt: now }
    : { reportCount: 1, firstReportedAt: now, lastReportedAt: now };

  await redis.set(key, stored, { ex: REPORT_TTL_SECONDS });
  return toOccupancyReport(stored);
}

/** Mutates nothing; returns spots with `occupancy` filled in from any live reports. No-ops if Redis isn't configured. */
export async function attachOccupancy(spots: StreetSpot[]): Promise<StreetSpot[]> {
  const redis = getRedis();
  if (!redis || spots.length === 0) return spots;

  const keys = spots.map((s) => reportKey(s.id));
  const raws = await redis.mget<unknown[]>(...keys);

  return spots.map((spot, i) => ({ ...spot, occupancy: parseReport(raws[i]) }));
}
