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

- **Toolchain: Homebrew + Node, no Docker** (2026-07-17). `osmium-tool`, keg-only
  `openjdk@21`, `tools/planetiler.jar`; all scripts in Node so the search-index
  shape is defined once, where the app consumes it.

- **Hosting simplified to plain static files** (2026-07-26). The earlier design
  (cron regeneration on a server, content-hash filenames, manifest.json, atomic
  deploys, nginx tuning) was machinery for a server that doesn't exist. Cut; no
  deploy tooling written. This is a personal map: rebuild locally, upload. Only
  hard requirements: HTTPS + Range support for `.pmtiles`.
