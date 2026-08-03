// Phase 1b — street names for the search index, extracted from the local .pbf.
//
// Not via Overpass: asking for every named highway in the bbox is a slow,
// rate-limited remote query for data already sitting on disk. osmium does it
// in under a second.
//
// Two things are worth knowing about the output:
//
//   1. Streets are clipped to Malmö municipality. The bbox carries margin
//      beyond the kommun (Arlöv, Åkarp, bits of Lomma/Vellinge/Svedala), and
//      those villages reuse the same common Swedish street names. We clip by
//      testing each way against districts.geojson AL10 — the 136 delområden
//      tile the municipality exactly, so the same lookup that clips also
//      yields the district label. Streets outside get no district and are
//      dropped.
//   2. One name is not one street. `Bruksvägen` exists several times inside
//      Malmö alone (Oxie, Klagshamn, …), so ways are grouped by name and then
//      split into spatially separate clusters; each cluster is its own search
//      entry, disambiguated by district.
//
// Output is an intermediate consumed by build-search.mjs, so it lands in
// data/cache/ rather than build/data/ (which holds deployed artifacts only).
//
// Usage: node scripts/build-streets.mjs [--pbf FILE] [--districts FILE] [--out FILE]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  PolygonIndex, bboxOf, clusterByGap, lineLength, representativePoint, roundPoint,
} from './lib/geo.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const pbf = arg('--pbf', 'data/cache/malmo.osm.pbf');
const districtsFile = arg('--districts', 'build/data/districts.geojson');
const outFile = arg('--out', 'data/cache/streets.json');
const tmp = 'data/cache';

// Highway values that are not streets a person would search for. Platforms are
// already covered by the transit overlay; the rest are not navigable ways.
const SKIP = new Set(['platform', 'construction', 'proposed', 'raceway']);

// Rank drives search-result ordering: a hit on a secondary road should outrank
// a hit on a footpath of the same name. Lower is more prominent. A street's
// rank comes from the class carrying most of its length, not its most
// prominent class — Annetorpsvägen is 46 secondary ways and one motorway_link
// slip road, and calling it a motorway because of the ramp is wrong.
const RANK = {
  motorway: 1, trunk: 1, motorway_link: 1, trunk_link: 1,
  primary: 2, primary_link: 2,
  secondary: 3, secondary_link: 3,
  tertiary: 4, tertiary_link: 4,
  residential: 5, unclassified: 5, living_street: 5, pedestrian: 5,
  service: 6, busway: 6, road: 6,
  cycleway: 7, path: 7, footway: 7, track: 7, steps: 7,
};
const rankOf = (h) => RANK[h] ?? 8;

// Segments of one street touch end to end; distinct streets sharing a name sit
// villages apart. 500 m is comfortably above the former and below the latter.
const CLUSTER_GAP_M = 500;

// 1. Named highway ways out of the clip, as LineStrings.
execFileSync('osmium', ['tags-filter', pbf, 'w/highway',
  '-o', `${tmp}/streets.osm.pbf`, '--overwrite'], { stdio: 'inherit' });
execFileSync('osmium', ['export', `${tmp}/streets.osm.pbf`,
  '-o', `${tmp}/streets-raw.geojson`, '-f', 'geojson',
  '--geometry-types=linestring', '--overwrite'], { stdio: 'inherit' });

const raw = JSON.parse(readFileSync(`${tmp}/streets-raw.geojson`, 'utf8'));

// 2. Keep named, street-like ways; assign each to a district (which clips to
//    the municipality). A way is placed by its middle vertex — a way straddling
//    the boundary lands wherever its bulk is, which is the sensible answer.
const districts = JSON.parse(readFileSync(districtsFile, 'utf8'));
const al10 = districts.features.filter((f) => f.properties.admin_level === 10);
if (!al10.length) throw new Error(`no admin_level 10 features in ${districtsFile}`);
const index = new PolygonIndex(al10);

const kept = [];
let named = 0, outside = 0;
for (const f of raw.features) {
  const p = f.properties ?? {};
  if (!p.name || SKIP.has(p.highway)) continue;
  if (f.geometry?.type !== 'LineString' || f.geometry.coordinates.length < 2) continue;
  named++;
  const coords = f.geometry.coordinates;
  const district = index.find(coords[Math.floor(coords.length / 2)]);
  if (!district) { outside++; continue; }
  kept.push({
    name: p.name,
    highway: p.highway,
    coords,
    district: district.properties.name,
  });
}

// 3. Group by name, then split each group into spatially separate clusters.
//    Single-linkage on way bboxes: cheap, and exact enough given the gap
//    between a street's own segments is ~0.
const byName = new Map();
for (const w of kept) {
  if (!byName.has(w.name)) byName.set(w.name, []);
  byName.get(w.name).push(w);
}

const streets = [];
for (const [name, ways] of byName) {
  const boxes = ways.map((w) => bboxOf(w.coords));
  for (const idx of clusterByGap(boxes, CLUSTER_GAP_M)) {
    const group = idx.map((i) => ways[i]);
    const point = representativePoint(group.map((w) => w.coords));
    if (!point) continue;
    // The cluster's district is the one most of its ways fall in.
    const tally = new Map();
    for (const w of group) tally.set(w.district, (tally.get(w.district) ?? 0) + 1);
    const district = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
    // Dominant class = the one with the most metres of road under this name.
    const byClass = new Map();
    for (const w of group) {
      byClass.set(w.highway, (byClass.get(w.highway) ?? 0) + lineLength(w.coords));
    }
    const highway = [...byClass.entries()]
      .sort((a, b) => b[1] - a[1] || rankOf(a[0]) - rankOf(b[0]))[0][0];
    streets.push({
      name,
      point: roundPoint(point),
      // How far the street actually reaches. The label point says where to
      // write the name; this says what a map has to show to have the whole
      // street on it, which is what the learning app frames a round by — a
      // chunk holding Amiralsgatan is not much use zoomed to the block its
      // midpoint falls in.
      bbox: bboxOf(group.flatMap((w) => w.coords)).map((v) => Math.round(v * 1e5) / 1e5),
      district,
      highway,
      rank: rankOf(highway),
    });
  }
}
streets.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, 'sv'));

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(streets));

const uniqueNames = new Set(streets.map((s) => s.name)).size;
const split = streets.length - uniqueNames;
const kb = (statSync(outFile).size / 1024).toFixed(0);
console.log(`\n-> ${outFile}`);
console.log(`   named highway ways:      ${named}`);
console.log(`   dropped (outside Malmö): ${outside}`);
console.log(`   unique names:            ${uniqueNames}`);
console.log(`   entries (name×cluster):  ${streets.length}  (+${split} from same-name splits)`);
console.log(`   ${kb} KB`);
