# Decisions

Short log of the non-obvious choices, so they don't get relitigated. A dated
bullet lands here only when something non-obvious was actually decided.

- **Source is whole-Sweden, clipped** (2026-07-17). Geofabrik has no Skåne extract
  (missing regions 302-redirect to the homepage, masquerading as a tiny "download").
  So: `sweden-latest.osm.pbf` (772 MB) → `osmium extract` to the bbox (6.3 MB) →
  Planetiler (pinned v0.10.2) → 13.3 MB pmtiles. Tiling: ~2 GB peak RAM, ~18 s wall
  with cached sources.

- **Fully offline PWA** (2026-07-17). The original plan ruled offline out, assuming
  a huge tileset. Reality: 13.3 MB basemap, ~15 MB total payload — small enough to
  load the pmtiles as one in-memory ArrayBuffer and cache everything in a service
  worker.

- **Attribution includes OpenMapTiles** (2026-07-17). Planetiler's default profile
  emits the OpenMapTiles schema (CC-BY), which requires the visible credit on top
  of the OSM one.

- **Districts come from OSM, verified against the city's own data** (2026-07-17 /
  2026-07-26). OSM has all 136 delområden (AL10) + 5 stadsområden (AL9). Diffed
  against Malmö stad's CC0 open data (`opendata-api.malmo.se`, mirror of the
  firewalled CKAN host): same counts, same names (2 spelling variants), median
  centroid shift 0.7 m — same division, shared lineage. Keep OSM; the city feed
  would only add a fragile dependency. Only reclaimed-harbour polygons differ
  (shoreline survey vintage).

- **Street names from the local pbf; search clipped to Malmö kommun** (2026-07-26).
  Overpass would be a slow remote query for data already on disk; osmium does it in
  ~0.4 s. The bbox margin (Arlöv, Åkarp, …) reuses common Swedish street names, so
  the index is clipped to the municipality — streets *and* POIs (an index that knows
  half of Arlöv's stops but none of its streets is worse than neither); hand-curated
  landmarks are exempt (some sit offshore). The 136 delområden tile the kommun
  exactly, so the same point-in-polygon clips and assigns each entry's district.
  One name ≠ one street: same-name ways >500 m apart become separate entries,
  disambiguated by district. A street's rank comes from its dominant highway class
  by length — not its most prominent way, which made one slip road turn
  Annetorpsvägen into a motorway.

- **Landmarks: Nominatim resolves, a human verifies, nothing is faked**
  (2026-07-26). `landmarks/landmarks.json` is the hand-edited source of truth;
  `build-landmarks.mjs --resolve` fills only missing coords (1 req/s, cached,
  `bounded=1` to the bbox — else Stortorget matches Stockholm), writes them back as
  `"verified": false`, and unresolved entries ship without geometry rather than
  with a plausible wrong point. Build-time only; runtime makes no external calls.
  **Caveat: the 63-entry list was seeded from general Malmö knowledge, not the
  owner's original list (lost context) — owner review pending.**

- **Transit overlay is rail only** (2026-07-26). `bus_stop` and
  `public_transport=platform` were cut: the two tags largely duplicate the same
  physical stop, and ~2k bus pins are clutter on a reference map. 2,071 → 20
  features (train stations + the museum tramway).

- **The style is carved from OSM Liberty, by script, from a pinned commit**
  (2026-07-26). `scripts/build-style.mjs` fetches `osm-liberty@649d12a`, then
  drops 18 layers, retunes 22 and adds 1 — each with a one-line reason in the
  source. Upstream is never hand-edited, so re-running against a newer Liberty
  is a diff you can read instead of a merge you can't. The script also refuses
  to emit a style that references a font we haven't vendored or a layer that a
  patched minzoom would hide entirely.

- **The whole pmtiles archive is downloaded up front, not read by Range**
  (2026-07-26). The app fetches all 13.3 MB, wraps it in a `File`, and hands it
  to the pmtiles reader as an in-memory source. Costs one visible wait on first
  load; buys two things: panning and zooming never touch the network, and
  offline is not a separate code path — the service worker answers the same
  single request. Range support is still required of the host, because that
  first request is what the browser does with a 13 MB file.

- **Two service-worker caches, versioned separately** (2026-07-26). Code is
  stale-while-revalidate (edits appear on the next load, and dev isn't fighting
  a cache); data is cache-first and only re-fetched when `DATA` in `app/sw.js`
  changes. One cache would mean every CSS tweak re-downloads the basemap.

- **z6–9 exist in the tileset but are unreachable in the app** (2026-07-26). The
  extract is ~22 km across, so `maxBounds` (which is what keeps you from panning
  into empty background) clamps zoom-out at ~z10–11 — the whole-city view. The
  low zooms are ~0.2 MB of the archive, so they stay; if the bbox ever grows,
  they are already there. The style's low-zoom rung was written for z6–9 and
  simply takes effect at z10–11 instead.

- **One level of area at a time, at hard zoom boundaries** (2026-07-26). The
  area hierarchy is the part of this map meant to teach the city's structure, so
  zooming steps through it rather than blending it:

  | zoom | what is named |
  | --- | --- |
  | < 11 | Malmö, and nothing else |
  | 11 – 12.8 | the ten stadsdelar, all of them, whatever their size |
  | ≥ 12.8 | the 136 delområden, all of them, and their boundaries |

  Two earlier attempts failed this and are worth not repeating. Rationing the
  136 names into zoom buckets by polygon area buried exactly the famous small
  central ones (Gamla Staden, Möllevången) until z13.5. Letting both levels
  compete on collision instead made *which level you were looking at* depend on
  where you happened to be panned. The handover is now a cut, not a fade, and
  the stadsdel labels are `text-allow-overlap` so all ten are unconditional.
  Neighbouring towns (Arlöv, Oxie) are level-3 grain and wait for z12.8 too, so
  the widest view really is one name.

- **District labels come from computed points** (2026-07-26). A district is one
  name but several polygons — Västra Hamnen is cut into four by the docks — and
  MapLibre labels every part, so the name appeared four times. Labels therefore
  render from a separate point layer, one centroid-of-largest-part per district,
  computed in the app: a display concern, not data.

- **The ten stadsdelar come from Malmö stad, reversing D "keep OSM only"**
  (2026-07-26). Counted against `opendata-api.malmo.se`: the city publishes
  **10 stadsdelar** (stadsdelsförvaltningarna, 1996–2013), **5 stadsområden**
  (2013–2017) and **136 delområden**. Our OSM data matches the last two exactly
  — admin_level 9 is those same five names, admin_level 10 those same 136 — but
  OSM has **no stadsdel equivalent at all**: only 9 informal `place=suburb`
  nodes and 37 suburb polygons, and the polygons are mostly small central areas
  that duplicate delområden. So the names people actually use for large parts of
  town (Limhamn, Rosengård, Kirseberg, Centrum) had no boundary anywhere in the
  pipeline. The earlier decision not to depend on the city feed was about
  delområden, where OSM already had the same data; here it is the only source,
  it is CC0, and it is fetched once and cached. All 136 delområden fall inside
  exactly one stadsdel, which is checked on every build.

  The stadsområden are consequently no longer drawn: Norr/Söder/Väster/Öster was
  an administrative division nobody said out loud, and the stadsdelar occupy the
  same zooms better. They stay in the data and in search.

- **Area names come from two sources, deduplicated in the app** (2026-07-26).
  The administrative division does not contain Slottsstaden, Limhamn, Kirseberg,
  Rosengård or Hyllie — those are `place=suburb` nodes in OSM, and they are
  precisely how people say where something is. So the basemap's place labels are
  dropped from the style and redrawn by the app instead, filtered against the
  136 district names (case-insensitively: "Gamla staden" the node and "Gamla
  Staden" the delområde are one place spelled twice). One styling for area
  names, one place to tune them. **Erikslust is in neither source** — it is not
  in OSM at all inside this bbox, in any form; showing it would need a
  hand-curated area list.

- **Everything named is tappable, and says its shape** (2026-07-26). Tapping
  answers "what is that?" in two ways at once: a card with the name and what
  kind of thing it is, and the shape drawn on the map — a street lit along its
  whole length, an area outlined, an icon ringed. Three things this cost:
  vector tiles cut features at tile borders, so a street is re-assembled from
  all loaded tiles by name and then kept only if the pieces hang together
  (otherwise the other two Kyrkogatan light up too); road geometry carries no
  names, so streets are found by proximity to the parallel `transportation_name`
  layer instead of by hit-testing the road; and only what is currently loaded
  can be highlighted, so the far end of a long street may be missing until it
  scrolls into view. The icon vocabulary (`app/kinds.js`) is deliberately
  partial — an untranslated OSM tag is shown as-is rather than hidden.

- **App icons are drawn in code** (2026-07-26). Installing to a home screen
  needs real PNGs (iOS ignores SVG icons), and rasterising one would mean a
  rendering dependency for one asset. `scripts/build-icons.mjs` is ~80 lines of
  scanline fill plus a zlib-deflated PNG writer, drawing the Turning Torso's
  twist. No dependency, and the mark is defined in the same 24-unit grid as the
  landmark icons.

- **Toolchain: Homebrew + Node, no Docker** (2026-07-17). `osmium-tool`, keg-only
  `openjdk@21`, `tools/planetiler.jar`; all scripts in Node so the search-index
  shape is defined once, where the app consumes it.

- **Hosting simplified to plain static files** (2026-07-26). The earlier design
  (cron regeneration on a server, content-hash filenames, manifest.json, atomic
  deploys, nginx tuning) was machinery for a server that doesn't exist. Cut; no
  deploy tooling written. This is a personal map: rebuild locally, upload. Only
  hard requirements: HTTPS + Range support for `.pmtiles`.
