// Förr: what a photograph is worth, and which five you get today.
//
// The quiz asks *where*. This asks *where and when*, which is a different kind
// of knowing — you can walk past Södergatan every day for ten years and have no
// idea whether the picture in front of you is from 1905 or 1935. The year is
// what the buildings, the clothes, the road surface and the absence of cars are
// telling you, and reading that is a skill the rest of the app does not touch.
//
// Nothing here knows about the DOM or the map, the same split rounds.mjs has
// from learn.js, so test/photos.test.mjs can ask it questions without a browser.
//
// ---- why this is scored and the quiz is not ----------------------------------
//
// Öva grades a tap right or wrong, because "is Sofielund there" has an answer
// and a near miss is still not knowing. A photograph does not work that way:
// being nine years and four hundred metres out is a real answer that deserves a
// real number, and the number is what makes you want the next one. So Förr
// keeps score, and the score is the only place in this app where being close
// counts for something.
import { metersBetween } from './rounds.mjs';

/** Photographs in a day. Five, because TimeGuessr is five and it is the right
 *  length: long enough to recover from one bad guess, short enough to finish. */
export const ROUND = 5;

/** What each half of a round is worth. Year and place are equal on purpose —
 *  the whole idea is that they are two separate things to know. */
export const MAX_PER_HALF = 5000;

export const MAX_SCORE = ROUND * MAX_PER_HALF * 2;

/**
 * How close the year was.
 *
 * Exact 5000 · ±3 y 3704 · ±5 y 3033 · ±10 y 1839 · ±20 y 677 · ±40 y 92.
 *
 * The corpus runs 1880 to the mid-1970s and clusters hard around 1900–1930,
 * because Public Domain Mark and age are the same fact — anything recent enough
 * to still be in copyright is not in here. So a player who knows nothing and
 * guesses the middle every time is only ever twenty or thirty years out, and the
 * decay has to be steep enough that this is visibly worse than knowing. Ten
 * years to fall by two thirds does that: it pays for reading the picture without
 * pretending a shrug was a guess.
 */
export const yearScore = (guess, actual) =>
  Math.round(MAX_PER_HALF * Math.exp(-Math.abs(guess - actual) / 10));

/**
 * How close the tap was, in metres.
 *
 * 0 m 5000 · 250 m 4232 · 500 m 3583 · 1 km 2567 · 2 km 1318 · 5 km 178.
 *
 * Tuned to a city fifteen kilometres across rather than to a planet. TimeGuessr
 * can afford to pay well for the right country; here the whole board is one
 * municipality, so the interesting distances are the ones you could walk. A
 * kilometre — right part of town, wrong street — is worth about half.
 *
 * The floor matters more than the ceiling: the answer is a street-level pin
 * derived from a catalogue description, so it is good to about a hundred metres
 * and no better. Paying 4232 at 250 m rather than demanding a bullseye is the
 * curve admitting that.
 */
export const placeScore = (meters) =>
  Math.round(MAX_PER_HALF * Math.exp(-meters / 1500));

/** One round's two halves, and the metres behind the second one. */
export function scored({ photo, year, point }) {
  const meters = metersBetween(point, photo.point);
  const yearPoints = yearScore(year, photo.year);
  const placePoints = placeScore(meters);
  return {
    meters,
    years: year - photo.year,
    yearPoints,
    placePoints,
    total: yearPoints + placePoints,
  };
}

// ---- which five ---------------------------------------------------------------
// The day is the seed, so everybody playing on the same date gets the same five
// and there is nothing to serve. That is the only reason a daily works in an app
// with no backend: it is not a schedule, it is a pure function of the date.

/** Day 1 is 1 January 2026. Nothing depends on the epoch except the number
 *  printed at the top of the screen. */
const EPOCH = Math.round(Date.UTC(2026, 0, 1) / 864e5);

/**
 * Today, as an integer.
 *
 * Local date, not UTC: the day has to roll over at midnight where you are
 * standing, and in Sweden UTC is an hour or two behind, so a UTC day number
 * changes during the evening. `toLocaleDateString('sv-SE')` gives ISO
 * `YYYY-MM-DD`, which `Date.parse` then reads as UTC midnight — the round trip
 * strips the time of day rather than converting it.
 */
export function dayNumber(now = new Date()) {
  return Math.round(Date.parse(now.toLocaleDateString('sv-SE')) / 864e5) - EPOCH;
}

/** Small seeded PRNG. Deterministic across engines, which is the whole point. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(list, seed) {
  const out = [...list];
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The five photographs for a given day.
 *
 * Cycled rather than sampled. Drawing five at random each day would show you the
 * same picture twice in a fortnight and leave others unseen for a year; dealing
 * the whole deck instead means every photograph comes up exactly once before any
 * comes up twice. The deck is reshuffled each time round, seeded on the cycle
 * number, so the second pass through is not the first pass in the same order.
 *
 * The tail is dropped: with 203 photographs the cycle is 40 days and the last
 * three sit out until the reshuffle. Rotating them in would mean a day whose
 * five are not five.
 */
export function dayOf(photos, day) {
  const cycleLength = Math.floor(photos.length / ROUND);
  if (cycleLength < 1) return [];
  // Floor division that keeps working for negative days — someone with a wrong
  // clock, or the epoch moving — rather than mirroring the cycle around day 0.
  const cycle = Math.floor(day / cycleLength);
  const index = ((day % cycleLength) + cycleLength) % cycleLength;
  return shuffled(photos, cycle).slice(index * ROUND, index * ROUND + ROUND);
}

/** How many days before a photograph comes round again. */
export const cycleLength = (photos) => Math.floor(photos.length / ROUND);

// ---- what you scored ----------------------------------------------------------
// Separate from progress.mjs, and not a small decision. That store is keyed by
// item name and asks one question — can you place this, two times running — so a
// name can be *known*. A photograph is not something you learn; it is something
// you get once and then have seen. Filing a score under "Södergatan" would
// quietly claim you had learned Södergatan because you dated a picture of it.
const KEY = 'malmo:photos:v1';

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    return raw && typeof raw === 'object' ? raw : { days: {} };
  } catch {
    return { days: {} };
  }
}

let store = load();

/** What you scored on a day, or null if you have not played it. */
export const scoreOf = (day) => store.days?.[day] ?? null;

/** Your best day so far. */
export const bestScore = () => Math.max(0, ...Object.values(store.days ?? {}));

/** How many days you have played. */
export const daysPlayed = () => Object.keys(store.days ?? {}).length;

/** A finished day. Kept only if it beats what that day already had, so
 *  reloading mid-round cannot cost you a score you already made. */
export function recordDay(day, score) {
  store.days ??= {};
  if (!(store.days[day] >= score)) store.days[day] = score;
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch { /* private mode; a lost score is not worth a crash */ }
  return store.days[day];
}

/** Everything Förr remembers about you, gone. Shares the button with Öva. */
export function forgetDays() {
  store = { days: {} };
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* as above */ }
}
