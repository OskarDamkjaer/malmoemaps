// Phase 2 — districts.geojson from OSM admin boundaries.
// OSM coverage for Malmö is complete (verified 2026-07-17): admin_level=9 = 5
// stadsområden (coarse), admin_level=10 = 136 delområden (fine). Both are kept,
// tagged with admin_level so the map can show coarse at low zoom, fine higher.
// osmium assembles the multipolygons; we strip props and write minimal GeoJSON.
//
// Usage: node scripts/build-districts.mjs [--out DIR] [--pbf FILE]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const outDir = arg('--out', 'build/data');
const pbf = arg('--pbf', 'data/cache/malmo.osm.pbf');
const tmp = 'data/cache';
mkdirSync(outDir, { recursive: true });

// 1. Keep admin_level 9 + 10 relations (+ referenced members) from the clip.
execFileSync('osmium', ['tags-filter', pbf, 'r/admin_level=9', 'r/admin_level=10',
  '-o', `${tmp}/districts.osm.pbf`, '--overwrite'], { stdio: 'inherit' });

// 2. Assemble areas -> geojson (osmium builds valid multipolygons).
execFileSync('osmium', ['export', `${tmp}/districts.osm.pbf`, '-o', `${tmp}/districts-raw.geojson`,
  '-f', 'geojson', '--geometry-types=polygon', '--overwrite'], { stdio: 'inherit' });

// 3. Reduce to minimal features.
const raw = JSON.parse(readFileSync(`${tmp}/districts-raw.geojson`, 'utf8'));
const features = [];
for (const f of raw.features) {
  const p = f.properties ?? {};
  if (p.boundary !== 'administrative') continue;
  if (p.admin_level !== '9' && p.admin_level !== '10') continue;
  if (!p.name || !f.geometry || !/Polygon/.test(f.geometry.type)) continue;
  features.push({
    type: 'Feature',
    geometry: f.geometry,
    properties: {
      name: p.name,
      osm_id: p['@id'] ?? p.id ?? null,
      admin_level: Number(p.admin_level),
    },
  });
}
const fc = { type: 'FeatureCollection', features };
const file = `${outDir}/districts.geojson`;
writeFileSync(file, JSON.stringify(fc));

const n9 = features.filter((f) => f.properties.admin_level === 9).length;
const n10 = features.filter((f) => f.properties.admin_level === 10).length;
const kb = (statSync(file).size / 1024).toFixed(0);
console.log(`\n-> ${file}`);
console.log(`   admin_level 9 (stadsområden): ${n9}`);
console.log(`   admin_level 10 (delområden):  ${n10}`);
console.log(`   total ${features.length} polygons, ${kb} KB`);
