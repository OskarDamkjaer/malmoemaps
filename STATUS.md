# STATUS — read this first to continue

Snapshot for picking up in a clean context. See `SPEC.md` (app definition) and
`DECISIONS.md` (decisions + real numbers) for the why.

_Last updated: 2026-07-17._

## Where we are: Phase 1 (pipeline) + Phase 2 (data), mid-flight

### Done ✅
- **1a basemap** — `scripts/build-basemap.sh`: download Sweden (772 MB) → osmium clip
  to bbox → Planetiler z6–16 → **`data/cache/malmo.pmtiles` = 13.3 MB**. Verified.
- **1b overlays** — `scripts/build-overlays.mjs` (+ `scripts/lib/overpass.mjs`, a cached
  rate-limited Overpass client). Outputs to `build/data/`:
  - food 1,063 / 177 KB · culture 272 / 45 KB · transit 2,071 / 326 KB · cycling 3,006 / 1.3 MB
- **districts** — `scripts/build-districts.mjs`: OSM AL9 (5 stadsområden) + AL10
  (136 delområden) → `build/data/districts.geojson` = 141 polygons, 266 KB.
  Coverage verified complete via `scripts/probe-districts.mjs` (reversed D4).
- **Docs + initial commits.** Two commits on `main` (`9072005`, `8469350`).

### In progress 🔄
- **Comparing Malmö stad open data vs OSM** (parks/squares/area-splits). Findings so far
  in DECISIONS.md **D7**. NOT finished — next action is to pull real distribution URLs
  and diff against OSM. Nothing committed for this yet.

### Not started ⬜ (remaining Phase 1/2)
1. **Malmö stad open-data comparison** — finish D7 (see its "next step").
2. **Street-name extraction** — osmium over the clip, dedup per name + representative
   centroid, for `search.json` (NOT via Overpass — too slow for every highway).
3. **`search.json`** — POIs from overlays + street names + district + landmark names;
   resolve "which district" by point-in-polygon **at build time** (now viable since
   districts exist). Target < ~2 MB.
4. **`landmarks.geojson` seed + Nominatim resolver** — the ~17 Tier-1 + ~50 Tier-2 the
   owner listed (in chat). Seed with null coords + documented schema; resolver fills
   lat/lon from Nominatim (1 req/s, cached, surfaced for hand-verification). Owner
   verifies/edits by hand. Schema: name, lat, lon, icon (id), min_zoom, tier, description.
5. **Phase 1c deploy** — content-hash filenames (`malmo-<hash>.pmtiles`,
   `food-<hash>.geojson`), `manifest.json` (no-cache) mapping logical→current file,
   long immutable Cache-Control, build-to-temp + atomic `mv`, keep-1-previous rollback,
   fail-loud-no-half-deploy. Plus the nginx block (Range support, cache headers) and
   crontab lines with RAM/disk/wall-time costs.

**Then STOP** — do not start Phase 3 (the app) until the owner has reviewed the data.

## How to run (dev, macOS)
- Java: `export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"` (keg-only openjdk@21).
- Tools present: `osmium` 1.19.1, `openjdk@21`, `tools/planetiler.jar` (89 MB, gitignored).
  Docker is colima and was NOT running — we use Homebrew, not Docker.
- Cached data (gitignored, already on disk): `data/cache/sweden-latest.osm.pbf` (772 MB),
  `data/cache/malmo.osm.pbf` (6.3 MB clip), `data/cache/malmo.pmtiles` (13.3 MB),
  `data/sources/` (~1.4 GB Planetiler sources), `data/cache/overpass/` (raw responses).
  So overlay/district re-runs are instant (cache hits); no need to re-download.
- Build: `scripts/build-basemap.sh` · `node scripts/build-overlays.mjs` ·
  `node scripts/build-districts.mjs`. Add `--refresh` to overlays to re-hit Overpass.

## Open design questions (Phase 3, not blocking)
- **District label granularity**: 5 stadsområden too coarse, 136 delområden too many at
  z11. Leaning: hand-pick ~15–20 "major" delområden large at z11–12, rest at z13–14,
  drop stadsområden. Tune with the map visible.
- **Landmark min_zoom**: owner wants Tier-1 at z11, but spec's z11–12 is "district names,
  almost nothing else." Suggest only Turning Torso + Öresundsbron at z11, rest z12–13.

## Environment gotchas
- Geofabrik has **no Skåne extract** — missing regions 302 to the homepage (looks like a
  9.6 KB "success"). Use whole Sweden + clip. (D1)
- `.gitignore` inline comments are NOT supported — nearly committed the 772 MB pbf. Fixed.
