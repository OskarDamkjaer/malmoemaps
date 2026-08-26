// The street half of the quiz, played against the real tiles.
//
// Streets are the one kind with no geometry of its own. An area is graded and
// drawn from districts.geojson and a bridge is a point in learn.json, but a
// street is a *name* that has to be found again, at runtime, in whatever vector
// tiles the browser happens to have loaded. Everything that can go wrong with
// that goes wrong quietly and only on the map: the wrong street lights up, or
// half of the right one does, or a correct tap is marked wrong — and none of it
// shows up in a test that only reads learn.json, because learn.json is fine.
//
// So this opens malmo.pmtiles, decodes `transportation_name` out of it, and
// hands app/highlight.js a map object whose `querySourceFeatures` answers from
// those tiles. What the test sees is what the app sees.
//
// The bug it was written for: `highlightStreet` used to take a point and light
// up the nearest named street. A street's point comes from
// `representativePoint` (scripts/lib/geo.mjs), which returns an existing vertex
// — and OSM ways are split at junctions, so that vertex is a crossroads. Ask
// for Södergatan at Södergatan's own point and Skomakaregatan is 0.317 m away
// against Södergatan's 0.329 m. The map lit up the cross street: short, at right
// angles, indistinguishable from "only part of it highlighted".
//
// Run: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { STREET_ZOOM } from '../app/rounds.mjs';
import { highlightStreet, streetAt } from '../app/highlight.js';
import { tiles, layerFeatures } from '../scripts/lib/pmtiles.mjs';

const ARCHIVE = 'data/cache/malmo.pmtiles';
const LEARN = 'build/data/learn.json';
const skip = existsSync(ARCHIVE) && existsSync(LEARN)
  ? false
  : 'the archive and build/data are gitignored — run scripts/build-basemap.sh and build-learn.mjs first';

const streets = skip ? [] : JSON.parse(readFileSync(LEARN, 'utf8')).items
  .filter((it) => it.kind === 'street');

// Everything the source has at one zoom, which is what a browser holds once you
// have panned across the city.
const loadedAt = (zoom) => {
  const out = [];
  for (const t of tiles(ARCHIVE, { zoom })) out.push(...layerFeatures(t.data, 'transportation_name', t));
  return out;
};
const atStreetZoom = skip ? [] : loadedAt(STREET_ZOOM);

/**
 * A map that answers from real tiles.
 *
 * Only the four calls highlight.js makes of it. `setData` is captured rather
 * than drawn, because what was handed to the source *is* the answer under test.
 */
function fakeMap(features) {
  let drawn = [];
  return {
    drawn: () => drawn,
    getCenter: () => ({ lat: 55.6, lng: 13.0 }),
    getSource: () => ({ setData: (d) => { drawn = d.features; } }),
    querySourceFeatures: (_source, { sourceLayer, filter }) => {
      if (sourceLayer !== 'transportation_name') return [];
      if (!filter) return features;
      const [, key, value] = filter;
      return features.filter((f) => f.properties[key] === value);
    },
  };
}

const M_LAT = 110574;
const kx = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);
const flatten = (c) => (typeof c[0] === 'number' ? [c] : c.flatMap(flatten));
const points = (fs) => fs.flatMap((f) => flatten(f.geometry.coordinates));

// How far the drawn shape reaches, end to end.
function reach(fs, lat) {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points(fs)) {
    w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y);
  }
  return Math.hypot((e - w) * kx(lat), (n - s) * M_LAT);
}
const spanOf = ([w, s, e, n]) => Math.hypot((e - w) * kx(s), (n - s) * M_LAT);

// The middle of the longest straight run in a shape: the point on a street
// furthest from a junction, which is what a fair tap on it looks like.
function midBlock(features) {
  let best = null;
  let longest = -1;
  for (const f of features) {
    const lines = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates];
    for (const line of lines) {
      for (let i = 1; i < line.length; i++) {
        const [a, b] = [line[i - 1], line[i]];
        const d = Math.hypot((b[0] - a[0]) * kx(a[1]), (b[1] - a[1]) * M_LAT);
        if (d > longest) { longest = d; best = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
      }
    }
  }
  return { lng: best[0], lat: best[1] };
}

// ---- the bug this file exists for -------------------------------------------

test('a street lights up itself and not the one crossing it', { skip }, () => {
  // Every piece drawn has to be a piece the source files under that name.
  // Compared by geometry because that is all the highlight source carries, and
  // the fake map is handing back the very features it was asked for — so this
  // is an identity check, not a proximity one. It is exactly what the old code
  // could not pass: it drew the pieces of whatever name came back from a
  // nearest-neighbour search, and at a junction that is the other street.
  const wrong = [];
  for (const st of streets) {
    const map = fakeMap(atStreetZoom);
    assert.ok(highlightStreet(map, st.name, st.point), `${st.name} could not be found at all`);
    const mine = new Set(map
      .querySourceFeatures('openmaptiles', { sourceLayer: 'transportation_name', filter: ['==', 'name', st.name] })
      .map((f) => JSON.stringify(f.geometry)));
    const strangers = map.drawn().filter((f) => !mine.has(JSON.stringify(f.geometry)));
    if (strangers.length) wrong.push(`${st.name}: ${strangers.length} pieces of some other street`);
  }
  assert.deepEqual(wrong, [], 'these lit up something other than themselves');
});

test('a street lights up along its whole length', { skip }, () => {
  const short = [];
  for (const st of streets) {
    const want = spanOf(st.bbox);
    // Under 100 m the bbox is a rounding error and the ratio means nothing.
    if (want < 100) continue;
    const map = fakeMap(atStreetZoom);
    highlightStreet(map, st.name, st.point);
    const got = reach(map.drawn(), st.point[1]);
    if (got < want * 0.7) short.push(`${st.name}: ${Math.round(got)} m of ${Math.round(want)} m`);
  }
  assert.deepEqual(short, [], 'these were drawn as a fragment of themselves');
});

test('two streets of the same name stay two streets', { skip }, () => {
  // The other half of the same knob. `LINK_M` is what joins pieces into one
  // street, and it is only correct if it is *also* small enough to keep
  // Bruksvägen in Oxie apart from Bruksvägen in Klagshamn — which is what the
  // build assumed when it made them two entries in the quiz.
  const dupes = new Map();
  for (const st of streets) {
    if (!dupes.has(st.name)) dupes.set(st.name, []);
    dupes.get(st.name).push(st);
  }
  const merged = [];
  for (const [name, group] of dupes) {
    if (group.length < 2) continue;
    for (const st of group) {
      const map = fakeMap(atStreetZoom);
      highlightStreet(map, name, st.point);
      // Reaching one of its namesakes means the two got joined.
      const others = group.filter((o) => o !== st);
      for (const other of others) {
        const hit = points(map.drawn()).some(([x, y]) => x >= other.bbox[0] && x <= other.bbox[2]
          && y >= other.bbox[1] && y <= other.bbox[3]);
        if (hit) merged.push(`${name} @ ${st.point} swallowed the one at ${other.point}`);
      }
    }
  }
  assert.deepEqual(merged, [], 'same name, different street, drawn as one');
});

// ---- the zoom the round warns about ------------------------------------------

test('STREET_ZOOM is where the archive actually starts naming streets', { skip }, () => {
  // The round says "Zooma in för att se gatorna" below this zoom, and the whole
  // claim is about what is in the tiles. Measured, not assumed: if a rebuild
  // changes the minzoom of `transportation_name`, the app is telling people to
  // do the wrong thing and this is where it says so.
  const names = (zoom) => new Set(loadedAt(zoom).map((f) => f.properties.name).filter(Boolean));
  const below = names(STREET_ZOOM - 1);
  const at = names(STREET_ZOOM);

  assert.ok(at.size > below.size * 5,
    `z${STREET_ZOOM} has ${at.size} names against z${STREET_ZOOM - 1}'s ${below.size} — that is not where the streets arrive`);
  // And the quiz's own streets are the ones that have to be there.
  const missing = streets.filter((st) => !at.has(st.name));
  assert.deepEqual(missing.map((s) => s.name), [], `not in the tiles at z${STREET_ZOOM}`);
});

test('below it, a street question cannot be graded', { skip }, () => {
  // Why the warning is worth a line of chrome: it is not that the map looks
  // empty, it is that `streetAt` — the grader — finds nothing, so a correct tap
  // is marked wrong. If this ever passes, the warning can go.
  const map = fakeMap(loadedAt(STREET_ZOOM - 1));
  const ungradeable = streets.filter((st) => {
    const hit = streetAt(map, { lng: st.point[0], lat: st.point[1] }, 40);
    return hit?.properties.name !== st.name;
  });
  assert.ok(ungradeable.length > streets.length * 0.5,
    `${ungradeable.length} of ${streets.length} streets are ungradeable a zoom below STREET_ZOOM — if that is now few, drop the warning`);
});

// ---- the grader's own direction ----------------------------------------------

test('tapping a street is graded as that street', { skip }, () => {
  // The other direction, and the one that must keep using proximity: a finger
  // lands somewhere and the name is what comes back. Tapping a point *on* the
  // street has to name it — junctions excepted, where two names are equally
  // true and the quiz accepts either by design (the grader compares names, and
  // a tap at a crossroads is genuinely on both).
  const wrong = [];
  for (const st of streets) {
    const map = fakeMap(atStreetZoom);
    highlightStreet(map, st.name, st.point);
    // Mid-block, not the item's own point and not a vertex — the vertices are
    // the junctions, which is the whole lesson of this file. The middle of the
    // longest straight run is the furthest a tap can get from a crossroads.
    const hit = streetAt(map, midBlock(map.drawn()), 40);
    if (hit?.properties.name !== st.name) wrong.push(`${st.name} → ${hit?.properties.name ?? 'nothing'}`);
  }
  assert.deepEqual(wrong, [], 'these do not answer to a tap on themselves');
});
