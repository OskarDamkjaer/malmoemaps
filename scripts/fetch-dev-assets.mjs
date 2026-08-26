// Fetch the generated data and vendored assets a web sandbox cannot build.
//
// A sandboxed session can reach GitHub but not geofabrik, opendata-api.malmo.se,
// nominatim, or the glyph/sprite hosts. The data pipeline and
// fetch-app-assets.mjs are therefore out of reach, and 26 of 51 tests skip —
// including the blind-map test that holds the whole app's load-bearing rule.
// This script closes that gap with a single release asset, so a fresh checkout
// in a sandbox can run the full suite and boot the app.
//
// It is a no-op when everything is already present, so it is safe to run
// unconditionally (the session-start hook does exactly that). It verifies a
// checksum, so a stale asset is a visible mismatch rather than a silent one.
//
// The repo is private, so the download is authenticated. `gh release download`
// handles that with whatever credential `gh` is logged in with — the one thing
// a sandbox session can rely on being set up.
//
// Usage: node scripts/fetch-dev-assets.mjs
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';

// Pinned: a stale asset is a visible mismatch rather than a silent one. Bump
// this when the release is rebuilt, and the checksum with it.
const TAG = 'dev-assets-v1';
const FILE = 'dev-assets.tar.gz';

// SHA-256 of the asset at the pinned tag. A mismatch means the release was
// rebuilt without bumping the tag, which is a bug rather than a surprise.
const SHA256 = '7c8b01e4edaf05db9b71c651fe275ff58db2d75fc4040a799cbd04a64f4ce7bf';

// The four things this unpacks, and the one thing that tells us they are all
// there: each is a directory or file that is gitignored, so its presence is the
// only signal a rebuild happened.
const CHECKS = [
  'build/data/learn.json',
  'data/cache/malmo.pmtiles',
  'app/glyphs/Roboto Regular',
  'app/sprite/osm-liberty.json',
];

function allPresent() {
  return CHECKS.every((p) => existsSync(p));
}

if (allPresent()) {
  console.log('fetch-dev-assets: everything present, nothing to do');
  process.exit(0);
}

const tmp = join('/tmp', `dev-assets-${process.pid}.tar.gz`);

function download() {
  console.log(`fetch-dev-assets: downloading ${TAG}/${FILE} …`);
  // `gh release download` is the one download path that works for a private
  // repo: it carries the credential `gh` is logged in with, which the sandbox
  // sets up and a bare fetch() does not.
  execSync(
    `gh release download "${TAG}" --pattern "${FILE}" --output "${tmp}" --clobber`,
    { stdio: 'pipe' },
  );
  if (!existsSync(tmp)) throw new Error('download produced no file');
}

function verify() {
  const hash = createHash('sha256');
  hash.update(readFileSync(tmp));
  const got = hash.digest('hex');
  if (got !== SHA256) {
    throw new Error(`checksum mismatch: expected ${SHA256}, got ${got}`);
  }
  console.log('fetch-dev-assets: checksum ok');
}

function unpack() {
  console.log('fetch-dev-assets: unpacking …');
  execSync(`tar xzf "${tmp}"`, { stdio: 'inherit' });
  rmSync(tmp, { force: true });
}

try {
  download();
  verify();
  unpack();
  if (!allPresent()) {
    throw new Error('archive unpacked but expected files are missing');
  }
  console.log('fetch-dev-assets: done — all 50 tests can run');
} catch (err) {
  rmSync(tmp, { force: true });
  console.error(`fetch-dev-assets: ${err.message}`);
  process.exit(1);
}
