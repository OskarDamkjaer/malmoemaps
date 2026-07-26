// What is actually on each rung of the ladder.
//
// area-levels.test.mjs proves the zoom bands don't overlap; this proves they
// have the right things in them — that zooming in on Rönneholm really does go
// Malmö → Västra Innerstaden → Slottsstaden → Rönneholm, and that a name never
// turns up on two rungs by accident.
//
// Run: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const DATA = 'build/data';
const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
const built = existsSync(`${DATA}/neighbourhoods.geojson`);
const skip = built ? false : 'build/data is gitignored — run the pipeline first (README, "Building the data")';

const names = (fc) => fc.features.map((f) => f.properties.name);
const level = {
  get kommun() { return names(read(`${DATA}/kommun.geojson`)); },
  get stadsdel() { return names(read(`${DATA}/stadsdelar.geojson`)); },
  get neighbourhood() { return names(read(`${DATA}/neighbourhoods.geojson`)); },
  get delomrade() {
    return read(`${DATA}/districts.geojson`).features
      .filter((f) => f.properties.admin_level === 10).map((f) => f.properties.name);
  },
};

test('zooming in on Rönneholm passes through one name per level', { skip }, () => {
  assert.deepEqual(level.kommun, ['Malmö']);
  assert.ok(level.stadsdel.includes('Västra Innerstaden'), 'level 2 has Västra Innerstaden');
  assert.ok(level.neighbourhood.includes('Slottsstaden'), 'level 3 has Slottsstaden');
  assert.ok(level.delomrade.includes('Rönneholm'), 'level 4 has Rönneholm');

  // …and the same going down the other example, Sorgenfri.
  assert.ok(level.neighbourhood.includes('Sorgenfri'), 'level 3 has Sorgenfri');
  for (const n of ['Västra Sorgenfri', 'Ribersborg']) {
    assert.ok(level.delomrade.includes(n), `level 4 has ${n}`);
  }
});

test('each level is the size it should be', { skip }, () => {
  assert.equal(level.stadsdel.length, 10, 'ten stadsdelar');
  assert.equal(level.delomrade.length, 136, '136 delområden');
  // Level 3 is the curated file and nothing else, so its size is a decision,
  // not a fact about a dataset — if this number moves, areas.json moved.
  assert.equal(level.neighbourhood.length, 14, 'fourteen curated in-between names');
});

test('level 3 is allowed to have holes, and does', { skip }, () => {
  // The point of the level is the names that exist, not covering the map. An
  // earlier version filled the gaps with delområden and put 93 names on two
  // rungs at once; this asserts we did not quietly go back to that.
  const covered = new Set(read(`${DATA}/neighbourhoods.geojson`)
    .features.flatMap((f) => f.properties.covers));
  assert.ok(covered.size < level.delomrade.length,
    'level 3 does not claim every delområde — if it did, it would be level 4 again');
  assert.equal(covered.size, 43, '43 of the 136 delområden have an in-between name');
});

test('no name appears on two levels, except a grouping named for its own centre', { skip }, () => {
  // Kroksbäck the area contains Kroksbäck the delområde, and that nesting is
  // how the city really is. What must not happen is the same name on two
  // levels for two *different* places.
  const groupings = new Map(read(`${DATA}/neighbourhoods.geojson`)
    .features.map((f) => [f.properties.name, f.properties.covers]));
  const rungs = [
    ['kommun', level.kommun], ['stadsdel', level.stadsdel],
    ['neighbourhood', [...groupings.keys()]], ['delomrade', level.delomrade],
  ];
  for (let i = 0; i < rungs.length; i++) {
    for (let j = i + 1; j < rungs.length; j++) {
      for (const name of rungs[i][1]) {
        if (!rungs[j][1].includes(name)) continue;
        // The only legitimate repeat: a level-3 grouping that takes its name
        // from one of the delområden it covers.
        assert.ok(groupings.get(name)?.includes(name),
          `"${name}" is on both ${rungs[i][0]} and ${rungs[j][0]} without being a grouping named for its own member`);
      }
    }
  }
});

test('every level 3 name has an outline to sit in', { skip }, () => {
  // Levels 1 and 3 have no polygons of their own — their outlines are dissolved
  // from the level below. A grouping whose dissolve came out empty or open
  // would be a name floating over the basemap.
  for (const f of read(`${DATA}/neighbourhoods.geojson`).features) {
    const { name, label, covers } = f.properties;
    assert.equal(f.geometry.type, 'MultiLineString', `${name} has an outline`);
    assert.ok(f.geometry.coordinates.length >= 1, `${name}'s outline is not empty`);
    for (const ring of f.geometry.coordinates) {
      assert.ok(ring.length >= 4, `${name}: a ring of ${ring.length} points is not a shape`);
      assert.deepEqual(ring.at(0), ring.at(-1), `${name}: the outline closes`);
    }
    assert.equal(label?.length, 2, `${name} has a label point`);
    assert.ok(covers.length >= 1, `${name} covers at least one delområde`);
  }
});

test('the Malmö outline is one closed ring around the whole city', { skip }, () => {
  const [f] = read(`${DATA}/kommun.geojson`).features;
  assert.equal(f.geometry.type, 'MultiLineString');
  // Slivers where two stadsdelar fail to share a vertex are dropped at build
  // time; what is left should be the coast-and-border ring, alone.
  assert.equal(f.geometry.coordinates.length, 1, 'one ring, not a scatter of fragments');
  const ring = f.geometry.coordinates[0];
  assert.deepEqual(ring.at(0), ring.at(-1), 'the outline closes');
  const lon = ring.map((c) => c[0]);
  const lat = ring.map((c) => c[1]);
  const { bbox } = read('config/bbox.json');
  assert.ok(Math.min(...lon) > bbox.west && Math.max(...lon) < bbox.east
    && Math.min(...lat) > bbox.south && Math.max(...lat) < bbox.north,
  'the whole outline is inside the extract, so it never runs off the tiles');
});

test('the curated groupings agree with Malmö stad’s own statistics', { skip }, () => {
  // areas/areas.json is hand-written, which is the only way to get these names
  // at all — but the city does publish a division at roughly this grain (the
  // 14 geografiska statistikområden), and a grouping that straddles two of
  // them has usually put two different places under one name.
  //
  // These two are known and accepted: the statistical division is not the
  // vernacular one, and in both cases the vernacular name is the right one.
  const ACCEPTED = {
    Slottsstaden: 'Wikipedia puts the SW corner of Malmö Hus (Slottsparken) in Slottsstaden; the city counts it to Gamla staden. Already marked partial.',
    Sorgenfri: 'Norra Sorgenfri counts to Kirsebergsstaden/Värnhem statistically; the name on the ground is Sorgenfri.',
  };
  const official = read('areas/statistikomraden.json').areas;
  const areaOf = (delomrade) => official.find((a) => a.covers.includes(delomrade))?.code;

  const straddles = [];
  for (const f of read(`${DATA}/neighbourhoods.geojson`).features) {
    const codes = [...new Set(f.properties.covers.map(areaOf))];
    assert.ok(!codes.includes(undefined), `${f.properties.name} covers a delområde the city does not list`);
    if (codes.length > 1 && !ACCEPTED[f.properties.name]) {
      straddles.push(`${f.properties.name} spans statistikområde ${codes.join(' and ')}: `
        + f.properties.covers.map((n) => `${n}=${areaOf(n)}`).join(', '));
    }
  }
  assert.deepEqual(straddles, [], `unreviewed grouping(s) crossing an official boundary:\n  ${straddles.join('\n  ')}`);
});

test('the official cross-check table still describes the delområden we have', { skip }, () => {
  const official = read('areas/statistikomraden.json').areas;
  assert.equal(official.length, 14);
  const listed = official.flatMap((a) => a.covers);
  assert.equal(listed.length, new Set(listed).size, 'no delområde is in two statistikområden');
  assert.deepEqual([...listed].sort(), [...level.delomrade].sort(),
    'the table covers exactly the 136 delområden — regenerate it if OSM gained or lost one');
});
