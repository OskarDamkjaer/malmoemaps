// Everything the quiz can ask about, in one file.
//
// The app has one quiz (app/rounds.mjs) whose items come in four kinds; this
// script fills them, from data that already exists for other reasons:
//
//   area      build/data/districts.geojson        (OSM, admin_level 10)
//   landmark  landmarks/landmarks.json            (curated)
//   bridge    learn/bridges.json                  (curated)
//   street    learn/streets.json ∩ data/cache/streets.json
//
// and joins each name to its text from learn/about.json or from its own file.
//
// The contract is the same one the rest of the pipeline keeps: **this script
// never invents an entry.** It places, joins, merges and validates. A curated
// name that matches nothing is a hard failure rather than a quietly dropped row
// — an unplaceable name is an unanswerable question, and the only thing worse
// than a round that is missing a name is a round that asks for one that cannot
// be pointed at.
//
// Three things it does add, all derived rather than authored:
//
//   `meta`      — what the thing is and where it sits ("Delområde i Fosie"),
//                 which is what the card falls back on for the names about.json
//                 has no sentence for. Facts from the data are not the same as
//                 facts made up to fill a field.
//   `point`     — where the map should centre, and what point-kind answers are
//                 measured from. For an area it is the label point the map
//                 already uses, so it is the same spot the name is written at.
//   `stadsdel`  — which tenth of the city the thing is in, which is how the
//                 quiz cuts itself up. Areas know theirs from the build;
//                 landmarks and bridges are looked up by point-in-polygon,
//                 because a quiz cut geographically has to be able to place
//                 everything geographically.
//
// Usage: node scripts/build-learn.mjs [--out FILE]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  PolygonIndex, bboxOf, distance, flatCoords, interiorPoint,
} from './lib/geo.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const outFile = arg('--out', 'build/data/learn.json');

const json = async (f) => JSON.parse(await readFile(f, 'utf8'));

const [
  stadsdelar, districts, landmarksDoc, bridgesDoc, streetsDoc, aboutDoc, streetIndex,
] = await Promise.all([
  json('build/data/stadsdelar.geojson'),
  json('build/data/districts.geojson'),
  json('landmarks/landmarks.json'),
  json('learn/bridges.json'),
  json('learn/streets.json'),
  json('learn/about.json'),
  json('data/cache/streets.json'),
]);

const problems = [];
const fail = (msg) => problems.push(msg);

const said = (entry) => (entry?.text ? { about: entry.text, source: entry.source ?? null } : {});

// ---- areas -------------------------------------------------------------------
const al10 = districts.features.filter((f) => f.properties.admin_level === 10);

// Which stadsdel a delområde belongs to, read off the stadsdelar's own `covers`
// rather than worked out from geometry: build-areas.mjs already decided this,
// and deciding it twice invites the two answers disagreeing.
const stadsdelOf = new Map();
for (const f of stadsdelar.features) {
  for (const d of f.properties.covers ?? []) stadsdelOf.set(d, f.properties.name);
}

// For the things that have a point and no boundary. The delområde polygons
// rather than the stadsdel ones, so this agrees with app/highlight.js's
// districtAt — one answer to "which part of town is this in".
const districtIndex = new PolygonIndex(al10);

// Everything in the sea. Ribersborgs Kallbadhus is on a pier, Öresundsbron's
// midpoint is four kilometres out, and neither is inside any delområde — but
// both are things you point at from a particular part of town, so they get the
// nearest one rather than a chunk of their own called "Övriga". Nearest by
// vertex, which over these distances is the same answer as nearest by edge and
// is a great deal less code.
const outline = al10.map((f) => ({
  name: f.properties.name,
  coords: flatCoords(f.geometry),
}));

function nearestDistrict(point) {
  let best = null;
  for (const d of outline) {
    for (const c of d.coords) {
      const m = distance(point, c);
      if (!best || m < best.m) best = { m, name: d.name };
    }
  }
  return best;
}

function stadsdelAt(point, name) {
  const hit = districtIndex.find(point);
  if (hit) return stadsdelOf.get(hit.properties.name) ?? null;

  const near = nearestDistrict(point);
  if (!near) { fail(`${name}: nothing to measure against`); return null; }
  console.warn(`  ${name} is outside the delområden — nearest is ${near.name}, ${Math.round(near.m)} m`);
  return stadsdelOf.get(near.name) ?? null;
}

// A polygon's label point: where the map writes the name, so where a round
// should centre and where the summary should fly to.
function labelPoint(feature, name) {
  const p = interiorPoint(feature.geometry);
  if (!p) fail(`no label point for ${name}`);
  return p;
}

const areaItems = al10.map((f) => {
  const { name } = f.properties;
  const stadsdel = stadsdelOf.get(name) ?? null;
  if (!stadsdel) fail(`delområde in no stadsdel: ${name}`);
  return {
    name,
    kind: 'area',
    point: labelPoint(f, name),
    // What the tray view has to contain: you drop onto the polygon, so framing
    // the chunk by label points alone would push half of it off screen.
    bbox: bboxOf(flatCoords(f.geometry)),
    covers: [name],
    stadsdel,
    meta: ['Delområde', stadsdel && `i ${stadsdel}`].filter(Boolean).join(' · '),
    ...said(aboutDoc.areas[name]),
  };
});

// ---- landmarks ---------------------------------------------------------------
const landmarkItems = landmarksDoc.landmarks
  .filter((lm) => {
    if (lm.lat != null && lm.lon != null) return true;
    // Not a failure: landmarks.json is allowed to hold an entry whose
    // coordinate has not been resolved yet. It just cannot be asked about.
    console.warn(`  skipping landmark without coordinates: ${lm.name}`);
    return false;
  })
  .map((lm) => ({
    name: lm.name,
    kind: 'landmark',
    point: [lm.lon, lm.lat],
    stadsdel: stadsdelAt([lm.lon, lm.lat], lm.name),
    meta: lm.tier === 1 ? 'Landmärke' : 'Sevärdhet',
    about: lm.description ?? null,
    source: null,
  }));

// ---- bridges -----------------------------------------------------------------
const bridgeItems = bridgesDoc.bridges.map((b) => {
  if (b.lat == null || b.lon == null) fail(`bridge without coordinates: ${b.name}`);
  return {
    name: b.name,
    kind: 'bridge',
    point: [b.lon, b.lat],
    stadsdel: stadsdelAt([b.lon, b.lat], b.name),
    meta: ['Bro', b.over && `över ${b.over}`].filter(Boolean).join(' · '),
    about: b.description ?? null,
    source: b.source ?? null,
  };
});

// ---- streets -----------------------------------------------------------------
// The curated names are resolved against the street index the search is built
// from, which is the same set of names the map can highlight. A name that is
// not in there is a name the round could never accept an answer for.
const streetByName = new Map();
for (const st of streetIndex) {
  const prev = streetByName.get(st.name);
  if (!prev || st.rank < prev.rank) streetByName.set(st.name, st);
}

const CLASS = {
  1: 'Motorväg', 2: 'Huvudgata', 3: 'Genomfartsgata', 4: 'Gata',
  5: 'Gata', 6: 'Gata', 7: 'Gång- och cykelväg',
};

const streetItems = streetsDoc.streets.map((s) => {
  const hit = streetByName.get(s.name);
  if (!hit) {
    fail(`street not in the index: ${s.name}`);
    return null;
  }
  return {
    name: s.name,
    kind: 'street',
    point: hit.point,
    // A street is the one kind whose extent is nothing like its point: the
    // chunk holding Amiralsgatan has to be framed wide enough to show all five
    // kilometres of it, or the round is played on a map the answer runs off.
    bbox: hit.bbox,
    stadsdel: stadsdelOf.get(hit.district) ?? null,
    meta: [CLASS[hit.rank] ?? 'Gata', hit.district && `i ${hit.district}`].filter(Boolean).join(' · '),
    about: s.description ?? null,
    source: s.source ?? null,
  };
}).filter(Boolean);

// ---- one name, one thing -----------------------------------------------------
// Merged into a single quiz, the four kinds collide on six names: the park
// Pildammsparken and the delområde Pildammsparken, Öresundsbron the landmark
// and Öresundsbron the bridge, and four more of the same shape. Asked as two
// questions they are the same question with two right answers, and the grader
// would mark you wrong for finding the other one.
//
// So a name is one thing, and the kind that keeps it is the one that can be
// *stood in*: an area beats a bridge beats a street beats a landmark. Landing
// anywhere inside the delområde Augustenborg is a better answer to "var ligger
// Augustenborg?" than a 250 m ring around the park, and Öresundsbron is a
// bridge before it is a sight.
//
// The loser is not simply dropped — its description usually is the better one
// (a landmark list is written to say what things are; a delområde list is not),
// so the survivor inherits any text it lacks. Nothing is invented, only moved.
const PRECEDENCE = ['area', 'bridge', 'street', 'landmark'];

function merge(lists) {
  const byName = new Map();
  const merged = [];
  for (const it of lists.flat()) {
    const prev = byName.get(it.name);
    if (!prev) { byName.set(it.name, it); continue; }
    const [keep, drop] = PRECEDENCE.indexOf(it.kind) < PRECEDENCE.indexOf(prev.kind)
      ? [it, prev] : [prev, it];
    if (!keep.about && drop.about) { keep.about = drop.about; keep.source = drop.source ?? null; }
    byName.set(keep.name, keep);
    merged.push(`${keep.name}: kept the ${keep.kind}, dropped the ${drop.kind}`);
  }
  return { items: [...byName.values()], merged };
}

const { items, merged } = merge([areaItems, landmarkItems, bridgeItems, streetItems]);

// ---- pictures ----------------------------------------------------------------
// Attached after the merge, so a name that lost its own entry still gets the
// picture found for it. Optional by design: `learn/images.json` is written by
// scripts/build-images.mjs, which talks to Wikimedia, and this build has to
// work without a network. No file means a quiz with no photographs, which is
// what it was last week.
const pictures = await json('learn/images.json').catch(() => ({}));
for (const it of items) {
  const pic = pictures[it.name];
  if (!pic?.image) continue;
  it.image = pic.image;
  it.credit = pic.credit;
  // The card already links a source for the text. Where there is no text, the
  // article the picture came from is the honest thing to point at.
  if (!it.source && pic.article) it.source = pic.article;
}

// ---- validate ----------------------------------------------------------------
// The app's kind table is the authority on which kinds exist. Reading it here
// rather than repeating the list means a kind added there and forgotten here
// fails at build time instead of showing up as an item the grader throws on.
const { KIND_IDS, MAX_CHUNK, chunksOf } = await import('../app/rounds.mjs');

const seen = new Set();
for (const it of items) {
  if (!KIND_IDS.includes(it.kind)) fail(`${it.name}: kind "${it.kind}" is not one the app knows`);
  if (!it.point || !Number.isFinite(it.point[0])) fail(`${it.name} has no point`);
  if (seen.has(it.name)) fail(`${it.name} appears twice — a question with two right answers`);
  seen.add(it.name);
  if (it.kind === 'area' && !it.covers?.length) fail(`${it.name} covers no delområde`);
}
for (const kind of KIND_IDS) {
  if (!items.some((it) => it.kind === kind)) fail(`no items of kind "${kind}"`);
}

// Chunking is what makes the quiz playable, so it is checked here rather than
// discovered on the front door: a chunk over the cap has no tray mode, and the
// cap is the only thing standing between "a round" and "a syllabus".
const chunks = chunksOf(items);
for (const chunk of chunks) {
  if (chunk.items.length > MAX_CHUNK) {
    fail(`chunk "${chunk.label}" has ${chunk.items.length} names, over the cap of ${MAX_CHUNK}`);
  }
}

if (problems.length) {
  console.error(`build-learn: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const out = { generated: new Date().toISOString(), items };
await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, JSON.stringify(out));

const kb = (JSON.stringify(out).length / 1024).toFixed(0);
console.log(`build-learn → ${outFile} (${kb} KB)`);
for (const m of merged) console.log(`  merged  ${m}`);
for (const kind of KIND_IDS) {
  const of = items.filter((it) => it.kind === kind);
  const withText = of.filter((it) => it.about).length;
  console.log(`  ${kind.padEnd(9)} ${String(of.length).padStart(3)} namn, ${String(withText).padStart(3)} med text`);
}
console.log(`  ${chunks.length} chunks, largest ${Math.max(...chunks.map((c) => c.items.length))}`);
