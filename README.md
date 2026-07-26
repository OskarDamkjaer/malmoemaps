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
- **Offline PWA.** The whole payload is 17.6 MB (basemap 13.3 MB), so the service
  worker just caches all of it.
- **Attribution, always visible:** `© OpenMapTiles © OpenStreetMap contributors`
  (OSM part links to openstreetmap.org/copyright).

## The map

- **Basemap** — MapLibre GL JS + PMTiles, OpenMapTiles schema, z6–16, own style
  JSON (carved from OSM Liberty, not written from scratch; glyphs + sprite
  self-hosted). The archive is downloaded whole on first load and read from
  memory, so panning never touches the network.
- **Zoom-dependent labelling** (the core): the widest view is coastline/Öresund
  + "Malmö" + the five stadsområden; then delområde names + major roads + canal
  ring; then streets, buildings and landmark icons; z15–16 everything. The
  ladder lives in `scripts/build-style.mjs`, one entry per change with a reason.
  Note the extract is only ~22 km wide, so the whole-city view is z10–11 — the
  tileset's z6–9 exist but can't be reached without leaving Malmö behind.
- **Districts** — 141 OSM admin polygons (5 stadsområden + 136 delområden), plus
  the OSM `place=suburb` names the division lacks (Slottsstaden, Limhamn,
  Kirseberg…), deduplicated against them.
- **Selection** — tapping anything named gives its name, what kind of thing it
  is, and its shape: a street lit end to end, an area outlined, an icon ringed.
  Basemap pictograms answer too, so an unfamiliar icon can be identified.
- **Overlays** — food, culture, cycling, transit (train stations only);
  toggleable, off by default.
- **Landmarks** — hand-curated two-tier list (`landmarks/landmarks.json`, 63
  entries, 61 with coordinates), 12 hand-drawn SVG icons for Tier 1, sprite
  icons for Tier 2. Tapping one shows its name, district and one line of text.
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
scripts/    build pipeline + dev server
app/        the app itself (vendor/, glyphs/, sprite/, icons/*.png gitignored)
tools/      planetiler.jar (fetched pinned, gitignored)
data/       cache/ + sources/ (gitignored)
build/      generated artifacts: style.json, data/, site/ (gitignored)
landmarks/  hand-curated landmark list + SVG icons
```

The app is five files — `index.html`, `app.css`, `app.js` (map, chrome, boot),
`layers.js` (districts, landmarks, overlays), `search.js` — plus `sw.js`. No
framework, no bundler, no `node_modules`: the browser loads the ES modules as
written.

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

## Building and running the app

```
node scripts/fetch-app-assets.mjs   # maplibre + pmtiles + glyphs + sprite → app/ (pinned)
node scripts/build-icons.mjs        # home-screen PNGs → app/icons/
node scripts/build-style.mjs        # OSM Liberty (pinned commit) → build/style.json
node scripts/serve.mjs              # http://127.0.0.1:8080, with Range support
```

The dev server stitches `app/`, `build/`, `landmarks/icons/` and the pmtiles
into one URL layout (`scripts/lib/site.mjs`), which is the same layout the
deployed site has. `window.map` is exposed for tuning zoom thresholds from the
console.

## Hosting

```
node scripts/build-site.mjs         # → build/site (17.6 MB, 51 files) — upload as-is
```

Any static host over HTTPS (geolocation and service workers need it). The only
requirement beyond "serves files": HTTP **Range** support for `.pmtiles`. Same
origin as the app, so no CORS.

Cache headers don't matter much: the service worker precaches everything on
first load and only re-fetches when the cache names in `app/sw.js` change (code
and data are versioned separately, so an app edit doesn't re-download 13 MB).

Rationale for non-obvious choices lives in [DECISIONS.md](DECISIONS.md) — it gets
a dated bullet only when something non-obvious was actually decided.
