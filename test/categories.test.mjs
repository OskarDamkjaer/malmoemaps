// The layer menu, held to the two promises it makes.
//
// First: the map opens clean. "All the pins off by default" is one line of
// intent and about six places it can leak — a layer added without a visibility,
// a basemap POI layer left in the style, a category that forgot it was off.
//
// Second: every POI in the archive is reachable from some chip, or excused in
// writing. That one cannot be checked by reading the code, because the set of
// classes is a property of the extract, not of this repo: it changes when OSM
// changes. So the archive is opened and read (scripts/lib/pmtiles.mjs), and a
// class nobody claims fails here rather than being invisible forever.
//
// Run: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  CATEGORIES, DEFAULT_ON, UNCLAIMED, categoryLayers, categoryMinzoom,
  categoryForClass, categoryOfLayer, isCarRoadLayer,
} from '../app/categories.mjs';
import { poiInventory } from '../scripts/lib/pmtiles.mjs';

const STYLE = 'build/style.json';
const ARCHIVE = 'data/cache/malmo.pmtiles';
const noStyle = existsSync(STYLE) ? false : 'build/style.json is gitignored — run scripts/build-style.mjs first';
const noArchive = existsSync(ARCHIVE) ? false : 'the pmtiles archive is gitignored — run scripts/build-basemap.sh first';

const style = () => JSON.parse(readFileSync(STYLE, 'utf8'));
const layersOf = (cat) => categoryLayers({ ...cat, on: DEFAULT_ON.includes(cat.id) });

// ---- the map opens clean ----------------------------------------------------
test('only the two that are not pins start on', () => {
  // The rule is about pins: nothing you could call a place is drawn until a chip
  // asks for it. Both exceptions are things the map says in its own voice — the
  // street network, and the area names finer than a delområde (Gamla Väster,
  // Erikslust), which the ladder draws and this row only switches off.
  assert.deepEqual(DEFAULT_ON, ['parts', 'roads'],
    'every pin is off until asked for; the streets and the kvarter names are not pins');
});

test('every category layer is added hidden', () => {
  for (const cat of CATEGORIES.filter((c) => !DEFAULT_ON.includes(c.id))) {
    for (const layer of layersOf(cat)) {
      assert.equal(layer.layout?.visibility, 'none',
        `${layer.id} would be drawn before anyone asked for it`);
    }
  }
});

test('the basemap draws no POI of its own', { skip: noStyle }, () => {
  // Otherwise "Mat" would double every café: once from the style, once from
  // the category drawn over it.
  const poi = style().layers.filter((l) => l['source-layer'] === 'poi');
  assert.deepEqual(poi.map((l) => l.id), [],
    'POI layers belong to the app now — build-style.mjs must drop them');
});

test('each category names layers of its own, and no two share one', () => {
  const seen = new Map();
  for (const cat of CATEGORIES) {
    for (const layer of layersOf(cat)) {
      assert.equal(layer.metadata?.category, cat.id, `${layer.id} is untagged`);
      assert.ok(!seen.has(layer.id), `${layer.id} is claimed by ${seen.get(layer.id)} too`);
      seen.set(layer.id, cat.id);
      assert.equal(categoryOfLayer(layer.id)?.id, cat.id,
        `${layer.id} does not parse back to its category — the click handler would not know what it is`);
    }
  }
});

test('the categories with no layers of their own are the ones that borrow', () => {
  const empty = CATEGORIES.filter((c) => layersOf(c).length === 0).map((c) => c.id);
  assert.deepEqual(empty.sort(), ['landmarks', 'parts', 'roads'],
    'landmarks keep their icon layers, parts belong to the ladder and roads are the basemap; '
    + 'anything else here is a category that draws nothing');
});

// ---- the roads category -----------------------------------------------------
test('"Bilvägar" is the drivable network, and only that', { skip: noStyle }, () => {
  const ids = style().layers.map((l) => l.id);
  const roads = ids.filter(isCarRoadLayer);

  // Enough of them to be the whole network: Liberty draws every road three
  // times (road_, bridge_, tunnel_) and casings besides.
  assert.ok(roads.length > 30, `only ${roads.length} road layers — the rule has stopped matching`);
  for (const id of ['road_motorway', 'road_minor', 'bridge_trunk_primary', 'tunnel_street_casing',
    'road_label', 'road_shield']) {
    assert.ok(roads.includes(id), `${id} should go away with the car roads`);
  }
  // What you keep when you turn the cars off: the city you can walk, and the
  // rail you can see.
  for (const id of ['road_major_rail', 'road_transit_rail', 'road_path_pedestrian',
    'bridge_path_pedestrian', 'road_area_pattern']) {
    assert.ok(!roads.includes(id), `${id} is not a car road`);
  }
});

// ---- every POI is reachable, or excused -------------------------------------
test('every POI class in the archive is claimed by a category or excused', { skip: noArchive }, () => {
  const orphans = [];
  for (const [cls, info] of poiInventory(ARCHIVE)) {
    if (categoryForClass(cls) || cls in UNCLAIMED) continue;
    orphans.push(`${cls} (${info.total})`);
  }
  assert.deepEqual(orphans, [],
    'a class no chip draws and no reason excuses is a POI the map can never show — '
    + 'run `node scripts/poi-inventory.mjs --unclaimed`');
});

test('no excuse outlives the class it was written for', { skip: noArchive }, () => {
  const present = new Set(poiInventory(ARCHIVE).keys());
  const stale = Object.keys(UNCLAIMED).filter((cls) => !present.has(cls));
  assert.deepEqual(stale, [], 'UNCLAIMED still argues about classes the extract no longer has');
});

test('a class belongs to exactly one category', () => {
  const owner = new Map();
  for (const cat of CATEGORIES) {
    for (const cls of cat.poi ?? []) {
      assert.ok(!owner.has(cls), `${cls} is in both ${owner.get(cls)} and ${cat.id}`);
      owner.set(cls, cat.id);
    }
  }
});

test('nothing is both claimed and excused', () => {
  for (const cls of Object.keys(UNCLAIMED)) {
    assert.equal(categoryForClass(cls), null, `${cls} is drawn by a category and excused for not being`);
  }
});

// ---- the chips --------------------------------------------------------------
test('every chip is legible: an id, a Swedish label, a colour of its own', () => {
  const ids = new Set();
  const colors = new Map();
  for (const cat of CATEGORIES) {
    assert.match(cat.id, /^[a-z]+$/, `${cat.id} must survive being part of a layer id`);
    assert.ok(!ids.has(cat.id), `two categories called ${cat.id}`);
    ids.add(cat.id);
    assert.ok(cat.label?.length, `${cat.id} has no label`);
    assert.match(cat.color, /^#[0-9a-f]{6}$/, `${cat.id}: colour must be a plain hex the chip can inherit`);
    assert.ok(!colors.has(cat.color), `${cat.id} and ${colors.get(cat.color)} are the same colour — the legend stops working`);
    colors.set(cat.color, cat.id);
  }
});

test('every chip carries its own icon', () => {
  // The icon is part of the chip, not decoration added later: a category with
  // no picture is a row of text in a menu of pictures. Path data only — the
  // chip draws it inline and colours it, so anything else (a <svg> wrapper, a
  // file name, a fill) would either not render or not take the colour.
  for (const cat of CATEGORIES) {
    assert.ok(cat.icon?.length, `${cat.id} has no icon`);
    assert.match(cat.icon, /^M[-\d.]/, `${cat.id}: icon must be bare path data, drawn in a 24×24 box`);
    assert.ok(!/[<>]/.test(cat.icon), `${cat.id}: icon is markup, not path data`);
  }
});

test('a chip says nothing it cannot draw', () => {
  // POIs are in the tiles from z14 and nowhere earlier, so a category built on
  // them must admit as much; the app greys the chip until you are close enough.
  for (const cat of CATEGORIES) {
    const floor = categoryMinzoom(cat);
    if (cat.poi && !cat.geojson) assert.equal(floor, 14, `${cat.id} promises POIs below z14`);
    assert.ok(floor >= 0 && floor <= 14, `${cat.id}: minzoom ${floor} is not on this map`);
  }
});
