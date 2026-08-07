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
| AI assistant model: **OpenAI direct** (`@ai-sdk/openai`), not Vercel AI Gateway | Vercel platform guidance defaults to the AI Gateway for AI SDK usage. Presented that as the recommended option, but flagged it needs an API key from the Vercel dashboard which may involve billing setup — given the earlier Redis/Marketplace billing friction, the user chose to bring their own OpenAI key directly instead, bypassing Vercel's Gateway/billing entirely. This is the explicit "user asked for direct provider wiring" exception to the gateway-by-default guidance. |
| AI model: **`gpt-5.4-mini`** | Fetched the live model catalog (`ai-gateway.vercel.sh/v1/models`) rather than trusting training data, which was outdated (would have suggested `gpt-4.1-mini`). Picked the mini tier of the newest version for a cheap/fast tool-calling assistant; `gpt-5.4-nano` is available if even cheaper is wanted. |
| Occupancy model: **reports corroborate, don't overwrite** | User pointed out that a single "taken" report on a spot representing a whole block-face (often several spaces) is misleading — other spaces on that block could still be open. Removed "taken" entirely; "open" reports now accumulate into a count/confidence tier within a rolling 30-min window instead of one person's report overwriting the last. |
| Garage data source: **DCA "Parking Garage List"** (`5bhr-pjxt`), not the more literally-named "Active DCA-Licensed Garages and Parking Lots" (`a7m8-iids`) | Researched before building (GARAGE_DATA_RESEARCH.md) rather than assumed. The better-named dataset has 69,885 rows including non-parking businesses — untrustworthy despite its title. The one actually used has 2,704 rows, uniform `license_type: "Premises"`, and a reliably-parseable capacity field. |
| `ParkingSpot` refactored to a discriminated union (`StreetSpot \| GarageSpot`) | Garages don't have meter status, occupancy, or street/cross-street fields — forcing them into the existing flat `ParkingSpot` shape would have meant fake/null values throughout. The union makes each variant's real shape explicit and lets TypeScript catch spots where garage-only or street-only code wasn't handling both cases. |

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

## AI parking assistant

Requested as a follow-up feature: a chat panel for natural-language questions
("free parking near Union Square", "a 2-hour spot near Times Square"). Built
with a plan-first pass (scope + provider/billing tradeoffs surfaced and
confirmed before writing code), per explicit user preference established
earlier in the session after a plan step got skipped once.

Design principle: the model has **no independent access to parking data** —
it can only answer via a tool that calls the app's own existing server-side
functions. This was a deliberate constraint (stated in the agent's
instructions and enforced structurally, not just by prompting) so an answer
like "Irving Place, 212m away" is always literally the tool's output, not a
generation. Verified this directly: called `/api/chat` with curl and
confirmed the model's final text matched the tool's returned street name and
distance exactly.

- `src/lib/geocode.ts` — extracted the Nominatim call out of
  `/api/geocode/route.ts` into a shared function, so the chat tool and the
  manual search bar geocode through identical logic (no second, possibly
  divergent implementation).
- `src/lib/types.ts` — added `MeterStatus.limitMinutes` (minutes a vehicle
  may stay under the currently active rule, null unless metered), computed
  in `meterHours.ts`'s existing active-rule branch. Needed so the duration
  filter ("a 2-hour spot") could compare against real parsed data instead of
  re-parsing or regex-scraping the display text a second time.
- `src/lib/tools/find-parking-tool.ts` — a `tool()` taking
  `{ area, durationMinutes? }`: geocodes, builds a ~500m box around the
  point, calls `fetchParkingSpots` + `attachOccupancy` directly (same
  process, no HTTP round-trip), filters by duration when given, ranks
  (crowd-reported-open first, then free, then metered, by distance), returns
  top 8.
- `src/lib/agents/parking-agent.ts` — a `ToolLoopAgent` (`gpt-5.4-mini` via
  `@ai-sdk/openai`) with instructions constraining it to only state tool
  output, to flag that free/metered ≠ physical occupancy, to label crowd
  reports as unverified, and to omit `durationMinutes` unless the user
  actually stated one (an early test showed the model defaulting to `1`
  when no duration was mentioned — harmless since almost any real limit
  clears 1 minute, but tightened the instructions anyway rather than leave
  an unintended default in place).
- `src/app/api/chat/route.ts` — `createAgentUIStreamResponse`, the
  agent-native route handler (simpler than manually wiring `streamText` +
  `convertToModelMessages` since the agent already encapsulates model/tools).
- `src/components/ChatPanel.tsx` — slide-over panel using `useChat` +
  `DefaultChatTransport`; renders `tool-findParking` parts as spot cards
  (street, status badge, distance, crowd report if any); clicking a card
  calls back into `page.tsx`'s existing `flyTo` state, so chat results and
  manual search share the same map-navigation path.
- Floating "Ask AI" button in the bottom-right of the map opens/closes the
  panel.

All current AI SDK API names (`ToolLoopAgent`, `tool()`, `inputSchema`,
`InferAgentUIMessage`, `createAgentUIStreamResponse`, `useChat`,
`DefaultChatTransport`) were confirmed against the bundled
`node_modules/ai/docs/` at build time rather than trusted from training data,
per the ai-sdk skill's explicit warning that AI SDK knowledge in training
data is outdated.

### Highlighting chat results on the map

Follow-up request: clicking a chat result flew the map there but gave no
visual cue about *which* marker it was. Added:

- `spotIcon()` in `ParkingMap.tsx` renders a bigger (22px vs 14px) marker
  with a pulsing blue halo (`.spot-marker-highlight`, keyframes in
  `globals.css`) when `spot.id === highlightedSpotId`.
- Clicking a chat result now sets both `flyTo` (with a `spotId`) and
  `highlightedSpotId` in `page.tsx`, passed down to `ParkingMap`.
- The spot's popup auto-opens once its marker actually exists — deliberately
  *not* tied to the fly-to animation's `moveend`, since a chat-selected spot
  is often outside the current viewport and its data may still be loading
  (a new bbox fetch) when the animation finishes. Instead, an effect watches
  `[highlightedSpotId, spots]` and opens the popup the moment the marker for
  that ID is available, however long that takes.

**Debugging note, in case this resurfaces:** the popup-auto-open initially
appeared broken — `marker.openPopup()` reported `isPopupOpen() === true`
immediately, but the popup vanished from the DOM within ~250ms in `npm run
dev`. Root-caused via a `popupclose` listener + stack trace to
`doubleInvokeEffectsOnFiber` — React's **development-only** Strict Mode
behavior of mount → simulated-unmount → remount for every effect on a
component's first render. Since react-leaflet's `Marker` adds/removes the
actual Leaflet layer inside an effect, this genuinely removed-then-re-added
the marker (closing its popup) the moment it first mounted — nothing to do
with our code being wrong. Verified clean against `next build && next
start` (production, no double-invoke): popup opens and stays open. Also
fixed a real, non-dev-only bug found along the way: `spotIcon()` built a
brand-new `L.divIcon()` object on every call, so *any* unrelated spots
refetch made Leaflet call `setIcon()` on every marker (new object ref),
which is wasteful and — combined with the dev double-invoke — made the
symptom worse. Now caches icons by visual signature (status + occupancy +
highlighted) so unchanged markers reuse the same instance.

## Garage/lot layer

Requested as suggestion #3 from the availability discussion, with an
explicit ask to research the data *before* building (see
[GARAGE_DATA_RESEARCH.md](GARAGE_DATA_RESEARCH.md)) and to let users choose
which type to see.

- `src/lib/types.ts`: `ParkingSpot` became `StreetSpot | GarageSpot`, keyed
  by `facilityType`. Every consumer (map, page, AI tool, chat UI) now
  branches on this discriminant rather than assuming one flat shape.
- `src/lib/garages.ts`: queries NYC DCA's `5bhr-pjxt` resource. This
  dataset has plain `latitude`/`longitude` number columns, not a combined
  Point column like the meters dataset, so geo-filtering is a numeric
  range `$where` clause instead of `within_box`. Also filters to
  non-expired licenses and regexes the vehicle/bicycle capacity out of a
  free-text `detail` field.
- `/api/parking` gained `?type=street|garage|both` (default `both`),
  fetching and merging both sources; occupancy attachment still only
  applies to the street subset.
- `page.tsx` got a **Street / Garages / Both** segmented control driving
  that param, plus separate legend entries and counts per type.
- `ParkingMap.tsx`: garages render as square indigo markers (vs. street's
  colored circles) with their own popup (name, address, capacity labeled
  "total, not live availability", explicit "no rate data" note) — no
  occupancy-report UI, since that's street-only.
- `find-parking-tool.ts` / `parking-agent.ts`: the AI assistant now
  searches both types together by default, with an optional
  `facilityType` param the model only sets when the user actually asked
  for one kind specifically, and instructions telling it to describe
  garage results differently (capacity, not status) and to say plainly
  there's no price data if asked about cost.

**A planning correction surfaced during this work:** the original plan was
"build #3 first, then cost-sorting, since garages naturally carry
pricing." That assumption didn't hold — the free garage dataset has no
rate field, so cost-sorting needed its own separate data source, built
next.

## Post-garage bug fixes: filter awareness

Two real bugs surfaced once the garage filter shipped:

1. **Highlighting silently did nothing under an active filter** — clicking
   a chat/list result flew the map there, but if the current Street/Garage
   filter excluded that result's type, the map never loaded it, so nothing
   was there to highlight. Fixed in `handleSelectSpot` (`page.tsx`): switch
   the filter to "Both" whenever a result is selected, guaranteeing it
   loads.
2. **The AI assistant ignored the active map filter**, always defaulting
   to searching both types. Root cause of the fix's shape:
   `createAgentUIStreamResponse` doesn't forward `runtimeContext`/
   `toolsContext` to the underlying agent call (checked the AI SDK source
   directly, not just docs, since the docs' `toolsContext` example is for
   `agent.generate()`, not this streaming helper) — so passing the filter
   that way wasn't an option. Instead, `parking-agent.ts` exports
   `buildParkingAgent(activeFilter)`, constructing the `ToolLoopAgent`
   fresh per request with filter-specific instructions appended (agents
   are cheap config objects, not connections, so this is fine per-request).
   `ChatPanel.tsx` sends the current filter via `sendMessage`'s `body`
   option, read directly in the submit handler — not through a `useRef`,
   which React's compiler-lint rule flags as unsafe to read inside a
   closure constructed during render (the transport's lazy `useState`
   initializer counts). `sendMessage(message, { body })` sidesteps that
   entirely since it's a plain prop read inside an event handler.

Both verified via curl (tool call's `facilityType` matches the active
filter) and a full browser pass (filter auto-switches to Both, correct
marker highlights).

## Cost sorting + list panel

Researched before building, same pattern as garages: NYC DOT's "Parking
Meters - Citywide Rate Zones" (`f72k-2u3b`) turned out genuinely usable —
large zone polygons, each with a posted hourly rate in a free-text field.
Verified live via a point-in-polygon SoQL query
(`intersects(the_geom, 'POINT(lng lat)')`) before writing any app code:
Union Square correctly resolved to "Zone M1 - Midtown, $5.50/hr." Also
closed out the garage-rate question definitively — checked `dotprs.nyc`
(DOT's own municipal garage reservation site) for a public API; it's
consumer-only, no documented data access, so no free garage rate source
exists anywhere that was found.

- `src/lib/meterRates.ts`: `fetchZoneRate(lat, lng)` — one point-in-polygon
  query per bounding box (at its *center*, not per spot, since these zones
  are large enough that a small map viewport essentially never spans two),
  regexing the "All Vehicles ... 1st Hour" rate out of the zone's free-text
  field. `attachZoneRate(spots, bbox)` applies the single result to every
  street spot in that bbox.
- `StreetSpot.rate: { zoneName, hourlyRate, rawRateText } | null` — shown
  in the map popup, list panel, and AI results; garages and out-of-zone
  street spots stay `null` rather than a guessed value.
- New `src/components/SpotListPanel.tsx` — left-docked (opposite the chat
  panel), listing every spot currently loaded, sortable by Distance or
  Cost. Deliberately sorts no-rate results *last* under cost sort rather
  than folding them in as free — same honesty principle as the rest of the
  app. Reused `handleSelectSpot` (renamed from `handleSelectSpotFromChat`
  since it's no longer chat-only) for fly-to/highlight, same as chat
  results.
- `findParkingTool` gained `sortBy: "relevance" | "cost"`; the agent's
  instructions say to only pass `"cost"` when the user explicitly asks for
  cheapest, and that no-rate results aren't free, just undocumented.
- Extracted `haversineMeters` into `src/lib/geo.ts` (previously duplicated
  inline in `find-parking-tool.ts`) since the list panel needed it too.

## Architecture

```
src/
  app/
    page.tsx                 Main UI: header, search bar, facility filter,
                              legend/counts, map
    layout.tsx                Root layout, page metadata
    api/
      parking/route.ts        GET ?north&south&east&west&type=street|garage|both
                               -> ParkingSpot[] (merges street + garage
                               sources per type param), 60s cache
      geocode/route.ts        GET ?q=<address> -> Nominatim results,
                               biased/bounded to NYC's bounding box
  components/
    ParkingMap.tsx             Leaflet map (client-only, dynamically
                                imported): street circles + garage squares,
                                type-specific popups, fly-to/move-end
    SearchBar.tsx               Address input -> /api/geocode -> results
                                dropdown -> selecting flies the map there
    ChatPanel.tsx                Slide-over AI chat: useChat, renders
                                 tool-findParking results as street/garage
                                 cards, sends facilityFilter with each message
    SpotListPanel.tsx             Left-docked sortable list (Distance/Cost)
                                  of every spot currently loaded
    api/
      report/route.ts           POST { spotId } -> corroborating occupancy
                                 report (30-min rolling window) in Redis
      chat/route.ts               POST -> createAgentUIStreamResponse(
                                  buildParkingAgent(facilityFilter))
  lib/
    types.ts                   StreetSpot, GarageSpot, ParkingSpot union,
                                MeterStatus, OccupancyReport, ZoneRate, BoundingBox
    meterHours.ts               Free-text meter-hours parser + status evaluator
    nycOpenData.ts               Fetches + normalizes street meter records
    garages.ts                    Fetches + normalizes DCA garage records
    meterRates.ts                  Zone rate point-in-polygon lookup + parser
    geo.ts                          Shared haversineMeters()
    redis.ts                     Lazy Upstash Redis client (null if unconfigured)
    occupancy.ts                  Report key/TTL, confidence tiers, attachOccupancy()
    geocode.ts                     Shared Nominatim geocode() — used by
                                   /api/geocode and the AI tool
    tools/
      find-parking-tool.ts          AI tool: geocode + street/garage fetch +
                                    attachOccupancy + attachZoneRate +
                                    duration filter + relevance/cost rank
    agents/
      parking-agent.ts               buildParkingAgent(activeFilter) ->
                                     ToolLoopAgent (gpt-5.4-mini) with
                                     filter-aware instructions per request
```

### Request flow

1. Map mounts → reports its initial viewport bounds → `page.tsx` fetches
   `/api/parking` for that bounding box and the current facility filter.
2. User pans/zooms, searches an address, or changes the Street/Garages/Both
   filter → refetch `/api/parking` for the (possibly new) bounds and filter
   (debounced 500ms on pan/zoom).
3. `/api/parking` fetches street spots (Socrata `693u-uax6`,
   `within_box(location, …) AND status='Active'`, capped at 400, live
   status computed server-side, occupancy attached, one zone-rate lookup
   applied to all of them) and/or garages (Socrata `5bhr-pjxt`, numeric
   lat/long range + active-license filter, capped at 200) based on `type`,
   merges, returns JSON.
4. Street markers are colored green (free) / red (metered) / gray
   (unknown); garage markers are square and indigo. Clicking either shows
   a type-appropriate popup, including the zone rate for street spots when
   known.

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
- AI assistant: verified grounding directly via curl against `/api/chat`
  before touching the UI — confirmed the streamed tool call's `input`
  matched the user's ask and the final text matched the tool's `output`
  verbatim (street name, distance). Then a full Playwright pass through the
  actual UI: opened the panel, asked "find a 2 hour metered spot near Times
  Square", confirmed real spot cards rendered with distances, clicked one
  and confirmed the map flew there and refetched that area's data, zero
  console errors throughout.
- Production deploy verified live: homepage, `/api/parking`, and `/api/report`
  all smoke-tested against the deployed URL after `vercel --prod`, confirming
  the Upstash env vars pushed via `vercel env add` actually reached
  production (not just local `.env.local`).
- Garage layer: tested `/api/parking?type=garage` directly (confirmed real
  DCA facility names/addresses/capacities), then `type=both` (confirmed
  street + garage counts both present), then a full Playwright pass —
  toggled Street/Garages/Both and confirmed marker counts changed each
  time, clicked a garage marker and confirmed its popup showed the honest
  capacity-not-availability copy, and asked the AI assistant "is there a
  garage near Union Square" and confirmed it returned real garages with a
  GARAGE badge. Zero console errors throughout.
- Filter-awareness fixes: verified via curl that the tool's `facilityType`
  input matches the active map filter under each of street/garage/both,
  and via Playwright that selecting a garage result while filtered to
  "Street" auto-switches to "Both" and correctly highlights the marker.
- Cost/rate feature: verified the point-in-polygon zone query directly via
  curl before writing any app code (Union Square → Midtown, $5.50/hr), then
  confirmed via `/api/parking` that all 177 street spots in a test bbox got
  the rate attached, then a full Playwright pass on the new list panel —
  opened it, confirmed row count and rate display, toggled Distance/Cost
  sort, clicked a row and confirmed it flew/highlighted correctly. Also
  confirmed the AI assistant passes `sortBy: "cost"` when asked for the
  cheapest option. Caught and fixed one real local-dev usability bug along
  the way: the new "List" button's bottom-left position collided with
  Next.js's dev-mode indicator badge, blocking clicks — moved it up.

## Known limitations / natural next steps

- Broader DOT regulation signs (no-standing, alternate-side parking,
  loading zones) still aren't included — only meters and licensed garages
  — since those live in a much larger, harder-to-parse dataset
  (`nfid-uabd`, coordinates in NY State Plane feet, free-text sign codes).
- Street rates come from large zone polygons queried at the viewport's
  center — a viewport straddling two rate zones shows one zone's rate for
  the whole visible area. No rate data exists for garages anywhere free
  (also checked and ruled out: `dotprs.nyc`).
- Garage license data can lag reality (a garage could have closed without
  its DCA license record reflecting it).
- Results capped at 400 street spots / 200 garages per viewport for map
  performance; dense areas (Midtown, Downtown) need zooming in to see
  everything in view.
- `meterHours.ts` handles the common `"NHR Class Day-Day HHMM-HHMM"`
  pattern (chained with `/` and `,`) but not every historical variant in
  the dataset — those fall back to "Unknown" rather than a wrong guess.
- No automated tests were added (none requested); verification was manual
  build/lint/type-check plus browser-driven smoke passes.
- Occupancy reports are anonymous and unmoderated, with no rate-limiting
  beyond the 30-minute TTL — fine for a demo, would need abuse controls
  before being trusted for real decisions.
- The AI assistant has no conversation memory of prior searches beyond
  what `useChat` keeps client-side for the current session, no rate
  limiting on `/api/chat`, and each `findParking` call costs real OpenAI
  tokens — fine for a demo, would need usage limits before wide exposure.
- No observability/error-tracking drains configured on the Vercel project.

## Repository & deployment

- Private GitHub repo: https://github.com/MehanazMI/parkingspots
- Live production: https://parkingspots-one.vercel.app
