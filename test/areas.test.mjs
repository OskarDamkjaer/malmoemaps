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
  assert.equal(level.neighbourhood.length, 31, 'thirty-one curated in-between names');
});

test('level 3 covers the city: a curated name, or the delområde standing in', { skip }, () => {
  // The curated file has holes and always will — most of Malmö has no word
  // between "Västra Innerstaden" and "Rörsjöstaden", and inventing one would be
  // the only dishonest thing this level could do. What fills the holes on
  // *screen* is the delområde itself, elevated (area-levels.mjs). So the level
  // is complete without a single invented name, and every delområde is on
  // exactly one side of the line.
  const covered = new Set(read(`${DATA}/neighbourhoods.geojson`)
    .features.flatMap((f) => f.properties.covers));
  const elevated = level.delomrade.filter((n) => !covered.has(n));

  assert.ok(covered.size < level.delomrade.length,
    'the curated names do not claim every delområde — if they did, level 3 would be level 4 again');
  assert.equal(covered.size, 70, '70 of the 136 delområden have an in-between name');
  assert.equal(elevated.length, 66, 'the other 66 are elevated under their own name');
  assert.equal(covered.size + elevated.length, 136, 'grouped or elevated, never both, never neither');

  // The example from the request: the zoom that used to be blank here says
  // Rörsjöstaden, because Rörsjöstaden is what it is called.
  assert.ok(elevated.includes('Rörsjöstaden'), 'Rörsjöstaden is elevated');
  assert.ok(!elevated.includes('Rönneholm'), 'Rönneholm is not — Slottsstaden covers it');
});

test('no name appears on two levels, except where the file says why', { skip }, () => {
  // Two repeats are legitimate, and both have to be declared rather than
  // tolerated:
  //
  //   · a grouping named for a delområde it covers — Kroksbäck the area
  //     contains Kroksbäck the delområde, and that nesting is how the city
  //     really is. A one-member promotion (Västra Hamnen, Gamla Staden) is the
  //     same shape: the name belongs to the place, not just to the statistical
  //     unit.
  //   · a grouping narrower than the stadsdel it is named after, which must say
  //     so in `narrowerThanStadsdel`. Five do: eleven stops called Hyllie all
  //     land in Hyllievång while the stadsdel Hyllie reaches Kulladal, so the
  //     word genuinely means two extents and the map says the smaller one at
  //     the closer zoom. See areas.json's _doc.narrowerThanTheStadsdel.
  //
  // Anything else on two rungs is an accident and fails here.
  const features = read(`${DATA}/neighbourhoods.geojson`).features;
  const groupings = new Map(features.map((f) => [f.properties.name, f.properties]));
  const rungs = [
    ['kommun', level.kommun], ['stadsdel', level.stadsdel],
    ['neighbourhood', [...groupings.keys()]], ['delomrade', level.delomrade],
  ];
  for (let i = 0; i < rungs.length; i++) {
    for (let j = i + 1; j < rungs.length; j++) {
      for (const name of rungs[i][1]) {
        if (!rungs[j][1].includes(name)) continue;
        const p = groupings.get(name);
        const namedForItsOwnMember = p?.covers.includes(name);
        // Declared repeats are licensed against the stadsdel rung and nothing
        // else: Hyllie may repeat the stadsdel Hyllie, but not a delområde.
        const declared = p?.narrowerThanStadsdel === name
          && (rungs[i][0] === 'stadsdel' || rungs[j][0] === 'stadsdel');
        assert.ok(namedForItsOwnMember || declared,
          `"${name}" is on both ${rungs[i][0]} and ${rungs[j][0]} without being a grouping `
          + 'named for its own member or declaring narrowerThanStadsdel');
      }
    }
  }

  // The licence is not a blanket one: it only covers the five, and only for the
  // stadsdel each actually sits in.
  const narrowed = features.filter((f) => f.properties.narrowerThanStadsdel);
  assert.deepEqual(narrowed.map((f) => f.properties.name).sort(),
    ['Husie', 'Hyllie', 'Kirseberg', 'Oxie', 'Rosengård'],
    'exactly five names are allowed to be narrower than their stadsdel');
  for (const f of narrowed) {
    assert.equal(f.properties.narrowerThanStadsdel, f.properties.name,
      `${f.properties.name}: the declaration names a different stadsdel than the grouping`);
    assert.ok(level.stadsdel.includes(f.properties.narrowerThanStadsdel),
      `${f.properties.name} declares a stadsdel that does not exist`);
    assert.equal(f.properties.stadsdel, f.properties.name,
      `${f.properties.name}'s label falls outside the stadsdel it is named after`);
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

test('a level-3 name stays inside one stadsdel', { skip }, () => {
  // The second check on the same hand-written file, and the sharper one: the
  // ladder nests, so a name at level 3 is a piece of one stadsdel. A grouping
  // reaching into two is either a real vernacular name the administrative
  // division cuts through — Slottsstaden and Sorgenfri, the same two the
  // statistics forgive, which is itself the reassuring part — or two different
  // places that happen to share a word.
  //
  // Bellevue was the latter and is why this test exists: it had swept in
  // Bellevuegården, a sixties estate in Hyllie 1.2 km from the villa district
  // in Limhamn-Bunkeflo, on the strength of the shared word alone. Since the
  // delområden with no name above them are elevated to level 3 anyway,
  // dropping it cost nothing — Bellevuegården says its own name at that zoom.
  const ACCEPTED = {
    Slottsstaden: 'Malmö Hus is administratively Centrum; Slottsparken is Slottsstaden to anyone standing in it. Already marked partial.',
    Sorgenfri: 'Norra Sorgenfri is in Centrum, the other two in Södra Innerstaden; the name crosses the boundary on the ground.',
  };
  const stadsdelOf = new Map(read(`${DATA}/stadsdelar.geojson`).features
    .flatMap((f) => f.properties.covers.map((n) => [n, f.properties.name])));

  const crossings = [];
  for (const f of read(`${DATA}/neighbourhoods.geojson`).features) {
    const { name, covers } = f.properties;
    if ([...new Set(covers.map((n) => stadsdelOf.get(n)))].length > 1 && !ACCEPTED[name]) {
      crossings.push(`${name} spans two stadsdelar: ${covers.map((n) => `${n}=${stadsdelOf.get(n)}`).join(', ')}`);
    }
  }
  assert.deepEqual(crossings, [], `grouping(s) crossing a stadsdel with no reason given:\n  ${crossings.join('\n  ')}`);
});

test('the official cross-check table still describes the delområden we have', { skip }, () => {
  const official = read('areas/statistikomraden.json').areas;
  assert.equal(official.length, 14);
  const listed = official.flatMap((a) => a.covers);
  assert.equal(listed.length, new Set(listed).size, 'no delområde is in two statistikområden');
  assert.deepEqual([...listed].sort(), [...level.delomrade].sort(),
    'the table covers exactly the 136 delområden — regenerate it if OSM gained or lost one');
});
