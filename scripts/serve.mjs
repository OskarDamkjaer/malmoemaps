// Dev server — the site as it will be deployed, on localhost.
//
// Two things a plain `python -m http.server` gets wrong for this project: it
// serves nothing but one directory (the site is three, see lib/site.mjs), and
// its Range support is the one hard requirement of the whole hosting story —
// pmtiles is a 13 MB file that the map reads a few kilobytes at a time. Both
// are ~40 lines, so here they are.
//
// Usage: node scripts/serve.mjs [--port 8080] [--host 127.0.0.1]
import { createServer } from 'node:http';
import { createReadStream, statSync, existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, normalize, extname } from 'node:path';
import { MOUNTS, MIME } from './lib/site.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const port = Number(arg('--port', 8080));
const host = arg('--host', '127.0.0.1');
const root = resolve(process.cwd());

// Longest matching mount wins, so /data/x.geojson beats the / catch-all. Mount
// prefixes are compared without their trailing slash, so "/data/" and "/data"
// in the table mean the same thing.
//
// The review tool is mounted here rather than in lib/site.mjs on purpose: it is
// a curation tool for whoever is building the thing, not part of the app, and
// adding it to MOUNTS would ship it. Nothing in build/site knows it exists.
const mounts = [...MOUNTS, { url: '/review/', dir: 'scripts/review' }]
  .map((m) => ({ ...m, base: m.url.replace(/\/+$/, '') }))
  .sort((a, b) => b.base.length - a.base.length);

// Where the review tool's decisions live. Deliberately not photos.json: a page
// should not be able to rewrite the curated list. It writes an opinion, and
// `node scripts/apply-review.mjs` is the step that acts on it.
const REVIEW = 'game/review.json';

function toFile(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath)).replace(/\/+$/, '') || '/';
  for (const m of mounts) {
    if (m.file && clean === m.base) return resolve(root, m.file);
    if (m.dir && (clean === m.base || clean.startsWith(`${m.base}/`))) {
      const rel = clean.slice(m.base.length + 1);
      const file = resolve(root, m.dir, rel || 'index.html');
      // Reject anything that climbed out of the mount via ../ before touching it.
      if (!file.startsWith(resolve(root, m.dir))) return null;
      if (existsSync(file) && statSync(file).isDirectory()) return resolve(file, 'index.html');
      if (existsSync(file)) return file;
    }
  }
  return null;
}

const json = (res, code, body) => {
  const text = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  res.end(text);
};

/**
 * The review tool's two calls: read the decisions so far, and write them back.
 *
 * The only endpoint in this repo that writes anything, which is why it is
 * narrow: one file, one shape, and the server is bound to 127.0.0.1 by default.
 * It exists because the alternative — downloading a JSON file and re-importing
 * it — turns "I have ten minutes, let me do thirty photographs" into a chore
 * with two ends, and a review that is a chore does not happen.
 */
async function review(req, res) {
  if (req.method === 'GET') {
    try {
      return json(res, 200, JSON.parse(await readFile(REVIEW, 'utf8')));
    } catch {
      return json(res, 200, {});
    }
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'GET or POST' });

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    // A decision file for five hundred photographs is about 30 KB. Anything
    // approaching a megabyte is not that.
    if (size > 1e6) { res.writeHead(413).end(); return undefined; }
    chunks.push(chunk);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return json(res, 400, { error: 'not JSON' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json(res, 400, { error: 'expected an object of id → keep|drop' });
  }
  const clean = {};
  for (const [id, verdict] of Object.entries(body)) {
    if (verdict === 'keep' || verdict === 'drop') clean[id] = verdict;
  }
  await mkdir('game', { recursive: true });
  await writeFile(REVIEW, `${JSON.stringify(clean, null, 2)}\n`);
  return json(res, 200, { saved: Object.keys(clean).length });
}

createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/review/state') {
    review(req, res).catch((err) => {
      console.error('review', err);
      json(res, 500, { error: err.message });
    });
    return;
  }

  const file = toFile(url.pathname);
  if (!file || !existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end(`404 ${url.pathname}\n`);
    console.log(`404 ${url.pathname}`);
    return;
  }

  const { size } = statSync(file);
  const type = MIME[extname(file)] ?? 'application/octet-stream';
  // Dev: never cache, so a rebuild shows up on reload. The service worker is
  // the caching story, and it is tested by going offline, not by stale files.
  const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-store' };

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range) {
    const [, rawStart, rawEnd] = range;
    const start = rawStart ? Number(rawStart) : size - Number(rawEnd);
    const end = rawStart && rawEnd ? Math.min(Number(rawEnd), size - 1) : size - 1;
    if (start >= size || start < 0 || end < start) {
      res.writeHead(416, { 'content-range': `bytes */${size}` });
      res.end();
      return;
    }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, { ...headers, 'content-length': size });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}).listen(port, host, () => {
  console.log(`serving on http://${host}:${port}`);
  for (const m of mounts) {
    const src = m.file ?? m.dir;
    console.log(`  ${m.url.padEnd(16)} ← ${src}${existsSync(resolve(root, src)) ? '' : '   ⚠ missing, run the build'}`);
  }
});
