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

- **District labels come from computed points, and prominence is area for now**
  (2026-07-26). A district is one name but several polygons — Västra Hamnen is
  cut into four by the docks — and MapLibre labels every part, so the name
  appeared four times. Labels therefore render from a separate point layer, one
  centroid-of-largest-part per district, computed in the app (display concern,
  not data). Which districts get labelled first is ranked by area: honest,
  tunable, and wrong about Malmö (Hyllievång outranks Möllevången) until the
  hand-picked list from STATUS's open question exists.

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
