// Förr, held to the two promises a daily has to keep: the same date gives the
// same five photographs to everybody, and you see all of them before you see any
// of them twice.
//
// The failures guarded against here are quiet ones. A day number derived from
// UTC works perfectly all day and then rolls over during the evening, handing
// you tomorrow's photographs while it is still today. A cycle built on a
// modulo that mirrors around zero repeats yesterday for anyone whose clock is
// wrong. A scoring curve that is not monotonic pays more for a worse guess, and
// nobody would notice unless they were looking for it.
//
// Run: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  ROUND, MAX_PER_HALF, MAX_SCORE,
  yearScore, placeScore, scored,
  dayNumber, dayOf, cycleLength,
} from '../app/photos.mjs';

// ---- the curves (no build needed) -------------------------------------------

test('an exact answer is worth full marks, and nothing beats it', () => {
  assert.equal(yearScore(1937, 1937), MAX_PER_HALF);
  assert.equal(placeScore(0), MAX_PER_HALF);
  for (const d of [1, 5, 20, 100]) {
    assert.ok(yearScore(1937 + d, 1937) < MAX_PER_HALF, `${d} years out beats exact`);
    assert.ok(yearScore(1937 - d, 1937) < MAX_PER_HALF, `${d} years early beats exact`);
  }
});

test('being wrong in either direction costs the same', () => {
  for (const d of [1, 3, 12, 45]) {
    assert.equal(yearScore(1900 + d, 1900), yearScore(1900 - d, 1900));
  }
});

test('a worse guess never scores better', () => {
  let last = Infinity;
  for (let d = 0; d <= 120; d++) {
    const s = yearScore(1900 + d, 1900);
    assert.ok(s <= last, `${d} years out scored more than ${d - 1}`);
    last = s;
  }
  last = Infinity;
  for (let m = 0; m <= 20000; m += 50) {
    const s = placeScore(m);
    assert.ok(s <= last, `${m} m scored more than ${m - 50} m`);
    last = s;
  }
});

// The numbers in the doc comment are the ones the mode was tuned against, so
// they are asserted rather than described. Changing the curve should mean
// changing this test on purpose.
test('the curves are the ones the comments promise', () => {
  assert.equal(yearScore(1910, 1900), 1839);
  assert.equal(yearScore(1920, 1900), 677);
  assert.equal(placeScore(250), 4232);
  assert.equal(placeScore(500), 3583);
  assert.equal(placeScore(1000), 2567);
  assert.equal(placeScore(2000), 1318);
});

test('a round cannot be worth more than the maximum', () => {
  const photo = { year: 1937, point: [13.0, 55.6] };
  const perfect = scored({ photo, year: 1937, point: [13.0, 55.6] });
  assert.equal(perfect.total, MAX_PER_HALF * 2);
  assert.equal(perfect.meters, 0);
  assert.equal(MAX_SCORE, ROUND * MAX_PER_HALF * 2);
});

test('scored reports the miss from the answer, signed', () => {
  const photo = { year: 1930, point: [13.0, 55.6] };
  assert.equal(scored({ photo, year: 1945, point: photo.point }).years, 15);
  assert.equal(scored({ photo, year: 1910, point: photo.point }).years, -20);
});

// ---- the day ------------------------------------------------------------------

test('the day rolls over at local midnight, not at UTC midnight', () => {
  // The bug this catches: a UTC-derived day number changes at 01:00 or 02:00
  // Swedish time, so an evening player gets tomorrow's photographs.
  const lateEvening = new Date('2026-08-04T23:30:00+02:00');
  const justAfter = new Date('2026-08-05T00:30:00+02:00');
  const sameEveningEarlier = new Date('2026-08-04T08:00:00+02:00');

  assert.equal(dayNumber(lateEvening), dayNumber(sameEveningEarlier), 'the day changed during the day');
  assert.equal(dayNumber(justAfter), dayNumber(lateEvening) + 1, 'midnight did not start a new day');
});

test('consecutive dates are consecutive days', () => {
  const at = (s) => dayNumber(new Date(`${s}T12:00:00+02:00`));
  assert.equal(at('2026-03-02'), at('2026-03-01') + 1);
  // Across the spring clock change, which is the one Sweden actually has.
  assert.equal(at('2026-03-30'), at('2026-03-29') + 1);
  assert.equal(at('2027-01-01'), at('2026-12-31') + 1);
});

// ---- the cycle ----------------------------------------------------------------

const fakePhotos = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, year: 1900, point: [13, 55.6] }));

test('a day is five photographs, and never the same one twice', () => {
  const photos = fakePhotos(203);
  for (const day of [0, 1, 17, 39, 40, 41, 1000]) {
    const five = dayOf(photos, day);
    assert.equal(five.length, ROUND, `day ${day} was not ${ROUND} photographs`);
    assert.equal(new Set(five.map((p) => p.id)).size, ROUND, `day ${day} repeated a photograph`);
  }
});

test('the same day always deals the same five', () => {
  const photos = fakePhotos(203);
  const a = dayOf(photos, 216).map((p) => p.id);
  const b = dayOf(photos, 216).map((p) => p.id);
  assert.deepEqual(a, b);
});

test('everything is seen once before anything is seen twice', () => {
  const photos = fakePhotos(200);
  const len = cycleLength(photos);
  assert.equal(len, 40);
  const seen = [];
  for (let day = 0; day < len; day++) seen.push(...dayOf(photos, day).map((p) => p.id));
  assert.equal(seen.length, 200);
  assert.equal(new Set(seen).size, 200, 'a photograph came round twice inside one cycle');
});

test('the next cycle is a different order', () => {
  const photos = fakePhotos(200);
  const first = dayOf(photos, 0).map((p) => p.id);
  const second = dayOf(photos, 40).map((p) => p.id);
  assert.notDeepEqual(first, second, 'the deck was not reshuffled');
});

test('a wrong clock does not crash or repeat yesterday', () => {
  const photos = fakePhotos(200);
  // Negative days are reachable: the epoch is 2026, and a device with a bad
  // clock is not a thing to throw on.
  for (const day of [-1, -40, -217]) {
    const five = dayOf(photos, day);
    assert.equal(five.length, ROUND, `day ${day} was not a full round`);
  }
  assert.notDeepEqual(dayOf(photos, -1).map((p) => p.id), dayOf(photos, 0).map((p) => p.id));
});

test('too few photographs is empty rather than a short round', () => {
  assert.deepEqual(dayOf(fakePhotos(4), 0), []);
  assert.equal(dayOf(fakePhotos(5), 0).length, ROUND);
});

// ---- the real set -------------------------------------------------------------

const FILE = 'build/data/game.json';
const missing = existsSync(FILE)
  ? false
  : 'build/data/game.json is gitignored — run scripts/build-game.mjs first';

const game = missing ? null : JSON.parse(readFileSync(FILE, 'utf8'));
const { bbox } = JSON.parse(readFileSync('config/bbox.json', 'utf8'));

test('every photograph can be an answer', { skip: missing }, () => {
  for (const p of game.photos) {
    assert.ok(Number.isFinite(p.year), `${p.id} has no year`);
    assert.ok(p.year >= game.minYear && p.year <= game.maxYear, `${p.id} is outside the stated range`);
    const [lng, lat] = p.point;
    assert.ok(lng >= bbox.west && lng <= bbox.east && lat >= bbox.south && lat <= bbox.north,
      `${p.id} is pinned outside the map`);
    // Credit is load-bearing: half the set is CC BY, which requires it.
    assert.ok(p.credit, `${p.id} has no credit`);
    assert.ok(p.source, `${p.id} has no source`);
    assert.ok(p.image, `${p.id} has no picture`);
  }
});

test('no photograph is listed twice', { skip: missing }, () => {
  const ids = game.photos.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('the real set deals whole days', { skip: missing }, () => {
  const len = cycleLength(game.photos);
  assert.ok(len >= 10, `only ${len} days before the cycle repeats`);
  const seen = new Set();
  for (let day = 0; day < len; day++) {
    const five = dayOf(game.photos, day);
    assert.equal(five.length, ROUND);
    for (const p of five) seen.add(p.id);
  }
  assert.equal(seen.size, len * ROUND, 'a photograph came round twice inside one cycle');
});
