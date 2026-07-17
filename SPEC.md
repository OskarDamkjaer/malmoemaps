# Malmö Map — app definition

A static, self-hosted, mobile-first map of Malmö rendered from self-hosted vector
tiles. It is a **reference and orientation tool, not a navigation tool.** There is
deliberately **no routing, no turn-by-turn, no directions**. Do not add one.

## Hard constraints

- **Static frontend.** No backend, no database, no accounts, no SSR. The app is a
  folder of files served by nginx. The only server-side thing is a cron job that
  regenerates data.
- **No user data leaves the device.** No analytics, telemetry, cookies, or
  third-party requests at runtime. Geolocation is browser-only, never transmitted.
- **No external tile or API calls at runtime.** Everything is served from our own origin.
- **Always north-up.** Rotation and pitch disabled in MapLibre (`dragRotate`,
  `touchZoomRotate` rotation, `pitchWithRotate`). Fixed orientation builds a stable
  mental map. No compass-reset button — there is nothing to reset.
- **Attribution mandatory & persistent:** `© OpenMapTiles © OpenStreetMap contributors`,
  the OSM part linking to openstreetmap.org/copyright. (OpenMapTiles credit is required
  by the CC-BY schema Planetiler emits; ODbL requires the OSM credit.)
- **HTTPS** (geolocation requires it).
- **Fully offline PWA.** The whole payload (~15 MB) is cached for offline use. See
  DECISIONS.md D2 — this reverses the original "no offline" line because the basemap
  turned out to be only 13.3 MB.

## Bounding box

Malmö with margin (`config/bbox.json`): W 12.80 / S 55.49 / E 13.16 / N 55.66 —
Öresund coast + bridge landfall (W), Husie/Bulltofta (E), Arlöv (N), Klagshamn/
Bunkeflo (S). Zoom z6–z16.

## Phase 1 — build pipeline (runs on the server via cron)

- **1a. Basemap tiles — monthly.** Download `sweden-latest.osm.pbf` (772 MB; there is
  no Skåne extract), clip to the bbox with osmium, generate one `.pmtiles` with
  Planetiler (OpenMapTiles schema), z6–16. Result: **13.3 MB**.
- **1b. Overlays + search — weekly.** Node script queries Overpass, writes baked
  minimal GeoJSON. Idempotent, rate-limited, caches raw responses locally. Street
  names extracted from the `.pbf` with osmium (not Overpass).
- **1c. Atomic deploy & cache-busting.** Every artifact gets a content hash/timestamp
  in its filename. A `manifest.json` (no-cache) lists current filenames; the app reads
  it at boot and loads whatever it points at. Artifacts get long immutable
  `Cache-Control`. Build to temp, `mv` into place (atomic). Keep previous version
  (cheap rollback), delete the one before. A failed cron run leaves the served version
  untouched and fails loudly to a log.

## Phase 2 — the data

Overlays, one minimal GeoJSON each (`name`, `osm_id`, source tag, nothing else):

- **food** — amenity in {restaurant, fast_food, cafe, bar, pub, ice_cream}; keep raw
  amenity for sub-filtering.
- **culture** — tourism museum/artwork/gallery, amenity theatre/arts_centre, historic=*, memorial=*.
- **cycling** — route=bicycle relations + highway=cycleway ways; `kind` distinguishes
  named official route from generic cycleway (lines, not points).
- **transit** — bus_stop, PT platform, railway station, tram_stop; keep name.
- **districts** — Malmö stadsdelar/delområden polygons. **Deferred** — OSM coverage
  suspect; see DECISIONS.md D4. Fallback: Malmö stad open data.

- **landmarks.geojson** — hand-curated (not queryable). Schema: `name`, `lat`, `lon`,
  `icon` (id), `min_zoom`, short description, `tier`. ~17 Tier-1 (drawn icons) +
  ~50 Tier-2 (generic icons). Seed scaffolded; owner fills/verifies lat/lon.
- **search.json** — named POIs from overlays + all street names (from the pbf) +
  district + landmark names. Each: display name, category, lat/lon, and the district
  it falls in (point-in-polygon **at build time**). Target < ~2 MB. District tag is
  omitted while districts are deferred (won't fake it).

## Phase 3 — the app

- **MapLibre GL JS** + PMTiles protocol plugin. Vanilla JS, light tooling. Style JSON
  written against the OpenMapTiles schema (no hosted style URL).
- **Zoom-dependent labelling** (the core; thresholds in one config file, expect tuning):
  z6–10 coastline/Öresund/bridge + Malmö label; z11–12 district names large + major
  roads/rail + canal ring; z13–14 major street names + landmark icons only; z15–16
  full streets + buildings + address detail.
- **Landmark icons** — SVG sprites, one per id, geometric placeholders shipped and
  trivially swappable. Appear from z13 (Tier-1 configurable earlier); more prominent
  than any overlay pin.
- **Overlays** — toggleable, off by default, one control, multiple at once. Cluster
  food & transit at low zoom. Toggle state in memory only.
- **Location** — locate button + `watchPosition`, position + accuracy circle, heading
  cone from device orientation (the map doesn't rotate, so the cone shows facing).
  Handle denial with a plain message; no nagging.
- **Search** — client-side fuzzy match against `search.json`; results show name,
  category, district; selecting pans + drops a pin. No route line, no directions, no
  bearing, no distance.
- **PWA** — installable; standalone, portrait-first, icons, theme colour. Fully
  offline (see D2). Minimal service worker caching the ~15 MB payload.
- **Design** — mobile-first, thumb-reachable, dark & light both usable, restrained.

## Server

- nginx serves `.pmtiles` with HTTP Range support + long immutable `Cache-Control`;
  `manifest.json` gets no-cache. Same origin as app (no CORS). Crontab + resource
  costs documented at ship.
