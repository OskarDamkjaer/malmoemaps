// Phase 2 — landmarks.geojson from the hand-curated list.
//
// landmarks/landmarks.json is the source of truth and is owner-edited. This
// script does two separable things:
//
//   --resolve   fill in missing lat/lon from Nominatim and write them back
//               into landmarks.json, each marked "verified": false
//   (default)   emit build/data/landmarks.geojson from whatever is resolved
//
// Coordinates are never silently trusted: anything the resolver guessed stays
// flagged until a human sets "verified": true, and the summary lists exactly
// what still needs eyeballing. Entries that stay unresolved are emitted with
// no geometry rather than a plausible-looking wrong point.
//
// Usage: node scripts/build-landmarks.mjs [--resolve] [--refresh] [--out DIR]
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { geocode } from './lib/nominatim.mjs';
import { PolygonIndex } from './lib/geo.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const resolve = args.includes('--resolve');
const refresh = args.includes('--refresh');
const outDir = arg('--out', 'build/data');
const srcFile = arg('--src', 'landmarks/landmarks.json');

const src = JSON.parse(readFileSync(srcFile, 'utf8'));
const list = src.landmarks;
const { bbox } = JSON.parse(readFileSync('config/bbox.json', 'utf8'));
const viewbox = [bbox.west, bbox.south, bbox.east, bbox.north];

// ---- resolve ---------------------------------------------------------------
if (resolve) {
  const pending = list.filter((l) => typeof l.lat !== 'number' || typeof l.lon !== 'number');
  console.log(`resolving ${pending.length} of ${list.length} landmarks (1 req/s, cached)…\n`);

  for (const l of pending) {
    const query = l.query ?? `${l.name}, Malmö`;
    let results;
    try {
      results = await geocode(query, { viewbox, refresh });
    } catch (err) {
      console.log(`  ✗ ${l.name}\n      ${err.message}`);
      continue;
    }
    if (!results.length) {
      console.log(`  ✗ ${l.name}\n      no result in bbox for "${query}"`);
      continue;
    }
    const hit = results[0];
    l.lat = Number(Number(hit.lat).toFixed(5));
    l.lon = Number(Number(hit.lon).toFixed(5));
    l.verified = false;
    l._resolved = { display_name: hit.display_name, type: hit.type, osm: `${hit.osm_type}/${hit.osm_id}` };
    const alt = results.length > 1 ? `  (+${results.length - 1} other match${results.length > 2 ? 'es' : ''})` : '';
    console.log(`  · ${l.name}\n      ${hit.display_name}${alt}`);
  }

  // Write back, preserving the doc block and key order.
  writeFileSync(srcFile, `${JSON.stringify(src, null, 2)}\n`);
  console.log(`\n-> ${srcFile} updated (resolved coords marked "verified": false)`);
}

// ---- emit ------------------------------------------------------------------
const districts = JSON.parse(readFileSync(`${outDir}/districts.geojson`, 'utf8'));
const index = new PolygonIndex(districts.features.filter((f) => f.properties.admin_level === 10));

const features = [];
const unresolved = [];
const unverified = [];
const outsideBbox = [];

for (const l of list) {
  if (typeof l.lat !== 'number' || typeof l.lon !== 'number') { unresolved.push(l.name); continue; }
  if (l.lon < bbox.west || l.lon > bbox.east || l.lat < bbox.south || l.lat > bbox.north) {
    outsideBbox.push(l.name);
    continue;
  }
  if (l.verified !== true) unverified.push(l.name);
  features.push({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [l.lon, l.lat] },
    properties: {
      name: l.name,
      tier: l.tier,
      icon: l.icon,
      min_zoom: l.min_zoom,
      description: l.description,
      district: index.find([l.lon, l.lat])?.properties.name ?? null,
      verified: l.verified === true,
    },
  });
}

features.sort((a, b) => a.properties.tier - b.properties.tier
  || a.properties.name.localeCompare(b.properties.name, 'sv'));

mkdirSync(outDir, { recursive: true });
const file = `${outDir}/landmarks.geojson`;
writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features }));

const t1 = features.filter((f) => f.properties.tier === 1).length;
const kb = (statSync(file).size / 1024).toFixed(0);
console.log(`\n-> ${file}`);
console.log(`   tier 1: ${t1}   tier 2: ${features.length - t1}   total ${features.length}, ${kb} KB`);
if (outsideBbox.length) console.log(`\n   ⚠ ${outsideBbox.length} outside the bbox, dropped: ${outsideBbox.join(', ')}`);
if (unresolved.length) console.log(`\n   ⚠ ${unresolved.length} unresolved (no coords): ${unresolved.join(', ')}`);
if (unverified.length) {
  console.log(`\n   ${unverified.length} awaiting hand-verification — check each on the map,`);
  console.log(`   then set "verified": true in ${srcFile}:`);
  for (const n of unverified) console.log(`     · ${n}`);
}
if (!unresolved.length && !unverified.length) console.log('\n   all landmarks resolved and verified.');

// Icons referenced but not yet drawn — useful when scaffolding the sprite set.
const icons = [...new Set(list.map((l) => l.icon))].sort();
console.log(`\n   icon ids in use (${icons.length}): ${icons.join(', ')}`);
