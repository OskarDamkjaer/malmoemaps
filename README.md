# malmoemaps

My personal map of Malmö. A static, self-hosted, mobile-first **reference map** —
vector tiles from my own origin, always north-up, installable and fully offline.
An orientation tool, **not** navigation: no routing, no directions, ever.

## Principles

- **Static frontend.** A folder of files on a static host. No backend, no database,
  no accounts. The only moving part is the build pipeline, run when I feel like it.
- **Nothing leaves the device.** No analytics, cookies, or third-party requests at
  runtime. Geolocation stays in the browser.
- **No external tile or API calls at runtime.** Everything served from my origin.
- **Always north-up.** Rotation and pitch disabled — a fixed orientation builds a
  stable mental map.
- **Offline PWA.** The whole payload is ~15 MB (basemap 13.3 MB), so the service
  worker just caches all of it.
- **Attribution, always visible:** `© OpenMapTiles © OpenStreetMap contributors`
  (OSM part links to openstreetmap.org/copyright).

## The map

- **Basemap** — MapLibre GL JS + PMTiles, OpenMapTiles schema, z6–16, own style
  JSON (carved from an open style, not written from scratch).
- **Zoom-dependent labelling** (the core): low zoom is coastline/Öresund/bridge +
  "Malmö"; then district names + major roads + canal ring; then major streets +
  landmark icons; z15–16 everything. Thresholds tuned with the map visible.
- **Districts** — 141 OSM admin polygons (5 stadsområden + 136 delområden).
- **Overlays** — food, culture, cycling, transit (train stations only);
  toggleable, off by default.
- **Landmarks** — hand-curated two-tier list (`landmarks/landmarks.json`, 63
  entries), drawn icons for Tier 1, generic for Tier 2.
- **Search** — client-side fuzzy match over streets, POIs, districts, landmarks
  (`search.json`, 4,168 entries / 496 KB), each tagged with its district.
  Selecting pans + drops a pin, nothing more.
- **Location** — locate button, accuracy circle, heading cone (map never rotates).

**Bounding box** (`config/bbox.json`): W 12.80 / S 55.49 / E 13.16 / N 55.66 —
coast + bridge landfall to Husie, Arlöv to Klagshamn. Search is clipped to Malmö
kommun; the map renders the margin but won't find it.

## Layout

```
config/     bbox + zoom range
scripts/    build pipeline
tools/      planetiler.jar (fetched pinned, gitignored)
data/       cache/ + sources/ (gitignored)
build/      generated artifacts (gitignored)
landmarks/  hand-curated landmark list + SVG icons
```

## Building the data

Prereqs (macOS): `brew install osmium-tool openjdk@21`; Node ≥ 20.
`export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"` for Java.

```
scripts/build-basemap.sh            # Sweden pbf → clip → data/cache/malmo.pmtiles (13.3 MB)
node scripts/build-overlays.mjs     # Overpass → build/data/{food,culture,cycling,transit}.geojson
node scripts/build-districts.mjs    # OSM boundaries → build/data/districts.geojson
node scripts/build-streets.mjs      # pbf → data/cache/streets.json (search intermediate)
node scripts/build-landmarks.mjs    # landmarks.json → build/data/landmarks.geojson (--resolve fills coords)
node scripts/build-search.mjs       # everything above → build/data/search.json
```

Downloads are cached under `data/` (Sweden extract reused < 30 days, Planetiler
sources, raw Overpass/Nominatim responses), so re-runs are fast and offline.
`--refresh` on the Node scripts re-hits the remote APIs.

## Hosting

Any static host over HTTPS (geolocation needs it). The only requirement beyond
"serves files": HTTP **Range** support for `.pmtiles`. Same origin as the app,
so no CORS.

Rationale for non-obvious choices lives in [DECISIONS.md](DECISIONS.md) — it gets
a dated bullet only when something non-obvious was actually decided.
