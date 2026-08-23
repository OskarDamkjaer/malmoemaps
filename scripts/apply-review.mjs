// The hand pass, written back into the curated list.
//
// The review tool at /review/ writes game/review.json — one verdict per
// photograph, `keep` or `drop`. This is the step that acts on it: kept rows get
// `"reviewed": true` and stay, dropped rows are cut, and anything nobody has
// looked at is left exactly as it was.
//
// Two steps rather than one on purpose. A page in a browser should not be able
// to rewrite the file that decides what the game asks about — the tool records
// an opinion, and turning that opinion into the curated list is a thing you run
// deliberately, can read the diff of, and can undo with git.
//
// Usage: node scripts/apply-review.mjs [--dry]
import { readFile, writeFile, rename } from 'node:fs/promises';

const dry = process.argv.includes('--dry');

const PHOTOS = 'game/photos.json';
const REVIEW = 'game/review.json';
// Rejections have to outlive the pool they were made against. Re-running
// propose-photos with a different target reshuffles which rows get picked, and
// without this it would cheerfully propose the interior of a 1907 trade-fair
// stand that somebody already threw away — and there is no way to tell, because
// the row looks exactly as good as it did the first time. Versioned, so the
// judgements are part of the repo the way learn/core.json is.
const REJECTED = 'game/rejected.json';

const read = async (f, what) => {
  try {
    return JSON.parse(await readFile(f, 'utf8'));
  } catch (err) {
    console.error(`apply-review: cannot read ${f} — ${what}`);
    console.error(`  ${err.message}`);
    process.exit(1);
  }
};

const photos = await read(PHOTOS, 'the curated list');
const verdicts = await read(REVIEW, 'run the dev server and review at /review/ first');
const rejected = JSON.parse(await readFile(REJECTED, 'utf8').catch(() => '{}'));

const kept = {};
let keep = 0;
let drop = 0;
let untouched = 0;
const missing = [];

for (const [id, photo] of Object.entries(photos)) {
  const verdict = verdicts[id];
  if (verdict === 'drop') {
    drop += 1;
    // Kept as a note rather than a bare id, so the list is readable and a
    // rejection can be reversed by hand if it turns out to have been a mistake.
    rejected[id] = photo.caption?.slice(0, 120) ?? photo.place ?? '(no caption)';
    continue;
  }
  if (verdict === 'keep') {
    keep += 1;
    // `check` is the note propose-photos left about why it was unsure. Somebody
    // has now looked, so the note has served its purpose and goes.
    const { check, ...rest } = photo;
    kept[id] = { ...rest, reviewed: true };
    continue;
  }
  untouched += 1;
  kept[id] = photo;
}

// A verdict for a photograph that is no longer in the list — the pool was
// re-proposed since the review. Worth saying rather than silently ignoring,
// because it means some of that reviewing was spent on rows that are now gone.
for (const id of Object.keys(verdicts)) if (!photos[id]) missing.push(id);

console.log(`apply-review: ${Object.keys(photos).length} in the list, ${Object.keys(verdicts).length} judged`);
console.log(`  ✓ kept       ${keep}  (now marked reviewed)`);
console.log(`  ✕ dropped    ${drop}`);
console.log(`  · untouched  ${untouched}  (nobody has looked at these yet)`);
if (missing.length) {
  console.log(`  ⚠ ${missing.length} verdict(s) refer to photographs no longer proposed — the pool changed since`);
}

if (dry) {
  console.log('\n--dry: nothing written.');
  process.exit(0);
}

if (!keep && !drop) {
  console.log('\nNothing to apply.');
  process.exit(0);
}

// Written via a temp file and renamed, so an interrupted write cannot leave the
// curated list half-rewritten. It is the one file here that is not regenerable.
const tmp = `${PHOTOS}.tmp`;
await writeFile(tmp, `${JSON.stringify(kept, null, 2)}\n`);
await rename(tmp, PHOTOS);

// Sorted, so the diff of a review session reads as the rows you added rather
// than as the whole file moving.
const sorted = Object.fromEntries(Object.entries(rejected).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(REJECTED, `${JSON.stringify(sorted, null, 2)}\n`);

console.log(`\n→ ${PHOTOS} (${Object.keys(kept).length} photographs)`);
console.log(`→ ${REJECTED} (${Object.keys(sorted).length} rejected, and they stay rejected)`);
console.log('  next: node scripts/build-game.mjs   (it will drop the webp of anything cut)');
