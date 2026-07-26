// Phase 2 — search.json, the flat index behind client-side search.
//
// The basemap already contains street and place names, but vector tiles only
// hold what is inside the tiles currently loaded, so they cannot answer "where
// is Bruksvägen" unless you are already looking at it. This file is the same
// data reshaped for lookup: one entry per searchable thing, with a point to
// pan to and the district it sits in.
//
// Districts are resolved by point-in-polygon here, at build time, so the app
// ships no geometry work. Entries that share a name but are different things
// (a station mapped as a dozen platforms, a street name reused in two
// districts) are split by spatial clustering rather than blindly deduped.
//
// Usage: node scripts/build-search.mjs [--out DIR] [--data DIR]
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import {
  PolygonIndex, bboxOf, clusterByGap, interiorPoint, representativePoint, roundPoint,
} from './lib/geo.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const dataDir = arg('--data', 'build/data');
const outDir = arg('--out', 'build/data');
const streetsFile = arg('--streets', 'data/cache/streets.json');

const read = (f) => JSON.parse(readFileSync(f, 'utf8'));

// Rank is a prominence tiebreaker applied after the fuzzy-match score: when
// several entries match equally well, the more significant place wins.
const RANK = {
  landmark1: 1, landmark2: 2,
  // Above everything: "Limhamn" and "Rosengård" are answers in themselves, and
  // used to lose the search box to a bus stop and a pizzeria of the same name.
  stadsdel: 1,
  stadsomrade: 2, delomrade: 3,
  station: 3,
  majorStreet: 4, street: 5, minorStreet: 7,
  stop: 5,
  culture: 6, food: 6, cycling: 6,
};

// ---- districts: the polygon index everything else is resolved against ------
const districts = read(`${dataDir}/districts.geojson`);
const al10 = districts.features.filter((f) => f.properties.admin_level === 10);
const al9 = districts.features.filter((f) => f.properties.admin_level === 9);
if (!al10.length) throw new Error('districts.geojson has no admin_level 10 features');
const index = new PolygonIndex(al10);
const districtOf = (point) => index.find(point)?.properties.name ?? null;

const entries = [];
const push = (...e) => { entries.push(...e); };

// The ten stadsdelar (build-areas.mjs, Malmö stad CC0) — the coarsest names on
// the map, and the ones most likely to be typed. Optional so the index can
// still be built before that step has run.
if (existsSync(`${dataDir}/stadsdelar.geojson`)) {
  for (const f of read(`${dataDir}/stadsdelar.geojson`).features) {
    push({ name: f.properties.name, cat: 'stadsdel', kind: 'stadsdel',
      point: roundPoint(interiorPoint(f.geometry)), district: null, rank: RANK.stadsdel });
  }
}

// Districts are searchable in their own right.
for (const f of al9) {
  push({ name: f.properties.name, cat: 'district', kind: 'stadsområde',
    point: roundPoint(interiorPoint(f.geometry)), district: null, rank: RANK.stadsomrade });
}
for (const f of al10) {
  const point = interiorPoint(f.geometry);
  const parent = new PolygonIndex(al9).find(point);
  push({ name: f.properties.name, cat: 'district', kind: 'delområde',
    point: roundPoint(point), district: parent?.properties.name ?? null, rank: RANK.delomrade });
}

// ---- streets (already clipped, clustered and district-tagged) -------------
const streets = read(streetsFile);
for (const s of streets) {
  const rank = s.rank <= 3 ? RANK.majorStreet : s.rank <= 5 ? RANK.street : RANK.minorStreet;
  push({ name: s.name, cat: 'street', kind: s.highway, point: s.point, district: s.district, rank });
}

/**
 * Collapse a point layer into search entries: drop the unnamed, group by name,
 * split each group into spatial clusters, and emit one entry per cluster at
 * its representative point.
 */
function pointLayer(features, { gapM, cat, kindOf, rankOf, keep = () => true }) {
  const byName = new Map();
  for (const f of features) {
    const name = f.properties?.name;
    if (!name || !keep(f)) continue;
    if (f.geometry?.type !== 'Point') continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(f);
  }
  const out = [];
  for (const [name, group] of byName) {
    const boxes = group.map((f) => bboxOf([f.geometry.coordinates]));
    for (const idx of clusterByGap(boxes, gapM)) {
      const members = idx.map((i) => group[i]);
      const point = representativePoint([members.map((f) => f.geometry.coordinates)]);
      if (!point) continue;
      out.push({
        name,
        cat,
        kind: kindOf(members),
        point: roundPoint(point),
        district: districtOf(point),
        rank: rankOf(members),
      });
    }
  }
  return out;
}

/** The commonest value of `prop` across a cluster's members. */
const commonest = (members, prop) => {
  const tally = new Map();
  for (const m of members) tally.set(m.properties[prop], (tally.get(m.properties[prop]) ?? 0) + 1);
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
};

// ---- food & culture: branches of a chain are distinct destinations, so the
// gap is small — just enough to merge a place mapped as both node and way.
for (const [layer, cat, rank] of [['food', 'food', RANK.food], ['culture', 'culture', RANK.culture]]) {
  const fc = read(`${dataDir}/${layer}.geojson`);
  const kindProp = layer === 'food' ? 'amenity' : 'kind';
  push(...pointLayer(fc.features, {
    gapM: 100, cat,
    kindOf: (m) => commonest(m, kindProp),
    rankOf: () => rank,
  }));
}

// ---- transit: platforms are named for their designation ("A", "B"), not the
// stop, so they are dropped; bus_stop/station/tram_stop carry the real name.
// A station spreads over a few hundred metres of platforms — one entry.
{
  const fc = read(`${dataDir}/transit.geojson`);
  push(...pointLayer(fc.features, {
    gapM: 400, cat: 'transit',
    keep: (f) => f.properties.kind !== 'platform' || f.properties.name.length > 2,
    kindOf: (m) => (m.some((x) => x.properties.kind === 'station') ? 'station'
      : m.some((x) => x.properties.kind === 'tram_stop') ? 'tram_stop' : 'bus_stop'),
    rankOf: (m) => (m.some((x) => x.properties.kind === 'station') ? RANK.station : RANK.stop),
  }));
}

// ---- cycling: named routes only (lines, so take a point on the route) ------
{
  const fc = read(`${dataDir}/cycling.geojson`);
  const byName = new Map();
  for (const f of fc.features) {
    const name = f.properties?.name;
    if (!name || f.properties.kind !== 'route') continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(f);
  }
  for (const [name, group] of byName) {
    const lines = [];
    for (const f of group) {
      if (f.geometry.type === 'LineString') lines.push(f.geometry.coordinates);
      else if (f.geometry.type === 'MultiLineString') lines.push(...f.geometry.coordinates);
    }
    const point = representativePoint(lines);
    if (!point) continue;
    push({ name, cat: 'cycling', kind: 'route', point: roundPoint(point),
      district: districtOf(point), rank: RANK.cycling });
  }
}

// ---- landmarks: optional, and only those the owner has verified coordinates
// for. Unresolved seeds carry null coords and are skipped rather than faked.
const landmarksFile = `${dataDir}/landmarks.geojson`;
let landmarkCount = 0;
if (existsSync(landmarksFile)) {
  const fc = read(landmarksFile);
  for (const f of fc.features) {
    if (f.geometry?.type !== 'Point') continue;
    const [lon, lat] = f.geometry.coordinates ?? [];
    if (typeof lon !== 'number' || typeof lat !== 'number') continue;
    const point = [lon, lat];
    push({ name: f.properties.name, cat: 'landmark', kind: f.properties.icon ?? null,
      point: roundPoint(point), district: districtOf(point),
      rank: f.properties.tier === 1 ? RANK.landmark1 : RANK.landmark2 });
    landmarkCount++;
  }
}

// ---- clip to the municipality ---------------------------------------------
// The bbox carries margin beyond Malmö kommun, and the AL10 delområden tile
// the municipality exactly — so "no district" means "not in Malmö" (Arlöv,
// Åkarp, Alnarp, Burlöv, Västra Ingelstad). Streets were clipped the same way
// in build-streets.mjs; POIs follow, or the index would be inconsistent about
// which half of Arlöv it knows. Those places still render on the map.
// Two exemptions: stadsområden are top-level so their district is null by
// definition, and landmarks are hand-curated — if it is on the owner's list it
// belongs in search, and several legitimately sit offshore in no delområde at
// all (Öresundsbron, Ribersborgs Kallbadhus on its pier).
const before = entries.length;
const clipped = entries.filter((e) => e.district !== null
  || e.kind === 'stadsområde' || e.cat === 'stadsdel' || e.cat === 'landmark');
const dropped = before - clipped.length;

clipped.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, 'sv'));
const entriesOut = clipped;
mkdirSync(outDir, { recursive: true });
const file = `${outDir}/search.json`;
writeFileSync(file, JSON.stringify(entriesOut));

const byCat = new Map();
for (const e of entriesOut) byCat.set(e.cat, (byCat.get(e.cat) ?? 0) + 1);
const kb = (statSync(file).size / 1024).toFixed(0);
console.log(`\n-> ${file}`);
for (const [cat, n] of [...byCat.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`   ${cat.padEnd(10)} ${String(n).padStart(5)}`);
}
console.log(`   ${'total'.padEnd(10)} ${String(entriesOut.length).padStart(5)}  ${kb} KB`);
console.log(`   dropped ${dropped} entries outside Malmö kommun`);
if (!landmarkCount) console.log('   (no landmarks yet — build-landmarks.mjs not run)');
