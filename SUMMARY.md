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
    ChatPanel.tsx                Slide-over AI chat: useChat, renders
                                 tool-findParking results as spot cards
    api/
      report/route.ts           POST { spotId, status } -> writes a 30-min
                                 TTL occupancy report to Redis
      chat/route.ts               POST -> createAgentUIStreamResponse(parkingAgent)
  lib/
    types.ts                   Shared types: ParkingSpot, MeterStatus,
                                OccupancyReport, BoundingBox
    meterHours.ts               Free-text meter-hours parser + status evaluator
    nycOpenData.ts               Fetches + normalizes NYC Open Data records
    redis.ts                     Lazy Upstash Redis client (null if unconfigured)
    occupancy.ts                  Report key/TTL, parsing, attachOccupancy()
    geocode.ts                     Shared Nominatim geocode() — used by
                                   /api/geocode and the AI tool
    tools/
      find-parking-tool.ts          AI tool: geocode + fetchParkingSpots +
                                    attachOccupancy + duration filter + rank
    agents/
      parking-agent.ts               ToolLoopAgent (gpt-5.4-mini), grounding
                                     instructions, InferAgentUIMessage export
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
