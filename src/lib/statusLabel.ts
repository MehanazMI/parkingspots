import type { MeterStatusValue } from "./types";

// Display text only — the underlying "free" status value stays as-is
// throughout the code/types. "No cost" avoids reading like "available/empty,"
// which is exactly the ambiguity this app works hard to avoid elsewhere.
export const STATUS_LABEL: Record<MeterStatusValue, string> = {
  free: "No cost",
  metered: "Metered",
  unknown: "Unknown",
};
