// Build overlay GeoJSON files from Overpass. Each feature carries only
// name, osm_id, source tag(s) — nothing else, to keep files small.
// Districts are intentionally skipped for now (OSM sub-municipal coverage
// for Malmö is unreliable; see project notes).
//
// Usage: node scripts/build-overlays.mjs [--refresh] [--out DIR]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { overpass, bboxClause, elementPoint } from './lib/overpass.mjs';

const args = process.argv.slice(2);
const refresh = args.includes('--refresh');
const outDir = (() => {
  const i = args.indexOf('--out');
  return i >= 0 ? args[i + 1] : 'build/data';
})();

const { bbox } = JSON.parse(await readFile('config/bbox.json', 'utf8'));
const bb = bboxClause(bbox);
await mkdir(outDir, { recursive: true });

const osmId = (el) => `${el.type}/${el.id}`;
const feat = (geometry, properties) => ({ type: 'Feature', geometry, properties });
const point = (coords, properties) => feat({ type: 'Point', coordinates: coords }, properties);

/** Convert point-ish Overpass elements to a FeatureCollection. */
function pointLayer(json, propFn) {
  const features = [];
  for (const el of json.elements ?? []) {
    const p = elementPoint(el);
    if (!p) continue;
    const props = propFn(el);
    if (!props) continue;
    features.push(point(p, { osm_id: osmId(el), name: el.tags?.name ?? null, ...props }));
  }
  return { type: 'FeatureCollection', features };
}

// ---- food: restaurant, fast_food, cafe, bar, pub, ice_cream --------------
async function food() {
  const ql = `[out:json][timeout:180];
    ( nwr["amenity"~"^(restaurant|fast_food|cafe|bar|pub|ice_cream)$"]${bb}; );
    out center;`;
  const json = await overpass(ql, { label: 'food', refresh });
  return pointLayer(json, (el) => ({ amenity: el.tags.amenity }));
}

// ---- culture: museum/artwork/gallery, theatre/arts_centre, historic, memorial
async function culture() {
  const ql = `[out:json][timeout:180];
    (
      nwr["tourism"~"^(museum|artwork|gallery)$"]${bb};
      nwr["amenity"~"^(theatre|arts_centre)$"]${bb};
      nwr["historic"]${bb};
      nwr["memorial"]${bb};
    );
    out center;`;
  const json = await overpass(ql, { label: 'culture', refresh });
  return pointLayer(json, (el) => {
    const t = el.tags;
    let kind = null;
    if (t.tourism && /^(museum|artwork|gallery)$/.test(t.tourism)) kind = t.tourism;
    else if (t.amenity && /^(theatre|arts_centre)$/.test(t.amenity)) kind = t.amenity;
    else if (t.memorial) kind = 'memorial';
    else if (t.historic) kind = `historic:${t.historic}`;
    return kind ? { kind } : null;
  });
}

// ---- transit: railway stations + tram stops only -------------------------
// Bus stops and PT platforms were cut (owner decision 2026-07-26): the two
// tags largely duplicate the same physical stop, and ~2k bus-stop pins are
// clutter on a reference map.
//
// Nothing on the map draws this any more (the Kollektivtrafik chip was cut,
// 2026-07-27); it is built for the search index alone, where a station is
// still a thing you look up by name.
async function transit() {
  const ql = `[out:json][timeout:180];
    (
      nwr["railway"="station"]${bb};
      nwr["railway"="tram_stop"]${bb};
    );
    out center;`;
  const json = await overpass(ql, { label: 'transit', refresh });
  return pointLayer(json, (el) => ({
    kind: el.tags.railway === 'tram_stop' ? 'tram_stop' : 'station',
  }));
}

// ---- cycling: route=bicycle relations (named) + highway=cycleway ways -----
// Lines, not points. `out geom` gives each way a geometry array; relations
// give member geometries. kind distinguishes official route from generic.
async function cycling() {
  const ql = `[out:json][timeout:240];
    (
      relation["route"="bicycle"]${bb};
      way["highway"="cycleway"]${bb};
    );
    out geom;`;
  const json = await overpass(ql, { label: 'cycling', refresh });
  const features = [];
  const line = (coords) => coords.map((g) => [g.lon, g.lat]);
  for (const el of json.elements ?? []) {
    const t = el.tags ?? {};
    if (el.type === 'way' && el.geometry && t.highway === 'cycleway') {
      features.push(feat(
        { type: 'LineString', coordinates: line(el.geometry) },
        { osm_id: osmId(el), name: t.name ?? null, ref: null, kind: 'cycleway' },
      ));
    } else if (el.type === 'relation' && el.members) {
      const parts = el.members
        .filter((m) => m.type === 'way' && Array.isArray(m.geometry) && m.geometry.length > 1)
        .map((m) => line(m.geometry));
      if (!parts.length) continue;
      features.push(feat(
        { type: 'MultiLineString', coordinates: parts },
        { osm_id: osmId(el), name: t.name ?? t.ref ?? null, ref: t.ref ?? null, kind: 'route' },
      ));
    }
  }
  return { type: 'FeatureCollection', features };
}

// ---- run ------------------------------------------------------------------
const layers = { food, culture, transit, cycling };
const summary = [];
for (const [name, fn] of Object.entries(layers)) {
  console.log(`\n== ${name} ==`);
  const fc = await fn();
  const file = `${outDir}/${name}.geojson`;
  await writeFile(file, JSON.stringify(fc));
  const kb = (statSync(file).size / 1024).toFixed(0);
  summary.push({ layer: name, features: fc.features.length, kb });
  console.log(`  -> ${file}: ${fc.features.length} features, ${kb} KB`);
}

console.log('\n=== overlay summary ===');
for (const s of summary) console.log(`  ${s.layer.padEnd(9)} ${String(s.features).padStart(6)} feat  ${String(s.kb).padStart(6)} KB`);
