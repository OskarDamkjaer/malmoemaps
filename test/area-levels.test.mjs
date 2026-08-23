// The zoom ladder, held to its one promise: exactly one level at a time.
//
// This replaces looking at the map and squinting. The four levels below are the
// four things you should be able to see, in order, on the way in — and the
// failure this guards against is not "a level is missing" (you'd notice) but
// "two levels are on at once for half a zoom step", which reads as clutter
// rather than as a bug and is invisible unless you go looking at exactly the
// wrong zoom.
//
// Run: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, TIER, areaLayers, areaLayersAt, levelAt } from '../app/area-levels.mjs';

// The four levels, by the name you should see at each. Zooms are picked inside
// each band rather than at its edge; the edges get their own test below.
const LADDER = [
  { zoom: 10.5, level: 'kommun', shows: 'Malmö' },
  { zoom: 11.5, level: 'stadsdel', shows: 'Västra Innerstaden' },
  { zoom: 12.8, level: 'neighbourhood', shows: 'Sorgenfri, Slottsstaden' },
  { zoom: 14, level: 'delomrade', shows: 'Västra Sorgenfri, Rönneholm, Ribersborg' },
];

const levelsAt = (zoom) => [...new Set(areaLayersAt(zoom).map((l) => l.metadata.level))];

test('each level is the only one drawn at its zoom', () => {
  for (const { zoom, level, shows } of LADDER) {
    assert.deepEqual(levelsAt(zoom), [level], `z${zoom} should show only ${level} (${shows})`);
  }
});

test('every level draws both its names and its outline', () => {
  // "At every level I want to see the area outlines clearly" — an area you
  // can't see the edge of is a label floating over a basemap.
  for (const { zoom, level } of LADDER) {
    const roles = new Set(areaLayersAt(zoom).map((l) => l.metadata.role));
    if (level === 'kommun') {
      // The one exception, and it is not a gap: "Malmö" is drawn by the
      // basemap's own place_city label, checked in style.test.mjs.
      assert.deepEqual([...roles], ['outline'], 'z10.5 draws the Malmö outline');
      continue;
    }
    assert.ok(roles.has('outline'), `z${zoom} (${level}) draws an outline`);
    assert.ok(roles.has('name'), `z${zoom} (${level}) draws names`);
  }
});

test('no zoom shows two levels at once', () => {
  // Every tenth of a zoom from the widest view to the deepest, including each
  // handover exactly — MapLibre's minzoom is inclusive and maxzoom exclusive,
  // so a level that ended at 12.3 and the next starting at 12.3 must not both
  // be on at 12.3.
  for (let z = 6; z <= 18.001; z += 0.1) {
    const zoom = Number(z.toFixed(1));
    assert.equal(levelsAt(zoom).length, 1, `z${zoom} draws exactly one level, got ${levelsAt(zoom)}`);
  }
  for (const zoom of Object.values(TIER)) {
    assert.equal(levelsAt(zoom).length, 1, `z${zoom} (a handover) draws exactly one level`);
    assert.equal(levelAt(zoom).from, zoom, `z${zoom} is the first zoom of its level, not the last of the one before`);
  }
});

test('level 3 says something everywhere: the delområden with no name above them', () => {
  // The rule that keeps this from being level 4 drawn twice is the filter: a
  // delområde appears at level 3 only where no curated name covers it, so
  // "Rörsjöstaden" is elevated and "Rönneholm" — which Slottsstaden covers —
  // is not. Both of the level-3 delområde layers must carry it; without the
  // filter the level really would be the level below in a bigger size.
  const notGrouped = ['!', ['in', ['get', 'name'], ['literal', ['Rönneholm']]]];
  const at3 = areaLayersAt(12.8, { notGrouped });
  const elevated = at3.filter((l) => l.id.endsWith('-elevated'));

  assert.equal(elevated.length, 2, 'the elevated delområden are drawn at level 3');
  for (const layer of elevated) {
    assert.equal(layer.metadata.level, 'neighbourhood', `${layer.id} belongs to level 3, not a level of its own`);
    assert.ok(layer.filter.includes(notGrouped), `${layer.id} draws only what no curated name covers`);
  }
  assert.deepEqual(elevated.map((l) => l.metadata.role).sort(), ['name', 'outline'],
    'an elevated name gets a boundary too — that is what makes level 3 a division of the city');

  // And they are only there at level 3: at level 4 the same delområden are
  // drawn by the unfiltered layers, alongside the ones a name was hiding.
  assert.equal(areaLayersAt(14, { notGrouped }).filter((l) => l.id.endsWith('-elevated')).length, 0,
    'nothing is "elevated" once every delområde is drawn anyway');
});

test('an elevated name is in the same voice as a curated one', () => {
  // "Rörsjöstaden" and "Slottsstaden" are the same kind of answer to the same
  // question at this zoom, so the map must not type one of them as a lesser
  // thing. Only the collision rules differ, and deliberately: the 31 curated
  // names always draw, the 65 elevated ones take their turn around them.
  const layers = areaLayers();
  const curated = layers.find((l) => l.id === 'area-label-neighbourhood');
  const elevated = layers.find((l) => l.id === 'district-label-elevated');

  for (const key of ['text-size', 'text-transform', 'text-letter-spacing', 'text-font']) {
    assert.deepEqual(elevated.layout[key], curated.layout[key], `same ${key}`);
  }
  assert.deepEqual(elevated.paint, curated.paint, 'same ink and halo');

  assert.equal(curated.layout['text-allow-overlap'], true, 'a curated name is always drawn');
  assert.equal(curated.layout['text-ignore-placement'], false,
    'but it blocks the elevated names around it, rather than being overprinted by them');
  assert.ok(!elevated.layout['text-allow-overlap'], 'an elevated name yields where there is no room');
  assert.deepEqual(elevated.layout['symbol-sort-key'], ['get', 'rank'], 'largest first when it does');
});

test('the ladder ends at the delområden — the parts ride inside level 4', () => {
  // Gamla Väster, Erikslust, Seved have no boundary anywhere in Malmö, so they
  // cannot be a level: an outline is what makes a level a division of the city
  // rather than a scatter of words. They are drawn *with* the delområden
  // instead, which keeps the promise ("one level at a time") while still
  // putting the names on the map.
  for (const zoom of [14, 15, 16, 17, 18]) {
    assert.deepEqual(levelsAt(zoom), ['delomrade'], `z${zoom} still shows delområden and nothing finer`);
  }
  assert.equal(LEVELS.at(-1).to, Infinity, 'the last level runs to the end of the zoom range');
  assert.equal(LEVELS.length, 4, 'four levels, not five');

  const part = areaLayers().find((l) => l.id === 'area-label-part');
  assert.ok(part, 'the parts are drawn');
  assert.equal(part.metadata.level, 'delomrade', 'as part of level 4, not as a level of their own');
  assert.equal(part.metadata.role, 'name', 'and as a name, which is all they can be without an outline');
  // The one thing that must not come back: a rung of its own.
  assert.ok(!areaLayers().some((l) => l.metadata.level === 'part'),
    'no layer claims a "part" level');
});

test('the levels tile the zoom axis with no seam and no gap', () => {
  assert.equal(LEVELS[0].from, 0, 'the first level starts at the bottom');
  for (let i = 1; i < LEVELS.length; i++) {
    assert.equal(LEVELS[i].from, LEVELS[i - 1].to,
      `${LEVELS[i - 1].id} hands over to ${LEVELS[i].id} with no overlap and no gap`);
  }
});

test('every layer declares which level and role it belongs to', () => {
  // The whole test file rests on this metadata, so a layer added without it
  // would silently escape every check above.
  const ids = LEVELS.map((l) => l.id);
  for (const layer of areaLayers()) {
    assert.ok(ids.includes(layer.metadata?.level), `${layer.id} declares a known level`);
    assert.ok(['outline', 'name'].includes(layer.metadata?.role), `${layer.id} declares a role`);
  }
});

test('a layer never outlives the level it belongs to', () => {
  for (const layer of areaLayers()) {
    const level = LEVELS.find((l) => l.id === layer.metadata.level);
    assert.equal(layer.minzoom ?? 0, level.from, `${layer.id} starts with its level`);
    assert.equal(layer.maxzoom ?? Infinity, level.to, `${layer.id} ends with its level`);
  }
});
