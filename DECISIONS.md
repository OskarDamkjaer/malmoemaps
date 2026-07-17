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
