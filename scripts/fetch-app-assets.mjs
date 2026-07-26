// Phase 3 — vendor everything the app loads at runtime.
//
// "No external calls at runtime" means the map engine, the pmtiles reader, the
// label glyphs and the icon sprite all have to come off my own origin. They are
// third-party build outputs, not source: fetched here at pinned versions,
// gitignored, and re-fetchable on any machine.
//
// Glyph ranges are fetched selectively — a full font is ~250 ranges, of which a
// Swedish city map uses three: Latin (åäö live in 0-255), Latin Extended, and
// General Punctuation for the dashes and quotes in street names.
//
// Usage: node scripts/fetch-app-assets.mjs [--refresh]
import { execFileSync } from 'node:child_process';
import { mkdirSync, cpSync, writeFileSync, existsSync, rmSync, statSync } from 'node:fs';

const refresh = process.argv.includes('--refresh');

const MAPLIBRE = '6.0.0';
const PMTILES = '4.4.1';
const FONTS = ['Roboto Regular', 'Roboto Medium', 'Roboto Condensed Italic'];
const RANGES = ['0-255', '256-511', '8192-8447'];
const GLYPH_HOST = 'https://orangemug.github.io/font-glyphs/glyphs';
const SPRITE_HOST = 'https://maputnik.github.io/osm-liberty/sprites';

const tmp = 'data/tmp/assets';
let fetched = 0;
let skipped = 0;

async function download(url, dest) {
  if (existsSync(dest) && !refresh) { skipped++; return; }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  mkdirSync(dest.slice(0, dest.lastIndexOf('/')), { recursive: true });
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  fetched++;
}

// npm tarballs, unpacked for their dist/ only. Both packages ship browser-ready
// bundles, so there is no build step and no node_modules in this project.
async function npmPackage(name, version, files) {
  const need = files.filter(([, dest]) => refresh || !existsSync(dest));
  if (!need.length) { skipped += files.length; return; }
  const dir = `${tmp}/${name}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const tgz = `${dir}/pkg.tgz`;
  const res = await fetch(`https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`);
  if (!res.ok) throw new Error(`${res.status} fetching ${name}@${version}`);
  writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
  execFileSync('tar', ['xzf', 'pkg.tgz'], { cwd: dir });
  for (const [src, dest] of need) {
    mkdirSync(dest.slice(0, dest.lastIndexOf('/')), { recursive: true });
    cpSync(`${dir}/package/${src}`, dest);
    fetched++;
  }
  skipped += files.length - need.length;
}

mkdirSync(tmp, { recursive: true });

console.log(`maplibre-gl ${MAPLIBRE} …`);
await npmPackage('maplibre-gl', MAPLIBRE, [
  // The main bundle imports the shared chunk and spawns the worker by relative
  // URL, so all three must sit in the same directory.
  ['dist/maplibre-gl.mjs', 'app/vendor/maplibre-gl.mjs'],
  ['dist/maplibre-gl-shared.mjs', 'app/vendor/maplibre-gl-shared.mjs'],
  ['dist/maplibre-gl-worker.mjs', 'app/vendor/maplibre-gl-worker.mjs'],
  ['dist/maplibre-gl.css', 'app/vendor/maplibre-gl.css'],
]);

console.log(`pmtiles ${PMTILES} …`);
// The ESM build imports fflate by bare specifier; the browser bundle inlines it
// and exposes window.pmtiles, which is one script tag instead of an import map.
await npmPackage('pmtiles', PMTILES, [['dist/pmtiles.js', 'app/vendor/pmtiles.js']]);

console.log(`glyphs: ${FONTS.length} fonts × ${RANGES.length} ranges …`);
for (const font of FONTS) {
  for (const range of RANGES) {
    await download(`${GLYPH_HOST}/${encodeURIComponent(font)}/${range}.pbf`,
      `app/glyphs/${font}/${range}.pbf`);
  }
}

console.log('sprite: osm-liberty …');
for (const f of ['osm-liberty.json', 'osm-liberty.png', 'osm-liberty@2x.json', 'osm-liberty@2x.png']) {
  await download(`${SPRITE_HOST}/${f}`, `app/sprite/${f}`);
}

const mb = (glob) => (statSync(glob).size / 1024 / 1024).toFixed(1);
console.log(`\n-> app/vendor, app/glyphs, app/sprite   (${fetched} fetched, ${skipped} cached)`);
console.log(`   maplibre-gl.mjs ${mb('app/vendor/maplibre-gl.mjs')} MB + shared ${mb('app/vendor/maplibre-gl-shared.mjs')} MB`);
console.log('   re-run with --refresh to re-download at the pinned versions');
