// Phase 3 — the basemap style, carved from OSM Liberty.
//
// Writing a full OpenMapTiles style from scratch is weeks of work for a worse
// result: Liberty already solves the tedious 80 % (road casings, bridge and
// tunnel ordering, landuse palette). What it does not solve is *this* map — a
// single city, always north-up, where the point is that each zoom shows one
// more layer of detail and nothing else.
//
// So this is a carving, not a fork: the upstream style is pinned by commit and
// never hand-edited, and every change to it is one entry below with a reason.
// Re-running against a newer upstream is then a diff you can read.
//
// The zoom ladder (the whole reason this file exists):
//   z6-9    coast, Öresund, the bridge, "Malmö"
//   z10-12  major roads + rail, the canal ring, district names (from geojson)
//   z13-14  streets and their names, buildings, landmark icons
//   z15-16  everything: service roads, paths, POI labels
//
// Usage: node scripts/build-style.mjs [--out DIR] [--refresh]
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const outDir = arg('--out', 'build');
const refresh = args.includes('--refresh');

// Pinned: gh-pages moves, and a style that silently changes under the map is
// exactly the kind of surprise this project avoids.
const LIBERTY_SHA = '649d12a737503d3e7170dd26a80ab3a1e0f5c1a4';
const LIBERTY_URL = `https://raw.githubusercontent.com/maputnik/osm-liberty/${LIBERTY_SHA}/style.json`;
const cacheFile = 'data/cache/osm-liberty.json';

// Fonts vendored by fetch-app-assets.mjs — anything else would render as boxes.
const FONTS = new Set(['Roboto Regular', 'Roboto Medium', 'Roboto Condensed Italic']);

// ---- what gets cut, and why ------------------------------------------------
const DROP = {
  natural_earth: 'raster tiles from a third-party origin at runtime',
  'building-3d': 'extrusions need pitch; this map is flat and north-up',
  road_one_way_arrow: 'direction of travel is navigation, not orientation',
  road_one_way_arrow_opposite: 'direction of travel is navigation, not orientation',
  poi_z14: 'prominence at z14 is the curated landmark list, not OSM POI rank',
  poi_transit: 'transit is a toggleable overlay, and rail only (see DECISIONS)',
  // The names themselves are wanted — Slottsstaden and Limhamn are not
  // delområden and exist nowhere else — but they are redrawn by the app
  // (addAreaNameLayers), which can filter them against the district names so
  // "Gamla staden" doesn't appear twice in two spellings.
  place_other: 'redrawn by the app, deduplicated against the district labels',
  aeroway_fill: 'no airfield inside the bbox',
  aeroway_runway: 'no airfield inside the bbox',
  aeroway_taxiway: 'no airfield inside the bbox',
  landcover_ice: 'no glaciers in Skåne',
  boundary_3: 'län/region borders say nothing inside one municipality',
  'boundary_2_z0-4': 'capped at z5, below this tileset',
  state: 'no such label point inside a one-city extract',
  continent: 'no such label point inside a one-city extract',
  country_1: 'no such label point inside a one-city extract',
  country_2: 'no such label point inside a one-city extract',
  country_3: 'no such label point inside a one-city extract',
};

// ---- the zoom ladder, layer by layer ---------------------------------------
// Only minzoom/maxzoom/filter/paint deltas; everything else stays as upstream.
const MAJOR_ROAD = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'];
const OVERRIDE = {
  // z6-9 — water, the strait, the bridge, the city name.
  water_name_point: { minzoom: 6 },
  water_name_line: { minzoom: 6 },
  // The area hierarchy is one level at a time (see app/layers.js): Malmö alone,
  // then the ten stadsdelar, then the delområden. "Malmö" is the first level,
  // so it holds the widest view by itself and stands down when the stadsdel
  // names take over; the neighbouring towns are level-3 grain and wait for it.
  place_city: { minzoom: 6, maxzoom: 12.8 },
  place_town: { minzoom: 12.8 },
  place_village: { minzoom: 12.8 },
  // The Sweden–Denmark line through the sound is real orientation; the rest of
  // the boundary work was dropped above.
  'boundary_2_z5-': { minzoom: 6 },

  // z10-12 — the skeleton: major roads, rail, the canal ring.
  road_trunk_primary: { minzoom: 10 },
  road_trunk_primary_casing: { minzoom: 10 },
  road_major_rail: { minzoom: 10 },
  road_major_rail_hatching: { minzoom: 10 },
  // Every ring road and E-road carries a number, and at overview zoom the
  // shields outnumber the streets. They earn their place once roads are named.
  road_shield: { minzoom: 12 },
  road_secondary_tertiary: { minzoom: 12 },
  road_secondary_tertiary_casing: { minzoom: 12 },
  road_label: { minzoom: 12, filter: ['all', ['in', 'class', ...MAJOR_ROAD]] },

  // z13-14 — streets, buildings.
  road_minor: { minzoom: 13 },
  road_minor_casing: { minzoom: 13 },
  building: { minzoom: 14, maxzoom: 17 },

  // z15-16 — the last details. Transit POIs are excluded for the same reason
  // the transit overlay is rail only: a bus stop every 300 m is not detail,
  // it is texture, and it arrives exactly where the map gets busiest.
  poi_z15: {
    filter: ['all', ['==', '$type', 'Point'], ['>=', 'rank', 7], ['<', 'rank', 20],
      ['!in', 'class', 'bus', 'rail', 'railway', 'airport']],
  },
  poi_z16: {
    filter: ['all', ['==', '$type', 'Point'], ['>=', 'rank', 20],
      ['!in', 'class', 'bus', 'rail', 'railway', 'airport']],
  },
  road_service_track: { minzoom: 15 },
  road_service_track_casing: { minzoom: 15 },
  road_area_pattern: { minzoom: 15 },
};

// ---- layers Liberty doesn't have -------------------------------------------
// Street *names* need two speeds: the through-roads carry orientation and can
// appear early; the residential grid is noise until you are actually in it.
const CLONE = [{
  from: 'road_label',
  id: 'road_label_minor',
  after: 'road_label',
  patch: {
    minzoom: 15,
    filter: ['all', ['!in', 'class', ...MAJOR_ROAD]],
    layout: { 'text-size': { base: 1, stops: [[15, 9], [16, 11]] } },
  },
}];

// ---- fetch (cached; the pin means one download, ever) -----------------------
if (!existsSync(cacheFile) || refresh) {
  console.log(`fetching OSM Liberty @ ${LIBERTY_SHA.slice(0, 7)} …`);
  const res = await fetch(LIBERTY_URL);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${LIBERTY_URL}`);
  mkdirSync('data/cache', { recursive: true });
  writeFileSync(cacheFile, await res.text());
} else {
  console.log(`using cached OSM Liberty @ ${LIBERTY_SHA.slice(0, 7)}`);
}
const style = JSON.parse(readFileSync(cacheFile, 'utf8'));
const before = style.layers.length;

// ---- rewrite the frame -----------------------------------------------------
const { bbox, minzoom, maxzoom } = JSON.parse(readFileSync('config/bbox.json', 'utf8'));

style.name = 'Malmö';
style.metadata = {
  'malmoemaps:derived-from': `maputnik/osm-liberty@${LIBERTY_SHA}`,
  'malmoemaps:note': 'Generated by scripts/build-style.mjs — edit that, not this.',
};
// Same origin, no API keys, no CDN. pmtiles:// is served by the protocol the
// app registers; the app hands it the file, so the path here is only a key.
style.sources = {
  openmaptiles: {
    type: 'vector',
    url: 'pmtiles://malmo.pmtiles',
    attribution: '© <a href="https://openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> '
      + '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
    minzoom,
    maxzoom,
    bounds: [bbox.west, bbox.south, bbox.east, bbox.north],
  },
};
style.glyphs = '/glyphs/{fontstack}/{range}.pbf';
style.sprite = '/sprite/osm-liberty';
delete style.center;
delete style.zoom;
delete style.bearing;
delete style.pitch;

// ---- carve -----------------------------------------------------------------
const seen = new Set();
style.layers = style.layers.filter((l) => {
  seen.add(l.id);
  return !(l.id in DROP);
});

for (const [id, patch] of Object.entries(OVERRIDE)) {
  const layer = style.layers.find((l) => l.id === id);
  if (!layer) throw new Error(`OVERRIDE targets a layer that no longer exists: ${id}`);
  Object.assign(layer, patch);
  if (patch.maxzoom === undefined && layer.maxzoom !== undefined && patch.minzoom !== undefined
      && layer.maxzoom <= patch.minzoom) {
    // A patched minzoom that swallows the upstream maxzoom would hide the layer
    // entirely — that is a bug, not a style choice.
    throw new Error(`${id}: minzoom ${patch.minzoom} >= maxzoom ${layer.maxzoom}`);
  }
}

for (const spec of CLONE) {
  const src = style.layers.find((l) => l.id === spec.from);
  if (!src) throw new Error(`CLONE source missing: ${spec.from}`);
  const clone = structuredClone(src);
  clone.id = spec.id;
  for (const [k, v] of Object.entries(spec.patch)) {
    clone[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...clone[k], ...v } : v;
  }
  const at = style.layers.findIndex((l) => l.id === spec.after);
  style.layers.splice(at + 1, 0, clone);
}

// ---- check it hangs together -----------------------------------------------
const missing = Object.keys(DROP).filter((id) => !seen.has(id));
if (missing.length) throw new Error(`DROP lists layers upstream no longer has: ${missing.join(', ')}`);

for (const l of style.layers) {
  if (l.source && !style.sources[l.source]) throw new Error(`${l.id}: unknown source ${l.source}`);
  for (const f of [l.layout?.['text-font']].flat().filter((f) => typeof f === 'string')) {
    if (!FONTS.has(f)) throw new Error(`${l.id}: font "${f}" is not vendored`);
  }
  if (l.minzoom !== undefined && l.minzoom > maxzoom) throw new Error(`${l.id}: minzoom above the tileset`);
}

mkdirSync(outDir, { recursive: true });
const file = `${outDir}/style.json`;
writeFileSync(file, `${JSON.stringify(style, null, 2)}\n`);

const kb = (statSync(file).size / 1024).toFixed(0);
console.log(`\n-> ${file}`);
console.log(`   ${before} layers upstream → ${style.layers.length} (${Object.keys(DROP).length} dropped, `
  + `${Object.keys(OVERRIDE).length} retuned, ${CLONE.length} added), ${kb} KB`);
