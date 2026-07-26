// The one part of the ladder the app does not draw.
//
// "Malmö" at level 1 is the basemap's own place_city label — well placed
// already, and not worth redrawing. That makes build/style.json part of the
// hierarchy, and the seam between the two files is exactly the kind of thing
// that drifts: retune the app's tiers and the basemap keeps saying "Malmö"
// over the top of the stadsdel names for another 1.8 zoom steps. It did, once.
//
// Run: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { TIER } from '../app/area-levels.mjs';

const FILE = 'build/style.json';
const skip = existsSync(FILE) ? false : 'build/style.json is gitignored — run scripts/build-style.mjs first';
const layer = (id) => JSON.parse(readFileSync(FILE, 'utf8')).layers.find((l) => l.id === id);

test('"Malmö" stands down exactly when the stadsdelar arrive', { skip }, () => {
  const city = layer('place_city');
  assert.ok(city, 'the basemap still labels the city');
  assert.equal(city.maxzoom, TIER.stadsdel,
    'place_city must end where level 2 begins, or level 1 and level 2 are both on screen');
  assert.ok((city.minzoom ?? 0) <= 6, 'and it holds the widest view');
});

test('the neighbouring towns wait for the bottom of the ladder', { skip }, () => {
  // Arlöv and Åkarp are delområde grain. Any earlier and they compete with the
  // levels that are about Malmö itself.
  for (const id of ['place_town', 'place_village']) {
    assert.equal(layer(id)?.minzoom, TIER.delomrade, `${id} starts at level 4`);
  }
});

test('no basemap place label competes with levels 2 and 3', { skip }, () => {
  // place_other is dropped by build-style.mjs and redrawn by the app so it can
  // be deduplicated against our own names; the rest must not overlap the two
  // middle rungs at all.
  const style = JSON.parse(readFileSync(FILE, 'utf8'));
  const middle = [TIER.stadsdel, TIER.neighbourhood, 12.9, TIER.delomrade - 0.01];
  for (const l of style.layers.filter((x) => x.id.startsWith('place_'))) {
    for (const zoom of middle) {
      const on = zoom >= (l.minzoom ?? 0) && zoom < (l.maxzoom ?? Infinity);
      assert.ok(!on, `${l.id} is drawn at z${zoom}, inside the app's own area levels`);
    }
  }
});
