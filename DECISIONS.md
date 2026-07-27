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

- **The area ladder is unit-tested, not eyeballed** (2026-07-26). Every previous
  zoom-threshold bug was found by being at exactly the wrong zoom on a phone —
  two levels overlapping for half a step looks like clutter, not like a fault,
  so it survives casual use. The fix is that the ladder is now *data*
  (`app/area-levels.mjs`: one array of layer specs, each tagged with the level
  and role it belongs to) rather than a sequence of `map.addLayer` calls with
  numbers inlined. That makes "which levels are on at z12.35?" a pure function
  of no map, no DOM and no tiles, so `node --test` answers it for every tenth of
  a zoom from 6 to 18. Cost: the app now imports a module whose only job is to
  be inspectable. Worth it — the same file is what `build-style.mjs` reads to
  cap the basemap's "Malmö" at the top rung, which was the one seam no test
  could have covered while the numbers lived in two files. Deliberately *not*
  tested: anything about how it looks. Collision, halo, letter-spacing and
  whether Slottsstaden's label sits in the water are eye questions.

- **Level 3 is 19 names with gaps between them** (2026-07-27). The in-between
  level was first built complete — the curated groupings plus every delområde no
  grouping claimed — on the theory that a level with holes teaches nothing. That
  was wrong in a way that took a test to see: 93 of the 136 delområden then
  appeared at level 3 *and* level 4, so zooming past 13.4 changed the type size
  and nothing else. A level that repeats the level below is not a level. So
  level 3 is now only the names that actually exist between "Västra
  Innerstaden" and "Rönneholm", and most of the map is blank at that zoom —
  which is the honest answer, because most of Malmö has no such name.

- **A one-member grouping is allowed, as a promotion** (2026-07-27). The level
  had a hole where the city's most-named places are: Västra Hamnen, Gamla
  Staden, Möllevången, Bunkeflostrand, Klagshamn are all single delområden, so
  the old rule ("a grouping is made of several") left the medium zoom blank over
  the old town and the harbour. But "promote a delområde" is one step from
  promoting all 136, which is the mistake above. So the bar is a source *outside*
  the delområde register — Malmö stad's own områden pages, `place=suburb` in OSM,
  a Skånetrafiken stop, a tätort of its own, estate agents selling by the name —
  and the question "would you answer *var bor du?* with it". Five passed;
  Ribersborg, Hyllievång, Lönngården and the rest of the 136 did not. The
  precedent was already there: Stadionområdet covers only Stadion.

- **Six holes in level 3 are structural and stay open** (2026-07-27). Searching
  Wikipedia, Malmö stad, Skånetrafiken's stop names and the estate agents' own
  område pages for the missing middle turned up the same answer six times: in
  Hyllie, Rosengård, Oxie, Fosie, Husie and Kirseberg the in-between name people
  say *is* the stadsdel's name, over a smaller area — vernacular Rosengård is the
  estate, while the stadsdel also takes Persborg and Östra Kyrkogården; vernacular
  Hyllie is the station district, which is the delområde Hyllievång. Putting the
  same word at two zooms over two extents teaches the city wrong, so those stay
  blank. Malmö's historic in-between division (Västra Förstaden = Fridhem +
  Mellanheden + Västervång, Mellersta Förstaden, Södra Förstaden, Östra
  Förstaden, Pildammsstaden) is the right grain and would fill much of the rest,
  but Wikipedia has all five in the past tense, nobody says them, and they
  predate the stadsdelar so they cross them. Rejected candidates and their
  reasons live in `areas/areas.json` under `_doc.rejected`, so the next person
  does not research them again.

- **Skånetrafiken's stop names are a source for area names** (2026-07-27). A stop
  is named after the place it serves, which makes the network an index of what
  Malmö calls things — and unlike a geocoder it comes with a coordinate that is
  in the place rather than merely matching its name. 437 stop names in the bbox
  produced Erikslust, Högaholm, Blekingsborg, Toftängen and Potatisåkern, none of
  which is in any boundary dataset. Each part's parent delområde is then decided
  by point-in-polygon on that coordinate rather than by hand, which is how
  Erikslust turned out to sit in Rönneholm and not in Fridhem, where the
  Wikipedia article that names it lives. Same rule as everywhere else: a machine
  may place it, only a human may call it verified.

- **The hand-written groupings are checked against the city's statistics**
  (2026-07-26). `areas/areas.json` is hand-written because no dataset contains
  Slottsstaden — but Malmö stad does publish a division at roughly that grain,
  the 14 *geografiska statistikområden* (CC0). Their names are unusable
  ("Ribersborg, Bellevue m fl"), but their *groupings* are official, so
  `areas/statistikomraden.json` holds them as a delområde→område table (derived
  once by point-in-polygon, so the test runs offline) and a grouping that
  straddles two of them has to be justified in the test or it fails. Two are
  justified: Slottsstaden takes a corner of Malmö Hus, Sorgenfri takes Norra
  Sorgenfri from Kirseberg's statistical area — in both the vernacular name is
  the right one. **Bellevue is not justified and is currently failing**: it
  groups Bellevue and Nya Bellevue (villa areas by Ribersborg) with
  Bellevuegården, 1.8 km away, which shares no boundary with either and which
  the city counts to Lorensborg. Left red on purpose — it is a data decision.

- **Every pin is opt-in, and the pins come from the tiles** (2026-07-27). The
  map now opens with nothing point-shaped on it — no cafés, no shops, not even
  the landmark icons — and a chip row along the bottom tacks categories on. Two
  choices inside that are worth writing down.

  *Where the pins come from.* The four Overpass overlays became fourteen
  categories without a single new fetch, because the POIs were already on disk:
  the pmtiles archive holds 4,227 of them with an OpenMapTiles `class` each, so
  a category is a filter over `source-layer: poi`. The basemap's own `poi_z15`
  and `poi_z16` are consequently dropped from the style — drawn as well, they
  would double every café the moment you tapped "Mat", and their rank filters
  had a hole in them anyway (`poi_z14` was dropped long ago, so ranks 1–6 were
  never drawn at all — the most prominent POIs in each tile, invisible). Two
  overlays stay GeoJSON because the tiles do them worse: rail stations, wanted
  from z11 where the tiles have no POIs, and the cycle network, which is lines
  and includes named routes the tiles don't carry. `food.geojson` and
  `culture.geojson` are still built for the search index but no longer drawn or
  precached.

  *The table is checked against the archive, not against the schema.* Writing
  the class → category table from the OpenMapTiles documentation would have
  given "bakery" a chip of its own and missed that plain `shop` is 536 places,
  an eighth of every POI in Malmö. So `scripts/lib/pmtiles.mjs` reads the
  archive back (PMTiles directory + just enough MVT to get feature properties;
  ~120 lines, no dependency), `scripts/poi-inventory.mjs` prints what is in
  there, and the test fails on a class that no category claims and no written
  reason excuses — and on an excuse for a class the extract no longer has. 103
  classes, all accounted for.

  The one category that starts on is **Bilvägar**, the drivable network: a
  reference map you cannot find a street on is not one. It is found by rule
  (`road_`/`bridge_`/`tunnel_`, minus rail, footways and pedestrian areas)
  rather than by listing 45 layer ids that Liberty would rot the first time it
  added a casing — so turning the cars off leaves you the city you can walk.

- **Toolchain: Homebrew + Node, no Docker** (2026-07-17). `osmium-tool`, keg-only
  `openjdk@21`, `tools/planetiler.jar`; all scripts in Node so the search-index
  shape is defined once, where the app consumes it.

- **Hosting simplified to plain static files** (2026-07-26). The earlier design
  (cron regeneration on a server, content-hash filenames, manifest.json, atomic
  deploys, nginx tuning) was machinery for a server that doesn't exist. Cut; no
  deploy tooling written. This is a personal map: rebuild locally, upload. Only
  hard requirements: HTTPS + Range support for `.pmtiles`.
