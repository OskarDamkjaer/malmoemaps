# To delete

Docs are already written as if this is done. Code to remove:

- **Förr** — `app/photos.js`, `app/photos.mjs`, `test/photos.test.mjs`,
  `game/`, `scripts/propose-photos.mjs`, `scripts/build-game.mjs`,
  `scripts/apply-review.mjs`, `scripts/review/`,
  `scripts/lib/{ksamsok,commons,carlotta}.mjs`; the photo markup in
  `index.html`, the photo chrome in `app.js` / `app.css`, the photo cache in
  `app/sw.js`, `game.json` + `photos/` in `scripts/build-site.mjs` and
  `scripts/lib/site.mjs`.
- **Search** — `app/search.js`, `scripts/build-search.mjs`, the search markup
  in `index.html` and its wiring in `app.js`, `/data/search.json` in
  `app/sw.js` and `build-site.mjs`. (`scripts/build-streets.mjs` **stays** —
  `build-learn.mjs` reads street geometry from it.)
- **Layer menu / pins** — `app/categories.mjs`, the Lager panel and chips in
  `index.html` / `app.js` / `app.css` / `app/layers.js`,
  `test/categories.test.mjs`. What the chips toggled becomes always-on
  (landmarks, kvarter names) or is already the basemap (roads).
- **POI overlays** — `scripts/build-overlays.mjs`, `scripts/poi-inventory.mjs`,
  `scripts/lib/overpass.mjs`, `build/data/{food,culture,cycling,transit}.geojson`.
- **Mode tabs** — `data-mode` chrome in `index.html` / `app.js`: the quiz is
  the only screen; the labelled map is a plain escape hatch from it.

Also check `scripts/serve.mjs` (the review write endpoint) and
`test/style.test.mjs` (may assert chip layers).
