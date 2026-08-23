# Where Förr's photographs come from

Provenance for everything in `game/photos/`. Two archives, both public, both
queried by `scripts/propose-photos.mjs`. Nothing here was scraped from a search
engine, and nothing is used whose licence does not permit it.

If you are looking for *why* the mode is shaped the way it is, that is in
`DECISIONS.md`. This file is the paper trail: what came from where, under what
terms, and what had to be worked around to get it.

---

## 1. K-samsök — everything before 2000

**Who.** Riksantikvarieämbetet's national aggregator for Swedish cultural
heritage, and through it **Malmö Museer**, whose collection management system is
Carlotta (`carlotta.malmo.se`). A few hundred records come from Kulturen,
Riksantikvarieämbetet itself and a handful of other institutions.

**Endpoint.** `https://kulturarvsdata.se/ksamsok/api`, `method=search`,
`recordSchema=presentation`. No key is needed for development (`x-api=test`); a
free key goes in `KSAMSOK_KEY` for anything heavier. A full sweep is about 70
paged requests and every response is cached under `data/cache/ksamsok/`.

**Query.**

```
itemType=foto AND placeName=Malmö
  AND mediaLicense="http://kulturarvsdata.se/resurser/license#pdmark"
  AND fromTime>=1880 AND toTime<=1999
```

…repeated for `#by` and `#cc0`. The licence value **must be the full URI**. The
short form the documentation suggests (`"License#pdmark"`) matches nothing, and
does not error — it returns `totalHits` 0.

**Volume.** ~35 000 records read, ~22 000 with a usable year, **~3 400
placeable**.

**Licences taken.** Public Domain Mark, CC BY, CC0.
**Licences refused.** `#inc` (in copyright) and `#by-nc-nd`. NC because a
non-commercial restriction is not ours to accept on someone else's behalf, and ND
because a photograph resized to 900 px is a derivative.

**Metadata licence.** All Malmö Museer records are CC0, so the Swedish
descriptions shown after a guess are freely reusable.

**How the year is derived.** From the `pres:context` block whose `pres:event` is
`Fotograferad`, and from no other. Where a record has exactly one context and it
carries no event label — Riksantikvarieämbetet's records are like this — that one
is accepted instead. A range of three years or less is averaged; anything wider
is dropped rather than guessed at.

**How the place is derived.** By matching `pres:description` against the 384
names the quiz already holds geometry for (`build/data/learn.json`), whole words
only. **The archive has no coordinates at all** — `geoDataExists=j` returns zero
across the entire collection — so a record that names nothing the map knows is
not used.

**Images.** `pres:src type="lowres"` from Carlotta, typically 3000–4000 px
grayscale scans.

---

## 2. Wikimedia Commons — everything from 2000

**Who.** Individual photographers and Flickr imports, via
`commons.wikimedia.org/w/api.php`.

**How the files are found.** `generator=geosearch`, swept as a grid over the
bbox in `config/bbox.json` — a single geosearch is capped at 10 km and 500
results, so one call centred on Stortorget silently returns the 500 nearest and
calls it the city. Cells are 0.02° of latitude apart with a 2.5 km radius, so the
circles overlap and the overlap costs requests rather than correctness.

**Volume.** ~1 000 geotagged files, **915 usable** — in the bbox, dated,
credited and openly licensed.

**Categories are never used to find files.** Only to label what a photograph is
*of*. The category graph leaks badly: `People of Malmö` at depth two reaches
individual people and then photographs of them taken anywhere in the world, and
`Eurovision Song Contest 2024` returns files from 2004. A coordinate inside the
bbox is a fact; category membership is somebody's filing decision.

**Licences taken.** An allowlist, not a blocklist — CC0, Public Domain, and
`CC BY` / `CC BY-SA` at any version. An unrecognised licence string is refused,
because the failure mode of guessing is publishing somebody's photograph without
the right to.

**CC BY-SA and ShareAlike.** Most of the modern half is CC BY-SA. Resizing makes
a derivative and that derivative stays CC BY-SA, which is fine and is already
what `learn/images` does. What travels with it is the credit, which is why a file
with no `Artist` is refused outright rather than shipped uncredited.

**How the year is derived.** `extmetadata.DateTimeOriginal`, clamped to
1840–present. A date outside that is a typo in the metadata, not a discovery.

**How the place is derived.** From the file's own coordinates. No geocoding, no
name matching, no inference — the camera said where it was. The `place` field on
these rows is only a *label*: the nearest thing the quiz has a name for within
400 m, used for the reveal text. The answer graded against is always the
coordinate.

---

## 3. What is not used, and why

| Source | Why not |
|---|---|
| **Malmö stadsarkiv / Alvin** | ~100 000 digitised photographs with date, photographer and place, migrated to Alvin in April 2026, and their FAQ says downloading is allowed. But the web UI sits behind Anubis proof-of-work and no Malmö set appears in Alvin's OAI-PMH `ListSets`. **The best unexplored lead by a wide margin** — worth emailing stadsarkiv@malmo.se for the set spec or a bulk dump. |
| **Europeana** | Re-serves the same Malmö Museer material with a rights field, and its `edmPlaceLatitude` is a *place-entity centroid*, not a photo location — a bbox query around Malmö comes back dominated by Natural History Museum herbarium specimens all sharing one coordinate. |
| **DigitaltMuseum** | Malmö Museer are not on it. `artifact.coordinate` and `production.fromYear` appear in the field list but are not indexed for filtering, so neither can be queried. |
| **Riksarkivet** | IIIF access is limited to material 110 years or older, so ≤1916 only. |
| **Flickr Commons** | The Swedish holdings that matter are already mirrored to Commons. |
| **Alamy and other stock** | What TimeGuessr pays for. Out of scope for a static, self-hosted, no-budget project. |

---

## 4. Five traps, all of which fail silently

Every one of these produced plausible-looking wrong data before it was caught.
They are the reason `scripts/lib/ksamsok.mjs` and `scripts/lib/commons.mjs` exist
rather than two `fetch` calls.

1. **The year is not the first year in the record.** K-samsök records carry
   several contexts — Fotograferad, Tillverkad, Förvärvad, Ägd — and *Förvärvad
   is when the museum bought it*. Across 2 000 records, taking the first one
   found was off by a **median of 84 years** and a maximum of 124: it dates an
   1865 photograph to 1949.

2. **`fromTime` / `toTime` do not mean what they say.** A query for 1980–1989
   returns records whose own `timeLabel` reads 1943. The counts that suggested
   ~750 photographs per five-year band through the 1980s and 1990s were counting
   1940s material. The real distribution can only be measured *after* parsing the
   year out of each record — which is how the 1980s turned out to hold sixteen
   photographs rather than seven hundred.

3. **The place is in the description, not in `pres:content`.** Content looks like
   the right field — it holds a street address in some records — but it is mostly
   accession numbers and the credit boilerplate `Foto: X / Malmö museum`.
   Matching place names against it makes every one of eleven thousand
   photographs a photograph of Malmö Museer: **208 false hits per 2 000 records,
   against 9** when only the description is read.

4. **The Carlotta image URL does not work as published.** It arrives as `http://`
   with `+` for spaces, and fetched that way returns **HTTP 200 with an HTML
   error page** — 77 KB of markup with `.jpg` on the end of the URL. Nothing in
   the status line says it failed, so the content type is checked instead. See
   `scripts/lib/carlotta.mjs`.

5. **A Commons coordinate says where the camera was, not what it was pointed
   at.** A photograph of a seed-vault storage box, taken in an office in Malmö
   and geotagged there, is a perfectly good file and an impossible question.
   These are flagged for the hand pass, not filtered — a rule cannot tell.

A sixth, smaller one: matching place names needs **whole-word** comparison, and
JavaScript's `\b` is ASCII-only, so `/\bMalmö\b/` does not match "Malmö". Without
the hand-written boundary test, "Hindbyvägen" reads as the delområde Hindby and
the photograph is pinned half a kilometre from the road it is of.

---

## 5. Decisions about the set itself

- **The join is at the year 2000.** Not a tuning parameter — it is where each
  archive stops being able to help. Commons has seven usable photographs from
  before it; K-samsök has almost none after.

- **The distribution is a declared quota, not an emergent property.** `QUOTA` in
  `propose-photos.mjs` sets how many photographs each decade contributes.
  Proportional to supply would be a quiz about 1900 (a third of everything
  placeable is from that one decade); flat would spend as much on the 1880s as on
  the 2010s. It ramps instead: counted per year, the 120 years before 2000 get
  about one photograph each and the 26 years after get about four.

- **The 1970s to the 1990s are a hole, and it is the archives' rather than the
  pipeline's.** Placeable supply runs to hundreds a decade until 1970 and then
  falls off a cliff: **19 from the 1970s, 1 from the 1980s, 12 from the 1990s.**
  Malmö Museer's open material is old because Public Domain Mark and age are the
  same fact, and Commons barely existed before digital cameras. The quota is set
  to what can be had, and `photo-candidates.md` prints supply beside quota so a
  thin row reads as a fact about Malmö's archives.

- **The cap on one place is per place *and decade*.** Stortorget in 1890 and
  Stortorget in 1960 are not the same question — the year is half the answer, and
  the same square seventy years apart is the clearest way the game can say so.
  Capping per place alone kept three Stortorgets and all of them from the 1890s,
  because the archive is deepest where it is oldest.

- **Photographs with people in them are preferred.** A crowd gives you far more to
  date a picture by than a facade does — clothes, prams, cars, what people are
  carrying. `SUBJECTS` in `propose-photos.mjs` detects them and `balanced` ranks
  them first.

- **Maps, plans and posters are refused outright**, not flagged. Left as a "?"
  they get picked wherever supply is thin, which is exactly where the archive is
  worst — a 1973 land-use plan reached the game that way.

---

## 6. Attribution

Every photograph carries a `credit` and a `source`, and both are shown on the
reveal — never in a footer, never only on the file page. Roughly a third of the
set is Public Domain Mark, which asks for nothing; the rest is CC BY or CC BY-SA,
which asks for attribution and gets it either way, because a photograph is
someone's work.

The credit lines read:

```
Foto: Ragnar Küller / Malmö Museer · Public Domain Mark
Foto: Bo F. Mårtensson · CC0 · Wikimedia Commons
```

`scripts/build-game.mjs` fails the build for any photograph missing either field.

## 7. Manners

Both archives are public services run on somebody else's budget. So: every
response is cached to disk and re-runs hit the cache, Commons image downloads are
throttled to one every 250 ms and back off on HTTP 429, Nominatim (unused by
default) is capped at 1 req/s, and every request carries a User-Agent naming the
project with a way to get in touch. A full cold build is a few hundred megabytes
fetched once, by hand, a few times a year.
