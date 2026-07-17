// Polite, cached, retrying Overpass client.
// Caches raw responses so dev re-runs never hit the public server twice for the
// same query. Rotates endpoints and backs off on rate-limit / gateway errors.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const CACHE_DIR = 'data/cache/overpass';
const UA = 'malmoemaps/1.0 (self-hosted Malmö reference map; contact: local build)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run an Overpass QL query. Returns parsed JSON (the raw Overpass response).
 * @param {string} ql   full Overpass QL (already bbox-substituted)
 * @param {object} opts { label, refresh }
 */
export async function overpass(ql, { label = 'query', refresh = false } = {}) {
  await mkdir(CACHE_DIR, { recursive: true });
  const key = createHash('sha1').update(ql).digest('hex').slice(0, 12);
  const cacheFile = join(CACHE_DIR, `${label}-${key}.json`);

  if (!refresh && existsSync(cacheFile)) {
    console.log(`  [${label}] cache hit (${key})`);
    return JSON.parse(await readFile(cacheFile, 'utf8'));
  }

  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      if (attempt > 0) {
        const wait = Math.min(60, 5 * 2 ** attempt);
        console.log(`  [${label}] retry ${attempt} in ${wait}s via ${endpoint}`);
        await sleep(wait * 1000);
      }
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        body: 'data=' + encodeURIComponent(ql),
      });
      if (res.status === 429 || res.status === 504 || res.status === 502) {
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const json = await res.json();
      await writeFile(cacheFile, JSON.stringify(json));
      console.log(`  [${label}] fetched ${json.elements?.length ?? 0} elements (cached ${key})`);
      // polite pause after a real network fetch
      await sleep(2000);
      return json;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`Overpass failed for ${label}: ${lastErr?.message}`);
}

/** bbox as Overpass expects: (south,west,north,east) */
export function bboxClause(bbox) {
  return `(${bbox.south},${bbox.west},${bbox.north},${bbox.east})`;
}

/** Point [lon,lat] for a node (lat/lon) or way/relation (center). null if none. */
export function elementPoint(el) {
  if (el.type === 'node' && el.lat != null) return [el.lon, el.lat];
  if (el.center) return [el.center.lon, el.center.lat];
  return null;
}
