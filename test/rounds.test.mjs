// The quiz, held to the one promise a quiz has to keep: every question can be
// answered, and exactly one answer is right.
//
// The failures guarded against here are all quiet ones. A curated name with no
// geometry behind it does not crash — it is just a question with nowhere on the
// map to tap. A name that appears twice makes a question with two right answers,
// and the grader will pick the first one and mark you wrong for finding the
// second. None of these are visible until you play the exact chunk they are in.
//
// Run: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  KINDS, KIND_IDS, MAX_CHUNK, byKind, chunksOf, graded,
} from '../app/rounds.mjs';

const FILE = 'build/data/learn.json';
const skip = existsSync(FILE)
  ? false
  : 'build/data/learn.json is gitignored — run scripts/build-learn.mjs first';
const items = skip ? [] : JSON.parse(readFileSync(FILE, 'utf8')).items;

const { bbox } = JSON.parse(readFileSync('config/bbox.json', 'utf8'));
const inside = ([lon, lat]) => lon >= bbox.west && lon <= bbox.east
  && lat >= bbox.south && lat <= bbox.north;

// ---- the kinds themselves (no build needed) ---------------------------------

test('every kind can actually be graded', () => {
  for (const [id, kind] of Object.entries(KINDS)) {
    assert.ok(['area', 'point', 'line'].includes(kind.shape), `${id} has a shape the grader knows`);
    // Both forms, because the picker counts things: "1 bro" and "3 broar" are
    // not the same word with a letter on the end.
    assert.ok(kind.label, `${id} has no singular for the picker`);
    assert.ok(kind.plural, `${id} has no plural for the picker`);
    assert.notEqual(kind.label, kind.plural, `${id} has the same word for one and many`);
    // A point or a line is graded by distance, so it needs a tolerance; an area
    // is graded by being inside it, so a tolerance would mean nothing.
    if (kind.shape === 'area') assert.equal(kind.near, undefined, `${id} is an area with a distance tolerance`);
    else assert.ok(kind.near > 0, `${id} needs a tolerance in metres`);
    // An area's outlines are the only thing left on a blinded map. Areas with
    // no shapes drawn is a blank screen with names to drop on it.
    if (kind.shape === 'area') assert.ok(kind.outline?.length, `${id} draws no outline to point at`);
  }
});

// ---- what the build put in it ------------------------------------------------

test('every name can be placed, once', { skip }, () => {
  const seen = new Set();
  for (const it of items) {
    assert.ok(it.name, 'an item with no name');
    assert.ok(KIND_IDS.includes(it.kind), `${it.name}: unknown kind "${it.kind}"`);
    // The whole quiz shares one namespace now — one Augustenborg, whichever
    // kind it ended up as — and progress.mjs keys on that.
    assert.ok(!seen.has(it.name), `"${it.name}" appears twice — two right answers`);
    seen.add(it.name);

    const [lon, lat] = it.point ?? [];
    assert.ok(Number.isFinite(lon) && Number.isFinite(lat), `${it.name} has no point`);
    assert.ok(inside(it.point), `${it.name} is outside the map's own bounding box`);
  }
});

test('every kind is actually represented', { skip }, () => {
  for (const kind of KIND_IDS) {
    assert.ok(items.some((it) => it.kind === kind), `nothing of kind "${kind}" was built`);
  }
});

test('areas are graded against delområden that exist', { skip }, () => {
  // Areas are graded by "which delområde is this point in", so a `covers`
  // naming something that is not a delområde is a name that can never be got
  // right. With one area level left, an area covers itself — but the grader
  // still reads `covers`, so that is what is checked.
  const real = new Set(items.filter((it) => it.kind === 'area').map((it) => it.name));
  for (const it of items) {
    if (it.kind !== 'area') continue;
    assert.ok(it.covers?.length, `${it.name} covers nothing`);
    for (const d of it.covers) assert.ok(real.has(d), `${it.name} covers "${d}", which is not a delområde`);
  }
});

test('everything with an extent brings it', { skip }, () => {
  // A round's opening view is framed from these. A missing bbox silently falls
  // back to the label point, which frames the chunk too tight — the polygon you
  // are meant to tap inside, or the four kilometres of street you are meant to
  // find, ends up off the screen. Points are exempt: for them the point *is*
  // the extent.
  for (const it of items) {
    if (it.kind !== 'area' && it.kind !== 'street') continue;
    const [w, s, e, n] = it.bbox ?? [];
    assert.ok(Number.isFinite(w) && Number.isFinite(n), `${it.name} has no bbox`);
    assert.ok(e > w && n > s, `${it.name} has an empty bbox`);
    assert.ok(inside([w, s]) && inside([e, n]), `${it.name}'s bbox leaves the map`);
    // The label point has to be somewhere the extent covers, or the two
    // disagree about where the thing is.
    assert.ok(it.point[0] >= w && it.point[0] <= e && it.point[1] >= s && it.point[1] <= n,
      `${it.name}'s point is outside its own bbox`);
  }
});

// ---- chunking ----------------------------------------------------------------

test('chunks keep every name, exactly once, in a playable size', { skip }, () => {
  const chunks = chunksOf(items);
  assert.ok(chunks.length, 'the quiz chunks into nothing');

  const names = chunks.flatMap((c) => c.items.map((i) => i.name));
  assert.equal(names.length, items.length, 'chunking lost or duplicated names');
  assert.equal(new Set(names).size, items.length, 'a name is in two chunks');

  const ids = chunks.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'two chunks share an id');

  for (const chunk of chunks) {
    assert.ok(chunk.items.length, `${chunk.label} is an empty chunk`);
    // Nothing has to fit on a screen any more — the cap is on how long a
    // sitting can be. Past it, the answer is to cut the chunks finer.
    assert.ok(chunk.items.length <= MAX_CHUNK,
      `${chunk.label} has ${chunk.items.length} names, over the cap of ${MAX_CHUNK}`);
  }
});

// ---- the order a round asks in -----------------------------------------------

test('a round asks one kind at a time, in the order the kinds are declared', () => {
  const mixed = [
    { name: 'a', kind: 'landmark' }, { name: 'b', kind: 'area' },
    { name: 'c', kind: 'bridge' }, { name: 'd', kind: 'street' },
    { name: 'e', kind: 'area' }, { name: 'f', kind: 'street' },
  ];
  const kinds = byKind(mixed).map((it) => it.kind);

  assert.deepEqual(kinds, ['area', 'area', 'street', 'street', 'bridge', 'landmark']);
  // Said the other way round, which is the property that actually matters: no
  // kind is ever returned to once it has been left.
  assert.deepEqual([...new Set(kinds)], KIND_IDS.filter((k) => kinds.includes(k)));
});

test('grouping by kind keeps every name and the order it was given inside a kind', () => {
  // Stability is what lets progress.mjs decide what to ask first: byKind sets
  // the order between kinds, spaced repetition sets it inside one, and neither
  // gets to undo the other.
  const items = Array.from({ length: 40 }, (_, i) => ({
    name: `n${i}`, kind: KIND_IDS[i % KIND_IDS.length],
  }));
  const out = byKind(items);

  assert.deepEqual(new Set(out.map((it) => it.name)), new Set(items.map((it) => it.name)));
  assert.equal(out.length, items.length);
  for (const kind of KIND_IDS) {
    assert.deepEqual(
      out.filter((it) => it.kind === kind).map((it) => it.name),
      items.filter((it) => it.kind === kind).map((it) => it.name),
      `${kind} came back in a different order than it went in`,
    );
  }
});

test('the chunks are listed from the middle of town outward', { skip }, () => {
  // The picker's order. A–Ö put Centrum third, behind Fosie, which is a fact
  // about the alphabet rather than about Malmö.
  const chunks = chunksOf(items);
  const away = chunks.map((c) => c.away);

  assert.deepEqual([...away].sort((a, b) => a - b), away, 'the list is not ordered outward');
  assert.equal(chunks[0].label, 'Centrum', 'the middle of town is not first');
  assert.equal(chunks.at(-1).label, 'Oxie', 'the furthest out is not last');
});

test('the anchor the order is measured from exists', { skip }, () => {
  // chunksOf measures from Stortorget and falls back to the centroid of
  // everything if it is gone — which would silently reorder the front door, so
  // it fails here instead. If the landmark is ever removed on purpose, this
  // test is the place that says what else has to change.
  assert.ok(items.some((it) => it.name === 'Stortorget'),
    'Stortorget is what "how far out is this" is measured from');
});

test('a chunk is one part of town', { skip }, () => {
  // The point of cutting by stadsdel: a chunk is somewhere, so it can be played
  // at one fixed view. A chunk drawn from two stadsdelar would be a map of the
  // whole city with eleven things scattered over it.
  for (const chunk of chunksOf(items)) {
    const stadsdelar = new Set(chunk.items.map((it) => it.stadsdel));
    assert.equal(stadsdelar.size, 1, `${chunk.label} spans ${[...stadsdelar].join(', ')}`);
  }
});

test('chunking is stable across calls', { skip }, () => {
  // Nothing is stored against a chunk id, but the picker is rebuilt on every
  // return to the front door and a list that reshuffles itself is a list you
  // cannot find your place in.
  const a = chunksOf(items).map((c) => `${c.id}:${c.items.map((i) => i.name).join(',')}`);
  const b = chunksOf(items).map((c) => `${c.id}:${c.items.map((i) => i.name).join(',')}`);
  assert.deepEqual(a, b);
});

// ---- the grader --------------------------------------------------------------

const area = { name: 'Möllevången', kind: 'area' };
const landmark = { name: 'Turning Torso', kind: 'landmark' };

test('an area is right when you land inside it and wrong when you land in its neighbour', () => {
  assert.equal(graded({ item: area, hit: { name: 'Möllevången' } }).right, true);

  const miss = graded({ item: area, hit: { name: 'Sofielund' } });
  assert.equal(miss.right, false);
  // Being told what you did hit is what makes the second guess informed.
  assert.equal(miss.hitName, 'Sofielund');

  const nowhere = graded({ item: area, hit: null });
  assert.equal(nowhere.right, false);
  assert.equal(nowhere.hitName, null);
});

test('a point has to be both nearest and near enough', () => {
  const near = { name: 'Turning Torso', distance: 100, targetDistance: 100 };
  assert.equal(graded({ item: landmark, hit: near }).right, true);

  // Nearest, but not near enough: 900 m from the answer at a zoom where a pixel
  // is a metre.
  const far = { name: 'Turning Torso', distance: 900, targetDistance: 900 };
  assert.equal(graded({ item: landmark, hit: far, metersPerPixel: 1 }).right, false);

  // Near enough, but something else was nearer — the case the whole
  // nearest-wins rule exists for: four landmarks standing in Västra Hamnen.
  const wrongThing = { name: 'Kockum Fritid', distance: 50, targetDistance: 120 };
  const verdict = graded({ item: landmark, hit: wrongThing });
  assert.equal(verdict.right, false);
  assert.equal(verdict.hitName, 'Kockum Fritid');
  assert.equal(verdict.distance, 120, 'the distance reported is to the answer, not to what you hit');
});

test('each kind is graded to its own tolerance', () => {
  // A bridge is 120 m and a landmark 250: the canal bridges are a few hundred
  // metres apart, so a landmark's slack would accept the wrong one.
  const hit = { name: 'Petribron', distance: 200, targetDistance: 200 };
  assert.equal(graded({ item: { name: 'Petribron', kind: 'bridge' }, hit }).right, false);
  assert.equal(graded({ item: { name: 'Petribron', kind: 'landmark' }, hit }).right, true);
});

test('the tolerance is a floor in metres and a fingertip on screen', () => {
  // Zoomed out, 250 m is a handful of pixels — a dare, not a tolerance. The
  // pixel floor is what makes the same name placeable at either zoom.
  const item = { name: 'Emporia', kind: 'landmark' };
  const hit = { name: 'Emporia', distance: 700, targetDistance: 700 };
  assert.equal(graded({ item, hit, metersPerPixel: 1 }).right, false,
    'zoomed in, 700 m away is wrong');
  assert.equal(graded({ item, hit, metersPerPixel: 40 }).right, true,
    'zoomed out, the same 700 m is under a fingertip');
});

test('an unknown kind is a crash, not a wrong answer', () => {
  // Silently grading it as a miss would make a build/app mismatch look like the
  // player being bad at the game.
  assert.throws(() => graded({ item: { name: 'x', kind: 'nonesuch' }, hit: null }));
});
