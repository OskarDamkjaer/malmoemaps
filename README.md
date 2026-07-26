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
- **Offline PWA.** The whole payload is 17.8 MB (basemap 13.3 MB), so the service
  worker just caches all of it.
- **Attribution, always visible:** `© OpenMapTiles © OpenStreetMap contributors`
  (OSM part links to openstreetmap.org/copyright), plus a credit for Malmö
  stad's stadsdelar — CC0, so given because it is theirs, not because it is owed.

## The map

- **Basemap** — MapLibre GL JS + PMTiles, OpenMapTiles schema, z6–16, own style
  JSON (carved from OSM Liberty, not written from scratch; glyphs + sprite
  self-hosted). The archive is downloaded whole on first load and read from
  memory, so panning never touches the network.
- **Zoom-dependent labelling** (the core): the widest view is coastline/Öresund
  and "Malmö"; then the canal ring and major roads; then streets, buildings and
  landmark icons; z15–16 everything. The ladder lives in
  `scripts/build-style.mjs`, one entry per change with a reason. Note the
  extract is only ~22 km wide, so the whole-city view is z10–11 — the tileset's
  z6–9 exist but can't be reached without leaving Malmö behind.
- **Areas, one level at a time** — zooming steps through the hierarchy instead
  of blending it. Four levels, each with its own names *and* its own outline,
  each handing over in a hard cut so no two are ever on screen together:

  | | zoom | what you see | outline from |
  |---|---|---|---|
  | 1 | < 11 | **Malmö** | the ten stadsdelar, dissolved |
  | 2 | 11 – 12.3 | the ten **stadsdelar** — Västra Innerstaden, Limhamn-Bunkeflo, Rosengård… | Malmö stad, CC0 |
  | 3 | 12.3 – 13.4 | the 14 names **in between** — Slottsstaden, Sorgenfri, Limhamn, Hamnen… | their delområden, dissolved |
  | 4 | ≥ 13.4 | all 136 **delområden** — Västra Sorgenfri, Rönneholm, Ribersborg… | OSM admin boundaries |

  The ladder lives in `app/area-levels.mjs` and nowhere else; `app/layers.js`
  draws from it and `scripts/build-style.mjs` imports its top rung to cap the
  basemap's own "Malmö" label. `test/` holds it to all of the above.

  **Level 3 has holes, on purpose.** Only 14 of these in-between names exist
  (`areas/areas.json`, hand-written with a source each), and most of Malmö
  simply has no word between "Västra Innerstaden" and "Rönneholm". An earlier
  version filled the gaps with the delområden nobody had grouped, which put 93
  names on two levels at once — the one thing the ladder exists to prevent.

  Each level says how it sits in the others: a stadsdel lists the delområden it
  covers, a delområde says which stadsdel it is in, a level-3 name lists what it
  is made of. The 5 stadsområden are kept in the data and in search but not
  drawn, and the parts below level 4 (Fullriggaren, Dockan, Seved) are built and
  searchable but not drawn either — names finer than a delområde, with no
  boundary to sit in.
- **Selection** — tapping anything named gives its name, what kind of thing it
  is, and its shape: a street lit end to end, an area outlined, an icon ringed.
  Basemap pictograms answer too, so an unfamiliar icon can be identified.
- **Overlays** — food, culture, cycling, transit (train stations only);
  toggleable, off by default.
- **Landmarks** — hand-curated two-tier list (`landmarks/landmarks.json`, 63
  entries, 61 with coordinates), 12 hand-drawn SVG icons for Tier 1, sprite
  icons for Tier 2. Tapping one shows its name, district and one line of text.
- **Search** — client-side fuzzy match over streets, POIs, all three tiers of
  area, and landmarks (`search.json`, 4,178 entries / 497 KB), each tagged with
  its district. Selecting pans, drops a pin, and outlines the thing if it has a
  shape — nothing more.
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

The app is seven files — `index.html`, `app.css`, `app.js` (map, chrome, boot),
`layers.js` (areas, landmarks, overlays), `highlight.js` (what you tapped and
its shape), `kinds.js` (what an icon means, in Swedish), `search.js` — plus
`sw.js`. No framework, no bundler, no `node_modules`: the browser loads the ES
modules as written.

## Building the data

Prereqs (macOS): `brew install osmium-tool openjdk@21`; Node ≥ 20.
`export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"` for Java.

```
scripts/build-basemap.sh            # Sweden pbf → clip → data/cache/malmo.pmtiles (13.3 MB)
node scripts/build-overlays.mjs     # Overpass → build/data/{food,culture,cycling,transit}.geojson
node scripts/build-districts.mjs    # OSM boundaries → build/data/districts.geojson
node scripts/build-areas.mjs        # Malmö stad CC0 → build/data/stadsdelar.geojson + kommun.geojson
node scripts/build-neighbourhoods.mjs  # areas/areas.json → build/data/{neighbourhoods,parts}.geojson
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

## Tests

```
node --test 'test/*.test.mjs'       # no deps, no runner, no config
```

There is one thing here worth testing and it is the area ladder, because it is
the only part of the map whose bugs are invisible: two levels overlapping for
half a zoom step reads as clutter, not as a fault, and you only find it by
being at exactly the wrong zoom. So the tests ask the four questions you would
otherwise ask by squinting — is each level alone at its zoom, does each have an
outline as well as names, do the bands tile the zoom axis with no seam, does
the ladder stop where it should — plus what is actually *on* each rung, and
whether the hand-written groupings still agree with Malmö stad's own
statistics (`areas/statistikomraden.json`, derived once from the CC0 dataset so
the check runs offline).

`test/areas.test.mjs` and `test/style.test.mjs` read `build/`, which is
gitignored; they skip with a note rather than fail if you haven't built yet.

## Hosting

```
node scripts/build-site.mjs         # → build/site (17.8 MB, 54 files) — upload as-is
```

Any static host over HTTPS (geolocation and service workers need it). The only
requirement beyond "serves files": HTTP **Range** support for `.pmtiles`. Same
origin as the app, so no CORS.

Cache headers don't matter much: the service worker precaches everything on
first load and only re-fetches when the cache names in `app/sw.js` change (code
and data are versioned separately, so an app edit doesn't re-download 13 MB).

Rationale for non-obvious choices lives in [DECISIONS.md](DECISIONS.md) — it gets
a dated bullet only when something non-obvious was actually decided.
