// The blind map, held to the rule the whole app rests on: while a round is
// running, nothing on the map says a name.
//
// This is the test that earns its keep. Every other failure in this app is
// visible — a name in the wrong place, a round that will not start. This one is
// not: a label layer that stays on during a round does not look like a bug, it
// looks like an easy question. You would play the round, get it right, and
// learn nothing, and nobody would ever file it.
//
// So the question is asked of the real style rather than of a list: take the
// basemap as built and the app's own layers as written, hand them to the same
// function the running app uses, and check that what survives is only ever
// shapes.
//
// Run: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { blindedLayerIds } from '../app/blind.js';
import { areaLayers } from '../app/area-levels.mjs';
import { OUTLINE_LAYERS } from '../app/rounds.mjs';

const FILE = 'build/style.json';
const skip = existsSync(FILE) ? false : 'build/style.json is gitignored — run scripts/build-style.mjs first';

// Everything that ends up on the map: the basemap's layers, the area ladder,
// and the landmark layers app/layers.js builds one per min_zoom. The last are
// symbol layers with a text-field, which is exactly what has to go.
function allLayers() {
  const basemap = JSON.parse(readFileSync(FILE, 'utf8')).layers;
  const ladder = areaLayers();
  const landmarks = [11, 12, 13].map((z) => ({ id: `landmark-${z}`, type: 'symbol' }));
  return [...basemap, ...ladder, ...landmarks];
}

test('a round leaves no text on the map', { skip }, () => {
  const layers = allLayers();
  const hidden = new Set(blindedLayerIds(layers, OUTLINE_LAYERS));
  const survivors = layers.filter((l) => l.type === 'symbol' && !hidden.has(l.id));
  assert.deepEqual(survivors.map((l) => l.id), [],
    `a round leaves these labels on screen: ${survivors.map((l) => l.id).join(', ')}`);
});

test('the shapes are kept', { skip }, () => {
  // The other half of the rule: blinding must not take the map away with the
  // words. Coastline, water, parks, roads and buildings are what is left to
  // reason from, and a round played on a white rectangle is not a round.
  const layers = allLayers();
  const hidden = new Set(blindedLayerIds(layers, []));
  const kept = layers.filter((l) => !hidden.has(l.id));
  for (const type of ['fill', 'line']) {
    assert.ok(kept.some((l) => l.type === type), `every ${type} layer was blinded away`);
  }
  assert.ok(kept.length > 20, 'almost nothing is left to look at');
});

test('every outline a round protects is a layer that exists', { skip }, () => {
  // Naming an outline layer that no longer exists fails silently: the blinding
  // still works, and the round is played on a map with nothing drawn on it at
  // all — "var ligger Sofielund?" over a blank rectangle.
  const ids = new Set(allLayers().map((l) => l.id));
  assert.ok(OUTLINE_LAYERS.length, 'nothing is protected, so areas have no outlines to aim at');
  for (const id of OUTLINE_LAYERS) {
    assert.ok(ids.has(id), `a round protects "${id}", which no layer draws`);
  }
});

test('the outlines a round keeps are shapes, not labels', () => {
  // Sneaking a name back on screen by listing it as an outline would defeat the
  // first test rather than fail it.
  const byId = new Map(areaLayers().map((l) => [l.id, l]));
  for (const id of OUTLINE_LAYERS) {
    const layer = byId.get(id);
    if (!layer) continue;
    assert.notEqual(layer.type, 'symbol', `the quiz keeps "${id}", which draws text`);
    assert.equal(layer.metadata?.role, 'outline', `the quiz keeps "${id}", which is not an outline`);
  }
});
