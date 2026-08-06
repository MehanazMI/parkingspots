# NYC Parking Finder

Find on-street metered parking in New York City and see whether each spot is
**free** or **metered right now**, based on the posted meter hours.

## What this is (and isn't)

NYC does not publish a free, public feed of real-time parking occupancy —
the city's old sensor-based systems (and SFpark-style approaches elsewhere)
were discontinued years ago, and true live occupancy today is only available
through paid private providers (e.g. Parknav, SpotHero).

Instead, this app uses [NYC Open Data's Parking Meters Locations and
Status](https://data.cityofnewyork.us/Transportation/Parking-Meters-Locations-and-Status/693u-uax6)
dataset, which gives the real location of every active parking meter plus its
posted regulation text (e.g. `"2HR Pas Mon-Sat 0900-1900"`). The app parses
that text and computes, for the current moment in New York time, whether the
meter is:

- 🟢 **Free** — no metered restriction in effect right now
- 🔴 **Metered** — paid, time-limited parking in effect right now
- ⚪ **Unknown** — the posted text didn't match a known pattern (shown as
  gray in the popup detail; check the physical sign)

This tells you **where parking is legal and what it costs**, not whether a
specific space is currently occupied by a car. It also does not account for
alternate-side parking, no-standing zones, construction closures, or other
DOT regulations beyond meter hours — those live in a much larger, harder to
parse dataset and are a natural next step.

## Stack

- **Next.js 16** (App Router, TypeScript, Turbopack)
- **Tailwind CSS 4**
- **Leaflet / react-leaflet** with OpenStreetMap tiles (no API key required)
- **NYC Open Data** (Socrata) for parking meter locations + regulation text
- **Nominatim (OpenStreetMap)** for address geocoding, proxied through a
  server route
- Deploys to **Vercel**

No database — both data sources are queried live through Next.js API routes
(`/api/parking`, `/api/geocode`) that act as thin, cached proxies.

## Running locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. The map loads centered on Union Square and
fetches meters in the visible viewport; pan/zoom or search an address to
load a different area (auto-refreshes ~500ms after you stop moving the map).

### Optional: NYC Open Data app token

The Socrata API works unauthenticated but is rate-limited. For heavier use,
get a free app token at https://data.cityofnewyork.us/profile/app_tokens and
set it as an env var:

```bash
# .env.local
NYC_OPEN_DATA_APP_TOKEN=your_token_here
```

## Deploying to Vercel

```bash
vercel
```

No environment variables are required for a basic deploy; add
`NYC_OPEN_DATA_APP_TOKEN` in the Vercel project settings if you have one.

## Known limitations / next steps

- Meter-hours text parsing covers the common patterns (`"NHR Class Day-Day
  HHMM-HHMM"`, optionally chained with `/` and `,`) but not every historical
  format in the dataset — unparseable entries are labeled "Unknown" rather
  than guessed.
- Only on-street metered spots are shown; municipal lots/garages and
  regulation signs (no-standing, alternate-side, loading zones) aren't
  included yet.
- Results are capped at 400 spots per viewport to keep the map responsive —
  zoom in on dense areas (Midtown, Downtown) to see everything.
