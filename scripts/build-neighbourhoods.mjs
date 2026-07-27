// Phase 3 — the neighbourhood level, and the parts below it.
//
// Between "Västra Innerstaden" and "Rönneholm" sits the name people actually
// use — Slottsstaden — and it is in no dataset: not in OSM (whose 37 suburb
// polygons are all delområde or stadsdel names already), not in Malmö stad's
// open data (whose in-between division, the 14 geografiska statistikområden, is
// named "Ribersborg, Bellevue m fl"). So areas/areas.json holds it, by hand,
// with a source per entry.
//
// Two outputs, because the file holds two shapes of thing:
//
//   neighbourhoods.geojson  the curated groupings, and only those: the names
//                           that exist between a stadsdel and a delområde.
//                           There are 31, so this file has holes — most of
//                           Malmö has no in-between name, and inventing one
//                           to fill the map would be the only dishonest thing
//                           this level could do. The holes are closed at draw
//                           time instead, without inventing anything: a
//                           delområde no grouping claims is elevated to level 3
//                           under its own name (app/area-levels.mjs). So this
//                           file stays exactly as long as the evidence is, and
//                           `covers` is what tells the app which 66 delområden
//                           are still unspoken for.
//   parts.geojson           the small named quarters (Fullriggaren, Seved),
//                           below the delområde level, points only. Built, but
//                           not currently drawn — see app/area-levels.mjs.
//
// A grouping has no polygon of its own: it *is* its members, so its outline is
// theirs with the seams between them removed (dissolveBoundary), and selecting
// it draws their polygons. Only parts are resolved from Nominatim — with the
// same rule as landmarks: a machine may fill in a coordinate, but only a human
// may call it verified.
//
// Usage: node scripts/build-neighbourhoods.mjs [--resolve] [--refresh] [--out DIR]
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import {
  PolygonIndex, dissolveBoundary, interiorPoint, bboxOf, flatCoords, pointInGeometry,
} from './lib/geo.mjs';
import { geocode } from './lib/nominatim.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const outDir = arg('--out', 'build/data');
const srcFile = arg('--src', 'areas/areas.json');
const resolve = args.includes('--resolve');
const refresh = args.includes('--refresh');

const src = JSON.parse(readFileSync(srcFile, 'utf8'));
const districts = JSON.parse(readFileSync(`${outDir}/districts.geojson`, 'utf8'));
const stadsdelar = JSON.parse(readFileSync(`${outDir}/stadsdelar.geojson`, 'utf8'));
const { bbox } = JSON.parse(readFileSync('config/bbox.json', 'utf8'));

const delomraden = new Map(districts.features
  .filter((f) => f.properties.admin_level === 10)
  .map((f) => [f.properties.name, f]));

const groupings = src.areas.filter((a) => a.covers?.length);
const parts = src.areas.filter((a) => a.within);

// ---- validate -------------------------------------------------------------
// A typo in `covers` would silently shrink an area, so it stops the build.
const unknown = [];
const claimed = new Map();
for (const a of groupings) {
  for (const name of a.covers) {
    if (!delomraden.has(name)) { unknown.push(`${a.name} → "${name}"`); continue; }
    if (claimed.has(name)) unknown.push(`${name} claimed by both ${claimed.get(name)} and ${a.name}`);
    claimed.set(name, a.name);
  }
}
for (const a of parts) {
  if (!delomraden.has(a.within)) unknown.push(`${a.name} → within "${a.within}"`);
}
if (unknown.length) {
  console.error('FATAL: areas.json refers to delområden that do not exist (or twice):');
  for (const u of unknown) console.error(`  ${u}`);
  process.exit(1);
}

// ---- resolve part coordinates ---------------------------------------------
if (resolve) {
  const pending = parts.filter((p) => typeof p.lat !== 'number' || typeof p.lon !== 'number');
  console.log(`resolving ${pending.length} of ${parts.length} parts (1 req/s, cached)…\n`);
  for (const p of pending) {
    let results;
    try {
      results = await geocode(p.query ?? `${p.name}, Malmö`, {
        viewbox: [bbox.west, bbox.south, bbox.east, bbox.north], refresh,
      });
    } catch (err) {
      console.log(`  ✗ ${p.name}: ${err.message}`);
      continue;
    }
    if (!results.length) { console.log(`  ✗ ${p.name}: no result in bbox`); continue; }

    // A part declares the delområde it is inside, which makes the geocoder
    // checkable: "Gamla Väster" came back as a fencing club in Gamla Limhamn,
    // and a name that is merely nearby is worse than no name at all. The first
    // result that lands inside the declared parent wins; if none does, nothing
    // is written and the entry stays unresolved.
    const parent = delomraden.get(p.within);
    const hit = results.find((r) => pointInGeometry(parent.geometry, [Number(r.lon), Number(r.lat)]));
    if (!hit) {
      console.log(`  ✗ ${p.name}: ${results.length} result(s), none inside ${p.within}`);
      console.log(`      best was: ${results[0].display_name}`);
      continue;
    }
    p.lat = Number(Number(hit.lat).toFixed(5));
    p.lon = Number(Number(hit.lon).toFixed(5));
    p.verified = false;
    p._resolved = { display_name: hit.display_name, type: hit.type, osm: `${hit.osm_type}/${hit.osm_id}` };
    console.log(`  · ${p.name}\n      ${hit.display_name}`);
  }
  writeFileSync(srcFile, `${JSON.stringify(src, null, 2)}\n`);
  console.log(`\n-> ${srcFile} updated (resolved points marked "verified": false)`);
}

// ---- the neighbourhood level ----------------------------------------------
const stadsdelIndex = new PolygonIndex(stadsdelar.features);

// Shoelace area and centroid of the outer rings, so "largest" means largest
// ground area rather than largest bounding box — Ribersborgsstranden is a
// 2 km beach strip with a huge box and almost no area, and picking it put
// Slottsstaden's name out in the water.
function ringStats(geometry) {
  const polys = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (const [outer] of polys) {
    for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
      const cross = outer[j][0] * outer[i][1] - outer[i][0] * outer[j][1];
      area += cross / 2;
      cx += (outer[j][0] + outer[i][0]) * cross;
      cy += (outer[j][1] + outer[i][1]) * cross;
    }
  }
  return { area: Math.abs(area), centroid: area === 0 ? null : [cx / (6 * area), cy / (6 * area)] };
}

// The label goes at the centroid of the whole grouping — that is where the name
// belongs — unless the grouping is concave enough that its centroid falls
// outside every member, in which case the biggest member's interior point is
// the honest fallback. A name floating in the neighbouring area is worse than
// a name slightly off-centre.
function labelPointFor(members) {
  const stats = members.map((f) => ({ f, ...ringStats(f.geometry) }));
  const total = stats.reduce((s, m) => s + m.area, 0);
  if (total > 0) {
    const point = [0, 1].map((k) => stats.reduce((s, m) => s + (m.centroid?.[k] ?? 0) * m.area, 0) / total);
    if (members.some((f) => pointInGeometry(f.geometry, point))) return point;
  }
  const biggest = stats.sort((a, b) => b.area - a.area)[0].f;
  return interiorPoint(biggest.geometry);
}

const features = [];

for (const a of groupings) {
  const members = a.covers.map((n) => delomraden.get(n));
  const point = labelPointFor(members);
  features.push({
    type: 'Feature',
    // The outline of the members with the boundaries between them removed —
    // those seams are exactly what the name papers over.
    geometry: {
      type: 'MultiLineString',
      coordinates: dissolveBoundary(members.map((f) => f.geometry))
        .map((line) => line.map((c) => c.map((v) => Number(v.toFixed(6))))),
    },
    properties: {
      name: a.name,
      covers: a.covers,
      partial: a.partial ?? [],
      // Where the name goes. Carried as a property rather than as the geometry
      // because the outline is the geometry; the app splits the two apart.
      label: point.map((v) => Number(v.toFixed(5))),
      stadsdel: stadsdelIndex.find(point)?.properties.name ?? null,
      curated: true,
      verified: a.verified === true,
      source: a.source ?? null,
      note: a.note ?? null,
      // The five names that repeat the stadsdel above them over less ground.
      // Carried through so the test can tell a declared repeat from an accident.
      narrowerThanStadsdel: a.narrowerThanStadsdel ?? null,
    },
  });
}

features.sort((a, b) => a.properties.name.localeCompare(b.properties.name, 'sv'));

// ---- the parts below ------------------------------------------------------
const partFeatures = [];
const unresolved = [];
for (const p of parts) {
  if (typeof p.lat !== 'number' || typeof p.lon !== 'number') { unresolved.push(p.name); continue; }
  partFeatures.push({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    properties: {
      name: p.name,
      within: p.within,
      stadsdel: stadsdelIndex.find([p.lon, p.lat])?.properties.name ?? null,
      verified: p.verified === true,
      source: p.source ?? null,
    },
  });
}

mkdirSync(outDir, { recursive: true });
const nFile = `${outDir}/neighbourhoods.geojson`;
const pFile = `${outDir}/parts.geojson`;
writeFileSync(nFile, JSON.stringify({ type: 'FeatureCollection', features }));
writeFileSync(pFile, JSON.stringify({ type: 'FeatureCollection', features: partFeatures }));

const kb = (f) => (statSync(f).size / 1024).toFixed(0);
console.log(`\n-> ${nFile}   ${features.length} curated names, `
  + `${claimed.size} of ${delomraden.size} delområden grouped, ${kb(nFile)} KB`);
for (const a of groupings) {
  console.log(`   ${a.name.padEnd(16)} ← ${a.covers.join(', ')}`);
}
console.log(`\n-> ${pFile}   ${partFeatures.length} parts, ${kb(pFile)} KB`);

const unverified = src.areas.filter((a) => a.verified !== true).map((a) => a.name);
if (unresolved.length) console.log(`\n   ⚠ parts without a point (run --resolve): ${unresolved.join(', ')}`);
if (unverified.length) {
  console.log(`\n   ${unverified.length} awaiting your eye — check each extent on the map,`);
  console.log(`   then set "verified": true in ${srcFile}:`);
  for (const n of unverified) console.log(`     · ${n}`);
}
