// One-off investigation: what sub-municipal coverage does OSM actually have
// for Malmö? Checks admin_level boundary relations AND place=* nodes/areas.
import { readFile } from 'node:fs/promises';
import { overpass, bboxClause } from './lib/overpass.mjs';

const { bbox } = JSON.parse(await readFile('config/bbox.json', 'utf8'));
const bb = bboxClause(bbox);

// 1. Administrative boundary relations, admin_level 7..11, with geometry check.
const admin = await overpass(`[out:json][timeout:120];
  ( relation["boundary"="administrative"]["admin_level"~"^(7|8|9|10|11)$"]${bb}; );
  out tags;`, { label: 'probe-admin' });

// 2. Named place polygons/nodes (suburb/neighbourhood/quarter/borough).
const places = await overpass(`[out:json][timeout:120];
  ( nwr["place"~"^(borough|suburb|quarter|neighbourhood)$"]["name"]${bb}; );
  out tags center;`, { label: 'probe-places' });

const byLevel = {};
for (const el of admin.elements ?? []) {
  const lvl = el.tags.admin_level;
  (byLevel[lvl] ??= []).push(el.tags.name ?? '(unnamed)');
}
console.log('\n=== boundary=administrative relations by admin_level ===');
for (const lvl of Object.keys(byLevel).sort()) {
  const names = byLevel[lvl].sort();
  console.log(`\nadmin_level=${lvl}  (${names.length}):`);
  console.log('  ' + names.join(', '));
}

const byPlace = {};
for (const el of places.elements ?? []) {
  const p = el.tags.place;
  (byPlace[p] ??= new Set()).add(el.tags.name);
}
console.log('\n=== place=* named areas ===');
for (const p of Object.keys(byPlace).sort()) {
  const names = [...byPlace[p]].sort();
  console.log(`\nplace=${p}  (${names.length}):`);
  console.log('  ' + names.join(', '));
}
