// The photographs Förr asks about, downloaded, converted, and checked.
//
// Reads game/photos.json — the hand-ruled list, the only file in this pipeline
// that decides anything — and turns it into build/data/game.json plus a folder
// of webp. Everything here is either a download, a conversion, or a refusal.
//
// The refusals are the point. A quiz that shows you a photograph and asks for a
// year and a place is making two factual claims per round, and both of them come
// from a museum catalogue that was never written with this use in mind. So this
// script fails the build rather than shipping a round that cannot be answered:
// no point, no year, no credit, a point outside Malmö — none of those are
// warnings, because a warning in a build log is a thing you stop reading.
//
// Images are kept under game/photos/ and versioned, not written to build/, for
// the reason the icons and the fact-card pictures already are (see site.mjs):
// they are the material the app is made of, a clone should be complete without a
// network round trip, and re-downloading eleven thousand JPEGs from Malmö stad's
// server on every build would be rude.
//
// Usage: node scripts/build-game.mjs [--limit N] [--refresh] [--width N]
import { readFile, writeFile, mkdir, stat, readdir, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { imageUrl } from './lib/carlotta.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const has = (k) => args.includes(k);

const LIMIT = Number(arg('--limit', Infinity));
const REFRESH = has('--refresh');

const SRC = 'game/photos.json';
const PHOTOS = 'game/photos';
const CACHE = 'data/cache/carlotta';
const OUT = 'build/data/game.json';

// Wide enough to be the thing you are studying — this is not a thumbnail on a
// card, it is the question — and no wider than a phone can show. Grayscale
// plates from the 1900s compress well at this size: 900 px lands around 59 KB
// each, so a set of 200 is 11.6 MB and fits the budget below with room to spare.
// 1000 px costs 12.5 MB for the same set, which does not.
const WIDTH = Number(arg('--width', 900));
const QUALITY = 72;

// The whole app is precached by the service worker, so a photograph that ships
// is a photograph everybody downloads.
//
// This was 12 MB when the set was two hundred grayscale plates averaging 59 KB.
// Adding the modern half changed the arithmetic rather than the principle: a
// colour photograph from 2015 costs about half as much again as a glass negative
// from 1905, and the set grew by a quarter, so the same photographs at the same
// width now come to 16 MB. Raised deliberately rather than quietly, because the
// number it is defending — the total download — is a promise the README makes
// out loud, and it is now about 40 MB.
//
// If this ever bites, drop --width before dropping photographs: the picture is
// the question, but 800 px is still a picture and 250 questions is a game where
// 180 is a demo.
const BUDGET_MB = 18;

const THIS_YEAR = new Date().getFullYear();

const problems = [];
const fail = (msg) => problems.push(msg);

const json = async (f) => JSON.parse(await readFile(f, 'utf8'));

const photos = await json(SRC).catch(() => {
  console.error(`build-game: ${SRC} is missing.`);
  console.error('Run `node scripts/propose-photos.mjs` and rule on game/photos.draft.json first.');
  process.exit(1);
});

const { bbox } = await json('config/bbox.json');

// ---- downloading -------------------------------------------------------------

// Both hosts want a real User-Agent with a way to get in touch; Wikimedia
// refuses requests without one outright.
const UA = 'malmoemaps-build/1.0 (https://github.com/oskardamkjaer/malmoemaps; static learning map of Malmö)';

// Wikimedia answers a burst of image requests with 429, and it is right to —
// this is a few hundred megabytes off a charity's servers. A quarter second
// between requests makes a full build take a couple of minutes instead of forty
// seconds, which is the correct trade for something run by hand a few times a
// year. Downloads are cached, so a rebuild pays none of it.
const PAUSE_MS = 250;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastFetch = 0;

async function polite(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = lastFetch + PAUSE_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastFetch = Date.now();
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.status !== 429) return res;
    // Backing off rather than giving up: a 429 is being asked to wait, not being
    // refused, and the alternative is a build that fails at photograph 180.
    const retryAfter = Number(res.headers.get('retry-after')) || 0;
    await sleep(Math.max(retryAfter * 1000, 1000 * 2 ** attempt));
  }
  throw new Error('rate limited after 4 attempts');
}

/**
 * Fetch one plate, from whichever archive it came from.
 *
 * Carlotta's URLs need rewriting before they resolve at all (see
 * lib/carlotta.mjs); Commons hands out a working URL for a server-rendered
 * scale, so it is taken as given. What both need is the content-type check —
 * Carlotta answers a bad path with an HTML error page under HTTP 200, and
 * nothing else in the response says so.
 */
async function download(id, source, url) {
  const file = `${CACHE}/${id}.jpg`;
  if (!REFRESH) {
    try { await stat(file); return file; } catch { /* not cached yet */ }
  }
  // Commons hands out a working URL with analytics query params stapled on;
  // stripping them keeps the cache key and the request clean.
  const target = source === 'commons'
    ? (() => { const u = new URL(url); u.search = ''; return u.toString(); })()
    : imageUrl(url);
  const res = await polite(target);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (!type.startsWith('image/')) throw new Error(`served ${type || 'nothing'}, not an image`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 8000) throw new Error(`only ${buf.length} bytes`);
  await mkdir(CACHE, { recursive: true });
  await writeFile(file, buf);
  return file;
}

function toWebp(from, to) {
  execFileSync('cwebp', ['-quiet', '-q', String(QUALITY), '-resize', String(WIDTH), '0', from, '-o', to]);
}

// ---- the run -----------------------------------------------------------------
await mkdir(PHOTOS, { recursive: true });

const entries = Object.entries(photos).slice(0, LIMIT);
const items = [];
let fetched = 0;
let converted = 0;
let unreviewed = 0;

for (const [key, p] of entries) {
  // Two archives number their records independently, so a Commons pageid could
  // collide with a Malmö Museer accession number. The prefix keeps them apart
  // without renaming the files that already exist.
  const source = p.origin === 'commons' ? 'commons' : 'ksamsok';
  const id = (source === 'commons' ? 'c' : '') + key.split('/').pop();
  const where = `${key}${p.place ? ` (${p.place})` : ''}`;

  // ---- what the round needs before anything is downloaded ----
  if (!Number.isFinite(p.year)) { fail(`${where}: no year`); continue; }
  // Photography reached Malmö in the 1840s and the future has not happened yet.
  // A year outside that is a typo in a catalogue, not a discovery.
  if (p.year < 1840 || p.year > THIS_YEAR) {
    fail(`${where}: year ${p.year} is not a photograph of Malmö`);
    continue;
  }
  if (!Array.isArray(p.point) || !Number.isFinite(p.point[0]) || !Number.isFinite(p.point[1])) {
    fail(`${where}: no point — it cannot be an answer`);
    continue;
  }
  const [lng, lat] = p.point;
  if (lng < bbox.west || lng > bbox.east || lat < bbox.south || lat > bbox.north) {
    fail(`${where}: point ${lng},${lat} is outside the map`);
    continue;
  }
  // Credit is not optional even where the licence would allow it. Half of these
  // are CC BY, which requires it, and mixing the two silently is how you end up
  // getting it wrong for the half that asks.
  if (!p.credit) { fail(`${where}: no credit`); continue; }
  if (!p.source) { fail(`${where}: no source link`); continue; }
  if (!p.lowres) { fail(`${where}: no image URL`); continue; }

  if (!p.reviewed) unreviewed += 1;

  // ---- the picture ----
  const out = `${PHOTOS}/${id}.webp`;
  let have = false;
  if (!REFRESH) { try { await stat(out); have = true; } catch { /* not built yet */ } }
  if (!have) {
    try {
      const jpg = await download(id, source, p.lowres);
      fetched += 1;
      toWebp(jpg, out);
      converted += 1;
    } catch (err) {
      fail(`${where}: image — ${err.message}`);
      continue;
    }
  }

  items.push({
    id: key,
    year: p.year,
    point: [Number(lng.toFixed(5)), Number(lat.toFixed(5))],
    place: p.place ?? null,
    caption: p.caption ?? null,
    credit: p.credit,
    source: p.source,
    image: `/photos/${id}.webp`,
    reviewed: p.reviewed === true,
  });
}

// ---- the shape of the whole set ----------------------------------------------
// A day is five photographs (app/photos.mjs owns that number, and reading it
// here rather than repeating it means a change there cannot quietly leave the
// last day of a cycle short).
const { ROUND } = await import('../app/photos.mjs');

if (items.length < ROUND * 10) {
  fail(`only ${items.length} photographs — fewer than ${ROUND * 10} makes the daily cycle shorter than two weeks`);
}

// Unused files from earlier runs, so the folder is the set and not a midden.
const wanted = new Set(items.map((it) => it.image.split('/').pop()));
let removed = 0;
for (const f of await readdir(PHOTOS).catch(() => [])) {
  if (f.endsWith('.webp') && !wanted.has(f)) { await unlink(`${PHOTOS}/${f}`); removed += 1; }
}

let bytes = 0;
for (const it of items) bytes += (await stat(`${PHOTOS}/${it.image.split('/').pop()}`)).size;
const mb = bytes / 1024 / 1024;

// The budget defends the download, so it applies to a set that is going to be
// downloaded. A pool that is still being reviewed is not that: the whole point
// of proposing five hundred is to throw half of them away, and a hard failure
// here would mean the only way to review candidates is to stay under the size
// the survivors are supposed to fit. So it is a warning while anything is
// unreviewed and a refusal once the set is settled.
const oversize = mb > BUDGET_MB;
if (oversize && !unreviewed) {
  fail(`photographs are ${mb.toFixed(1)} MB, over the ${BUDGET_MB} MB budget`
    + ` — drop --width below ${WIDTH} before dropping photographs`);
}

if (problems.length) {
  console.error(`build-game: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const years = items.map((it) => it.year);
const out = {
  generated: new Date().toISOString(),
  minYear: Math.min(...years),
  maxYear: Math.max(...years),
  photos: items,
};
await mkdir('build/data', { recursive: true });
await writeFile(OUT, JSON.stringify(out));

const decades = new Map();
for (const it of items) {
  const d = Math.floor(it.year / 10) * 10;
  decades.set(d, (decades.get(d) ?? 0) + 1);
}

console.log(`build-game → ${OUT} (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`);
console.log(`  ${items.length} photographs, ${out.minYear}–${out.maxYear}, ${mb.toFixed(1)} MB of webp at ${WIDTH} px`);
console.log(`  ${Math.floor(items.length / ROUND)} days before the cycle repeats`);
if (fetched) console.log(`  downloaded ${fetched}, converted ${converted}`);
if (removed) console.log(`  removed ${removed} webp no longer listed`);
if (unreviewed) {
  console.log(`  ⚠ ${unreviewed} of ${items.length} not marked "reviewed": true —`);
  console.log('    nobody has looked at the picture yet. Run the dev server and open /review/.');
}
if (oversize) {
  console.log(`  ⚠ ${mb.toFixed(1)} MB is over the ${BUDGET_MB} MB budget.`
    + (unreviewed ? ' Allowed while reviewing; this must come down before it ships.' : ''));
}
for (const d of [...decades.keys()].sort((a, b) => a - b)) {
  console.log(`    ${d}s ${String(decades.get(d)).padStart(3)} ${'█'.repeat(decades.get(d))}`);
}
