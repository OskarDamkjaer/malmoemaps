# malmoemaps

A static, self-hosted, mobile-first **reference map of Malmö** — vector tiles from our
own origin, north-up, fully offline. Orientation tool, **not** navigation: no routing,
no directions, ever.

- **[SPEC.md](SPEC.md)** — the app definition (constraints, phases, features).
- **[DECISIONS.md](DECISIONS.md)** — decision log with real numbers.

## Layout

```
config/     bbox + tunable config
scripts/    build pipeline (osmium clip, Planetiler, Overpass overlays, search, deploy)
tools/      planetiler.jar (fetched, gitignored)
data/       cache/ (extracts, pmtiles, overpass cache) + sources/ (gitignored)
build/      staged/deployed artifacts (gitignored)
landmarks/  hand-curated seed + SVG icons
```

## Build (Phase 1)

Prereqs (macOS dev): `brew install osmium-tool openjdk@21`; Node ≥ 20.
`export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"` for Java.

```
# 1a — basemap tiles (monthly): download Sweden, clip, tile
scripts/build-basemap.sh          # -> data/cache/malmo.pmtiles (~13 MB)

# 1b — overlays + search (weekly)
node scripts/build-overlays.mjs   # -> build/data/{food,culture,cycling,transit}.geojson
```

Numbers, resource costs, and rationale live in DECISIONS.md.
