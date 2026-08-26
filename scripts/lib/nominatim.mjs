// Minimal Nominatim client, on-disk cached and hard-limited to 1 request per
// second as the usage policy requires. A descriptive User-Agent is mandatory —
// requests without one get blocked.
//
// This is a build-time tool only. Nothing here runs in the app; the spec
// forbids third-party requests at runtime.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'malmoemaps-build/1.0 (static Malmö reference map; contact via repo)';
const MIN_INTERVAL_MS = 1100; // 1 req/s plus headroom

let lastRequest = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function throttle() {
  const wait = lastRequest + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
}

/**
 * Geocode a free-text query, biased to a bounding box.
 *
 * `viewbox` is [west, south, east, north]. We pass bounded=1 so results
 * outside the box are not returned at all — a query like "Stortorget" would
 * otherwise happily match Stockholm.
 *
 * Returns the raw result array (possibly empty). Cached by query+viewbox.
 */
export async function geocode(query, { viewbox, cacheDir = 'data/cache/nominatim', refresh = false, limit = 5 } = {}) {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: String(limit),
    addressdetails: '1',
  });
  if (viewbox) {
    params.set('viewbox', viewbox.join(','));
    params.set('bounded', '1');
  }

  const key = createHash('sha1').update(params.toString()).digest('hex').slice(0, 16);
  const cacheFile = `${cacheDir}/${key}.json`;
  await mkdir(cacheDir, { recursive: true });

  if (!refresh) {
    try {
      return JSON.parse(await readFile(cacheFile, 'utf8'));
    } catch { /* not cached yet */ }
  }

  await throttle();
  const res = await fetch(`${ENDPOINT}?${params}`, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'sv' },
  });
  if (!res.ok) throw new Error(`Nominatim ${res.status} ${res.statusText} for "${query}"`);
  const json = await res.json();
  await writeFile(cacheFile, JSON.stringify(json));
  return json;
}
