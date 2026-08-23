# Decisions

Short log of the non-obvious choices, so they don't get relitigated. A dated
bullet lands here only when something non-obvious was actually decided, and it
leaves when its subject does — this is the current state, argued, not an
archive.

- **The front door is Grunden and Resten** (2026-08-04). The question people
  arrive with is not "which part of town shall I practise" but *which of these
  384 names am I supposed to know at all*. A row per part of town cannot say
  that — ten rows all reading "23 av 41"; two headings can, before anything is
  pressed. So: two halves, four kinds each, eight rounds. Resten is the
  remainder rather than the whole, so nothing is asked of you twice.

  The cost is the mixing. A city is not learned a category at a time — standing
  on Föreningsgatan you want to know that this is Möllevången, that the bridge
  is Petribron and that the park is Pildammsparken, and that is three categories
  and one piece of knowledge. Two things make it payable. Inside a round the
  questions are grouped by kind anyway, because placing a delområde and placing
  a bridge are different jobs and alternating means starting over every
  question; the cut only catches up with the order. And a chunk the size of a
  stadsdel was buying less mixing than the argument promised — a stadsdel is a
  tenth of the city, not the walk down Föreningsgatan.

  Two smaller things went with it. `hitAt` grades against every item of the
  target's shape rather than the round's — with disjoint halves, a chunk-local
  candidate list would have made Grunden quietly the easier half twice over.
  And a street round is framed to the whole city, so it opens well under
  `STREET_ZOOM` and says "zooma in för att se gatorna" as its first word — the
  ordinary case rather than the awkward one. The honest fix, if that spoils the
  streets rounds, is to carry simplified street geometry in `learn.json` and
  stop grading off the loaded tiles at all.

- **What counts as core is decided by hand, against a sentence** (2026-08-04).
  Splitting the quiz needs a line through 384 names, and the tempting version is
  arithmetic: landmark tier 1, street rank ≤ 3, delområden no grouping speaks
  for, everything under 2.5 km. Every input is already in the repo and it would
  have taken an afternoon.

  It is the wrong instrument. Tier in `landmarks.json` is how prominently the
  map draws an icon; rank is what class OSM gave a way; `areas.json` ruled on
  which name *replaces* which on a map. None of them is an answer to "would you
  have to ask where that is", and a formula built from them cannot be overruled
  by anybody who knows the city. So `learn/core.json` is hand-written, its
  `_doc` carries the sentence, and `build-learn.mjs` refuses to infer anything —
  a name it lists that the quiz does not have is a hard failure, and so is a
  core share outside 25–45 %.

  The data is not wasted, it is just demoted: `scripts/propose-core.mjs` writes
  `learn/core-candidates.md`, every name with its band and its evidence,
  pre-sorted ja / ? / nej, the same shape as `areas/elevated.md`. The rule
  shortlists, the sentence decides, and rerunning the script after the pass
  marks every row where the two disagreed. The loudest one is the broar: the
  band rule says the old town is "nearly everything" and there are fifteen named
  crossings of the canal ring inside one square kilometre. Nobody knows fifteen
  bridge names. Six are in Grunden.

  The shape the sentence produced, worth writing down because it was not
  designed: core is not the top third of the city but the **first** third, read
  outward from Stortorget, and what thins with distance is the grain rather than
  the category. Inside the canal ring, nearly everything. Out to Inre Ringvägen,
  every area name that is its own and the through-roads but not the residential
  grid. Inside Yttre Ringvägen, only names no grouping speaks for, and the
  arteries that reach them. Beyond, the place and the road that gets you there.
  139 of 384, 36 %.

- **Streets are found by name, not by what is nearest** (2026-08-04). Asked to
  show Södergatan, the map lit up a short stretch of something at right angles
  to it. The reveal called "give me the named street nearest this point" with
  the street's own point — which comes from `representativePoint`
  (scripts/lib/geo.mjs) and is an existing *vertex* of the street, and OSM ways
  are split at junctions, so a vertex is usually a crossroads. At Södergatan's
  point, Skomakaregatan is 0.317 m away and Södergatan is 0.329 m away. The
  cross street won, and was then drawn end to end. 20 of the 174 streets did
  this.

  Proximity is now only for fingers. A tap is a place and the name is what you
  want out of it, so the grader still asks what is nearest. Anything that
  already *has* the name asks by name, and uses the point only to pick which
  Bruksvägen. The clustering distance that joins tile-clipped pieces into one
  street is 500 m — the same number as `CLUSTER_GAP_M` in build-streets.mjs,
  which is what decides that Almviksvägen is one entry in the quiz rather than
  two. Two files disagreeing about that meant the app drawing 508 m of a street
  the build called 1144 m long.

  The reason this survived: nothing about streets can be checked by reading
  `learn.json`, which is correct — it is only wrong once the name is looked up
  in vector tiles at runtime. `test/streets.test.mjs` does that lookup against
  the real archive.

- **The round says "zooma in" on zoom, not on what it failed to draw**
  (2026-08-04). `transportation_name` carries motorways from z10 and the other
  three thousand names only from z14, so below that a street question cannot be
  answered *or graded* — the grader looks your tap up in the same tiles. A round
  framed to fit a part of town opens well below it, so the warning fires on the
  zoom itself. `STREET_ZOOM` is a named constant read back out of the archive by
  a test, which is the honest form of the claim: it is a fact about the tileset,
  not a preference.

- **A description says what a thing is, never where it is** (2026-08-04). The
  panel is up for the whole question, so its text is not allowed to contain the
  answer: "öster om Möllevången", "mellan Slottsstaden och Mellanheden" and the
  forty-odd others like them were fine rewards and are free answers. All 184
  curated lines audited against one rule — what it is, when it was built, what
  happened there, what it is known for, and nothing about position — and 141 of
  them changed.

  Two judgement calls inside that rule. **A name may say what it already says:**
  Limhamns kyrka can mention Limhamn and Petribron can say it is named after
  Sankt Petri kyrka, because the etymology is in the name you were just handed
  and pretending otherwise leaves half the bridges mute. **Composition is not
  position:** Stadionområdet may list the arenas standing in it, because that is
  what the name announces, but Gamla Staden may not point at Stortorget, because
  there the containment is a coordinate.

  Twenty-six lines had nothing left once the position came out, and those are
  empty rather than reworded into a sentence that says nothing — the same
  bargain the rest of the pipeline makes. Coverage is 40 of 136 delområden, 22
  of 174 streets and 13 of 19 bridges. The derived `meta` line obeys the same
  rule in `build-learn.mjs`: a street does not print the delområde it runs
  through, and a bridge does not print what it crosses. A delområde still prints
  its stadsdel, which is coarse enough to give nothing away.

- **A picture per name, not per Wikipedia article** (2026-08-04). The picture
  rule is "prove it is the right place", and coordinates do prove that — but
  they say nothing about whether the picture is worth showing. Seven pairs of
  names were sharing one file, because Wikipedia illustrates two articles with
  the same photograph: Norra and Södra Sofielund were the same picture of the
  same building, which is the failure the coordinate check was built to prevent,
  arriving through the front door. One name (Malmö universitet) had a
  *logotype* rather than a photograph. Three had photographs from before 1920,
  of which Regementsgatan's is a canal that was filled in — a card that sends
  you looking for water.

  Fixed by hand-pinning thirteen entries, using the mechanism `images.json`
  already had. Nine got a new picture chosen from Commons **geosearch**, which
  is per-file coordinates rather than per-article ones and so is a strictly
  stronger proof than the build's own; four are pinned to `null`. Not automated:
  picking between six photographs of the same street is a judgement about what a
  place looks like, and the build has no business making it.

- **The panel is the question, not the prize** (2026-08-03). The card is up for
  the whole question — name, what it is, its picture and what is known about it,
  sitting there while you look for it — and a settled answer advances to the
  next name on a timer rather than through a button. Three things that bought. A
  question is never a blank: you are not asked for a name you have been told
  nothing about, which for the hundred-odd streets with no description is most
  of them. The picture gets the whole question to work on you rather than two
  seconds after you have stopped needing it. And the dismissal tap is gone — it
  only ever existed to admit you had finished reading, and the reading is done
  before you answer. What the text may say while it sits there is its own
  decision, above.

- **The view moves only when the answer is off screen** (2026-08-03). Flying to
  every answer takes the view out from under someone who panned there on
  purpose; never moving means being told "så här ligger det" about a place off
  the edge of the screen. So the reveal checks first — against the part of the
  canvas nothing is sitting on top of, because revealing an answer *behind the
  card that explains it* is the exact failure worth avoiding. Nothing re-frames
  between questions either: the opening view is a starting point, not a cage to
  be returned to.

- **A round runs a kind at a time** (2026-08-03). Every delområde, then every
  gata, then the broar, then the landmärken — because placing a delområde and
  placing a bridge are not the same job (*which of these outlines is it* versus
  *where on the water is it*), and alternating between them means starting over
  on every question. The order is the declaration order of `KINDS`, which is
  also what the picker counts a chunk in, so there is one answer to "what comes
  first". Inside a kind, the round asks what you keep missing.

- **Pan and zoom stay on during a round** (2026-08-03). A chunk framed to fit
  Centrum on a phone is not a scale you can tell two canal bridges apart at, and
  refusing to let someone zoom in tests their eyesight rather than their
  knowledge. Zooming in is not cheating when the labels are gone — that is what
  the blinding is for. Nothing in the round moves the map on its own: taking the
  view out from under you between questions would undo the pan you just made on
  purpose.

- **The streets are the yellow ones** (2026-08-03). The curated list was 65
  hand-picked names and the taste behind them was real but narrow: the ring
  roads, the arteries, the old streets inside the canal, the addresses people
  meet on — which is Centrum and Söder, and almost nothing in Husie, Oxie or
  Tygelsjö; Rosengård was ten names.

  So the second half of the list is a rule instead of a taste: **every road the
  basemap paints yellow.** Yellow is `#fea`, which `road_trunk_primary` and
  `road_secondary_tertiary` share — in Malmö that resolves to secondary and
  tertiary, since everything trunk-and-above here is motorway (`#fc8`, already
  listed). 109 names, taking the list to 174 of the 2 737 streets in the city.

  It is the right rule because it is the one your eye already uses. The yellow
  lines are the through-roads: what a part of town is navigated by, and — the
  part that matters for a blind map — what is still legible when the labels come
  off and the white residential grid around them is just texture. A rule also
  scales the way a taste does not, and it is checkable: the class comes from
  OSM, `build-learn.mjs` refuses any name it cannot place, and none of the 109
  got a description, because I do not know a story about Kvisslevägen and the
  card is allowed to say so.

- **The app is for learning the city, not for looking things up** (2026-08-03).
  Everything a reference map answers, a phone already answers. What this one is
  unusually good at is the thing it builds as a side effect — a mental model of
  how Malmö is put together, from the one-level-at-a-time area ladder and the
  curated names. So the app asks instead of tells; the map, the ladder, the
  names and the landmark list are the material.

  The labelled map survives as an escape hatch — everything the quiz asks
  about, drawn and tappable — because the rounds are only worth playing if
  there is somewhere to learn the names in the first place. It is unreachable
  while a round is running for the obvious reason: a map that answers "var
  ligger Sofielund?" is not a feature you leave within reach of someone being
  asked exactly that.

- **Blinding is total, not selective** (2026-08-03). During a round, every layer
  that draws text is hidden — not just the names of the category being asked
  about. Selective blinding is wrong twice: names leak sideways (Petribron is a
  bridge *and* a street name; Möllevångstorget is a square, a landmark and half
  a delområde), so the rule would have to know all of that and would be wrong
  quietly; and "which symbol layers are visible during a round" has one testable
  answer only if the answer is *none*. The cost is real — placing a landmark
  with no street names to triangulate from is harder — and is accepted, because
  the alternative is a quiz you can pass by reading. What is left is coastline,
  water, parks, roads and buildings, plus the outlines of whatever is being
  asked about, forced on at every zoom rather than only inside their band of the
  ladder.

- **The quiz is graded through the selection code, not beside it** (2026-08-03).
  An area is graded by asking the 136 delområde polygons which one the tap
  landed in and then asking the chunk which of its items claims it (`covers`),
  and a street by finding the named street under your finger. Both are things
  `highlight.js` already does for tap-to-identify. The alternative — a second
  set of polygon tests living next to the quiz — would mean two answers to
  "which area is this point in", and they would eventually disagree, which shows
  up as a round marking a right answer wrong. That is why `districtAt`,
  `highlightCovers` and `highlightStreet` are exported from the selection code
  rather than reimplemented next door.

- **One name is one thing** (2026-08-03). Six names exist as two kinds of thing
  at once: Pildammsparken, Augustenborg, Södervärn, Rosengård Centrum and
  Ribersborgsstranden are each both a park-ish landmark and a delområde, and
  Öresundsbron is both a bridge and a landmark. Asked as two questions they are
  one question with two right answers, and the grader picks the first and marks
  you wrong for finding the second. So the build keeps one: the kind you can
  stand *in* wins (area, then bridge, then street, then landmark), because
  landing anywhere inside the delområde Augustenborg is a better answer to "var
  ligger Augustenborg?" than a 250 m ring around the park. The loser is not
  simply dropped — its description is usually the better written one, since a
  landmark list is written to say what things are and a delområde list is not —
  so the survivor inherits any text it lacks. Nothing is invented, only moved.

- **Pictures are fetched by the build, never by the browser** (2026-08-03). The
  fact card wanted a photograph, and the obvious way to get one — point an
  `<img>` at Wikimedia — would have struck three principles in one line: no
  third-party requests at runtime, nothing leaves the device, works offline. It
  would also have been worst exactly where the app is most used, since a card on
  a train would have been a blank frame. So `scripts/build-images.mjs` downloads
  them when I ask it to, they are served from this origin, and the service
  worker caches them like everything else. Cost: 5.7 MB of payload. Accepted —
  a picture of the place does more for "Sofielund is *there*" than another
  sentence would.

  A picture is only kept if the article's own coordinates land near the point
  the quiz already grades against. A wrong picture is worse than none, because
  it teaches you something false about somewhere real, and title matching alone
  would happily have put Stockholm's Västerbron on Malmö's. An article with no
  coordinates is not rejected as wrong but as *unproven*, which is the same
  standard this repo has always held names to. That leaves 180 of 384 with a
  picture and 204 with none — mostly the through-roads, which have no article
  and should not. They say nothing rather than showing something that might be
  somewhere else.

  Every picture carries who took it and under what licence, in the card itself.
  That is a condition of use, not a courtesy, and this repo already shows its
  attributions rather than burying them.

- **Two strikes, then the answer** (2026-08-03). A third guess at a name you
  have no idea about is stabbing at the map. The first miss says what you *did*
  hit, which is what makes the second guess informed; the second reveals, and is
  recorded as `helped` — neither right nor wrong, but it pulls the item forward
  in the asking order.

  Strikes are counted per session rather than per name. Kept on the item, the
  count outlives the round: replaying a chunk starts you on your last strike,
  and "En gång till" — whose whole purpose is a second go at the names you just
  fumbled — reveals them on the first miss instead of the second. A second
  chance is not a shorter fuse.

- **Mastery is per item, and easy to lose** (2026-08-03). Progress is stored per
  name rather than per chunk — "Sofielund" is a thing you either can or cannot
  place — and a name counts as known only after two right answers in a row, with
  one miss taking it away. Placing something correctly once is mostly evidence
  about the last ten seconds. Full spaced repetition with due dates was
  considered and dropped: it is the right tool for 136 delområden and the wrong
  tone for an app you open when you feel like it.

  The key is the bare name, which one-name-one-thing is what made possible — and
  it is what makes the cut free to move: a name promoted from Resten to Grunden,
  or a landmark added, shifts no streaks.

- **Facts are partial on purpose** (2026-08-03). The card says something real or
  it says nothing. `learn/about.json` covers the areas I actually know something
  about (40 of 136 delområden); the rest fall back on what the build can prove
  from the data — "Delområde i Fosie", "Bro". Writing 136 paragraphs would have
  meant inventing most of them, which is the one thing this repo has
  consistently refused to do about names and had no reason to start doing about
  facts. Every line that *is* there is a draft marked `verified: false`, the
  same bargain `landmarks.json` makes about coordinates.

  One consequence worth writing down: the bridge list was read off OSM rather
  than out of memory — nineteen named crossings, and the half-dozen canal
  bridges I was sure existed but which OSM does not name are simply not in the
  app.

- **Source is whole-Sweden, clipped** (2026-07-17). Geofabrik has no Skåne extract
  (missing regions 302-redirect to the homepage, masquerading as a tiny "download").
  So: `sweden-latest.osm.pbf` (772 MB) → `osmium extract` to the bbox (6.3 MB) →
  Planetiler (pinned v0.10.2) → 13.3 MB pmtiles. Tiling: ~2 GB peak RAM, ~18 s wall
  with cached sources.

- **Fully offline PWA** (2026-07-17). Offline looked ruled out by tileset size.
  Reality: a 13.3 MB basemap, ~24 MB total payload — small enough to load the
  pmtiles as one in-memory ArrayBuffer and cache everything in a service worker.

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

- **Street names from the local pbf, clipped to Malmö kommun** (2026-07-26).
  Overpass would be a slow remote query for data already on disk; osmium does it in
  ~0.4 s. The bbox margin (Arlöv, Åkarp, …) reuses common Swedish street names, so
  the extraction is clipped to the municipality. The 136 delområden tile the kommun
  exactly, so the same point-in-polygon clips and assigns each street its district.
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
  a cache); data is cache-first and only re-fetches when `DATA` in `app/sw.js`
  changes. One cache would mean every CSS tweak re-downloads the basemap.

- **z6–9 exist in the tileset but are unreachable in the app** (2026-07-26). The
  extract is ~22 km across, so `maxBounds` (which is what keeps you from panning
  into empty background) clamps zoom-out at ~z10–11 — the whole-city view. The
  low zooms are ~0.2 MB of the archive, so they stay; if the bbox ever grows,
  they are already there. The style's low-zoom rung was written for z6–9 and
  simply takes effect at z10–11 instead.

- **One level of area at a time, at hard zoom boundaries** (2026-07-26). The
  area hierarchy is the part of this map meant to teach the city's structure, so
  zooming steps through it rather than blending it. Two approaches failed this
  and are worth not repeating: rationing the 136 names into zoom buckets by
  polygon area buried exactly the famous small central ones (Gamla Staden,
  Möllevången) until deep in the ladder, and letting the levels compete on
  collision made *which level you were looking at* depend on where you happened
  to be panned. The handover is a cut, not a fade, and the stadsdel labels are
  `text-allow-overlap` so all ten are unconditional. The current rungs are the
  table in the README.

- **District labels come from computed points** (2026-07-26). A district is one
  name but several polygons — Västra Hamnen is cut into four by the docks — and
  MapLibre labels every part, so the name appeared four times. Labels therefore
  render from a separate point layer, one centroid-of-largest-part per district,
  computed in the app: a display concern, not data.

- **The ten stadsdelar come from Malmö stad** (2026-07-26). OSM has the 136
  delområden and the 5 stadsområden exactly (above), but **no stadsdel
  equivalent at all**: only 9 informal `place=suburb` nodes and 37 suburb
  polygons, and the polygons are mostly small central areas that duplicate
  delområden. So the names people actually use for large parts of town (Limhamn,
  Rosengård, Kirseberg, Centrum) had no boundary anywhere in the pipeline. Here
  the city feed is the only source, it is CC0, and it is fetched once and
  cached. All 136 delområden fall inside exactly one stadsdel, which is checked
  on every build.

  The stadsområden are kept in the data but not drawn:
  Norr/Söder/Väster/Öster is a division nobody said out loud.

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

- **The area ladder is unit-tested, not eyeballed** (2026-07-26). Two levels
  overlapping for half a zoom step looks like clutter, not like a fault, so it
  survives casual use; every such bug was found by being at exactly the wrong
  zoom on a phone. The fix is that the ladder is *data* (`app/area-levels.mjs`:
  one array of layer specs, each tagged with the level and role it belongs to)
  rather than a sequence of `map.addLayer` calls with numbers inlined. That
  makes "which levels are on at z12.35?" a pure function of no map, no DOM and
  no tiles, so `node --test` answers it for every tenth of a zoom from 6 to 18.
  Cost: the app now imports a module whose only job is to be inspectable. Worth
  it — the same file is what `build-style.mjs` reads to cap the basemap's
  "Malmö" at the top rung, which was the one seam no test could have covered
  while the numbers lived in two files. Deliberately *not* tested: anything
  about how it looks. Collision, halo, letter-spacing and whether
  Slottsstaden's label sits in the water are eye questions.

- **A delområde no grouping covers is elevated to level 3** (2026-07-27). Level
  3 is the 31 curated in-between names — and most of Malmö has no such name.
  Rather than leave that blank, the 66 delområden no curated name covers stand
  in for themselves at that zoom, under their own names and their own outlines,
  so level 3 tiles the city. The cost is that those 66 are on two rungs. What it
  buys is that the 13.4 cut *means* something everywhere instead of only over
  the 31 curated names — it is the zoom at which those 31 break into the 70
  delområden they were hiding. Where nothing breaks, nothing changes, because in
  that part of the city there is nothing to break: the in-between name does not
  exist. A repeat that says "this place has one name" is honest; a blank that
  says "there is nothing here" is not. The invariant the test asserts is the
  partition: grouped or elevated, never both, never neither.

  Elevated names are set in the same face, size and ink as the curated ones: at
  that zoom "Rörsjöstaden" and "Slottsstaden" answer the same question, and
  typing one smaller would be the map hedging about which it means. Only
  collision differs — the 31 curated names always draw (they are the level's
  spine) and block rather than overprint, the 66 elevated ones take their turn
  around them, largest first. No name was invented to make this work.

- **The parts are drawn inside level 4** (2026-07-27). Gamla
  Väster, Erikslust, Seved, Fullriggaren — 14 names finer than a delområde, with
  no boundary anywhere in Malmö. They cannot be a level of their own (an outline
  is what makes a level a division rather than a scatter of words), so they are
  drawn *with* the delområden from z13.4, in italic condensed at a size under
  the delområde names, with `text-optional` so the delområde's own name wins
  when only one can fit.

- **A one-member grouping is allowed, as a promotion** (2026-07-27). The level
  had a hole where the city's most-named places are: Västra Hamnen, Gamla
  Staden, Möllevången, Bunkeflostrand, Klagshamn are all single delområden, so
  "a grouping is made of several" left the medium zoom blank over the old town
  and the harbour. But "promote a delområde" is one step from promoting all 136.
  So the bar is a source *outside* the delområde register — Malmö stad's own
  områden pages, `place=suburb` in OSM, a Skånetrafiken stop, a tätort of its
  own, estate agents selling by the name — and the question "would you answer
  *var bor du?* with it". Five passed; Ribersborg, Hyllievång, Lönngården and
  the rest of the 136 did not. The precedent was already there: Stadionområdet
  covers only Stadion.

- **Five level-3 names repeat the stadsdel above them, over less ground**
  (2026-07-27). Searching Wikipedia, Malmö stad, Skånetrafiken's stop names and
  the estate agents' own område pages for the missing middle turned up the same
  answer six times: in Hyllie, Rosengård, Oxie, Fosie, Husie and Kirseberg the
  in-between name people say *is* the stadsdel's name, over a smaller area.
  Refused at first — one word for two extents at two zooms teaches the city
  wrong — and then allowed, because the alternative was leaving the six largest
  holes in the level over exactly the parts of Malmö people name most
  confidently. No extent is guessed: each is where OSM's own `place=suburb` node
  for the name falls plus every stop carrying it, by point-in-polygon, and where
  those disagree with the stadsdel they disagree usefully — eleven stops called
  Hyllie all land in Hyllievång and none anywhere else in the stadsdel Hyllie,
  while vernacular Rosengård is the estate and the stadsdel also takes Persborg
  and Östra Kyrkogården. The repeat has to be declared per entry
  (`narrowerThanStadsdel`), and the test allows those five by name and still
  fails on a sixth.

  **Fosie is the one that could not be done**: its core is already spoken for —
  the OSM Fosie node lands in Gullviksborg, which `Gullvik` holds, and the stops
  named for it scatter across Fosieby, Lindängen, Holma and Lindeborg. Rejected
  candidates and their reasons — including Malmö's historic in-between division,
  the right grain that nobody says — live in `areas/areas.json` under
  `_doc.rejected`, so the next person does not research them again.

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
  the right one.

- **Toolchain: Homebrew + Node, no Docker** (2026-07-17). `osmium-tool`, keg-only
  `openjdk@21`, `tools/planetiler.jar`; all scripts in Node so the data shapes
  are defined once, where the app consumes them.

- **Hosting is plain static files** (2026-07-26). No cron regeneration,
  content-hash filenames or deploy tooling — machinery for a server that doesn't
  exist. This is a personal map: rebuild locally, upload. Only hard
  requirements: HTTPS + Range support for `.pmtiles`.
