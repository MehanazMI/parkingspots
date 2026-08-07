# Suggestions for Improving NYC Parking Finder

This file exists because the app's core purpose — finding *available*
parking — runs into a hard limitation: NYC does not publish free, live,
space-level parking occupancy data. This document is an honest look at that
limitation, the options for dealing with it, and which ones this project is
acting on.

## The core limitation

Every "spot" in this app is one record from NYC Open Data's [Parking Meters
Locations and
Status](https://data.cityofnewyork.us/Transportation/Parking-Meters-Locations-and-Status/693u-uax6)
dataset. Each record represents **a block-face segment** — a stretch of curb
between two cross streets, on one side of the street (e.g. "Irving Place, W
side, between E 15th & E 16th St") — because NYC's muni-meter system
regulates parking by block, not by individual space. A single record can
cover anywhere from one to a dozen or more physical parking spaces.

That has two consequences worth being explicit about:

1. **"Free" / "Metered" is always accurate** — it's a direct read of the
   posted regulation, computed against the current time. This tells you
   *where parking is legal and what it costs*, reliably.
2. **"Available" is fundamentally not knowable from free data** — nobody
   (not NYC, not any commercial provider we could add for free) can tell you
   with certainty that a specific curb space is empty right now, because the
   sensor infrastructure for that was decommissioned years ago city-wide.
   Anything claiming otherwise for on-street NYC parking is either paid,
   proprietary, or wrong.

This is why the original "It's taken" crowd report was removed: reporting a
whole block as "taken" implied a certainty the app can't back up (other
spaces on that block could still be open), which was actively misleading
rather than merely incomplete.

## Options considered

| # | Option | What it gets you | Effort / cost | Status |
|---|---|---|---|---|
| 1 | **Honest reframing** — UI copy makes clear a marker is a block/segment, not a single space; crowd reports are phrased as "someone saw *an* opening" rather than implying the specific spot is free | Sets correct expectations; costs nothing, fixes a real trust problem | Low | **Done** |
| 2 | **Multi-report confidence** — track multiple recent reports per block instead of one overwritable flag, show a confidence level (e.g. "2 people reported an opening in the last 10 min") | More honest and more useful than a single stale/overwritable report | Low–Medium | **Done** |
| 3 | **Cover garages/lots, not just on-street** | Turned out free NYC data has no live counts for garages either (see GARAGE_DATA_RESEARCH.md) — but adding them still gives a distinct, honestly-labeled result type (static capacity) with its own filter, differentiated from street parking | Medium (new data source, new UI treatment) | **Done** |
| 4 | **Paid live-occupancy provider** (e.g. Parknav, SpotHero) for areas they cover | The only way to get verified on-street availability at scale | Medium effort, real recurring cost, requires signing up for a paid account | Not started — previously declined for the Redis/Marketplace billing step; would need a fresh decision |
| 5 | **Predictive/historical hints** — use NYC's parking violation ticket volume by block/hour to show "usually busy at this time" | A statistically-grounded estimate, clearly labeled as such, better than nothing between reports | Medium (new dataset, needs its own honesty framing so it doesn't get read as certainty) | Not started |

## What was built (#1 and #2)

**#1 — Honest reframing:**
- Popup/report copy reads "I saw an opening here" / "N people saw an
  opening on this block" — never implies a single space is confirmed free.
- Added a visible **ⓘ info icon** next to the map legend (`page.tsx`) with a
  tooltip explaining that a marker = a block-face segment that may hold
  multiple spaces, and that crowd reports mean "at least one opening seen,"
  not "this exact spot is free."
- Header subtitle changed to "Legal parking status by block, computed live
  — not a live occupancy feed."
- AI assistant instructions (`parking-agent.ts`) explicitly told to describe
  results as block segments and never imply single-space certainty.

**#2 — Multi-report confidence:**
- Replaced the single overwrite-on-report model with a corroboration
  counter per spot (`src/lib/occupancy.ts`): each new report within the
  rolling 30-minute window increments `reportCount` (capped at 5) and
  refreshes the window; no report for 30+ minutes and it resets to zero.
- Confidence tier derived from count: 1 = low, 2 = medium, 3+ = high
  (`confidenceFor()`), shown in the map popup, the AI assistant's tool
  results, and used to rank chat results (higher confidence sorts first).
- Chose a simple refresh-on-report counter over a true sorted-set/pruned
  window (the originally sketched design) because it needs only one GET +
  one SET per report (no pipelining, no per-read pruning across up to 400
  spots) and is simpler to reason about, at the honestly-stated cost of not
  distinguishing "3 reports in the last 2 minutes" from "3 reports spread
  across 29 minutes" — both currently read as "high confidence."

**#3 — Garages/lots:** researched first (see
[GARAGE_DATA_RESEARCH.md](GARAGE_DATA_RESEARCH.md)) rather than assumed.
Finding: no free live occupancy for garages either — same limitation as
street parking. What *is* usable: NYC DCA's "Parking Garage List"
(`5bhr-pjxt`), 2,704 licensed facilities with location and a static total
vehicle capacity. Built on that:
- `src/lib/types.ts`: `ParkingSpot` is now a discriminated union
  (`StreetSpot | GarageSpot`) on a `facilityType` field, rather than one
  flat shape — garages don't have meter status, occupancy reports, or
  street/cross-street fields, and forcing them into the old shape would
  have meant fake/null fields everywhere.
- `src/lib/garages.ts`: queries the DCA dataset with a geo bounding box
  (plain `latitude`/`longitude` numeric range — this dataset has no
  combined Point column like the meters one does) and an active-license
  filter (`lic_expir_dd > today`), parses `"Vehicle Capacity: N; Bicycle
  Capacity: N"` out of the free-text `detail` field.
- `/api/parking` gained a `type=street|garage|both` param; the map toolbar
  got a **Street / Garages / Both** segmented filter driving it.
- Garages render as square indigo markers (vs. street's colored circles) —
  the "differentiate street vs. garage" requirement — with popups showing
  name, address, and capacity, explicitly labeled "total, not live
  availability," plus a note that no rate data exists for it.
- The AI assistant's `findParking` tool now searches both types (with an
  optional `facilityType` param the model only sets when the user actually
  asked for one kind), and its instructions were updated to describe
  garages differently from street results and to say plainly there's no
  price data if asked.

**Correction to the original sequencing plan:** the plan was "do #3 first,
since garages naturally carry pricing, making cost-sorting a small
follow-on." That assumption was wrong — the free garage dataset has no rate
field. Cost-sorting remains unstarted and will need its own data source for
*both* street meters (a separate NYC rate-zone dataset exists but wasn't
integrated) and garages (no free source found) regardless of build order.

## Why not #4/#5 right now

Not rejected — just bigger asks than a quick follow-up:

- **#4 (paid provider)** is a real, recurring cost and an account signup —
  worth it if the app needs to make an availability guarantee, but that's a
  product/budget decision, not something to default into.
- **#5 (predictive hints)** adds real value but also real risk of being
  misread as certainty if not framed very carefully — better tackled after
  #1's honesty-in-copy work is solid, so the pattern for "this is an
  estimate" is already established in the UI.

## Cost sorting — next up

Not yet started. Needs its own research pass (like GARAGE_DATA_RESEARCH.md)
into: NYC's meter rate-zone dataset for street parking rates, and some
source for garage rates (none found free so far — may require scraping
individual garage listings or a paid aggregator). Until then, no field
exists to sort by.
