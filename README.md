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
  | 3 | 12.3 – 13.4 | the 31 names **in between** — Slottsstaden, Sorgenfri, Limhamn, Västra Hamnen… — and, where there is no such name, the delområde itself | their delområden, dissolved |
  | 4 | ≥ 13.4 | all 136 **delområden** — Västra Sorgenfri, Rönneholm, Ribersborg… | OSM admin boundaries |

  The ladder lives in `app/area-levels.mjs` and nowhere else; `app/layers.js`
  draws from it and `scripts/build-style.mjs` imports its top rung to cap the
  basemap's own "Malmö" label. `test/` holds it to all of the above.

  **Level 3 covers the city, but only 31 of its names are its own.** That is how
  many in-between names exist (`areas/areas.json`, hand-written with a source
  each) — most of Malmö has no word between "Västra Innerstaden" and
  "Rönneholm". Rather than leave that blank, the 66 delområden no name covers
  are *elevated*: each stands in for itself, so the zoom that was empty over
  Rörsjöstaden says Rörsjöstaden. Level 4 is then the same map with those 31
  names broken into the 70 delområden they were hiding, which is what the cut at
  13.4 is for. No name is ever invented to fill a gap; the alternative to a
  curated name is always the real name of the smaller thing.

  Elevation is a floor, not an answer: the 66 are listed in
  `areas/elevated.md`, which asks of each one whether people actually say it.
  Nobody living in Rådmansvången says Rådmansvången — they say Triangeln, and
  Triangeln is on no administrative map at all. Every row that gets an answer
  becomes a grouping and leaves the list.

  Six of the biggest gaps closed differently: in Hyllie, Rosengård,
  Oxie, Fosie, Husie and Kirseberg the in-between name people use is the
  stadsdel's own name over a smaller area. Five are curated names that declare
  the repeat (`narrowerThanStadsdel`); Fosie is the one that could not be, its
  core already spoken for. `areas/areas.json` keeps the rejected candidates —
  including Malmö's historic in-between division (Västra Förstaden, Mellersta
  Förstaden, Pildammsstaden…), which is the right grain but which nobody says.

  Each level says how it sits in the others: a stadsdel lists the delområden it
  covers, a delområde says which stadsdel it is in, a level-3 name lists what it
  is made of. The 5 stadsområden are kept in the data and in search but not
  drawn: Norr/Söder/Väster/Öster is a division nobody said out loud.

  **The parts ride inside level 4.** Gamla Väster, Erikslust, Seved,
  Fullriggaren — 14 names finer than a delområde, with no boundary anywhere in
  Malmö. They cannot be a level of their own (an outline is what makes a level a
  division rather than a scatter of words), so they are drawn *with* the
  delområden from z13.4, italic and a size smaller so the two grains never read
  as one. They have a chip of their own, **Kvarter**, which starts on: turn it
  off and the ladder is exactly the four levels again.
- **No pins, until you ask** — the map opens with nothing point-shaped on it:
  no cafés, no shops, not even the landmarks. Everything of that kind is a
  **category**, tacked on from the **Lager** panel in the bottom corner — one
  chip each, stacked, with the icon and colour the map draws them in — and the
  choice is remembered like the view is. The panel opens closed every time: the
  map is the app. Two chips start on, and neither is a pin: the street network,
  and the kvarter names above. Turning a chip on that has nothing to show at
  this zoom takes you down to where it has, rather than greying out.

  | | drawn from |
  |---|---|
  | Mat · Barer · Kultur · Parker · Sport & bad · Butiker · Vård · Samhälle · Hotell · Bil & parkering | the basemap's own POIs, by OpenMapTiles `class`, z14+ |
  | Landmärken | the curated list (below) |
  | Cykel | `cycling.geojson` lines + lånecyklar from the tiles |
  | **Bilvägar** | the basemap's road layers — **the one category that starts on** |

  The table lives in `app/area-levels.mjs`'s neighbour, `app/categories.mjs`,
  and nowhere else: the chips, the layers, the colours and the card all read it.
  4,227 POIs are already inside the pmtiles archive, so a category costs a
  filter rather than a download — and `scripts/poi-inventory.mjs` reads the
  archive back to say what is in it, which is how the table was written and how
  `test/categories.test.mjs` checks that no class is left undrawable.
- **Selection** — tapping anything named gives its name, what kind of thing it
  is, and its shape: a street lit end to end, an area outlined, an icon ringed.
  What is turned off is not tappable: a pin you cannot see is not a hidden
  answer.
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

The app is eight files — `index.html`, `app.css`, `app.js` (map, chrome, chips,
boot), `layers.js` (areas, landmarks, category plumbing), `categories.mjs` (the
layer menu: what each chip stands for), `area-levels.mjs` (the zoom ladder),
`highlight.js` (what you tapped and its shape), `kinds.js` (what an icon means,
in Swedish), `search.js` — plus `sw.js`. No framework, no bundler, no
`node_modules`: the browser loads the ES modules as written.

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
node scripts/poi-inventory.mjs      # reads the tileset back: which POI classes it holds
```

`food.geojson` and `culture.geojson` are still built and still feed the search
index, but the map no longer draws them: those categories come from the POIs
already in the tiles, which are more complete and cost no download.

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

Two things here are worth testing, and both for the same reason: their bugs are
invisible.

The first is the area ladder — two levels overlapping for
half a zoom step reads as clutter, not as a fault, and you only find it by
being at exactly the wrong zoom. So the tests ask the four questions you would
otherwise ask by squinting — is each level alone at its zoom, does each have an
outline as well as names, do the bands tile the zoom axis with no seam, does
the ladder stop where it should — plus what is actually *on* each rung, and
whether the hand-written groupings still agree with Malmö stad's own
statistics (`areas/statistikomraden.json`, derived once from the CC0 dataset so
the check runs offline).

The second is the layer menu. "Everything off by default" is one line of intent
with six places to leak, so the test asserts the map opens clean — and, because
the set of POI classes is a property of the extract rather than of this repo, it
opens the pmtiles archive and reads it: a class that no chip draws and no
written reason excuses is a POI the map could never show, and it fails here
instead of being invisible forever.

`test/areas.test.mjs`, `test/style.test.mjs` and `test/categories.test.mjs` read
`build/` and `data/`, which are gitignored; they skip with a note rather than
fail if you haven't built yet.

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
