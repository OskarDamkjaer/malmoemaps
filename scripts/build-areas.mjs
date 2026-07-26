// Phase 3 — stadsdelar, the large areas people actually name.
//
// "Var bor du?" is answered with Limhamn, Rosengård, Kirseberg, Centrum — and
// none of those are in the administrative data this map already has. OSM knows
// the *names* (place=suburb nodes) but has no boundary for them; the 136
// delområden are the wrong grain; the five stadsområden (Norr, Söder, …) are a
// division nobody said out loud even when it existed.
//
// Malmö stad publishes the ten stadsdelar as CC0 open data, with real polygons.
// That is the layer, and it is worth the one build-time dependency: it is the
// only source for a shape you can point at when someone says "Limhamn".
//
// The division is historical (stadsdelsförvaltningarna, 1996–2013). The city
// has had no sub-municipal administration since, so there is no current
// equivalent to prefer — and the names outlived the offices.
//
// Also computed here: which delområden each stadsdel contains, so that tapping
// one can say what it covers rather than just drawing a line around it.
//
// Usage: node scripts/build-areas.mjs [--out DIR] [--refresh]
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { PolygonIndex, dissolveBoundary, distance, interiorPoint } from './lib/geo.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const outDir = arg('--out', 'build/data');
const refresh = args.includes('--refresh');

// CKAN resource id, pinned: the dataset is versioned by resource, so this is
// the specific file that was diffed, not "whatever is current".
const STADSDELAR = 'https://opendata-api.malmo.se/dataset/3b1e0328-2c40-4400-88f0-0f84c9327955'
  + '/resource/2b50e053-6cd2-4423-9a1a-ad1d0747e566/download/stadsdelar_4326.geojson';
const cacheFile = 'data/cache/stadsdelar_4326.geojson';

if (!existsSync(cacheFile) || refresh) {
  console.log('fetching stadsdelar from Malmö stad open data (CC0) …');
  const res = await fetch(STADSDELAR);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${STADSDELAR}`);
  mkdirSync('data/cache', { recursive: true });
  writeFileSync(cacheFile, await res.text());
} else {
  console.log('using cached stadsdelar_4326.geojson');
}

// The city ships names in caps ("SÖDRA INNERSTADEN"); the map sets its own
// case, so store them the way they are spoken.
const titleCase = (s) => s.toLocaleLowerCase('sv')
  .replace(/(^|[\s-])([\p{L}])/gu, (_, sep, c) => sep + c.toLocaleUpperCase('sv'));

const src = JSON.parse(readFileSync(cacheFile, 'utf8'));
const districts = JSON.parse(readFileSync(`${outDir}/districts.geojson`, 'utf8'));
const delomraden = districts.features.filter((f) => f.properties.admin_level === 10);

const stadsdelar = src.features.map((f) => ({
  type: 'Feature',
  geometry: f.geometry,
  properties: {
    name: titleCase(f.properties.sdf_namn),
    kod: f.properties.sdf_kod,
    // Rounded to whole km²: this is for a sentence on a card, not for planning.
    area_km2: Math.round((f.properties.area_kvm ?? 0) / 1e6),
    covers: [],
  },
}));

// Which delområde sits in which stadsdel, by interior point. The two divisions
// are drawn independently, so a delområde that straddles a boundary lands in
// whichever stadsdel holds its interior point — reported below so a bad split
// is visible rather than silent.
const index = new PolygonIndex(stadsdelar);
const orphans = [];
for (const d of delomraden) {
  const hit = index.find(interiorPoint(d.geometry));
  if (!hit) { orphans.push(d.properties.name); continue; }
  hit.properties.covers.push(d.properties.name);
}
for (const s of stadsdelar) s.properties.covers.sort((a, b) => a.localeCompare(b, 'sv'));

mkdirSync(outDir, { recursive: true });
const file = `${outDir}/stadsdelar.geojson`;
writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features: stadsdelar }));

// The top of the ladder: Malmö, one shape. The city publishes no such polygon
// and the kommun boundary in OSM runs out into the Öresund, so the honest
// outline of "Malmö" is the ten stadsdelar with the lines between them taken
// out — the extent of the city as the city itself divides it.
//
// Rings under 250 m are dropped: they are slivers where two stadsdelar fail to
// share a vertex, not coastline. (One appears, 121 m, near Kalkbrottet.)
const SLIVER_M = 250;
const ringLength = (line) => line.reduce((s, c, i) => (i ? s + distance(line[i - 1], c) : 0), 0);
const outline = dissolveBoundary(stadsdelar.map((f) => f.geometry))
  .filter((line) => ringLength(line) >= SLIVER_M)
  .map((line) => line.map((c) => c.map((v) => Number(v.toFixed(6)))));

const kommunFile = `${outDir}/kommun.geojson`;
writeFileSync(kommunFile, JSON.stringify({
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    geometry: { type: 'MultiLineString', coordinates: outline },
    // No label point: the name at this level is the basemap's own "Malmö",
    // which build-style.mjs caps at TIER.stadsdel so it leaves when the
    // stadsdelar arrive.
    properties: { name: 'Malmö' },
  }],
}));

const kb = (statSync(file).size / 1024).toFixed(0);
console.log(`\n-> ${file}`);
console.log(`   ${stadsdelar.length} stadsdelar, ${kb} KB`);
console.log(`\n-> ${kommunFile}`);
console.log(`   Malmö outline: ${outline.length} ring(s), `
  + `${(outline.reduce((s, l) => s + ringLength(l), 0) / 1000).toFixed(0)} km, `
  + `${(statSync(kommunFile).size / 1024).toFixed(0)} KB`);
for (const s of stadsdelar.sort((a, b) => b.properties.covers.length - a.properties.covers.length)) {
  console.log(`   ${s.properties.name.padEnd(20)} ${String(s.properties.covers.length).padStart(3)} delområden`
    + `  ${s.properties.area_km2} km²`);
}
const placed = stadsdelar.reduce((n, s) => n + s.properties.covers.length, 0);
console.log(`\n   ${placed} of ${delomraden.length} delområden placed`);
if (orphans.length) console.log(`   ⚠ outside every stadsdel: ${orphans.join(', ')}`);
