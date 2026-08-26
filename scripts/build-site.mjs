// The deployable folder.
//
// Hosting is "a folder of files on a static host" (see README), and this is the
// folder: the same URL layout the dev server serves, materialised into
// build/site so it can be uploaded with anything that copies files.
//
// It copies rather than symlinks, and it refuses to produce a half-built site:
// a missing basemap or data file is a failed build, not a folder that 404s in
// production.
//
// Usage: node scripts/build-site.mjs [--out DIR]
import { cpSync, existsSync, mkdirSync, rmSync, statSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { MOUNTS } from './lib/site.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const out = arg('--out', 'build/site');

const missing = MOUNTS.map((m) => m.file ?? m.dir).filter((p) => !existsSync(p));
if (missing.length) {
  console.error('FATAL: nothing to copy from:');
  for (const p of missing) console.error(`  ${p}`);
  console.error('\nRun the build pipeline first (see README, "Building the data").');
  process.exit(1);
}

// Build beside the target and swap, so an interrupted run cannot leave a
// partly-copied site where the last good one was.
const tmp = `${out}.tmp`;
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

for (const m of MOUNTS) {
  const rel = m.url.replace(/^\/+/, '').replace(/\/+$/, '');
  const dest = rel ? join(tmp, rel) : tmp;
  if (m.file) {
    mkdirSync(resolve(dest, '..'), { recursive: true });
    cpSync(m.file, dest);
  } else {
    cpSync(m.dir, dest, { recursive: true });
  }
}

rmSync(out, { recursive: true, force: true });
cpSync(tmp, out, { recursive: true });
rmSync(tmp, { recursive: true, force: true });

let bytes = 0;
let files = 0;
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else { bytes += statSync(p).size; files++; }
  }
}(out));

console.log(`-> ${out}   ${files} files, ${(bytes / 1048576).toFixed(1)} MB`);
console.log('   upload as-is. Requirements: HTTPS, and HTTP Range support for .pmtiles.');
