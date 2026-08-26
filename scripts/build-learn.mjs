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
// and joins each name to its text from learn/about.json or from its own file,
// and to its half of the quiz from learn/core.json.
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
//   `meta`      — what kind of thing this is ("Delområde · i Fosie", "Bro"),
//                 which is what the card falls back on for the names about.json
//                 has no sentence for. Facts from the data are not the same as
//                 facts made up to fill a field.
//
//                 It says *where* only when the where is already on the
//                 player's screen: the panel is the question now, not the
//                 reward for answering one, so a meta line that named the
//                 delområde a street runs through was handing over the answer
//                 with the question. A stadsdel is safe, and only a stadsdel —
//                 it is the chunk you picked, so you were told it before the
//                 round started. Everything finer than that is the answer.
//   `point`     — where the map should centre, and what point-kind answers are
//                 measured from. For an area it is the label point the map
//                 already uses, so it is the same spot the name is written at.
//   `stadsdel`  — which tenth of the city the thing is in. It used to be how
//                 the quiz cut itself up; it now only feeds the `meta` line
//                 ("Delområde · i Fosie"), which is the one place a coarse
//                 where is safe to say. Areas know theirs from the build;
//                 landmarks and bridges are looked up by point-in-polygon.
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
  coreDoc,
] = await Promise.all([
  json('build/data/stadsdelar.geojson'),
  json('build/data/districts.geojson'),
  json('landmarks/landmarks.json'),
  json('learn/bridges.json'),
  json('learn/streets.json'),
  json('learn/about.json'),
  json('data/cache/streets.json'),
  json('learn/core.json'),
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
    // What the round's opening view has to contain: you answer by tapping
    // inside the polygon, so framing the chunk by label points alone would push
    // half of it off screen.
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
    // `over` stays in the file — it is what the bridge is for — but not on the
    // card: fifteen of the nineteen cross Malmö kanal, so the four that say
    // anything else (Öresund, Sege å, Slottsgraven) say it loudly.
    meta: 'Bro',
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
    meta: CLASS[hit.rank] ?? 'Gata',
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

// ---- sources -----------------------------------------------------------------
// Attached after the merge, so a name that lost its own entry still gets the
// link found for it. Where a name has no source of its own, the Wikipedia
// article is the honest thing to point at — and these were verified by
// coordinates when they were collected, so a link here is about the right
// place rather than merely the right title. A name with its own source keeps
// it; this only ever fills a gap.
const sources = (await json('learn/sources.json').catch(() => ({}))).sources ?? {};
for (const it of items) {
  if (!it.source && sources[it.name]) it.source = sources[it.name];
}

// ---- core --------------------------------------------------------------------
// Which of these names Malmö expects you to know. Hand-written in
// learn/core.json against a sentence rather than a formula (its `_doc` carries
// both the sentence and the places the rule behind it lost), and applied here
// the same way everything else in this file is: by name, never by invention.
//
// After the merge, because the merge is what decides which kind a name ends up
// as — Öresundsbron is a bridge and not a landmark, so it is filed under
// `bridges` and a copy under `landmarks` is a mistake worth failing on rather
// than a synonym worth accepting.
const CORE_KIND = { areas: 'area', streets: 'street', bridges: 'bridge', landmarks: 'landmark' };

const byName = new Map(items.map((it) => [it.name, it]));
const claimed = new Set();

for (const [section, names] of Object.entries(coreDoc.core)) {
  const kind = CORE_KIND[section];
  if (!kind) { fail(`core.json has a section "${section}", which is not a kind`); continue; }
  for (const name of names) {
    const it = byName.get(name);
    // The same contract as the rest of the pipeline: a curated name that
    // matches nothing is a claim about a place the quiz cannot ask about, so it
    // fails here rather than disappearing.
    if (!it) { fail(`core.json: "${name}" is not in the quiz`); continue; }
    if (it.kind !== kind) fail(`core.json: "${name}" is filed under ${section} but survived the merge as a ${it.kind}`);
    if (claimed.has(name)) fail(`core.json: "${name}" is listed twice`);
    claimed.add(name);
    it.core = true;
  }
}

for (const it of items) if (!it.core) it.core = false;

// The split only says anything while the core half stays something you could
// finish. Below a quarter it is a sampler; above nearly half it is the quiz
// again with a smaller word on the button. A wide band on purpose — this is a
// guard against drift, not a target to hit.
const share = claimed.size / items.length;
if (share < 0.25 || share > 0.45) {
  fail(`core is ${claimed.size} of ${items.length} names (${Math.round(share * 100)} %), outside 25–45 %`);
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
// discovered on the front door: the cap is the only thing standing between "a
// round" and "a syllabus".
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
  const core = of.filter((it) => it.core).length;
  console.log(`  ${kind.padEnd(9)} ${String(of.length).padStart(3)} namn, ${String(withText).padStart(3)} med text`
    + `, ${String(core).padStart(3)} i Grunden`);
}
console.log(`  Grunden ${claimed.size} av ${items.length} (${Math.round(share * 100)} %)`);
console.log(`  ${chunks.length} chunks, largest ${Math.max(...chunks.map((c) => c.items.length))}`);
