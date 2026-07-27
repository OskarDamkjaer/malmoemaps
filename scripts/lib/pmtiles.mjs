// Reading the tileset back, in Node.
//
// The category table in app/categories.mjs is a claim about what is inside
// malmo.pmtiles — "these classes exist, this many, from this zoom". Believing
// the OpenMapTiles schema instead of checking would be believing a document
// about someone else's planet extract, so this reads the archive itself.
//
// Two formats, both only as far as this needs them: the PMTiles v3 directory
// (to find every tile) and Mapbox Vector Tile (to read one layer's feature
// properties — geometry is skipped entirely). ~120 lines beats a dependency for
// something used by one script and one test.
import { openSync, readSync, closeSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

// ---- protobuf ---------------------------------------------------------------
function reader(buf) {
  let p = 0;
  const varint = () => {
    let x = 0;
    let shift = 0;
    for (;;) {
      const b = buf[p++];
      x += (b & 0x7f) * 2 ** shift;
      if (b < 0x80) return x;
      shift += 7;
    }
  };
  return {
    get done() { return p >= buf.length; },
    varint,
    bytes: () => { const n = varint(); const b = buf.subarray(p, p + n); p += n; return b; },
    skip: (wire) => {
      if (wire === 0) varint();
      // Two statements, not `p += varint()`: the read advances p itself, and a
      // compound assignment would write back the position it started from.
      else if (wire === 2) { const n = varint(); p += n; }
      else if (wire === 5) p += 4;
      else if (wire === 1) p += 8;
      else throw new Error(`unknown protobuf wire type ${wire}`);
    },
  };
}

/** Walk a message's fields; `fn` returns true when it consumed the value. */
function fields(buf, fn) {
  const r = reader(buf);
  while (!r.done) {
    const tag = r.varint();
    if (!fn(tag >> 3, tag & 7, r)) r.skip(tag & 7);
  }
}

function tileValue(buf) {
  let out = null;
  fields(buf, (num, wire, r) => {
    if (num === 1 && wire === 2) { out = r.bytes().toString(); return true; }
    if (num === 4 || num === 5) { out = r.varint(); return true; }
    return false;
  });
  return out;
}

/**
 * The properties of every feature in one layer of a tile.
 *
 * MVT stores properties as indexes into per-layer key and value tables, which
 * is the whole reason this is cheap: geometry is never even decoded.
 */
export function layerProperties(tile, wanted) {
  const out = [];
  fields(tile, (num, wire, r) => {
    if (num !== 3 || wire !== 2) return false;
    const buf = r.bytes();
    const keys = [];
    const values = [];
    const features = [];
    let name = '';
    fields(buf, (n, w, rr) => {
      if (n === 1) { name = rr.bytes().toString(); return true; }
      if (n === 3) { keys.push(rr.bytes().toString()); return true; }
      if (n === 4) { values.push(tileValue(rr.bytes())); return true; }
      if (n === 2) {
        const tags = [];
        fields(rr.bytes(), (fn, fw, fr) => {
          if (fn !== 2 || fw !== 2) return false;
          const packed = reader(fr.bytes());
          while (!packed.done) tags.push(packed.varint());
          return true;
        });
        features.push(tags);
        return true;
      }
      return false;
    });
    if (name !== wanted) return true;
    for (const tags of features) {
      const props = {};
      for (let i = 0; i < tags.length; i += 2) props[keys[tags[i]]] = values[tags[i + 1]];
      out.push(props);
    }
    return true;
  });
  return out;
}

// ---- pmtiles ----------------------------------------------------------------
function directory(buf) {
  const r = reader(buf);
  const n = r.varint();
  const ids = new Array(n);
  const runs = new Array(n);
  const lengths = new Array(n);
  const offsets = new Array(n);
  let id = 0;
  for (let i = 0; i < n; i++) { id += r.varint(); ids[i] = id; }
  for (let i = 0; i < n; i++) runs[i] = r.varint();
  for (let i = 0; i < n; i++) lengths[i] = r.varint();
  for (let i = 0; i < n; i++) {
    const v = r.varint();
    // 0 is the format's "runs on from the previous entry".
    offsets[i] = v === 0 && i > 0 ? offsets[i - 1] + lengths[i - 1] : v - 1;
  }
  return ids.map((tileId, i) => ({ tileId, run: runs[i], length: lengths[i], offset: offsets[i] }));
}

// Tile ids are one Hilbert curve per zoom, laid end to end, so the zoom is
// recoverable from the id alone — which is all this needs; where a tile *is*
// never comes up.
function zoomOf(tileId) {
  let z = 0;
  let base = 0;
  while (base + 4 ** (z + 1) <= tileId + 1) { base += 4 ** z; z++; }
  return z;
}

/** Every tile in the archive, as `{ zoom, data }`, decompressed. */
export function* tiles(file, { minZoom = 0 } = {}) {
  const fd = openSync(file, 'r');
  try {
    const read = (off, len) => { const b = Buffer.alloc(len); readSync(fd, b, 0, len, off); return b; };
    const head = read(0, 127);
    if (head.subarray(0, 7).toString() !== 'PMTiles') throw new Error(`not a pmtiles archive: ${file}`);
    const u64 = (o) => Number(head.readBigUInt64LE(o));
    const [rootOff, rootLen] = [u64(8), u64(16)];
    const [leafOff, dataOff] = [u64(40), u64(56)];
    const internal = head.readUInt8(97);
    const tileComp = head.readUInt8(98);
    const decompress = (buf, kind) => (kind === 2 ? gunzipSync(buf) : buf);

    const entries = [];
    for (const e of directory(decompress(read(rootOff, rootLen), internal))) {
      // run === 0 means the entry points at a leaf directory, not a tile.
      if (e.run === 0) entries.push(...directory(decompress(read(leafOff + e.offset, e.length), internal)));
      else entries.push(e);
    }

    for (const e of entries) {
      const zoom = zoomOf(e.tileId);
      if (zoom < minZoom) continue;
      yield { zoom, data: decompress(read(dataOff + e.offset, e.length), tileComp) };
    }
  } finally {
    closeSync(fd);
  }
}

/**
 * What POIs the archive actually holds: one entry per OpenMapTiles `class`,
 * with its subclasses, how many are named, and the lowest zoom it appears at.
 *
 * A POI is repeated in every zoom's tile that covers it, so places are counted
 * by name+class+subclass rather than by feature — an approximation that can
 * merge two unnamed benches, and never merges anything you could look up.
 */
export function poiInventory(file) {
  const classes = new Map();
  const seen = new Set();
  for (const { zoom, data } of tiles(file, { minZoom: 12 })) {
    for (const p of layerProperties(data, 'poi')) {
      const key = `${p.name ?? ''}|${p.class}|${p.subclass}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!classes.has(p.class)) classes.set(p.class, { total: 0, named: 0, minzoom: Infinity, subclasses: new Map() });
      const c = classes.get(p.class);
      c.total++;
      if (p.name) c.named++;
      c.minzoom = Math.min(c.minzoom, zoom);
      c.subclasses.set(p.subclass, (c.subclasses.get(p.subclass) ?? 0) + 1);
    }
  }
  return classes;
}
