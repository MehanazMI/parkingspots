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
| 1 | **Honest reframing** — UI copy makes clear a marker is a block/segment, not a single space; crowd reports are phrased as "someone saw *an* opening" rather than implying the specific spot is free | Sets correct expectations; costs nothing, fixes a real trust problem | Low | **In progress** |
| 2 | **Multi-report confidence** — track multiple recent reports per block instead of one overwritable flag, show a confidence level (e.g. "2 people reported an opening in the last 10 min") | More honest and more useful than a single stale/overwritable report | Low–Medium | **In progress** |
| 3 | **Cover garages/lots, not just on-street** | Off-street facilities are the one place *genuine* real-time space counts commonly exist (many operators publish live counts). Adding them would give part of the app real, verified availability instead of estimates everywhere | Medium (new data source, new UI treatment) | Not started |
| 4 | **Paid live-occupancy provider** (e.g. Parknav, SpotHero) for areas they cover | The only way to get verified on-street availability at scale | Medium effort, real recurring cost, requires signing up for a paid account | Not started — previously declined for the Redis/Marketplace billing step; would need a fresh decision |
| 5 | **Predictive/historical hints** — use NYC's parking violation ticket volume by block/hour to show "usually busy at this time" | A statistically-grounded estimate, clearly labeled as such, better than nothing between reports | Medium (new dataset, needs its own honesty framing so it doesn't get read as certainty) | Not started |

## What's being built now (#1 and #2)

**#1 — Honest reframing:**
- Popup/report copy already changed to "I saw an opening here" / "someone
  saw an opening here" (not "this spot is open") as part of removing "taken".
- Add a short, visible explanation (e.g. a legend note or info tooltip) that
  a marker = a block segment that may hold multiple spaces, not one space.
- Audit remaining UI/chat-assistant copy for language that overstates
  certainty (e.g. avoid "the spot is free," prefer "parking is legal here
  right now").

**#2 — Multi-report confidence:**
- Replace the single overwrite-on-report model (last report wins, no
  memory of earlier ones) with a rolling window of recent reports per
  block (Redis sorted set, same 30-minute TTL philosophy).
- Show a simple confidence tier from the count of distinct recent reports
  (e.g. 1 = low, 2 = medium, 3+ = high) instead of a bare yes/no, so the UI
  reflects actual corroboration rather than one person's single tap.

## Why not #3/#4/#5 right now

Not rejected — just bigger asks than a quick follow-up:

- **#3 (garages/lots)** needs a new NYC Open Data source (or a different
  one entirely for live counts) and a UI treatment for a genuinely different
  kind of result (a facility with a numeric count, vs. a block with a
  legal/estimated status). Worth prioritizing next given it's the most
  direct path to *real* availability data without a paid vendor.
- **#4 (paid provider)** is a real, recurring cost and an account signup —
  worth it if the app needs to make an availability guarantee, but that's a
  product/budget decision, not something to default into.
- **#5 (predictive hints)** adds real value but also real risk of being
  misread as certainty if not framed very carefully — better tackled after
  #1's honesty-in-copy work is solid, so the pattern for "this is an
  estimate" is already established in the UI.
