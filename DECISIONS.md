# Decisions

Short log of the non-obvious choices, so they don't get relitigated. A dated
bullet lands here only when something non-obvious was actually decided.

- **One mode: peka ut** (2026-08-04). "Dra ut alla" is gone. It lit up every
  slot the name could go in — every delområde in the chunk, every bridge, every
  street — and asked you to choose among them, on the theory that recognition is
  the easy direction you start with before you can recall.

  What it actually was, once the slots were drawn, was a matching exercise. With
  the delområden outlined and the streets stroked, the map had already narrowed
  the answer to a dozen shapes, and the round became about telling those shapes
  apart rather than about knowing where anything is. You can finish a chunk that
  way having learned the shape of the board. The previous entry in this log
  ("the board is the run you are in") was the third attempt in a week to keep
  the easy half honest, which is its own kind of evidence.

  It also cost more than it looked like it did. Every chunk offered a choice
  nobody had the information to make — nothing on the picker says which mode you
  should be in, and the honest answer was "the hard one". And in the code, a
  `mode` was threaded through every function in learn.js, with a tray, a drag
  ghost, a board of slots that had to be redrawn on every pan, and a set of
  layers in highlight.js hanging off it: about 250 lines, all of them serving
  the half that taught less. One question, asked properly.

- **Streets are found by name, not by what is nearest** (2026-08-04). Streets
  highlighted strangely — asked to show Södergatan, the map would light up a
  short stretch of something at right angles to it.

  The reveal called "give me the named street nearest this point" with the
  street's own point. That point comes from `representativePoint`
  (scripts/lib/geo.mjs), which returns an existing *vertex* of the street — and
  OSM ways are split at junctions, so a vertex is usually a crossroads. At
  Södergatan's point, Skomakaregatan is 0.317 m away and Södergatan is 0.329 m
  away. The cross street won, and was then drawn end to end: a short line,
  crossways, which is exactly what "only part of the street highlighted" looks
  like. 20 of the 174 streets in the quiz did this, and the same call in the
  search dropped another fifth of the street index to a bare ring, because the
  name check behind it quietly rejected the wrong answer without saying so.

  Proximity is now only for fingers. A tap is a place and the name is what you
  want out of it, so the grader still asks what is nearest. Anything that
  already *has* the name asks by name, and uses the point only to pick which
  Bruksvägen. While there, the clustering distance that joins tile-clipped
  pieces into one street moved from 220 m to 500 m — the same number as
  `CLUSTER_GAP_M` in build-streets.mjs, which is what decided that Almviksvägen
  is one entry in the quiz rather than two. Two files disagreeing about that
  meant the app drawing 508 m of a street the build called 1144 m long.

  The reason this survived: nothing about streets can be checked by reading
  `learn.json`, which is correct. It is only wrong once the name is looked up in
  vector tiles at runtime. `test/streets.test.mjs` now does that lookup against
  the real archive — see the README. Three of its six tests fail against the old
  code.

- **The round says "zooma in" on zoom, not on what it failed to draw**
  (2026-08-04). Same warning, different trigger. It used to fire when the board
  could not draw any street slots, which was a real measurement but only existed
  in the mode that had a board. The fact underneath belongs to neither mode:
  `transportation_name` carries motorways from z10 and the other three thousand
  names only from z14, so below that a street question cannot be answered *or
  graded* — the grader looks your tap up in the same tiles. A chunk framed to
  fit a stadsdel opens well below it. `STREET_ZOOM` is now a named constant read
  back out of the archive by a test, which is the honest form of the claim: it
  is a fact about the tileset, not a preference.

- **The panel is the question, not the prize** (2026-08-03). The card was the
  reward for a correct placement: place Sofielund, then find out what Sofielund
  is. It is now up for the whole question instead — name, what it is, its
  picture and what is known about it, sitting there while you look for it — and
  a settled answer advances to the next name on a timer rather than through a
  button.

  Three things that bought. A question is never a blank: you are no longer asked
  for a name you have been told nothing about, which for the hundred-odd streets
  with no description was most of them. The picture gets the whole question to
  work on you rather than two seconds after you have stopped needing it. And the
  dismissal tap is gone — it only ever existed to admit you had finished
  reading, and the reading is now done before you answer.

  **The cost is that the text can give the answer away**, and it does: 47 of the
  154 descriptions name another place, and the meta line names the delområde
  outright — "Slussen · Delområde i Centrum · Där kanalen möter hamnbassängen i
  öster, vid Slussbron" is most of a location before you have looked at the map.
  Accepted on the grounds that the app is for learning Malmö rather than for
  scoring you, and being told where Slussen is while being asked to point at it
  is a worse quiz and a better lesson. If that turns out to be wrong, the
  smallest fix is holding `about` and `meta` back until the answer is in, which
  keeps the name and the picture as the question.

- **The board is the run you are in** (2026-08-03). Everything placed used to
  stay lit whatever was in hand, on the theory that the round so far is what you
  eliminate against. But you eliminate *within a kind* — and once the areas were
  done, that theory meant twenty green delområden sitting underneath the street
  run, tinting half the city in a colour that had stopped meaning anything
  there. A run starts clean and shows one kind: open slots dashed, filled ones
  solid.

- **The view moves only when the answer is off screen** (2026-08-03). Point mode
  flew to every answer and tray mode never moved, and with pan and zoom now on,
  both are wrong. Flying every time takes the view out from under someone who
  panned there on purpose; never moving means being told "så här ligger det"
  about a place off the edge of the screen. So the reveal checks first — against
  the part of the canvas nothing is sitting on top of, because revealing an
  answer *behind the card that explains it* is the exact failure worth avoiding.
  Nothing re-frames between questions either: the opening view is a starting
  point, not a cage to be returned to.

- **A street round says "zooma in" when it means it** (2026-08-03). Street slots
  are looked up in the vector tiles that happen to be loaded, and
  `transportation_name` is not in them below about z14 — so at the zoom a whole
  stadsdel is framed at, a street slot resolves to nothing. That was showing up
  as roads that would not highlight, but the drawing was the lesser half: the
  grader finds your answer through the *same* lookup, so a street question asked
  at that zoom could not be got right either. `setBoard` now returns how many
  slots it could actually draw, and a street run with none of them says the one
  thing that fixes it. The layer chips already talk this way, for the same
  reason.

- **The rounds are listed outward from Stortorget** (2026-08-03). The picker was
  in Swedish alphabetical order, which put Centrum third behind Fosie and Husie
  above Kirseberg — facts about the alphabet, not about Malmö. Sorted by how far
  out each stadsdel is, the list is a route: the part you already half-know,
  then the ring around it, then Oxie nine kilometres down at the bottom where it
  belongs.

  The anchor is `Stortorget` looked up in the quiz's own items rather than a
  coordinate pair in a constant, because "the middle of Malmö is Stortorget" is
  a claim about the city that anyone can check and `13.0006, 55.6061` is a claim
  about nothing. It lands 163 m from the Centrum chunk's own centroid, which is
  as good a check as that idea is going to get. A test holds the build to it;
  the runtime falls back to the centroid of everything, because a missing
  landmark should cost you the ordering rather than the app.

- **Pan and zoom stay on during a round** (2026-08-03). Tray mode used to
  disable both, on the grounds that you cannot pan with a name in your hand.
  That was true of the wall of nametags, where the map had to hold still for a
  hundred drop targets, and stopped being true when the tray became one tag that
  is placed as often by tapping as by dragging. Meanwhile the cost had gone up:
  a chunk framed to fit Centrum on a phone is not a scale you can tell two canal
  bridges apart at, and refusing to let someone zoom in was testing their
  eyesight rather than their knowledge. Zooming in is not cheating when the
  labels are gone — that is what the blinding is for.

  It does mean the board has to follow the view: a street slot is found in the
  tiles that happen to be loaded, so `moveend` redraws it. Nothing else in the
  round moves the map on its own, because the board *is* the round so far and
  taking it out from under you between questions would undo the pan you just
  made on purpose.

- **A slot is dashed until it is filled** (2026-08-03). The board said "empty"
  in grey and "placed" in green and left it at that, which fell apart on the
  streets: a grey stroke along a road drawn in grey casing, next to a green
  stroke along a road that is not, is two muted colours to tell apart — and with
  fifty street slots lit at once in Centrum, telling them apart *is* the task.
  Dashed against solid is a difference that cannot be missed, holds over white,
  yellow and orange road casings alike, and does not ask anyone to distinguish
  two dark colours at a glance. Colour still carries the same meaning; it is
  just no longer carrying it alone. Two layers rather than one expression,
  because `line-dasharray` is not data-driven in MapLibre.

- **The tray holds one name, and a round runs a kind at a time** (2026-08-03).
  Tray mode laid the whole chunk out as nametags along the bottom, and in
  Centrum that is 104 of them: a wall covering two thirds of the city it was
  asking about. The mode's whole argument is that you can *see what is left* —
  and the seeing was supposed to happen on the map, between the slots filling up
  green, not in a list of words on top of it. So the tray is one tag now, in
  hand from the moment it appears, and the map is a map again.

  What went with it: arming. A tap used to pick a name up out of the wall and a
  second tap put it down, which was the right gesture when there were a hundred
  to choose between and is pure ceremony when there is one. The name is in hand,
  the map takes the tap, and `renderArmed`, the `dragged` click-suppression flag
  and the escape-key rung that disarmed all went with it. Dragging stays, though
  nothing needs it: it is the affordance that says a nametag is a thing you put
  somewhere.

  And the order stopped being one shuffle over everything. A round now asks a
  kind at a time — every delområde, then every gata, then the broar, then the
  landmärken — because placing a delområde and placing a bridge are not the same
  job (*which of these outlines is it* versus *where on the water is it*), and
  alternating between them means starting over on every question. The order is
  the declaration order of `KINDS`, which is also what the picker counts a chunk
  in, so there is one answer to "what comes first". Inside a kind each mode
  keeps its own idea: tray shuffles, point asks what you keep missing. Tray
  cannot use the spaced-repetition order, because with the slots on screen
  "here is the one you always get wrong" is a hint about which slot it is.

  With nothing having to fit on a screen, `MAX_CHUNK` stopped meaning what it
  said. It is now a ceiling on how long a sitting is (200), and the honest fix
  for a chunk that reaches it is cutting the chunks finer, not raising it again.

- **The streets are the yellow ones** (2026-08-03). The curated list was 65
  hand-picked names and the taste behind them was real but narrow: the ring
  roads, the arteries, the old streets inside the canal, the addresses people
  meet on — which is Centrum and Söder, and almost nothing in Husie, Oxie or
  Tygelsjö. A quiz cut by stadsdel notices that immediately; Rosengård was ten
  names.

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
  The reference map was a good map that nobody needed: everything it answered,
  a phone already answers. What it was *unusually* good at was the thing it
  built as a side effect — a mental model of how Malmö is put together, from the
  one-level-at-a-time area ladder and the curated names. So the app now asks
  instead of tells. The map, the ladder, the names and the landmark list are
  unchanged and are now the material; the round picker is the front door.

  The reference map survives as **Utforska** rather than being deleted, because
  the rounds are only worth playing if there is somewhere to learn the names in
  the first place, and that is exactly what search + tap-to-identify is. It is
  unreachable while a round is running for the obvious reason: a text box that
  answers "var ligger Sofielund?" is not a feature you leave within reach of
  someone being asked exactly that.

- **Blinding is total, not selective** (2026-08-03). During a round, every layer
  that draws text is hidden — not just the names of the category being asked
  about. Selective blinding was the first design and is wrong twice: names leak
  sideways (Petribron is a bridge *and* a street name; Möllevångstorget is a
  square, a POI label and half a delområde), so the rule would have to know all
  of that and would be wrong quietly; and "which symbol layers are visible
  during a round" has one testable answer only if the answer is *none*. The cost
  is real — placing a landmark with no street names to triangulate from is
  harder — and is accepted, because the alternative is a quiz you can pass by
  reading. What is left is coastline, water, parks, roads and buildings, plus
  the outlines of whatever is being asked about, forced on at every zoom rather
  than only inside their band of the ladder.

- **One quiz, cut by geography rather than by category** (2026-08-03). The first
  build had six rounds — a round per category, each with its own shape, its own
  tolerance and its own idea of how to cut itself up. That is a menu of six
  things to practise rather than one thing to learn, and it teaches the taxonomy
  instead of the city: you end up able to recite the ten stadsdelar and still
  unable to say what you are standing in. A city is not learned a category at a
  time. Standing on Föreningsgatan you want to know that this is Möllevången,
  that the bridge down there is Petribron and that the park is Pildammsparken,
  and that is three categories and one piece of knowledge.

  So there is one quiz, cut by stadsdel — ten chunks — and a chunk holds
  whatever is in that part of town. What used to be a round is now a *kind* — a property of the item
  saying how it is placed and how close counts. Two levels were cut outright:
  the ten stadsdelar (learnable in one sitting, and mostly already known) and
  the 97 names in between (the same ground as the delområden, asked at a coarser
  grain, so answering both was answering twice). What is left is 275 names, one
  level of area, and nineteen chunks of at most twenty.

  Three things fell out of that, all of them simplifications. Progress is keyed
  by name alone, because "Limhamn the name in between" and "Limhamn the
  delområde" was the only reason it could not be — which means the cut can move
  without anyone losing what they learned. The view is computed from the chunk's
  own extent rather than read off a zoom ladder, because chunks are no longer
  all the same size. And the tray cap stopped being a rule about which rounds
  get tray mode and became a rule about how big a chunk may be, checked in the
  build: every chunk is playable both ways.

- **A chunk is a whole stadsdel, however uneven that is** (2026-08-03). The
  first cut sliced any stadsdel over twenty names into contiguous west-to-east
  strips, so a tray would fit a phone screen without scrolling. That optimised
  the wrong thing. A twenty-name slice of Centrum is a few blocks, and a few
  blocks cannot hold a street: Amiralsgatan and Regementsgatan run the width of
  the city, so every chunk small enough to be comfortable was too small to
  contain the things most worth knowing, and the streets that did fit were the
  short ones nobody needs teaching. So the strips are gone, the tray scrolls,
  and chunks range from Oxie's 8 names to Centrum's 104 — which is honest,
  because those parts of town are not the same size either.

  Streets carry a bounding box for the same reason. A street's label point says
  where to write the name; it says nothing about the five kilometres the street
  runs, and a chunk framed on label points alone puts the answer off the screen
  in the one mode where the map is not allowed to move. `build-streets.mjs` now
  emits the extent of each cluster it already computed.

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

- **One name is one thing** (2026-08-03). Merging the categories put six names
  in the quiz twice: Pildammsparken, Augustenborg, Södervärn, Rosengård Centrum
  and Ribersborgsstranden are each both a park-ish landmark and a delområde, and
  Öresundsbron is both a bridge and a landmark. Asked as two questions they are
  one question with two right answers, and the grader picks the first and marks
  you wrong for finding the second. So the build keeps one: the kind you can
  stand *in* wins (area, then bridge, then street, then landmark), because
  landing anywhere inside the delområde Augustenborg is a better answer to "var
  ligger Augustenborg?" than a 250 m ring around the park. The loser is not
  simply dropped — its description is usually the better written one, since a
  landmark list is written to say what things are and a delområde list is not —
  so the survivor inherits any text it lacks. Nothing is invented, only moved.

- **The tray board shows the slots for the name in your hand** (2026-08-03).
  Tray mode drops names onto a blinded map, and a blinded map does not say where
  anything goes. The delområde boundaries are forced on, but all 136 of them
  are, so a chunk was dragged onto a mesh of identical cells with no way to tell
  a candidate from a bystander; for a bridge nothing was drawn at all, and "drag
  this name onto the city" is not a question with a visible answer set. Either
  way the one thing tray mode is *for* — seeing what is left, getting the last
  few by elimination — was missing.

  So picking a name up lights the slots it could go in, and a slot turns green
  once something has landed in it. The kind in hand decides what is drawn:
  bridges when you are holding a bridge, delområden when you are holding an
  area. Drawing all four kinds at once would be a wall of rings over a map that
  still has to be readable, and would answer a question nobody asked — you are
  not choosing between a bridge and a street, you are choosing between the
  bridges.

  The cost is real and accepted: with the drop zones drawn, tray mode is closer
  to matching names against slots than to placing them from memory. That is what
  the easy direction is for, and it is the reason every chunk is also playable
  the other way. Point mode — the direction that says whether you actually know
  it — gets no board at all.

  Slots are found by the same route the grader takes to them: an area's
  `covers`, a street by proximity to `transportation_name`, a point as itself.
  Drawing a candidate any other way would eventually light up something the
  grader would not accept, which is the worst bug this app could have.

- **Pictures are fetched by the build, never by the browser** (2026-08-03). The
  fact card wanted a photograph, and the obvious way to get one — point an
  `<img>` or an `<iframe>` at Wikimedia — would have struck three principles in
  one line: no third-party requests at runtime, nothing leaves the device, works
  offline. It would also have been worst exactly where the app is most used,
  since a card on a train would have been a blank frame. So
  `scripts/build-images.mjs` downloads them when I ask it to, they are served
  from this origin, and the service worker caches them like everything else.
  Cost: 5.7 MB on a payload that was 17.9. Accepted — a picture of the place
  does more for "Sofielund is *there*" than another sentence would.

  A picture is only kept if the article's own coordinates land near the point
  the quiz already grades against. A wrong picture is worse than none, because
  it teaches you something false about somewhere real, and title matching alone
  would happily have put Stockholm's Västerbron on Malmö's. An article with no
  coordinates is not rejected as wrong but as *unproven*, which is the same
  standard this repo has always held names to. That leaves 184 of 275 with a
  picture and 91 with none, including seventeen of the nineteen bridges, whose
  canal crossings simply have no article. They say nothing rather than showing
  something that might be somewhere else.

  Every picture carries who took it and under what licence, in the card itself.
  That is a condition of use, not a courtesy, and this repo already shows its
  attributions rather than burying them.

- **The pixel floor had never fired** (2026-08-03). `graded` widens every
  distance tolerance to whatever 26 screen pixels are worth, so that 120 m is
  not a dare at a zoomed-out view. The metres-per-pixel it was given was wrong
  by a factor of 128 — the 256-pixel tile constant against MapLibre's 512-pixel
  tiles — which made a pixel worth about four centimetres and the floor
  unreachable, so the tolerance was always just the flat metre figure. It is now
  measured by projecting two points and asking how far apart they are, which
  cannot be wrong in that way. Worth recording because the failure was invisible
  from both sides: the tests exercise `graded` with the number passed in, and
  the app looked like it was merely being strict.

- **Two strikes, then the answer; and the card is the reward, not the score**
  (2026-08-03). A third guess at a name you have no idea about is stabbing at
  the map. The second miss reveals, and is recorded as `helped` — neither right
  nor wrong, but it pulls the item forward in the asking order. And a correct
  placement is the moment the app has your attention, so it spends it on what
  the place *is* rather than on a tick: the fact card is the product, the
  placing is the pretext. In tray mode the card is deferred to the summary,
  because nineteen interruptions in a round of twenty is not a rhythm.

  Strikes are counted per session rather than per name. The first build kept the
  count on the item, which is the fetched data and is shared by every chunk that
  holds it, so the count outlived the round: replaying a chunk started you on
  your last strike, and "En gång till" — whose whole purpose is a second go at
  the names you just fumbled — revealed them on the first miss instead of the
  second. A second chance is not a shorter fuse.

- **Mastery is per item, and easy to lose** (2026-08-03). Progress is stored per
  name rather than per chunk — "Sofielund" is a thing you either can or cannot
  place — and a name counts as known only after two right answers in a row, with
  one miss taking it away. Placing something correctly once is mostly evidence
  about the last ten seconds. Full spaced repetition with due dates was
  considered and dropped: it is the right tool for 136 delområden and the wrong
  tone for an app you open when you feel like it.

  The key is the bare name, which the merge is what made possible: there used to
  be two Limhamns on two rungs, and one flat key would have given them each
  other's streak. It is also what makes the chunking free to change — a new
  landmark shifting the west-to-east split of Centrum moves names between chunks
  without touching what is stored against them.

- **Facts are partial on purpose** (2026-08-03). The card says something real or
  it says nothing. `learn/about.json` covers the areas I actually know something
  about (44 of 136 delområden); the rest fall back on what the build can prove
  from the data — "Delområde i Fosie", "Bro över Malmö kanal". Writing 136
  paragraphs would have meant inventing most of them, which is the one thing
  this repo has consistently refused to do about names and had no reason to
  start doing about facts. Every line that *is* there is a draft marked
  `verified: false`, the same bargain `landmarks.json` makes about coordinates.

  One consequence worth writing down: the bridge list was read off OSM rather
  than out of memory — nineteen named crossings, and the half-dozen canal
  bridges I was sure existed but which OSM does not name are simply not in the
  app.

  `about.json` still keeps two maps, `stadsdelar` and `areas`, because five
  names sat on two levels at two sizes and one flat map would have given the big
  one the little one's description. With the stadsdel level cut, only `areas` is
  read. The other map is kept rather than deleted: those ten paragraphs are
  about real places and are the obvious material if that level ever comes back.

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

- **Level 3 is 19 names with gaps between them** (2026-07-27, reversed the same
  day — see below). The in-between level was first built complete — the curated
  groupings plus every delområde no grouping claimed — on the theory that a
  level with holes teaches nothing. That was wrong in a way that took a test to
  see: 93 of the 136 delområden then appeared at level 3 *and* level 4, so
  zooming past 13.4 changed the type size and nothing else. A level that repeats
  the level below is not a level. So level 3 is now only the names that actually
  exist between "Västra Innerstaden" and "Rönneholm", and most of the map is
  blank at that zoom — which is the honest answer, because most of Malmö has no
  such name.

- **…and then it isn't: a delområde with no name above it is elevated**
  (2026-07-27). The decision above was right about the mechanism and wrong about
  which half was the lie. Standing at z12.8 over Rörsjöstaden, the map said
  nothing at all — and "nothing" is not what that place is called. Rörsjöstaden
  is. So the 66 delområden no curated name covers are drawn at level 3 under
  their own names and their own outlines, and level 3 tiles the city.

  What that costs is the thing the earlier entry measured: those 66 names are on
  two rungs. What it buys is that the 13.4 cut now *means* something everywhere
  instead of only over the 31 curated names — it is the zoom at which those 31
  break into the 70 delområden they were hiding. Where nothing breaks, nothing
  changes, because in that part of the city there is nothing to break: the
  in-between name does not exist. A repeat that says "this place has one name"
  is honest; a blank that says "there is nothing here" is not. The old test
  ("level 3 is allowed to have holes, and does") asserted the wrong invariant
  and is now the partition test — grouped or elevated, never both, never
  neither.

  Elevated names are set in the same face, size and ink as the curated ones: at
  that zoom "Rörsjöstaden" and "Slottsstaden" answer the same question, and
  typing one smaller would be the map hedging about which it means. Only
  collision differs — the 31 curated names always draw (they are the level's
  spine) and now block rather than overprint, the 66 elevated ones take their
  turn around them, largest first. No name was invented to make this work, which
  was the whole reason for refusing to fill the gaps in the first place.

  It also paid for a fix that had been too expensive to make: **Bellevue no
  longer covers Bellevuegården** (2026-07-27). The grouping's only source was
  `"delområdesnamnen själva"` — three delområden sharing a word — and both
  independent checks disliked it: Bellevuegården is in the stadsdel Hyllie next
  to Lorensborg while Bellevue and Nya Bellevue are adjacent in
  Limhamn-Bunkeflo 1.2 km away, and Malmö stad counts it to a different
  statistikområde. A sixties estate that borrowed a villa district's name.
  Removing it used to mean punching a hole in level 3; now it means
  Bellevuegården says its own name there, so the honest reading costs nothing.
  Exactly three groupings cross a stadsdel, and the other two are Slottsstaden
  and Sorgenfri — the same two the statistics test already forgives by name,
  which is the strongest evidence that the two divisions agree and Bellevue was
  the outlier. That check is now its own test rather than a thing someone
  noticed once.

- **The parts are drawn inside level 4, behind a chip** (2026-07-27). Gamla
  Väster was in the data from the start and had never once appeared on the map:
  parts.geojson was built and searchable but not drawn, because a fifth level of
  names with no boundaries was noise. Both halves of that were right — the names
  are worth having, a fifth rung is not — so they are drawn *within* level 4
  from z13.4, in italic condensed at a size under the delområde names, with
  `text-optional` so the delområde's own name wins when only one can fit. The
  ladder is still four levels and `area-levels.test.mjs` still asserts it.
  Because 14 boundary-less names may yet turn out to be clutter, the layer
  answers to a chip of its own ("Kvarter") in the layer menu — the first chip
  that is neither a pin nor basemap, and the second that starts on. Turning it
  off restores the four levels exactly.

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

  **Fosie is the one that could not be done**: its core is already spoken for.
  The OSM Fosie node lands in Gullviksborg, which `Gullvik` holds, and the stops
  named for it scatter across Fosieby, Lindängen, Holma and Lindeborg — Fosieby,
  the village and church the name comes from, is a grouping already. Malmö's
  historic in-between division (Västra Förstaden = Fridhem + Mellanheden +
  Västervång, Mellersta Förstaden, Södra Förstaden, Östra Förstaden,
  Pildammsstaden) is the right grain and would fill much of what is still blank,
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

  *Where the pins come from.* The four Overpass overlays became thirteen
  categories without a single new fetch, because the POIs were already on disk:
  the pmtiles archive holds 4,227 of them with an OpenMapTiles `class` each, so
  a category is a filter over `source-layer: poi`. The basemap's own `poi_z15`
  and `poi_z16` are consequently dropped from the style — drawn as well, they
  would double every café the moment you tapped "Mat", and their rank filters
  had a hole in them anyway (`poi_z14` was dropped long ago, so ranks 1–6 were
  never drawn at all — the most prominent POIs in each tile, invisible). One
  overlay stays GeoJSON because the tiles do it worse: the cycle network, which
  is lines and includes named routes the tiles don't carry. `food.geojson`,
  `culture.geojson` and `transit.geojson` are still built for the search index
  but no longer drawn or precached.

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

- **The layer menu is a closed panel, and a chip keeps its promise**
  (2026-07-27). Four changes to the chips, one week after they were built, all
  from the same complaint: a row of fourteen categories along the bottom is
  something you read past every time you look at the map.

  *A column behind one button, closed by default.* Fourteen chips in a row is a
  row you have to scroll to read, and a menu you scroll is a menu you stop
  reading; stacked in a panel, the whole list is one glance. It opens closed
  every time — not remembered — because the map is the app and the menu is a
  detour. Closed means `hidden`, not scrolled away or faded out: the chips leave
  the tab order with the pixels, which is the same rule the map obeys.

  *Kollektivtrafik is cut.* Rail stations at z11 were the argument for a chip of
  their own, but the rail lines are drawn at those zooms anyway, and a station
  pin on top of the line it sits on says nothing the map wasn't already saying.
  The stations stay in the search index, which is where you actually reach for
  one by name — so `transit.geojson` is still built, just no longer drawn or
  precached. Bus stops were cut a day earlier for a different reason (427 of
  them is texture, not detail).

  *An icon per chip.* Path data in `categories.mjs` beside the colour, not
  thirteen files: the chip row is the only thing that draws them, they are ~200
  bytes each, and a category cannot be added without one because the test says
  so. Drawn in the category's own colour, so the chip is still the legend.

  *A chip that is on shows its pins.* POIs exist in the tiles from z14 and
  nowhere earlier, so turning on "Mat" at z12 used to grey the chip out and wait
  for you to work out why nothing happened. Now the map goes to where the data
  is — and the names arrive with the dots instead of a zoom and a half later.
  The greyed-out state survives for one case only: a category restored from last
  time, where the saved view outranks the chip. The alternative — extracting the
  4,227 POIs to GeoJSON so they have no floor at all — buys a genuinely
  floorless category at the price of a new build step, another precached file,
  and every café in Malmö as one mass of dots at z11 with no rank to thin it by.
  Not worth it yet.

  *And what is hidden is not tappable.* Selection reads the layer registry
  rather than the shape of a layer id, so a category you turned off cannot be a
  hidden answer waiting to be found. The one hit that could survive its layers
  being hidden was the street fallback, which searches the *source* (a tap
  within 14 px of a named way, not of its label) and so ignores visibility
  entirely: it is now off when "Bilvägar" is.

- **Toolchain: Homebrew + Node, no Docker** (2026-07-17). `osmium-tool`, keg-only
  `openjdk@21`, `tools/planetiler.jar`; all scripts in Node so the search-index
  shape is defined once, where the app consumes it.

- **Hosting simplified to plain static files** (2026-07-26). The earlier design
  (cron regeneration on a server, content-hash filenames, manifest.json, atomic
  deploys, nginx tuning) was machinery for a server that doesn't exist. Cut; no
  deploy tooling written. This is a personal map: rebuild locally, upload. Only
  hard requirements: HTTPS + Range support for `.pmtiles`.
