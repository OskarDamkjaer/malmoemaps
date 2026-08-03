# malmoemaps

A way to **learn Malmö by heart**. Static, self-hosted, mobile-first: vector
tiles from my own origin, always north-up, installable and fully offline. Not
navigation, and no longer even orientation — the map is the board you are tested
on, not a thing to look something up in.

There is **one quiz**, and it is the city rather than a category: a row per part
of town, each holding whatever is in it — the delområden, the streets worth
knowing, the bridges, the landmarks. A round asks them in that order, a kind at
a time, one name at a time. Two ways to be asked, and they are the same question
in both directions:

- **Dra ut alla** — one name at a time, dragged out onto the map, and the map
  shows you where it could go: every delområde in the chunk if it is an area,
  every bridge if it is a bridge, every street if it is a street. A slot turns
  green once something has landed in it, so you can see what is left and the
  last few in a kind go by elimination. That is the easy direction, and it is
  where you start.
- **Peka ut** — one name, no slots, tap where it is. Nothing to eliminate
  against, so this is the one that says whether you actually know it.

Get it right and the map tells you something about the place: what Västra Hamnen
was before it was Västra Hamnen, why Augustenborg is famous outside Sweden, what
Suellsbron is named after. That card is the point; the placing is how it earns
your attention.

The old reference map is still here as **Utforska** — search, layer chips, tap
anything to find out what it is. It is where you go to learn the names in the
first place, so it is study material rather than a leftover. It is also
unreachable from inside a round, for the obvious reason.

## Principles

- **Static frontend.** A folder of files on a static host. No backend, no database,
  no accounts. The only moving part is the build pipeline, run when I feel like it.
- **Nothing leaves the device.** No analytics, cookies, or third-party requests at
  runtime. Geolocation stays in the browser.
- **No external tile or API calls at runtime.** Everything served from my origin.
- **Always north-up.** Rotation and pitch disabled — a fixed orientation builds a
  stable mental map.
- **Offline PWA.** The whole payload is 23.5 MB (basemap 13.3 MB, photographs 5.7 MB), so the service
  worker just caches all of it. Practising on a train with no signal is the
  normal case, not a degraded one.
- **Nothing is invented to fill a field.** The rule the area names already
  obeyed now covers the facts too: a place with nothing known about it gets a
  card with nothing on it but what the data can prove. See *What it says about
  a place*, below.
- **Attribution, always visible:** `© OpenMapTiles © OpenStreetMap contributors`
  (OSM part links to openstreetmap.org/copyright), plus a credit for Malmö
  stad's stadsdelar — CC0, so given because it is theirs, not because it is owed.

## Learning

- **The blind map is the whole idea.** While a round is running, *no layer that
  draws text is visible* — not the names of the thing being asked about, every
  name. A quiz played on the labelled map is not a test of whether you know
  where Sofielund is, it is a test of whether you can read "SOFIELUND", and the
  reading test is so much easier that it hides the fact that you failed the
  other one. The rule is blunt on purpose: names leak sideways (Petribron is
  also a street, Möllevångstorget is also a POI label), so anything subtler
  would have to know all of that and would be wrong quietly. `app/blind.js`
  applies it, `test/blind.test.mjs` asks the real style whether anything
  survived. What is left to reason from is coastline, water, parks, roads,
  buildings — and the outlines of whatever is being asked about, forced on at
  every zoom rather than only inside their own band of the ladder.

- **One quiz, four kinds of thing.** A kind is a property of the item, not of
  the game: it says how the thing is placed and how close counts
  (`app/rounds.mjs`, the one place the table exists — `scripts/build-learn.mjs`
  fills exactly the kinds it names, and `test/rounds.test.mjs` holds the two
  together):

  | kind | names | placed by |
  |---|---|---|
  | delområde | 136 | landing inside the shape |
  | gata | 174 | standing on the right street |
  | bro | 19 | landing within 120 m — they are 400 m apart |
  | landmärke | 55 | same, but 250 m, and nearer than to anything else |

  The order of that table is the order a round asks in; it lives in the
  declaration order of `KINDS` so the two cannot drift apart.

  Areas are graded through one lookup — *which delområde is this point in* —
  and streets reuse what the selection code already does: find the named street
  under your finger. Nothing here re-implements geometry the map already has.

  The four collide on six names: Pildammsparken and Augustenborg are both a park
  and a delområde, Öresundsbron is both a bridge and a landmark. Merged, those
  would be one question with two right answers, so the build keeps one of each —
  the kind you can stand *in* wins — and the survivor inherits the loser's
  description, which is usually the better written one.

- **Chunks are parts of town, not categories.** 384 names is not a round, and
  neither is "all the landmarks": standing on Föreningsgatan you want to know
  that this is Möllevången, that the bridge is Petribron and that the park is
  Pildammsparken, and that is three categories and one piece of knowledge. So
  the quiz is cut by stadsdel: ten chunks, one per part of town, each holding
  every delområde, street, bridge and landmark in it.

  They are uneven — Rosengård has 13 names, Centrum 120 — and that is honest,
  because those parts of town are not the same size either. An earlier cut
  sliced them down to twenty apiece so a tray would fit a phone screen without
  scrolling, and that turned out to be optimising the wrong thing: a twenty-name
  slice of Centrum is a few blocks, and a few blocks cannot hold a street.
  Amiralsgatan and Regementsgatan run the width of the city, so every chunk
  small enough to be comfortable was too small to contain the things most worth
  knowing. Nothing has to fit on a screen now that the tray holds one name.

- **A round runs a kind at a time**, in the order the kinds are declared in
  `app/rounds.mjs`: every delområde, then every gata, then the broar, then the
  landmärken, shuffled inside each. Mixing them cost more than it looked like it
  would — placing a delområde ("which of these outlines is it") and placing a
  bridge ("where on the water is it") are different jobs, and alternating means
  starting over on every question. Grouped, a run builds: the board lights the
  same set of slots for a dozen questions, and what you have already placed
  stays there to eliminate against.

- **Two strikes, then the answer.** A third guess at a name you have no idea
  about is stabbing at the map, not learning. The first miss says what you *did*
  hit ("Nej — det där är Sofielund"), which is what makes the second guess
  informed; the second flies you there, outlines it, and tells you about it.
  That is recorded as `helped` — neither right nor wrong, but it does mean you
  will be asked again sooner.

- **What it knows about you** (`app/progress.mjs`) is one localStorage key of
  small integers, keyed by *name*: "Sofielund" is a thing you either can or
  cannot place, and there is now exactly one Sofielund. Knowing is hard to reach
  and easy to lose — two right in a row, and one miss takes it away — because
  placing something correctly once is mostly evidence about the last ten
  seconds. Point mode asks in the order of what you keep missing — inside each
  kind, since the kinds themselves run in a fixed order — and the bar on a chunk
  is just how many of its names are known. Keying by name rather than by
  chunk is what lets the cut move — a new landmark shifting the west-to-east
  split of Centrum — without costing anyone what they had learned. Nothing
  leaves the device here either.

- **What it says about a place.** The card after a correct placement is why the
  app exists — a panel down the right of the map, a sheet along the bottom of a
  phone. Its coverage is deliberately uneven: 44 of 136 delområden have real
  text, all 55 landmarks, all 19 bridges, 36 of 174 streets. The rest place
  perfectly well and fall back on what the build can prove — "Delområde i
  Fosie", "Bro över Malmö kanal". A place I know nothing about says nothing
  rather than something invented. Area text lives in `learn/about.json`;
  everything else keeps its text next to its name in its own curated file. Every
  line is a draft marked `verified: false` — the same bargain `landmarks.json`
  already makes about coordinates.

- **And shows it.** 184 of the 384 names carry a photograph, fetched from
  Swedish Wikipedia by `scripts/build-images.mjs` and served from this origin
  like everything else — no runtime request leaves the device, and the card is
  the same on a train. A picture is only accepted if the article carries
  coordinates near the point the quiz already grades against: a wrong picture
  teaches you something false about a real place, and half the street names in
  Malmö are street names in every other Swedish town. Every picture shows who
  took it and under what licence, which is a condition of use rather than a
  courtesy. The 200 names with none simply have none — mostly the through-roads
  added last, which Wikipedia has no article about and should not.

## The map

Everything below describes the map itself, which is both the board the rounds
are played on and — with its labels back on — the **Utforska** mode you study
in. It did not change when the app did.

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
areas/      the in-between names, hand-written with a source each
learn/      what can be asked about and what is said back:
            about.json (area text), bridges.json, streets.json
```

The app is twelve files. The map: `index.html`, `app.css`, `app.js` (map,
chrome, chips, the two modes, boot), `layers.js` (areas, landmarks, category
plumbing), `categories.mjs` (the layer menu: what each chip stands for),
`area-levels.mjs` (the zoom ladder), `highlight.js` (what you tapped and its
shape — and, now, what the quiz is graded against, plus the tray board),
`kinds.js` (what an icon means, in Swedish), `search.js`. The learning:
`rounds.mjs` (what can be asked and what counts as knowing it),
`learn.js` (the loop and its chrome),
`progress.mjs` (what you know), `blind.js` (taking the words off the map). Plus
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
node scripts/build-learn.mjs        # areas + landmarks + learn/*.json → build/data/learn.json
node scripts/build-images.mjs       # Wikipedia → learn/images/*.webp + learn/images.json
node scripts/poi-inventory.mjs      # reads the tileset back: which POI classes it holds
```

`build-learn.mjs` is the one that will stop the build. It joins every curated
name to geometry that exists and to its text, and a name it cannot place is a
hard failure rather than a dropped row — an unplaceable name is an unanswerable
question, and the only thing worse than a round missing a name is a round asking
for one that cannot be pointed at. It also reads `app/rounds.mjs` — for the list
of kinds, so one added there and forgotten here fails at build time, and for the
chunker itself, so a chunk grown past the length cap stops the build rather
than turning up as a sitting nobody finishes.

`build-images.mjs` is the only script that talks to a third party, and it runs
when I ask it to rather than as part of a build. It reads `learn.json` for the
names and the points, asks Swedish Wikipedia for an article per name, and keeps
the picture **only if the article's own coordinates land near the point the quiz
grades against** — 2 km for a delområde, 4 km for a bridge (Öresundsbron is 8 km
long and our midpoint sits 2.7 km from Wikipedia's), 400 m for a landmark. An
article with no coordinates is not rejected as wrong but as unproven, which is
the same standard this pipeline holds names to. Everything it fetches is cached
under `data/cache/wiki/`, so re-runs cost four requests rather than six hundred.

Its output, `learn/images.json`, is versioned next to the curated data rather
than under `build/`: it is reviewable, and a bad pick can be corrected by hand
and marked `"pinned": true`, after which the script leaves it alone (including a
deliberate `"image": null` for "there is no good picture of this, stop looking").
The images themselves live in `learn/images/` for the same reason the landmark
icons do — a clone should be complete, and re-downloading 184 files from
Wikimedia on every build would be rude.

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

Four things here are worth testing, and all for the same reason: their bugs are
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

The third is the blinding, and it is the one that earns its keep. A label layer
that stays on during a round does not look like a bug — it looks like an easy
question. You would play the round, get it right, learn nothing, and never file
it. So `test/blind.test.mjs` hands the *real* built style plus the app's own
layers to the same function the running app uses and checks that nothing which
draws text survives, that the shapes do (a round played on a white rectangle is
not a round), and that every outline a round protects is a layer that still
exists.

The fourth is the quiz. Every failure mode there is quiet: a curated name with
no geometry is a question that can never be answered; a name in the set twice is
a question with two right answers, and the grader will mark you wrong for
finding the second; a chunk over the length cap is a round nobody finishes; an
area with no bbox frames its chunk too tight and pushes the polygon you are
meant to drop on off the screen. `test/rounds.test.mjs` asks all of those, plus
that a round asks a kind at a time and shuffles honestly inside one, that a
chunk is one part of town and that the cut is stable between calls,
plus the grader's own rules — nearest-wins, per-kind tolerances, and the pixel
floor that keeps 250 m from being a dare at a zoomed-out view.

`test/areas.test.mjs`, `test/style.test.mjs`, `test/categories.test.mjs`,
`test/rounds.test.mjs` and `test/blind.test.mjs` read `build/` and `data/`,
which are gitignored; they skip with a note rather than fail if you haven't
built yet.

## Hosting

```
node scripts/build-site.mjs         # → build/site (23.5 MB, 248 files) — upload as-is
```

Any static host over HTTPS (geolocation and service workers need it). The only
requirement beyond "serves files": HTTP **Range** support for `.pmtiles`. Same
origin as the app, so no CORS.

Cache headers don't matter much: the service worker precaches everything on
first load and only re-fetches when the cache names in `app/sw.js` change (code
and data are versioned separately, so an app edit doesn't re-download 13 MB).

Rationale for non-obvious choices lives in [DECISIONS.md](DECISIONS.md) — it gets
a dated bullet only when something non-obvious was actually decided.
