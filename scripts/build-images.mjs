// A photograph for as many of the quiz's names as can be proven to have one.
//
// The fact card is why the app exists, and a picture of the place does more for
// "Sofielund is *there*" than another sentence would. But a picture of the
// wrong place is worse than none at all — it teaches you something false about
// somewhere real — so this script is built around one question: **can I show
// that this image is of this thing?**
//
// The proof is coordinates. A Wikipedia article is accepted only if it carries
// a location and that location is near the point the quiz already grades
// against. Title matching alone would have been enough to put a picture of
// Centrum in Stockholm on the card for the delområde Centrum, and half the
// street names in Malmö are street names in every other Swedish town. An
// article with no coordinates is not rejected as wrong, it is rejected as
// unproven, which is the same standard the rest of this pipeline holds names to.
//
// Everything it downloads is stored: responses under data/cache/wiki/, images
// under learn/images/. Re-runs hit disk, not Wikimedia. That is partly speed
// and mostly manners — this asks a few hundred questions of someone else's
// servers, once.
//
// Output is learn/images.json, keyed by name, which build-learn.mjs reads and
// attaches. It is a build product that lives with the curated data on purpose:
// it is reviewable, it is diffable, and a bad pick can be corrected by hand and
// will survive the next run (see `pinned`).
//
// Usage: node scripts/build-images.mjs [--limit N] [--only NAME] [--refresh]
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { distance } from './lib/geo.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const has = (k) => args.includes(k);

const LIMIT = Number(arg('--limit', Infinity));
const ONLY = arg('--only', null);
const REFRESH = has('--refresh');

const CACHE = 'data/cache/wiki';
const IMAGES = 'learn/images';
const OUT = 'learn/images.json';
const WIDTH = 480;

// Wikimedia asks for a real User-Agent with a way to get in touch. Fair.
const UA = 'malmoemaps/1.0 (https://github.com/oskardamkjaer/malmoemaps; static learning map of Malmö)';

// How far an article's own coordinates may sit from ours before the match is
// unproven. Not a measure of precision — a measure of how far apart two honest
// answers to "where is this?" can be. A delområde is a square kilometre and its
// article is pinned wherever someone felt was the middle; a street is however
// long the street is; Öresundsbron is eight kilometres of bridge, and our
// midpoint and Wikipedia's sit 2.7 km apart on it.
//
// Generous does not mean unguarded. What this actually catches is the failure
// that matters: Västerbron and Slottsbron are places in Stockholm and Värmland
// as well as here, and those are rejected at four hundred kilometres by any
// radius on this list.
const RADIUS = {
  area: 2000, street: 1500, landmark: 400, bridge: 4000,
};

const json = async (f) => JSON.parse(await readFile(f, 'utf8'));
const items = (await json('build/data/learn.json')).items;

// Corrections survive re-runs. A wrong picture is fixed by editing images.json
// and marking the entry `"pinned": true`; anything pinned is copied through
// untouched, including a deliberate `"image": null` meaning "there is no good
// picture of this, stop looking".
const previous = await json(OUT).catch(() => ({}));
const pinned = Object.fromEntries(
  Object.entries(previous).filter(([, v]) => v?.pinned),
);

const slug = (name) => name.toLowerCase()
  .replaceAll('å', 'a').replaceAll('ä', 'a').replaceAll('ö', 'o')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

// ---- the polite network ------------------------------------------------------
let fetched = 0;

async function cachedJSON(key, url) {
  const file = `${CACHE}/${key}.json`;
  if (!REFRESH) {
    const hit = await readFile(file, 'utf8').catch(() => null);
    if (hit) return JSON.parse(hit);
  }
  // One request at a time with a gap. Nothing here is urgent, and a burst of
  // three hundred parallel requests is how a static site earns a block.
  if (fetched) await sleep(150);
  fetched += 1;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const body = await res.json();
  await mkdir(CACHE, { recursive: true });
  await writeFile(file, JSON.stringify(body));
  return body;
}

const api = (host, params) => `https://${host}/w/api.php?${new URLSearchParams({
  format: 'json', formatversion: '2', ...params,
})}`;

// ---- finding the article -----------------------------------------------------
// Candidate titles, cheapest first. Swedish Wikipedia is asked before Commons
// because an article is a claim about a *place*, which is what has to be
// checked, whereas a Commons category is a claim about a pile of files.
const titlesFor = (item) => [
  item.name,
  `${item.name} (Malmö)`,
  `${item.name}, Malmö`,
];

/**
 * The article for an item, or null — with the reason, because "no picture"
 * and "picture rejected as unproven" are different things and the summary at
 * the end should be able to tell them apart.
 */
async function articleFor(item) {
  const titles = titlesFor(item);
  const page = await cachedJSON(`page-${slug(item.name)}`, api('sv.wikipedia.org', {
    action: 'query',
    titles: titles.join('|'),
    prop: 'coordinates|pageimages',
    piprop: 'name|thumbnail',
    pithumbsize: String(WIDTH),
    redirects: '1',
  }));

  const pages = (page.query?.pages ?? []).filter((p) => !p.missing);
  if (!pages.length) return { why: 'no article' };

  for (const p of pages) {
    const coord = p.coordinates?.[0];
    if (!coord) continue;
    const away = distance(item.point, [coord.lon, coord.lat]);
    if (away > (RADIUS[item.kind] ?? 1000)) continue;
    if (!p.thumbnail?.source || !p.pageimage) continue;
    return { title: p.title, file: p.pageimage, thumb: p.thumbnail.source, away };
  }
  // Distinguishing these two is what tells me whether the gap is Wikipedia's
  // coverage or my matching.
  const anyCoords = pages.some((p) => p.coordinates?.[0]);
  const anyImage = pages.some((p) => p.thumbnail?.source);
  if (!anyImage) return { why: 'article has no image' };
  return { why: anyCoords ? 'article is somewhere else' : 'article has no coordinates' };
}

// ---- who took it -------------------------------------------------------------
// A photograph is someone's. This repo shows its attributions rather than
// burying them, so an image with no usable licence line is an image we do not
// ship — the credit is a condition of use, not a nice-to-have.
const strip = (html) => (html ?? '')
  .replace(/<[^>]*>/g, '')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

/**
 * A name to put on the card, out of whatever Commons has in its Artist field.
 *
 * Which is anything at all: a bare username, an anchor, or — often enough to
 * matter — a nested table containing a paragraph beginning "This image was
 * produced by me, …" and running to a hundred and fifty words about how to ask
 * for a higher resolution. A credit line is one line, so the long ones fall
 * back to the Commons username, which is who the licence names anyway.
 */
function artistFrom(html) {
  const plain = strip(html);
  if (plain && plain.length <= 60) return plain.replace(/_/g, ' ');

  const user = /\/wiki\/User:([^"'?#]+)/.exec(html ?? '');
  if (user) return decodeURIComponent(user[1]).replace(/_/g, ' ');

  return plain ? `${plain.slice(0, 57).trimEnd()}…` : '';
}

async function creditFor(file) {
  const meta = await cachedJSON(`file-${slug(file)}`, api('commons.wikimedia.org', {
    action: 'query',
    titles: `File:${file}`,
    prop: 'imageinfo',
    iiprop: 'extmetadata',
    iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl|AttributionRequired',
  }));
  const ext = meta.query?.pages?.[0]?.imageinfo?.[0]?.extmetadata;
  if (!ext) return null;

  const artist = artistFrom(ext.Artist?.value);
  const licence = strip(ext.LicenseShortName?.value);
  if (!licence) return null;
  return artist ? `Foto: ${artist} · ${licence}` : `Foto: Wikimedia Commons · ${licence}`;
}

// ---- the file ----------------------------------------------------------------
// WebP at 480 px. The thumbnail Wikimedia serves is already the right size, so
// this is only re-encoding — typically a third of the JPEG, over a hundred
// files, on a payload that is a phone's whole download.
async function saveImage(url, name) {
  const out = `${IMAGES}/${slug(name)}.webp`;
  if (!REFRESH && await stat(out).then(() => true, () => false)) return out;

  if (fetched) await sleep(150);
  fetched += 1;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} downloading ${url}`);
  const bytes = Buffer.from(await res.arrayBuffer());

  await mkdir(IMAGES, { recursive: true });
  const tmp = `${IMAGES}/.tmp-${slug(name)}`;
  await writeFile(tmp, bytes);
  // q74 rather than the usual 80: these are thumbnails in a 330 px column, and
  // the difference is invisible there but worth about a third of the payload
  // across a hundred-odd files.
  execFileSync('cwebp', ['-quiet', '-q', '74', '-resize', String(WIDTH), '0', tmp, '-o', out]);
  await execFileSync('rm', ['-f', tmp]);
  return out;
}

// ---- run ---------------------------------------------------------------------
const result = { ...pinned };
const why = new Map();
const note = (reason) => why.set(reason, (why.get(reason) ?? 0) + 1);

let done = 0;
for (const item of items) {
  if (ONLY && item.name !== ONLY) continue;
  if (result[item.name]) { note('pinned'); continue; }
  if (done >= LIMIT) break;
  done += 1;

  try {
    const found = await articleFor(item);
    if (!found.title) { note(found.why); continue; }

    const credit = await creditFor(found.file);
    if (!credit) { note('no usable licence'); continue; }

    const file = await saveImage(found.thumb, item.name);
    result[item.name] = {
      image: `/images/${file.split('/').pop()}`,
      credit,
      article: `https://sv.wikipedia.org/wiki/${encodeURIComponent(found.title)}`,
      away: Math.round(found.away),
    };
    note('kept');
  } catch (err) {
    // One name failing is not the run failing. The gap shows up in the summary
    // and the name simply has no picture, which the card already handles.
    console.warn(`  ${item.name}: ${err.message}`);
    note('error');
  }
}

const ordered = Object.fromEntries(
  Object.entries(result).sort((a, b) => a[0].localeCompare(b[0], 'sv')),
);
await writeFile(OUT, `${JSON.stringify(ordered, null, 2)}\n`);

const kept = Object.values(ordered).filter((v) => v.image).length;
console.log(`build-images → ${OUT} (${kept} bilder av ${items.length} namn)`);
for (const [reason, n] of [...why].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${reason}`);
}
console.log(`  ${fetched} requests to Wikimedia this run`);
