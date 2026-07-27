// What POIs are in the tileset, and which category claims each of them.
//
// This is the tool the category table was written with, kept because the table
// has to be re-argued every time the extract is rebuilt: a new supermarket
// chain, a new OSM tagging fashion, and a class nobody has thought about
// appears. test/categories.test.mjs fails when that happens; this says what to
// do about it.
//
// Usage: node scripts/poi-inventory.mjs [archive] [--unclaimed]
import { existsSync } from 'node:fs';
import { poiInventory } from './lib/pmtiles.mjs';
import { CATEGORIES, UNCLAIMED, categoryForClass } from '../app/categories.mjs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--')) ?? 'data/cache/malmo.pmtiles';
const onlyUnclaimed = args.includes('--unclaimed');

if (!existsSync(file)) {
  console.error(`no such archive: ${file}\nBuild it first (scripts/build-basemap.sh), or pass a path.`);
  process.exit(1);
}

const inventory = [...poiInventory(file)].sort((a, b) => b[1].total - a[1].total);
const total = inventory.reduce((n, [, c]) => n + c.total, 0);

const owner = (cls) => categoryForClass(cls)?.id ?? (cls in UNCLAIMED ? '—' : '???');

console.log(`${file}: ${total} POIs in ${inventory.length} classes\n`);
for (const [cls, c] of inventory) {
  const who = owner(cls);
  if (onlyUnclaimed && who !== '???') continue;
  const subs = [...c.subclasses].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s}:${n}`).join(' ');
  console.log(`${who.padEnd(10)} ${cls.padEnd(18)} ${String(c.total).padStart(5)}  named ${String(c.named).padStart(5)}  z${c.minzoom}`);
  console.log(`${' '.repeat(11)}${subs}\n`);
}

// The summary is the point: a category with two POIs in it is a chip that earns
// nothing, and a class with 400 in it that nobody claims is a decision nobody
// made.
console.log('=== by category ===');
for (const cat of CATEGORIES) {
  if (!cat.poi) continue;
  const n = cat.poi.reduce((sum, cls) => sum + (inventory.find(([c]) => c === cls)?.[1].total ?? 0), 0);
  const empty = cat.poi.filter((cls) => !inventory.some(([c]) => c === cls));
  console.log(`  ${cat.label.padEnd(18)} ${String(n).padStart(5)}${empty.length ? `   (no features: ${empty.join(', ')})` : ''}`);
}

const unknown = inventory.filter(([cls]) => owner(cls) === '???');
console.log(`\n${unknown.length} classes claimed by nobody${unknown.length ? `: ${unknown.map(([c, v]) => `${c} (${v.total})`).join(', ')}` : ''}`);
console.log('Give each one a category in app/categories.mjs, or a reason in UNCLAIMED.');
