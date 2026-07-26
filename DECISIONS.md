# Decision log

Chronological record of non-obvious decisions and the real numbers behind them.
Newest context wins; each entry dated.

## Phase 1a numbers (2026-07-17)

| Metric | Value |
|---|---|
| pmtiles (z6–16) | **13.3 MB** (5,014 tiles, 761k features), valid PMTiles v3 |
| Source extract | `sweden-latest.osm.pbf` = 772 MB |
| Clipped Malmö extract | 6.3 MB (663k nodes, 112k ways, 3.6k relations), clip 2.4s |
| Peak RAM (tiling) | 2.13 GB (`-Xmx4g`) |
| CPU / wall (cached sources) | ~53s CPU / ~18s wall |
| One-time Planetiler sources | ~1.4 GB (water 884 M, natural earth 414 M, lakes 77 M), cached & reused |

---

### D1 — Source is the whole-Sweden extract, clipped with osmium
The spec named `skane-latest.osm.pbf`, which **does not exist** — Geofabrik doesn't
subdivide Sweden (missing regions 302-redirect to the homepage, masquerading as a
9.6 KB "download"). We download `sweden-latest.osm.pbf` (772 MB) and clip to the bbox
with `osmium extract` → 6.3 MB. The user's original "~600 MB extract" instinct was
right; the "skane" filename in the spec was not.

### D2 — Fully offline PWA (reverses the spec's "no offline")
The spec ruled out offline ("far too large… blow the Cache Storage quota, especially
on iOS"). That assumed a large tileset. The real basemap is **13.3 MB**; total offline
payload ≈ 15 MB. **Decision (user-confirmed): build a full offline PWA.** At 13 MB the
basemap can be loaded as a single in-memory ArrayBuffer (pmtiles FileSource), avoiding
Range-request-in-service-worker complexity. Service worker caches the ~15 MB payload.

### D3 — Attribution includes OpenMapTiles
Planetiler's default profile emits the OpenMapTiles schema (CC-BY), which requires a
visible "© OpenMapTiles" credit in addition to "© OpenStreetMap contributors".
**Decision (user chose option a):** attribution string is
`© OpenMapTiles © OpenStreetMap contributors`. (Alternative rejected: a custom bare
profile, which would lose the prepared water/natural-earth layers.)

### D4 — Districts: OSM coverage is complete, so we build from OSM (reversed)
The spec feared OSM sub-municipal coverage for Malmö was thin/stale. **Investigated
2026-07-17 (`scripts/probe-districts.mjs`) — it is not.** OSM has:
- **admin_level 10 = 136 delområden** (complete; matches the city's official count),
- admin_level 9 = 5 stadsområden (coarse), plus ~45 `place=suburb` point names.

**Decision (reversed): build `districts.geojson` from OSM** (`scripts/build-districts.mjs`,
osmium-assembled multipolygons) — both AL9 (coarse) and AL10 (fine), tagged with
`admin_level` so the map can show coarse names at low zoom, fine at higher. 141
polygons, 266 KB. Malmö-stad open data is no longer needed as a fallback.
Consequence: `search.json` **regains** its district tag (point-in-polygon at build
time is viable again). Open design question for Phase 3: which granularity labels at
which zoom (5 stadsområden are unfamiliar; 136 delområden are too many for z11).

### D5 — Toolchain: Homebrew, not Docker
Local Docker is colima and was not running. Went Homebrew: `osmium-tool` 1.19.1 +
`openjdk@21` (keg-only) + `tools/planetiler.jar`. Overlays/search in **Node** (one JS
toolchain; the search-index shape is defined once and consumed directly by the app).

### D6 — Cache-busting via content hash in every filename
Every generated artifact (`malmo-<hash>.pmtiles`, `food-<hash>.geojson`) carries a
content hash so immutable `Cache-Control` is safe even for mid-cycle regenerations.
`manifest.json` (no-cache) maps logical name → current file. Fixes the latent bug in
the spec's month-only `malmo-2026-07.pmtiles` naming.

### D7 — Malmö stad open data vs OSM → keep OSM (RESOLVED 2026-07-26)
Owner suspects Malmö stad's open-data archive may have better **parks, torg (squares),
or area splits** than OSM. Investigation so far:
- **Two portals.** `opendata.malmo.se` is a client-rendered Next.js "Dataplatform.se"
  app (the classic OpenDataSoft `/api/explore/...` path returns HTML, not JSON).
  `malmo.dataplatform.se` refused connection via WebFetch (`ECONNREFUSED 185.170.4.210`).
- **Primärkarta (primary map) is open data** since 2024-03-28 (Geoforum) — the likely
  authoritative source for named parks/squares. EU aggregator entry:
  `https://data.europa.eu/data/datasets/5fcde58b-ca30-4b41-b6c2-9dcca67dd016`
- **Stadsområden dataset** at `https://opendata.malmo.se/@malmo/stadsomraden` is **current,
  not defunct** (CKAN `stadsomraden`, updated 2026-07-01): 5 areas — SÖDER, VÄSTER, ÖSTER,
  INNERSTADEN, NORR — the same 5 as OSM AL9. (Earlier note that it was the 2013–2017 split
  was wrong.)

**How to fetch (working endpoints).** The CKAN host `ckan-malmo.dataplatform.se`
(185.170.4.210) is firewalled — times out from here and via WebFetch. But the API is
mirrored on **`opendata-api.malmo.se`** (reachable), so use that:
- `GET https://opendata-api.malmo.se/api/3/action/package_show?id=delomraden` → resources:
  GPKG (4326/3008) + **TopoJSON 4326** (`.../download/delomraden_epsg4326.json`, quantized).
- `GET .../package_show?id=stadsomraden` → includes a plain **GeoJSON 4326**
  (`.../download/stadsomraden_4326.geojson`). Both **CC0-1.0**.

**Diff done (2026-07-26).** Converted the delområden TopoJSON→GeoJSON and compared to our
OSM `districts.geojson` (centroid + planar area, equirectangular @55.6°N):
- **Delområden: 136 ↔ 136.** 134/136 names match exactly; the other 2 are spelling
  variants only (`SOFIELUNDS INDUSTRIOMR.`↔`…INDUSTRIOMRÅDE`, `MALMÖHUS`↔`MALMÖ HUS`).
- **Geometry ~identical:** median centroid shift **0.7 m**, median area diff **0.11 %**.
  Only real divergences are reclaimed harbour/industrial polygons (Oljehamnen 70 % area /
  373 m, Norra Hamnen 44 % / 341 m, Västra Hamnen, Spillepengen, Limhamns hamnområde) —
  different survey vintages of a changing shoreline, not a different division.
- **Stadsområden: 5 ↔ 5**, identical names.

**Decision: keep OSM `districts.geojson`; do NOT swap in Malmö-stad boundaries.** The two
are the same division (shared lineage — OSM was aligned to the city's split), so swapping
buys nothing and adds a fragile external dependency. Parks/torg were not separately
diffed; revisit only if a concrete gap in `leisure=park`/`place=square` shows up in Phase 3.
The throwaway visual overlay the owner asked for was built and reviewed, then dropped — the
numeric result above is conclusive, so it isn't worth keeping.

---

## Phase 2 data numbers (2026-07-26)

| Artifact | Value |
|---|---|
| `search.json` | **4,529 entries / 539 KB** (target was < 2 MB) |
| — streets | 2,737 · food 1,015 · transit 378 · culture 196 · districts 141 · landmarks 61 · cycling 1 |
| `streets.json` (intermediate) | 2,737 entries / 297 KB, from 8,830 named highway ways |
| `landmarks.geojson` | 61 of 63 resolved / 16 KB (17 Tier-1, 44 Tier-2) |
| Street extraction wall time | ~0.4 s (osmium over the local clip) |

### D8 — The search index is clipped to Malmö kommun (owner's choice)
`search.json` exists because vector tiles cannot answer "where is Bruksvägen" unless you
are already looking at it — MapLibre only holds the tiles in the current viewport, so the
names in `malmo.pmtiles` are unreachable for lookup. The index is the same data reshaped
for search. Street names come from the local `.pbf` via osmium (~0.4 s), **not** Overpass,
which would be a slow rate-limited remote query for data already on disk.

**The bbox has margin beyond the municipality** (Arlöv, Åkarp, Alnarp, Burlöv, Västra
Ingelstad), and those villages reuse common Swedish street names — 155 names spanned
>2 km, e.g. `Bruksvägen` appearing in three separate places. Three options were put to the
owner; **the owner chose to clip to the municipality.** Applied consistently:
- **streets** — 1,070 of 8,830 named ways dropped as outside Malmö;
- **POIs** — a further 89 search entries dropped (55 transit, 23 food, 10 culture), because
  an index that knows half of Arlöv's bus stops but none of its streets is worse than one
  that knows neither;
- **landmarks are exempt** — they are hand-curated, and several legitimately sit offshore
  in no delområde (Öresundsbron, Ribersborgs Kallbadhus on its pier).

The clip is free: the 136 AL10 delområden tile the municipality exactly, so the same
point-in-polygon that assigns a district also decides what is in Malmö. **Consequence the
owner accepted:** those areas still *render* on the map but cannot be searched.

Duplicates survive *within* the kommun (Oxie and Klagshamn are both Malmö), so names are
still split into spatial clusters — >500 m gap means a distinct street — and disambiguated
by district. That yielded 10 genuine splits, all verified as real (`Trelleborgsvägen` in
Lindeborg vs Tygelsjö by, `Ängavägen` in Oxie Kyrkby vs Klagshamn, …).

**Street rank is the dominant class by length, not the most prominent class.** The first
implementation took the minimum rank across a name's ways, which made `Annetorpsvägen`
(46 secondary ways + 13 primary + one motorway_link slip road) rank as a motorway, and
left rank 2 empty because its primary ways were absorbed. Weighting by metres of road
fixes it.

### D9 — Landmarks: Nominatim resolves, a human verifies, nothing is faked
`landmarks/landmarks.json` is the hand-edited source of truth; `build-landmarks.mjs
--resolve` fills only *missing* coordinates and never rewrites an existing entry.
Every resolved coordinate is written back as `"verified": false` and reported until a
human confirms it. Unresolvable entries are emitted **without geometry** rather than with
a plausible-looking wrong point, and `search.json` skips them.

Nominatim is queried at 1 req/s with a descriptive User-Agent (policy) and `bounded=1`
against the bbox — without it, `Stortorget` cheerfully matches Stockholm. Responses are
cached to `data/cache/nominatim/`. **This is build-time only**; the spec forbids
third-party requests at runtime.

61 of 63 resolved. The 8 initial failures were fixed by correcting the *query* rather than
the display name (`Malmö moské` → queries `Malmö Islamic Center`; `Caroli City` → renamed
to its actual OSM name `Kv. Caroli`), determined by grepping the shipped extract for what
OSM really calls them. **2 remain unresolved** — `Klagshamns udde` and `Toftanäs
våtmarkspark` are real places that simply are not *named* features in OSM.

Coordinates were cross-checked against the local extract by name: only 3 sit >200 m from
their OSM namesake, all large-extent features (Ribersborgsstranden 292 m, Bulltofta 357 m,
Malmö universitet 457 m) where a centroid and a chosen point differ legitimately.

**Caveat for the owner:** this list was seeded from general Malmö knowledge, *not* from the
~17+~50 the owner listed in an earlier chat — that context was lost. It needs review.

### D10 — Phase 1c (atomic deploy + cache-busting) skipped
**Owner's instruction, 2026-07-26.** The content-hash/manifest design in D6 stands if it is
ever revived, but no deploy tooling, nginx config or crontab was written.

