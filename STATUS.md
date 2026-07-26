# STATUS — read this first to continue

Snapshot for picking up in a clean context. See `SPEC.md` (app definition) and
`DECISIONS.md` (decisions + real numbers) for the why.

_Last updated: 2026-07-26._

## Where we are: Phase 2 data is COMPLETE — awaiting owner review

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
- **Malmö stad vs OSM district comparison — DONE, D7 resolved (2026-07-26).** Pulled the
  official delområden + stadsområden (CC0) from `opendata-api.malmo.se` and diffed against
  our OSM `districts.geojson`: 136↔136 delområden (all names match, 2 spelling variants),
  5↔5 stadsområden, median centroid shift 0.7 m, median area diff 0.11 %. Only the reclaimed
  harbours differ. **Decision: keep OSM districts, do not swap.** See DECISIONS.md D7.
  (Throwaway visual overlay was built + reviewed, then dropped — numbers were conclusive.)

- **street names (2026-07-26)** — `scripts/build-streets.mjs`: osmium over the clip,
  clipped to Malmö kommun, clustered per name → `data/cache/streets.json` = **2,737
  entries**, 297 KB. Intermediate (feeds search), so it lives in `data/cache/`, not
  `build/data/`. See D8.
- **`search.json` (2026-07-26)** — `scripts/build-search.mjs`: **4,529 entries, 539 KB**
  (well under the 2 MB target). streets 2,737 · food 1,015 · transit 378 · culture 196 ·
  districts 141 · landmarks 61 · cycling 1. District resolved by point-in-polygon at
  build time. See D8.
- **`landmarks.geojson` (2026-07-26)** — `landmarks/landmarks.json` (hand-edited source
  of truth, 63 entries: 17 Tier-1 + 46 Tier-2) + `scripts/build-landmarks.mjs --resolve`
  (Nominatim, 1 req/s, disk-cached). 61 resolved → `build/data/landmarks.geojson`, 16 KB.
  See D9.

### Needs the owner ⬜
1. **Verify the 61 landmark coordinates.** All are `"verified": false` in
   `landmarks/landmarks.json`. Check each on the map, fix any that are off, set
   `"verified": true`. Cross-checking against the local OSM extract already found only
   3 outliers >200 m, all large-extent features (Ribersborgsstranden, Bulltofta,
   Malmö universitet) where a centroid and Nominatim's point differ legitimately.
2. **Review the landmark list itself.** It was seeded from general Malmö knowledge, not
   from the list the owner gave in an earlier chat (that context was lost). Add/remove
   freely — the file is the source of truth and the resolver never rewrites entries.
3. **2 unresolved landmarks:** `Klagshamns udde` and `Toftanäs våtmarkspark` — both real
   places, but neither is a *named* feature in OSM, so Nominatim finds nothing in the
   bbox. Either hand-enter coords or drop them.

**Then STOP** — do not start Phase 3 (the app) until the owner has reviewed the data.

### Dropped ✂️
- **Phase 1c deploy** (content-hash filenames, `manifest.json`, atomic `mv`, nginx block,
  crontab) — **skipped at the owner's instruction, 2026-07-26.** D6 still records the
  cache-busting design if it is ever revived.

## How to run (dev, macOS)
- Java: `export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"` (keg-only openjdk@21).
- Tools present: `osmium` 1.19.1, `openjdk@21`, `tools/planetiler.jar` (89 MB, gitignored).
  Docker is colima and was NOT running — we use Homebrew, not Docker.
- Cached data (gitignored, already on disk): `data/cache/sweden-latest.osm.pbf` (772 MB),
  `data/cache/malmo.osm.pbf` (6.3 MB clip), `data/cache/malmo.pmtiles` (13.3 MB),
  `data/sources/` (~1.4 GB Planetiler sources), `data/cache/overpass/` (raw responses).
  So overlay/district re-runs are instant (cache hits); no need to re-download.
- Build, in dependency order:
  ```
  scripts/build-basemap.sh                     # 1a, monthly
  node scripts/build-overlays.mjs              # 1b  (--refresh to re-hit Overpass)
  node scripts/build-districts.mjs             # districts.geojson
  node scripts/build-streets.mjs               # needs districts (clips + tags)
  node scripts/build-landmarks.mjs [--resolve] # --resolve hits Nominatim
  node scripts/build-search.mjs                # needs all of the above
  ```
  `build-search.mjs` degrades gracefully if `landmarks.geojson` is absent.

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
