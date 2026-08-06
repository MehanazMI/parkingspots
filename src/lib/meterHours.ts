import type { MeterStatus } from "./types";

// Monday = 0 ... Sunday = 6, matching the day order NYC DOT uses in meter hour text.
const DAY_INDEX: Record<string, number> = {
  mon: 0,
  tue: 1,
  wed: 2,
  thu: 3,
  fri: 4,
  sat: 5,
  sun: 6,
};
const DAY_NAME = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface MeterRule {
  days: number[];
  startMin: number;
  endMin: number;
  limitHours: number | null;
  vehicleClass: string | null;
}

const LEADING = /^(\d+)\s*HR\s*([A-Za-z]+)?\s*([A-Za-z]{3})\s*-?\s*([A-Za-z]{3})?\s+(\d{3,4})\s*-\s*(\d{3,4})$/i;
const FOLLOWUP = /^([A-Za-z]{3})\s*-?\s*([A-Za-z]{3})?\s+(\d{3,4})\s*-\s*(\d{3,4})$/i;

function parseTime(raw: string): number {
  const padded = raw.padStart(4, "0");
  const hour = parseInt(padded.slice(0, 2), 10);
  const minute = parseInt(padded.slice(2), 10);
  return hour * 60 + minute;
}

function expandDays(startDay: string, endDay: string | undefined): number[] | null {
  const start = DAY_INDEX[startDay.toLowerCase().slice(0, 3)];
  if (start === undefined) return null;
  if (!endDay) return [start];
  const end = DAY_INDEX[endDay.toLowerCase().slice(0, 3)];
  if (end === undefined) return null;
  const days: number[] = [];
  if (start <= end) {
    for (let d = start; d <= end; d++) days.push(d);
  } else {
    for (let d = start; d <= 6; d++) days.push(d);
    for (let d = 0; d <= end; d++) days.push(d);
  }
  return days;
}

export function parseMeterHours(text: string): MeterRule[] {
  if (!text) return [];
  const rules: MeterRule[] = [];
  const segments = text.split("/").map((s) => s.trim()).filter(Boolean);

  for (const segment of segments) {
    const subclauses = segment.split(",").map((s) => s.trim()).filter(Boolean);
    let prefixHours: number | null = null;
    let prefixClass: string | null = null;

    for (const sub of subclauses) {
      const lead = sub.match(LEADING);
      if (lead) {
        const [, hrs, cls, d1, d2, t1, t2] = lead;
        prefixHours = parseInt(hrs, 10);
        prefixClass = cls ?? null;
        const days = expandDays(d1, d2);
        if (days) {
          rules.push({
            days,
            startMin: parseTime(t1),
            endMin: parseTime(t2),
            limitHours: prefixHours,
            vehicleClass: prefixClass,
          });
        }
        continue;
      }
      const follow = sub.match(FOLLOWUP);
      if (follow && prefixHours !== null) {
        const [, d1, d2, t1, t2] = follow;
        const days = expandDays(d1, d2);
        if (days) {
          rules.push({
            days,
            startMin: parseTime(t1),
            endMin: parseTime(t2),
            limitHours: prefixHours,
            vehicleClass: prefixClass,
          });
        }
      }
    }
  }

  return rules;
}

function nowInNewYork(date: Date): { dayIndex: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  let hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  if (hour === 24) hour = 0;

  const dayIndex = DAY_INDEX[weekday.toLowerCase().slice(0, 3)] ?? 0;
  return { dayIndex, minutes: hour * 60 + minute };
}

function formatClock(min: number): string {
  const h24 = Math.floor(min / 60) % 24;
  const m = min % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

export function getMeterStatus(meterHoursText: string, at: Date = new Date()): MeterStatus {
  const rules = parseMeterHours(meterHoursText);

  if (rules.length === 0) {
    return {
      value: "unknown",
      detail: `Could not parse meter hours ("${meterHoursText}") — check the posted sign.`,
      limitMinutes: null,
    };
  }

  const { dayIndex, minutes } = nowInNewYork(at);

  const active = rules.find((r) => {
    if (!r.days.includes(dayIndex)) return false;
    if (r.endMin >= r.startMin) {
      return minutes >= r.startMin && minutes < r.endMin;
    }
    return minutes >= r.startMin || minutes < r.endMin;
  });

  if (active) {
    const dayLabel = describeDays(active.days);
    return {
      value: "metered",
      detail: `Metered now — up to ${active.limitHours ?? "?"}HR${
        active.vehicleClass ? ` (${active.vehicleClass})` : ""
      }, ${dayLabel} ${formatClock(active.startMin)}–${formatClock(active.endMin)}.`,
      limitMinutes: active.limitHours !== null ? active.limitHours * 60 : null,
    };
  }

  return {
    value: "free",
    detail: "No metered restriction in effect right now, based on posted meter hours.",
    limitMinutes: null,
  };
}

function describeDays(days: number[]): string {
  if (days.length === 1) return DAY_NAME[days[0]];
  const sorted = [...days].sort((a, b) => a - b);
  const isContiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (isContiguous) return `${DAY_NAME[sorted[0]]}-${DAY_NAME[sorted[sorted.length - 1]]}`;
  return sorted.map((d) => DAY_NAME[d]).join(", ");
}
