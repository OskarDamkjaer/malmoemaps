// The site layout, defined once.
//
// The deployable site is assembled from three places that must not be merged on
// disk: hand-written app source (versioned), generated data (gitignored), and
// the big basemap (cached, never copied around casually). Every entry is
// load-bearing: if one is missing the build fails rather than shipping a site
// that 404s. Both the dev server
// and the site build read this table, so a URL means the same thing in both and
// "works in dev, 404s in production" can't happen.
// The list the service worker precaches lives in app/sw.js, next to the code
// that uses it — one list, in the only place that reads it.
export const MOUNTS = [
  { url: '/', dir: 'app' },
  { url: '/style.json', file: 'build/style.json' },
  { url: '/data/', dir: 'build/data' },
  // Hand-drawn tier-1 icons: source assets, versioned with the landmark list
  // they belong to rather than copied into the app.
  { url: '/landmark-icons/', dir: 'landmarks/icons' },
  { url: '/malmo.pmtiles', file: 'data/cache/malmo.pmtiles' },
];

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.pbf': 'application/x-protobuf',
  '.pmtiles': 'application/octet-stream',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
