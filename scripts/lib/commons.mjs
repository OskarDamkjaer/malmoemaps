// Wikimedia Commons — the half of Malmö that K-samsök does not have.
//
// The museum archive is structurally old: Public Domain Mark and age are the
// same fact, so everything openly licensed there is a photograph of a city with
// no cars in it. Commons is the mirror image — barely anything before 2000, and
// then thousands of geotagged files a year, taken by people who were standing
// there. Between them the game can cover a century and a half instead of ninety
// years, and it can ask about things that *happened* rather than only about
// buildings that stood still.
//
// Two ways in, because the two halves of what is wanted sit in different places:
//
//   **geosearch** — files with real coordinates on them, which is the thing
//   K-samsök could not give at any price. No geocoding, no name matching, no
//   inference: the photographer's own camera said where this was. Commons caps
//   a geosearch at 10 km and 500 results, so the bbox is swept as a grid.
//
//   **categories** — how Commons files events and people. Malmöfestivalen, the
//   Eurovision finals, Turning Torso going up, Malmö FF. Most carry no
//   coordinates, so these are placed the same way K-samsök records are: by
//   matching against names the quiz already holds geometry for.
//
// ---- licensing ---------------------------------------------------------------
//
// Commons hosts plenty this cannot use. `extmetadata.LicenseShortName` is the
// filter, and it is an allowlist rather than a blocklist — an unrecognised
// licence string is refused, because the failure mode of guessing is publishing
// somebody's photograph without the right to.
//
// CC BY-SA is accepted and is most of what comes back. Resizing a photograph
// makes a derivative, and the derivative stays CC BY-SA — which is fine, and is
// already what `learn/images` does with CC BY-SA 3.0 material. What travels with
// it is the credit, which is why `artist` is required rather than nice to have.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const API = 'https://commons.wikimedia.org/w/api.php';
// Wikimedia blocks requests without a real User-Agent, and asks for a way to get
// in touch. Fair.
const UA = 'malmoemaps-build/1.0 (https://github.com/oskardamkjaer/malmoemaps; static learning map of Malmö)';
const CACHE = 'data/cache/commons';

// The licences a photograph may carry to be shown here. Anything not on this
// list is refused, including the empty string.
const ALLOWED = [
  /^cc0/i,
  /^public domain/i,
  /^pd(-|$)/i,
  /^cc by(-sa)? [1-4]\.\d$/i,
];
// Spelled out so the refusals are readable in the candidates file rather than
// silent: NC is not our call to make on someone else's behalf, and ND makes a
// resized photograph a problem.
export const licenseOk = (name) => !!name
  && !/nc|nd\b/i.test(name)
  && ALLOWED.some((re) => re.test(name.trim()));

let lastCall = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(params, { refresh = false } = {}) {
  const query = new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  const key = createHash('sha1').update(query.toString()).digest('hex').slice(0, 16);
  const file = `${CACHE}/${key}.json`;
  await mkdir(CACHE, { recursive: true });
  if (!refresh) {
    try { return JSON.parse(await readFile(file, 'utf8')); } catch { /* not cached */ }
  }
  // Commons is generous but this asks a few hundred questions; a quarter second
  // between them costs nothing and is the polite reading of their guidance.
  const wait = lastCall + 250 - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();

  const res = await fetch(`${API}?${query}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Commons ${res.status} ${res.statusText}`);
  const json = await res.json();
  await writeFile(file, JSON.stringify(json));
  return json;
}

const strip = (s) => (s ?? '').replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * The year the shutter opened, from whatever Commons managed to record.
 *
 * `DateTimeOriginal` is usually an ISO date and sometimes a sentence. A file
 * with a date in the future or before photography is a typo in the metadata, not
 * a discovery, so the range is clamped rather than trusted.
 */
function yearOf(meta) {
  const raw = strip(meta?.DateTimeOriginal?.value);
  const found = raw.match(/\b(1[89]\d\d|20[0-4]\d)\b/);
  if (!found) return null;
  const year = Number(found[1]);
  const now = new Date().getFullYear();
  return year >= 1840 && year <= now ? year : null;
}

function normalise(page) {
  const info = page.imageinfo?.[0];
  if (!info) return null;
  const meta = info.extmetadata ?? {};
  const license = strip(meta.LicenseShortName?.value);
  const coords = page.coordinates?.[0];
  const title = page.title.replace(/^File:/, '');
  return {
    source: 'commons',
    id: `commons/${page.pageid}`,
    title,
    year: yearOf(meta),
    // Commons stores coordinates as lat/lon; everything in this repo is [lng, lat].
    point: coords ? [Number(coords.lon.toFixed(5)), Number(coords.lat.toFixed(5))] : null,
    license,
    artist: strip(meta.Artist?.value) || null,
    description: strip(meta.ImageDescription?.value) || strip(meta.ObjectName?.value) || title.replace(/\.\w+$/, '').replace(/_/g, ' '),
    categories: strip(meta.Categories?.value).replace(/\|/g, ' · '),
    // The file page, not the image: that is where the licence and the
    // photographer live, and it is what a credit should point at.
    source_url: info.descriptionurl,
    // A server-rendered scale, so the build downloads one megabyte rather than
    // the twenty the original may be.
    image: info.thumburl ?? info.url,
    width: info.width,
    height: info.height,
  };
}

const PROPS = {
  prop: 'imageinfo|coordinates',
  // Without this the API returns coordinates for ten pages out of five hundred
  // and the rest look like they have none.
  colimit: 'max',
  iiprop: 'extmetadata|url|size',
  iiurlwidth: '1400',
  iiextmetadatafilter: 'DateTimeOriginal|LicenseShortName|Artist|ObjectName|ImageDescription|Categories',
};

/**
 * Every geotagged file inside the bbox, swept as a grid.
 *
 * One geosearch reaches 10 km and returns at most 500 files, and central Malmö
 * holds several thousand — so a single call centred on Stortorget silently
 * returns the 500 nearest and calls it the city. The grid is spaced so the
 * circles overlap, and results are keyed by pageid, so the overlap costs
 * requests rather than correctness.
 */
// step 0.02° of latitude is 2.22 km and 0.034° of longitude is 2.13 km at this
// latitude, so a 2.5 km radius covers every corner of each cell with margin.
export async function geotagged(bbox, { step = 0.02, radius = 2500, refresh = false } = {}) {
  const found = new Map();
  for (let lat = bbox.south; lat <= bbox.north + 1e-9; lat += step) {
    for (let lon = bbox.west; lon <= bbox.east + 1e-9; lon += step * 1.7) {
      const data = await api({
        action: 'query',
        generator: 'geosearch',
        ggscoord: `${lat.toFixed(4)}|${lon.toFixed(4)}`,
        ggsradius: String(radius),
        ggslimit: '500',
        ggsnamespace: '6',
        ...PROPS,
      }, { refresh });
      for (const page of data.query?.pages ?? []) {
        const rec = normalise(page);
        if (rec) found.set(rec.id, rec);
      }
    }
  }
  return [...found.values()];
}

/**
 * Files in a category, and in its subcategories to a given depth.
 *
 * This is how events and people are reachable at all — "Malmöfestivalen" holds
 * ten files itself and thirteen subcategories, one per year, and the years are
 * where the photographs are. Depth is capped because Commons categories are a
 * graph rather than a tree and will happily walk you from Malmö to the concept
 * of buildings.
 */
export async function inCategory(name, { depth = 2, refresh = false, seen = new Set() } = {}) {
  const title = name.startsWith('Category:') ? name : `Category:${name}`;
  if (seen.has(title) || depth < 0) return [];
  seen.add(title);

  const found = new Map();
  let cont;
  do {
    const data = await api({
      action: 'query',
      generator: 'categorymembers',
      gcmtitle: title,
      gcmtype: 'file',
      gcmlimit: '500',
      ...(cont ? { gcmcontinue: cont } : {}),
      ...PROPS,
    }, { refresh });
    for (const page of data.query?.pages ?? []) {
      const rec = normalise(page);
      if (rec) found.set(rec.id, rec);
    }
    cont = data.continue?.gcmcontinue;
  } while (cont);

  if (depth > 0) {
    const subs = await api({
      action: 'query', list: 'categorymembers',
      cmtitle: title, cmtype: 'subcat', cmlimit: '500',
    }, { refresh });
    for (const sub of subs.query?.categorymembers ?? []) {
      for (const rec of await inCategory(sub.title, { depth: depth - 1, refresh, seen })) {
        found.set(rec.id, rec);
      }
    }
  }
  return [...found.values()];
}
