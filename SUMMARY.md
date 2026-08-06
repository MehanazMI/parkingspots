# Project Summary — NYC Parking Finder

Record of what was built in this session: the decisions made, why, the
architecture, and what's left. See [README.md](README.md) for setup/run
instructions — this file is the narrative behind those instructions.

## Goal

An app to find available parking spots in a specific area, requested as a
new greenfield project with its own git repo.

## Key decisions (and why)

| Decision | Why |
|---|---|
| Target city: **New York City** | User choice among NYC / SF / LA / other. |
| Availability model: **regulation-based**, not live occupancy | User initially wanted a "real-time API feed." Research (NYC Open Data catalog + DOT data feeds page) showed NYC has no free public feed of live on-street occupancy — the old sensor-based approach was discontinued years ago, same as SFpark. True live occupancy exists only via paid private providers (Parknav, SpotHero). Given that, the user chose to show *where parking is legal and what it costs right now*, computed from posted meter regulations, instead of pausing to integrate a paid provider. |
| Data source: **NYC Open Data "Parking Meters Locations and Status"** (`693u-uax6`) | Chosen over the "Parking Regulation Locations and Signs" dataset (`nfid-uabd`) because the meters dataset has ready-to-use `lat`/`long` fields and a `location` geo-Point field that supports server-side `within_box` filtering. The regulation/signs dataset only has NY State Plane feet coordinates (`sign_x_coord`/`sign_y_coord`), which would require a coordinate-system conversion, and its free-text sign descriptions are far more varied. |
| Map: **Leaflet + OpenStreetMap tiles** | No API key or billing account required, unlike Mapbox/Google Maps — appropriate for a fast-start greenfield app. |
| Geocoding: **Nominatim (OpenStreetMap)**, proxied server-side | Free, no key. Proxied through `/api/geocode` to set the descriptive `User-Agent` Nominatim's usage policy requires, and to avoid CORS issues from the browser. |
| Meter/geocoding data: **no database** | Both are queried live and cached briefly (60s) at the API-route level — re-derived from a live feed, not stored state. |
| Occupancy reports: **Upstash Redis**, self-serve free tier (not Vercel Marketplace billing) | The user asked for an availability sub-status on metered spots. No free live-occupancy feed exists (see above), so the only honest way to offer one is crowdsourced reports — which need somewhere to write TTL'd key-value data. First attempt was `vercel integration add upstash/upstash-kv` through the Marketplace; that requires accepting billing terms and a payment method on file, which the user declined ("I do not want to share my card details"). Switched to creating the Redis database directly at console.upstash.com (free tier, no card) and pasting the REST URL/token into `.env.local` by hand instead. |
| Repo visibility: **private** | User's explicit choice when asked. |

## What "status" actually means

Each meter's `meter_hours` field is free text describing when the meter is
in effect, e.g. `"2HR Pas Mon-Sat 0900-1900"` or a chained version like
`"1HR Com Mon-Fri 0700-1600 / 3HR Pas Mon-Fri 1600-2200, Sat 0700-2200"`.

`src/lib/meterHours.ts` parses this into structured rules (days, time
window, hour limit, vehicle class) and `src/lib/nycOpenData.ts` evaluates
them against the current time in `America/New_York` to classify each spot:

- **Free** — outside all metered windows, no restriction in effect
- **Metered** — inside a metered window right now (paid, time-limited)
- **Unknown** — the text didn't match a recognized pattern (the dataset has
  a long tail of formats; unparseable ones are surfaced as "Unknown" with
  the raw text shown, rather than guessed)

This reflects **legal/paid status, not physical occupancy** — the app
cannot tell you if a car is currently sitting in a given spot, because no
free public feed for that exists for NYC. This limitation was surfaced to
the user before building and is called out again in the README.

## Crowdsourced occupancy layer

Added after the user asked for an available/not-available sub-category on
metered spots. Since there's still no live feed, this is opt-in, anonymous,
crowdsourced reporting on top of the meter status:

- `src/lib/redis.ts` — lazy Upstash Redis client; returns `null` if
  `UPSTASH_REDIS_REST_URL`/`TOKEN` aren't set, so the rest of the app can
  degrade gracefully instead of crashing when occupancy isn't configured.
- `src/lib/occupancy.ts` — report key naming (`report:<spotId>`), a 30-minute
  TTL constant, a `parseReport` guard for values coming back out of Redis,
  and `attachOccupancy(spots)` which does one `mget` across all spot IDs in
  a response and merges the result in.
- `POST /api/report` — body `{ spotId, status: "open" | "taken" }`, writes
  `{ status, reportedAt }` to Redis with the 30-minute TTL. Returns 503 if
  Redis isn't configured, 400 on a malformed body.
- `GET /api/parking` now calls `attachOccupancy` after fetching spots, so
  each `ParkingSpot.occupancy` is either `null` or a live (unexpired, by
  construction — TTL handles expiry) report.
- UI: `ParkingMap.tsx` draws a colored ring around a marker when it has an
  occupancy report (blue = reported open, orange = reported taken — swapped
  from an earlier blue/purple pairing the user found too similar to tell
  apart) and adds
  an "It's open" / "It's taken" control to the popup for metered spots only,
  per the user's ask ("at least for the metered ones"). Submitting posts to
  `/api/report` and optimistically updates that one spot's `occupancy` in
  local state — no full refetch needed.

TTL-based expiry was chosen over an explicit "clear" action so stale reports
can't linger indefinitely with no upkeep — a report simply stops existing
30 minutes after it's made, and the marker reverts to showing meter status
only.

## Architecture

```
src/
  app/
    page.tsx                 Main UI: header, search bar, legend/counts, map
    layout.tsx                Root layout, page metadata
    api/
      parking/route.ts        GET ?north&south&east&west -> ParkingSpot[]
                               Queries NYC Open Data (SoQL within_box),
                               computes status per spot, 60s cache
      geocode/route.ts        GET ?q=<address> -> Nominatim results,
                               biased/bounded to NYC's bounding box
  components/
    ParkingMap.tsx             Leaflet map (client-only, dynamically
                                imported): colored markers, popups,
                                fly-to-location and move-end handlers
    SearchBar.tsx               Address input -> /api/geocode -> results
                                dropdown -> selecting flies the map there
    api/
      report/route.ts           POST { spotId, status } -> writes a 30-min
                                 TTL occupancy report to Redis
  lib/
    types.ts                   Shared types: ParkingSpot, MeterStatus,
                                OccupancyReport, BoundingBox
    meterHours.ts               Free-text meter-hours parser + status evaluator
    nycOpenData.ts               Fetches + normalizes NYC Open Data records
    redis.ts                     Lazy Upstash Redis client (null if unconfigured)
    occupancy.ts                  Report key/TTL, parsing, attachOccupancy()
```

### Request flow

1. Map mounts → reports its initial viewport bounds → `page.tsx` fetches
   `/api/parking` for that bounding box.
2. User pans/zooms or searches an address (geocoded via `/api/geocode`,
   then the map flies there) → `moveend` fires → debounced 500ms → refetch
   `/api/parking` for the new bounds.
3. `/api/parking` queries Socrata's `693u-uax6` resource with a
   `within_box(location, …) AND status='Active'` filter, capped at 400
   results, computes each spot's live status server-side, returns JSON.
4. Markers are colored green (free) / red (metered) / gray (unknown);
   clicking one shows street, cross-streets, side, status detail, and the
   raw posted meter hours.

## Verification performed

- `tsc --noEmit` — clean
- `npm run lint` (ESLint) — clean
- `npm run build` — production build succeeds
- Live browser check (Playwright, headless Chromium): loaded the app,
  confirmed real markers render (400 near Union Square, mix of free/metered),
  ran the search flow (typed "Times Square", selected a result, confirmed
  the map flew there and refetched a different, smaller marker set — 129
  spots, 30 free / 99 metered), checked `console --errors` was empty both
  times.
- Caught and fixed a real bug during that check: searching a new area flew
  the map there but didn't refetch data until a manual "Search this area"
  click. Changed the move-end handler to auto-refetch (debounced), kept a
  manual "Refresh" button as a fallback.

## Known limitations / natural next steps

- Only on-street metered spots are shown — no municipal lots/garages, and
  no broader DOT regulations (no-standing, alternate-side parking, loading
  zones) since those live in a much larger, harder-to-parse dataset
  (`nfid-uabd`, coordinates in NY State Plane feet, free-text sign codes).
- Results capped at 400 per viewport for map performance; dense areas
  (Midtown, Downtown) need zooming in to see everything in view.
- `meterHours.ts` handles the common `"NHR Class Day-Day HHMM-HHMM"`
  pattern (chained with `/` and `,`) but not every historical variant in
  the dataset — those fall back to "Unknown" rather than a wrong guess.
- No automated tests were added (none requested); verification was manual
  build/lint/type-check plus one browser-driven smoke pass.
- Not yet deployed — `vercel` (or the Vercel MCP `deploy_to_vercel` tool)
  is the next step whenever that's wanted.
- Occupancy reports are anonymous and unmoderated, with no rate-limiting
  beyond the 30-minute TTL — fine for a demo, would need abuse controls
  before being trusted for real decisions.

## Repository

Private GitHub repo: https://github.com/MehanazMI/parkingspots
