// Small geometry helpers shared by the build scripts. No dependencies —
// everything here is plane geometry on an equirectangular approximation,
// which is accurate enough at Malmö's latitude over a 40 km bbox.

/** Metres per degree at 55.6°N, used to turn lon/lat deltas into metres. */
const M_PER_DEG_LAT = 111320;
const LAT0 = 55.6;
const LON_SCALE = Math.cos((LAT0 * Math.PI) / 180);

/** Planar distance in metres between two [lon, lat] points. */
export function distance(a, b) {
  const dx = (a[0] - b[0]) * M_PER_DEG_LAT * LON_SCALE;
  const dy = (a[1] - b[1]) * M_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

/** Total length in metres of a [lon, lat] LineString. */
export function lineLength(coords) {
  let sum = 0;
  for (let i = 1; i < coords.length; i++) sum += distance(coords[i - 1], coords[i]);
  return sum;
}

/** [minX, minY, maxX, maxY] of a flat [lon, lat] coordinate list. */
export function bboxOf(coords) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of coords) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

/** Gap in metres between two bboxes (0 if they overlap). */
export function bboxGap(a, b) {
  const dx = Math.max(0, Math.max(a[0] - b[2], b[0] - a[2])) * M_PER_DEG_LAT * LON_SCALE;
  const dy = Math.max(0, Math.max(a[1] - b[3], b[1] - a[3])) * M_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

export function bboxContains(bb, [x, y]) {
  return x >= bb[0] && x <= bb[2] && y >= bb[1] && y <= bb[3];
}

/**
 * Ray-casting point-in-ring. Odd-even over every ring of a polygon (outer and
 * inner alike) gives correct hole handling for free.
 */
function crossings(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** True if [lon, lat] falls inside a Polygon or MultiPolygon geometry. */
export function pointInGeometry(geometry, point) {
  const [x, y] = point;
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  for (const rings of polys) {
    let inside = false;
    for (const ring of rings) if (crossings(ring, x, y)) inside = !inside;
    if (inside) return true;
  }
  return false;
}

/**
 * Point-in-polygon lookup over a set of polygon features, with a bbox
 * pre-filter so the expensive ring walk only runs on plausible candidates.
 */
export class PolygonIndex {
  constructor(features) {
    this.entries = features.map((f) => ({
      feature: f,
      bbox: bboxOf(flatCoords(f.geometry)),
    }));
  }

  /** The first feature containing the point, or null. */
  find(point) {
    for (const e of this.entries) {
      if (!bboxContains(e.bbox, point)) continue;
      if (pointInGeometry(e.feature.geometry, point)) return e.feature;
    }
    return null;
  }
}

/** Every [lon, lat] pair in a Polygon/MultiPolygon, flattened. */
export function flatCoords(geometry) {
  const out = [];
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  for (const rings of polys) for (const ring of rings) for (const c of ring) out.push(c);
  return out;
}

/**
 * A representative point for a set of LineStrings: the vertex closest to the
 * length-weighted centroid. Weighting by segment length keeps dense junction
 * detail from dragging the centre off; snapping to a real vertex guarantees
 * the result sits *on* the street rather than inside a bend it cuts across.
 */
export function representativePoint(lines) {
  let sx = 0, sy = 0, sw = 0;
  for (const coords of lines) {
    for (let i = 0; i < coords.length; i++) {
      const prev = coords[i - 1];
      const next = coords[i + 1];
      const w = (prev ? distance(prev, coords[i]) : 0) + (next ? distance(coords[i], next) : 0);
      const weight = w || 1; // isolated single-vertex way
      sx += coords[i][0] * weight;
      sy += coords[i][1] * weight;
      sw += weight;
    }
  }
  if (!sw) return null;
  const centre = [sx / sw, sy / sw];

  let best = null, bestD = Infinity;
  for (const coords of lines) {
    for (const c of coords) {
      const d = distance(c, centre);
      if (d < bestD) { bestD = d; best = c; }
    }
  }
  return best;
}

/**
 * A point guaranteed to lie inside a Polygon/MultiPolygon, near its middle.
 *
 * The area-weighted centroid is the natural answer but falls outside concave
 * shapes — several Malmö delområden wrap around a harbour or a park. So we
 * test it, and on failure sample a grid over the bbox and keep the interior
 * sample nearest the centroid.
 */
export function interiorPoint(geometry) {
  const coords = flatCoords(geometry);
  const [minX, minY, maxX, maxY] = bboxOf(coords);

  // Area-weighted centroid of the largest ring (the shoelace formula).
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let outer = null, outerLen = -1;
  for (const rings of polys) {
    if (rings[0] && rings[0].length > outerLen) { outerLen = rings[0].length; outer = rings[0]; }
  }
  let cx = 0, cy = 0, a2 = 0;
  for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
    const cross = outer[j][0] * outer[i][1] - outer[i][0] * outer[j][1];
    a2 += cross;
    cx += (outer[j][0] + outer[i][0]) * cross;
    cy += (outer[j][1] + outer[i][1]) * cross;
  }
  const centroid = a2 ? [cx / (3 * a2), cy / (3 * a2)] : [(minX + maxX) / 2, (minY + maxY) / 2];
  if (pointInGeometry(geometry, centroid)) return centroid;

  const STEPS = 32;
  let best = null, bestD = Infinity;
  for (let i = 1; i < STEPS; i++) {
    for (let j = 1; j < STEPS; j++) {
      const p = [minX + ((maxX - minX) * i) / STEPS, minY + ((maxY - minY) * j) / STEPS];
      if (!pointInGeometry(geometry, p)) continue;
      const d = distance(p, centroid);
      if (d < bestD) { bestD = d; best = p; }
    }
  }
  return best ?? centroid;
}

/**
 * Single-linkage clustering of bboxes: any two within `gapM` metres end up in
 * the same cluster. Returns groups of indices into the input array.
 *
 * Used to split things that share a name but are not the same thing — a street
 * name reused in two villages, a station mapped as a dozen platforms. Group
 * sizes here are small (tens at most), so the O(n²) pass is not worth indexing.
 */
export function clusterByGap(boxes, gapM) {
  const parent = boxes.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (bboxGap(boxes[i], boxes[j]) <= gapM) {
        const ra = find(i), rb = find(j);
        if (ra !== rb) parent[ra] = rb;
      }
    }
  }
  const groups = new Map();
  for (let i = 0; i < boxes.length; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(i);
  }
  return [...groups.values()];
}

/** Round a [lon, lat] to ~1 m precision, to keep the JSON small. */
export function roundPoint([x, y]) {
  return [Number(x.toFixed(5)), Number(y.toFixed(5))];
}
