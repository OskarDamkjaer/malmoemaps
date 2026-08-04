// Service worker — the whole map, offline.
//
// Most offline strategies exist because the payload is unbounded. This one is
// not: basemap 13.3 MB, data 2.3 MB, code and fonts under 2 MB, and none of it
// changes unless I rebuild. So there is no runtime strategy to speak of — the
// install downloads everything, and from then on the network is only consulted
// for things that were somehow missed.
//
// Two caches, deliberately: code changes when I edit the app, data changes when
// I re-run the pipeline. Editing a CSS rule should not re-download 13 MB.
const CODE = 'malmo-code-v12';
const DATA = 'malmo-data-2026-08-03c';

const CODE_FILES = [
  '/',
  '/index.html',
  '/app.css',
  '/app.js',
  '/area-levels.mjs',
  '/categories.mjs',
  '/layers.js',
  '/highlight.js',
  '/kinds.js',
  '/search.js',
  '/learn.js',
  '/rounds.mjs',
  '/progress.mjs',
  '/blind.js',
  '/manifest.webmanifest',
  '/style.json',
  '/vendor/maplibre-gl.css',
  '/vendor/maplibre-gl.mjs',
  '/vendor/maplibre-gl-shared.mjs',
  '/vendor/maplibre-gl-worker.mjs',
  '/vendor/pmtiles.js',
  '/sprite/osm-liberty.json',
  '/sprite/osm-liberty.png',
  '/sprite/osm-liberty@2x.json',
  '/sprite/osm-liberty@2x.png',
  '/icons/icon.svg',
  '/icons/icon-180.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  ...['Roboto Regular', 'Roboto Medium', 'Roboto Condensed Italic'].flatMap((font) => [
    '0-255', '256-511', '8192-8447',
  ].map((range) => `/glyphs/${encodeURIComponent(font)}/${range}.pbf`)),
  ...['amusement', 'beach', 'bridge', 'castle', 'church', 'concert', 'park',
    'shopping', 'square', 'stadium', 'station', 'tower']
    .map((id) => `/landmark-icons/${id}.svg`),
];

const DATA_FILES = [
  '/malmo.pmtiles',
  '/data/districts.geojson',
  '/data/kommun.geojson',
  '/data/stadsdelar.geojson',
  '/data/neighbourhoods.geojson',
  // Drawn from the start (the "Kvarter" chip), so it is not optional offline.
  '/data/parts.geojson',
  '/data/landmarks.geojson',
  // Every name the app can ask about, and everything it says once you have
  // placed it. Without this the front door is empty, so it is the least
  // optional file here after the tiles themselves.
  '/data/learn.json',
  '/data/search.json',
  // The one category that is not in the tiles. food, culture and transit are
  // still built — the search index is made from them, and a station is worth
  // finding by name — but nothing on the map draws them any more, so there is
  // nothing of theirs to precache.
  '/data/cycling.geojson',
];

// A missing file is a build mistake worth seeing in the console, but it must not
// take the whole install down with it — a map that works offline apart from the
// cycling overlay still beats no offline map.
async function fillCache(name, urls) {
  const cache = await caches.open(name);
  const results = await Promise.allSettled(urls.map(async (url) => {
    const res = await fetch(url, { cache: 'reload' });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    await cache.put(url, res);
  }));
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length) console.warn(`sw: ${failed.length} of ${urls.length} failed`, failed.map((f) => f.reason?.message));
}

// The photographs on the fact cards. Not in DATA_FILES because there are a
// hundred-odd of them and the list is a build output, not something to keep in
// sync by hand — so it is read from the one place that already knows, which is
// the quiz itself. A picture that fails here is not worth failing the install
// over: the card hides its frame and says the same words it always did.
async function pictureFiles() {
  try {
    const items = await fetch('/data/learn.json').then((r) => r.json()).then((d) => d.items);
    return [...new Set(items.map((it) => it.image).filter(Boolean))];
  } catch {
    return [];
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await Promise.all([fillCache(CODE, CODE_FILES), fillCache(DATA, DATA_FILES)]);
    await fillCache(DATA, await pictureFiles());
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CODE && key !== DATA) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return; // nothing here is cross-origin anyway

  // Photographs are data: they change when the pipeline re-runs, not when I
  // edit a stylesheet, and they have no business invalidating the code cache.
  const isData = url.pathname.startsWith('/data/')
    || url.pathname.startsWith('/images/')
    || url.pathname.endsWith('.pmtiles');

  event.respondWith((async () => {
    const cacheName = isData ? DATA : CODE;
    const hit = await caches.match(request, { ignoreSearch: true });

    // Data is immutable until I re-run the pipeline (and bump DATA), so a hit is
    // the final answer — re-validating 13 MB on every load would defeat the
    // point. Code is served from cache too, but refreshed in the background, so
    // an edit shows up on the next load instead of never.
    const update = fetch(request).then(async (res) => {
      if (res.ok) (await caches.open(cacheName)).put(request, res.clone());
      return res;
    });

    if (hit) {
      if (!isData) event.waitUntil(update.catch(() => {}));
      return hit;
    }

    try {
      return await update;
    } catch (err) {
      // Offline and never cached: for a navigation, the shell is the best answer.
      if (request.mode === 'navigate') {
        const shell = await caches.match('/index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
