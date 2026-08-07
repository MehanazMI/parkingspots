# Research: NYC Garage/Lot Parking Data (for Suggestion #3)

Goal: find a free, queryable data source for off-street parking (garages and
lots) to add alongside the existing on-street meter data, as the "most
promising path to real availability data without a paid vendor" per
[SUGGESTIONS.md](SUGGESTIONS.md). This documents what was actually found —
including the dead ends — before any implementation.

## Bottom line

**No live occupancy data exists for NYC garages/lots in free, public form
either.** Same fundamental limitation as on-street parking. What free data
*does* exist is a static business registry: garage/lot locations with a
posted vehicle capacity, no rates, no live counts. This still lets us build
a meaningfully different, more useful garage layer than street parking (a
known, fixed capacity is more informative than "legal but occupancy
unknown"), but it does **not** deliver "how many spaces are open right now"
for garages any more than it does for meters — that continues to require a
paid provider (SUGGESTIONS.md option #4).

## Datasets evaluated

| Dataset | ID | Rows | Verdict |
|---|---|---|---|
| **Parking Garage List** (DCA) | `5bhr-pjxt` | 2,704 (1,695 with a non-expired license as of today) | **Usable.** See below. |
| Active DCA-Licensed Garages and Parking Lots | `a7m8-iids` | 69,885 | **Not usable as-is.** Despite the name, sample rows include businesses with no relation to parking (e.g. a diamond corp, a sewing machine company). This looks like a broader DCA license category than just garages, and needs a filter we haven't identified — don't trust the title. |
| Municipal Parking Facilities (Manhattan/Brooklyn/Bronx/Queens/Staten Island) | `i8d5-5ciu` + 4 borough siblings | N/A | **Dead.** Socrata catalog reports `type: "href"`, `backend: "not_a_dataset"` — these are placeholder links to an RSS feed from 2011 that no longer resolves to a queryable API. |
| Parking Lots (DPR) | `e2f7-cs7i` | N/A | **Wrong domain.** This is Parks Department lots (parking for park visitors), and the resource returned empty rows when queried directly — likely GIS-only, not a clean JSON API. |
| Carshare Locations – Municipal Garages and Lots | `j4y5-w7iq` | small | **Wrong purpose.** Real, queryable data, but it's specifically about carshare-reserved spaces (Zipcar, etc.) inside municipal lots — gives a `cs_spaces_` count for carshare only, not general public capacity. |

## The usable one: Parking Garage List (`5bhr-pjxt`)

Sample record:
```json
{
  "license_nbr": "0365792-DCA",
  "license_type": "Premises",
  "lic_expir_dd": "2027-03-31T00:00:00.000",
  "business_name": "CARMEL GARAGE, INC.",
  "address_building": "6861",
  "address_street_name": "YELLOWSTONE BOULEVARD",
  "address_borough": "Queens",
  "address_zip": "11375",
  "latitude": "40.724968...",
  "longitude": "-73.847310...",
  "detail": "Vehicle Capacity: 80; Bicycle Capacity: 8"
}
```

- `license_type` is uniformly `"Premises"` across all 2,704 rows — a clean,
  single-purpose dataset (unlike `a7m8-iids`).
- `detail` follows a consistent `"Vehicle Capacity: N; Bicycle Capacity: N"`
  format in 2,634 of 2,704 rows (97%) — reliably regex-parseable.
- Has real lat/long, business name, and full street address — enough to
  place on the map and show in a popup.
- `lic_expir_dd` lets us filter to currently-active licenses
  (`lic_expir_dd > now`) — 1,695 of 2,704 pass that filter as of
  2026-08-07. The other ~37% are presumably lapsed/inactive and should be
  excluded, though a lapsed license doesn't necessarily mean the garage
  physically closed (DCA registries lag reality somewhat) — worth stating
  as a caveat in the UI, similar to how meter data is caveated.
- **No rate/price field.** This means the follow-up cost-sorting work will
  need a rate source for garages too — this dataset alone doesn't solve
  that half of the problem.
- **No capacity-remaining / occupancy field.** `Vehicle Capacity` is total
  capacity, a static number, not how many are currently free.

## What this means for implementation

1. Garages get their own `facilityType: "garage"` entries with: name,
   address, lat/long, total vehicle capacity (parsed from `detail`), and a
   clear "capacity ≠ availability" caveat — consistent with how meter data
   is already caveated in this app.
2. **No cost data for garages either.** The earlier plan ("do #3, then cost
   sorting, since garages naturally carry pricing") turns out to be wrong —
   this free dataset has no rates. Cost-sorting will need its own follow-up
   research into a rate source (the NYC meter rate-zone dataset covers
   on-street only; garage rates aren't in DCA's registry and would likely
   need scraping garage operators' own listings or a paid aggregator).
3. Filter to non-expired licenses (`lic_expir_dd > now`) to reduce stale
   entries, and disclose in the UI that licensing data can lag real-world
   status.
4. The `a7m8-iids` dataset should **not** be used without further
   investigation — the row count and sample content don't match its title,
   and using it as-is would likely surface non-garage businesses as if they
   were parking facilities.

## Open question for a future pass

NYC DOT operates ~41 of its own municipal garages/lots (reported ~7,983
total spaces) with a live consumer-facing reservation site,
[dotprs.nyc](https://dotprs.nyc) — since users can reserve and pay through
it, it plausibly has real capacity/rate data behind it. Whether it exposes
anything publicly queryable (a documented API, a public data export) is
**unverified** — this research didn't find one and didn't attempt to
reverse-engineer the site. Worth a targeted look if garage rate data becomes
a priority.
