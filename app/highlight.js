// Selection: what you tapped, and the shape of it.
//
// A reference map's job is to answer "what is that?" — so everything with a
// name is tappable, including the basemap's own pictograms, and the answer is
// drawn as well as written: a street lights up along its whole length, a park
// fills, an area outlines, an icon gets a ring around it.
//
// Two things make this less trivial than it sounds.
//
// Vector tiles cut features at tile borders, so "the whole street" is a dozen
// separate pieces, each also present in the neighbouring tile. Pieces are
// therefore collected by name across all loaded tiles and then kept only if
// they hang together (see cluster) — otherwise clicking Kyrkogatan would light
// up the other two Kyrkogatan in view. Only what is loaded can be highlighted:
// pan far enough and the far end of a long street is simply not there yet.
//
// And the basemap's road geometry carries no names — names live in a parallel
// `transportation_name` layer. So a street is found by proximity to that layer
// rather than by hit-testing the road you can see.
import { categoryOfLayer } from './categories.mjs';
import { kindLabel } from './kinds.js';

const SRC = 'highlight';
const BOARD = 'board';
const ACCENT = '#b8562b';
// The two states of a slot on the tray board. Green is the app's own accent,
// which everywhere else means "this is the answer" — here it means "this one is
// answered", which is the same claim.
const SLOT = '#6d665e';
const FILLED = '#1f6f5c';
const EMPTY = { type: 'FeatureCollection', features: [] };

// Districts and stadsdelar are kept unclipped here, straight from their
// GeoJSON: they are what gets highlighted where tile seams would show as stray
// lines, and the stadsdelar double as the answer to "which part of town is
// this in?" for everything that has a point but no boundary.
let districtFeatures = [];
let stadsdelFeatures = [];
let neighbourhoodFeatures = [];
export function setDistrictFeatures(features) { districtFeatures = features; }
export function setStadsdelar(features) { stadsdelFeatures = features; }
export function setNeighbourhoods(features) { neighbourhoodFeatures = features; }
export const stadsdelNames = () => stadsdelFeatures.map((f) => f.properties.name);

// Symbol layers whose icons and labels should answer for themselves. The app's
// own layers are added to this at pick time.
//
// The basemap's POI pictograms used to be in here. They are not drawn any more
// (build-style.mjs drops poi_z15/poi_z16) — the same POIs are the category
// layers, which come through as app layers when their chip is on.
const BASEMAP_SYMBOLS = ['place_city', 'place_town', 'place_village',
  'road_shield', 'water_name_point', 'water_name_line'];
const BASEMAP_AREAS = ['park', 'landuse_cemetery', 'landuse_hospital', 'landuse_school'];

// ---- geometry ---------------------------------------------------------------
const flatten = (coords) => (typeof coords[0] === 'number' ? [coords] : coords.flatMap(flatten));

function bboxOf(geometry) {
  const pts = flatten(geometry.coordinates);
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of pts) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [w, s, e, n];
}

// Equirectangular metres. Everything here is within one city, where the error
// is far below the tolerances being compared against.
const M_PER_DEG_LAT = 110574;
const mPerDegLon = (lat) => 111320 * Math.cos(lat * Math.PI / 180);

function gapMeters(a, b, lat) {
  const dx = Math.max(0, a[0] - b[2], b[0] - a[2]) * mPerDegLon(lat);
  const dy = Math.max(0, a[1] - b[3], b[1] - a[3]) * M_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

function distanceToSegment(p, a, b, kx) {
  const px = (p[0] - a[0]) * kx;
  const py = (p[1] - a[1]) * M_PER_DEG_LAT;
  const bx = (b[0] - a[0]) * kx;
  const by = (b[1] - a[1]) * M_PER_DEG_LAT;
  const len2 = bx * bx + by * by;
  const t = len2 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
  return Math.hypot(px - t * bx, py - t * by);
}

function distanceToLine(point, geometry, lat) {
  const kx = mPerDegLon(lat);
  const lines = geometry.type === 'MultiLineString' ? geometry.coordinates : [geometry.coordinates];
  let best = Infinity;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      best = Math.min(best, distanceToSegment(point, line[i - 1], line[i], kx));
    }
  }
  return best;
}

// Keep the pieces that hang together with the clicked one. Tile borders leave
// gaps of nearly nothing; a different street of the same name is hundreds of
// metres away.
function cluster(pieces, seed, linkMeters, lat) {
  const boxes = pieces.map((f) => bboxOf(f.geometry));
  const keep = new Set([seed]);
  const queue = [seed];
  while (queue.length) {
    const i = queue.pop();
    for (let j = 0; j < pieces.length; j++) {
      if (keep.has(j) || gapMeters(boxes[i], boxes[j], lat) > linkMeters) continue;
      keep.add(j);
      queue.push(j);
    }
  }
  return [...keep].map((i) => pieces[i]);
}

// ---- collecting the shape ---------------------------------------------------
const piecesNamed = (map, sourceLayer, name) => map
  .querySourceFeatures('openmaptiles', { sourceLayer, filter: ['==', 'name', name] })
  .filter((f) => f.properties.name === name);

function shapeOf(map, feature, sourceLayer, { outline = false } = {}) {
  const lat = map.getCenter().lat;
  const name = feature.properties?.name;
  let features = [feature];

  if (name) {
    const pieces = piecesNamed(map, sourceLayer, name);
    // The clicked piece is one of these, but identity is not preserved across
    // the two query APIs, so it is found by proximity to what was clicked.
    const box = bboxOf(feature.geometry);
    let seed = -1;
    let bestGap = Infinity;
    pieces.forEach((f, i) => {
      const gap = gapMeters(box, bboxOf(f.geometry), lat);
      if (gap < bestGap) { bestGap = gap; seed = i; }
    });
    if (seed >= 0) features = cluster(pieces, seed, 220, lat);
  }

  return features.map((f) => ({
    type: 'Feature',
    geometry: f.geometry,
    properties: { _outline: outline },
  }));
}

// ---- layers -----------------------------------------------------------------
export function addHighlightLayers(map) {
  // The tray board goes on first, so the highlight — which is the *answer*,
  // drawn the moment a name is settled — always sits on top of the slots.
  addBoardLayers(map);

  map.addSource(SRC, { type: 'geojson', data: EMPTY });

  map.addLayer({
    id: 'highlight-fill',
    type: 'fill',
    source: SRC,
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': ACCENT, 'fill-opacity': 0.16 },
  });

  // Lines get a highlighter-pen stroke: wide, soft, under the label rather than
  // over it, so the street stays readable while it is lit.
  map.addLayer({
    id: 'highlight-line',
    type: 'line',
    source: SRC,
    filter: ['any', ['==', ['geometry-type'], 'LineString'], ['get', '_outline']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ACCENT,
      'line-width': ['interpolate', ['linear'], ['zoom'], 11, 4, 14, 7, 17, 12],
      'line-opacity': 0.45,
    },
  });

  // A ring, not a dot: the icon underneath is the thing being pointed at.
  map.addLayer({
    id: 'highlight-point',
    type: 'circle',
    source: SRC,
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 11, 16, 18],
      'circle-color': ACCENT,
      'circle-opacity': 0.12,
      'circle-stroke-color': ACCENT,
      'circle-stroke-width': 2,
      'circle-stroke-opacity': 0.85,
    },
  });
}

const setShape = (map, features) => map.getSource(SRC)
  ?.setData({ type: 'FeatureCollection', features });

export function clearHighlight(map) { setShape(map, []); }

// ---- the tray board ----------------------------------------------------------
// Tray mode drags names onto a blinded map, and a blinded map does not say
// where anything *goes*. The delområde boundaries are forced on, but all 136 of
// them are, so a chunk of eleven names is dragged onto a mesh of identical
// cells with no way to tell a candidate from a bystander. For a bridge it is
// worse: nothing is drawn at all, and "drag this name onto the city" is not a
// question with a visible answer set.
//
// So picking a name up lights the slots it could go in — every delområde in the
// chunk when the name is an area, every bridge when it is a bridge — and a slot
// turns green once something has landed in it. That is what makes the last few
// answerable by elimination, which is the whole point of the easy direction:
// tray mode is recognition, and recognition needs something to recognise
// *among*. Point mode, which is recall, gets no board at all.
//
// The cost is real and accepted: with the drop zones drawn, tray mode is closer
// to matching names against slots than to placing them from memory. That is
// what the easy direction is for, and it is why the same chunk is also playable
// the other way.
function addBoardLayers(map) {
  map.addSource(BOARD, { type: 'geojson', data: EMPTY });

  map.addLayer({
    id: 'board-fill',
    type: 'fill',
    source: BOARD,
    filter: ['==', ['geometry-type'], 'Polygon'],
    // Deliberately faint. An area slot can be half the screen, and at the
    // opacity a small shape wants it becomes a wash that everything else — the
    // rings, the streets, the map underneath — has to be read through. The
    // outline below is what says where the slot is; the fill only has to say
    // which side of the line you are on.
    paint: {
      'fill-color': ['case', ['get', 'placed'], FILLED, SLOT],
      'fill-opacity': ['case', ['get', 'placed'], 0.13, 0.05],
    },
  });

  // Both the outline of an area slot and the whole length of a street slot. A
  // street has to read as a stroke along the road rather than as a hairline, so
  // it is drawn several times wider than a boundary.
  //
  // **An empty slot is dashed; a filled one is solid.** Colour alone was doing
  // this job and could not, on the streets in particular: a grey stroke along a
  // road drawn in grey casing, next to a green stroke along a road that is not,
  // are two differences your eye has to go looking for — and with fifty street
  // slots lit at once in Centrum, going looking is the whole task. Dashed
  // against solid is a difference that cannot be missed, holds up over white,
  // yellow and orange roads alike, and does not depend on telling two muted
  // colours apart. It is two layers rather than one expression because
  // `line-dasharray` is not data-driven in MapLibre.
  const line = (id, placed) => ({
    id,
    type: 'line',
    source: BOARD,
    filter: ['all',
      ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'LineString']],
      placed ? ['get', 'placed'] : ['!', ['get', 'placed']]],
    layout: { 'line-join': 'round', 'line-cap': placed ? 'round' : 'butt' },
    paint: {
      'line-color': placed ? FILLED : SLOT,
      'line-width': ['case',
        ['==', ['geometry-type'], 'LineString'], placed ? 8 : 6,
        placed ? 2.5 : 1.6],
      // The empty state is more opaque than it was as well as dashed. It used
      // to sit at 0.6, which on a pale road is a suggestion, not a stroke.
      'line-opacity': placed ? 0.95 : 0.85,
      // In line widths, so the dash keeps its proportions between a 6 px street
      // and a 1.6 px boundary rather than turning one of them into a dotted rule.
      ...(placed ? {} : { 'line-dasharray': [1.6, 1.1] }),
    },
  });

  map.addLayer(line('board-line', false));
  // Filled on top: an answered street crossing an unanswered one should read as
  // the answered one, since that is the thing that changed.
  map.addLayer(line('board-line-placed', true));

  // A landmark or a bridge has no shape to tint, so its slot is a ring at the
  // spot. Deliberately not drawn at the grading tolerance: a 250 m disc is a
  // dinner plate at close zoom, and the ring is there to say "one of these",
  // not to promise exactly where the edge of right is.
  map.addLayer({
    id: 'board-point',
    type: 'circle',
    source: BOARD,
    filter: ['==', ['geometry-type'], 'Point'],
    // A ring has to survive being drawn on top of an area slot, so it carries
    // its contrast in the stroke rather than in the fill.
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 7, 16, 15],
      'circle-color': ['case', ['get', 'placed'], FILLED, SLOT],
      'circle-opacity': ['case', ['get', 'placed'], 0.35, 0.12],
      'circle-stroke-color': ['case', ['get', 'placed'], FILLED, SLOT],
      'circle-stroke-width': 2.5,
      'circle-stroke-opacity': 0.95,
    },
  });
}

// One slot's worth of geometry, by the same route the grader takes to it: an
// area's `covers`, a street found by proximity to `transportation_name`, a
// point as itself. Drawing a candidate any other way would eventually light up
// something the grader would not accept.
function zoneOf(map, { shape, covers = [], point }) {
  if (shape === 'area') {
    return districtFeatures.filter((f) => covers.includes(f.properties.name));
  }
  if (shape === 'line') {
    const street = nearestNamedStreet(map, { lng: point[0], lat: point[1] }, 60);
    return street ? shapeOf(map, street, 'transportation_name') : [];
  }
  return [{ geometry: { type: 'Point', coordinates: point } }];
}

/**
 * Draw the slots for a tray round, and say how many of them could be drawn.
 *
 * `slots` is `[{ name, shape, covers, point, placed }]`. What is in the list is
 * the caller's decision — learn.js shows the kind currently in hand — because
 * "which slots are worth drawing right now" is a question about the round, not
 * about geometry.
 *
 * The count is not bookkeeping. A street slot is looked up in the vector tiles
 * that happen to be loaded, and `transportation_name` is not in them below
 * about z14 — so at the zoom a whole stadsdel is framed at, a street slot
 * resolves to nothing at all. That is not only a drawing problem: the grader
 * finds your answer through the same lookup, so a street question asked at that
 * zoom cannot be got right either. Returning the count lets the caller notice
 * and say so, instead of showing a blank map and marking you wrong on it.
 */
export function setBoard(map, slots) {
  let drawn = 0;
  const features = slots.flatMap((slot) => {
    const zone = zoneOf(map, slot);
    if (zone.length) drawn += 1;
    return zone.map((f) => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: { name: slot.name, placed: !!slot.placed },
    }));
  });
  map.getSource(BOARD)?.setData({ type: 'FeatureCollection', features });
  return drawn;
}

export function clearBoard(map) { map.getSource(BOARD)?.setData(EMPTY); }

// ---- picking ----------------------------------------------------------------
// Metres per screen pixel, so tolerances can be expressed in taps rather than
// in degrees.
function metersPerPixel(map, point) {
  const a = map.unproject(point);
  const b = map.unproject([point.x + 1, point.y]);
  return Math.hypot((b.lng - a.lng) * mPerDegLon(a.lat), (b.lat - a.lat) * M_PER_DEG_LAT);
}

function nearestNamedStreet(map, lngLat, maxMeters) {
  const point = [lngLat.lng, lngLat.lat];
  let best = null;
  for (const f of map.querySourceFeatures('openmaptiles', { sourceLayer: 'transportation_name' })) {
    if (!f.properties.name || f.geometry.type === 'Point') continue;
    const d = distanceToLine(point, f.geometry, lngLat.lat);
    if (d <= maxMeters && (!best || d < best.d)) best = { d, f };
  }
  return best?.f ?? null;
}

// Everything tappable, in the order it wins ties. Curated layers first: they
// are what this map is *for*, and they sit on top visually too.
export function pickFeature(map, e, appLayerIds, { streets = true } = {}) {
  const box = [[e.point.x - 8, e.point.y - 8], [e.point.x + 8, e.point.y + 8]];
  const exists = (ids) => ids.filter((id) => map.getLayer(id));

  const mine = map.queryRenderedFeatures(box, { layers: exists(appLayerIds) });
  if (mine.length) return { feature: mine[0], origin: 'app' };

  const symbols = map.queryRenderedFeatures(box, { layers: exists(BASEMAP_SYMBOLS) });
  if (symbols.length) {
    const f = symbols[0];
    return { feature: f, origin: f.sourceLayer === 'transportation_name' ? 'street' : 'symbol' };
  }

  // Tapping the street itself, not its name: 14 px of slack, which is about a
  // fingertip, and never crosses to the next street in a normal grid.
  //
  // This one reads the *source*, not the screen, so it is the only hit that
  // survives its layers being hidden — hence `streets`, which is off when the
  // "Bilvägar" chip is. A road you cannot see is not an answer you can be
  // holding your finger on.
  if (streets) {
    const street = nearestNamedStreet(map, e.lngLat, 14 * metersPerPixel(map, e.point));
    if (street) return { feature: street, origin: 'street' };
  }

  const areas = map.queryRenderedFeatures(box, { layers: exists(BASEMAP_AREAS) });
  if (areas.length) return { feature: areas[0], origin: 'area' };

  return null;
}

// ---- highlighting -----------------------------------------------------------
const ringAt = (coords) => [{
  type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties: {},
}];

const asShape = (features) => features
  .map((f) => ({ type: 'Feature', geometry: f.geometry, properties: { _outline: true } }));

const districtShape = (name) => asShape(districtFeatures.filter((f) => f.properties.name === name));
const stadsdelShape = (name) => asShape(stadsdelFeatures.filter((f) => f.properties.name === name));

// A neighbourhood has no geometry of its own — it *is* its delområden. Drawn as
// their polygons with the outline suppressed when there are several, because
// the boundaries between them are exactly what the name papers over.
function neighbourhoodShape(covers) {
  const members = districtFeatures.filter((f) => covers.includes(f.properties.name));
  const outline = covers.length === 1;
  return members.map((f) => ({
    type: 'Feature', geometry: f.geometry, properties: { _outline: outline },
  }));
}

// Ray casting, the textbook version. Ten polygons, one point, on a tap.
function pointInRing(ring, [x, y]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointInFeature(feature, point) {
  const polys = feature.geometry.type === 'MultiPolygon'
    ? feature.geometry.coordinates : [feature.geometry.coordinates];
  // Outer ring in, holes out.
  return polys.some(([outer, ...holes]) => pointInRing(outer, point)
    && !holes.some((h) => pointInRing(h, point)));
}

// Which stadsdel a point falls in — the "in Västra Innerstaden" half of the
// card, and the only thing that can be said about a name with no boundary.
function stadsdelAt(point) {
  return stadsdelFeatures.find((f) => pointInFeature(f, point))?.properties.name ?? null;
}

// ---- what the quiz asks of this file -----------------------------------------
// A handful of questions, all of them ones the selection code already answers
// for its own reasons. They are exported rather than reimplemented next door
// because "which area is this point in" having two answers in one app is
// exactly the kind of drift that shows up as the quiz marking a right answer
// wrong.

/**
 * The delområde a point falls in, or null outside the municipality.
 *
 * Every area name is graded through here, and named through `covers`, so the
 * 136 polygons are the only geometry the area half of the quiz needs.
 */
export function districtAt(point) {
  return districtFeatures
    .find((f) => f.properties.admin_level === 10 && pointInFeature(f, point))
    ?.properties.name ?? null;
}

/** Outline an area given the delområden it is made of. */
export function highlightCovers(map, covers) {
  setShape(map, neighbourhoodShape(covers));
}

/** Ring a point — a landmark or a bridge, which have no shape to draw. */
export function highlightPoint(map, coords) {
  setShape(map, ringAt(coords));
}

/**
 * The named street nearest a point, optionally lit up end to end.
 *
 * Doubles as the street round's grader and its reveal, which is the right way
 * round: what gets drawn as the answer is by construction the same thing that
 * was tested against.
 */
export function highlightStreet(map, lngLat, maxMeters, draw = false) {
  const street = nearestNamedStreet(map, lngLat, maxMeters);
  if (street && draw) setShape(map, shapeOf(map, street, 'transportation_name'));
  return street;
}

// A delområde's stadsdel comes from the build (covers), not from geometry:
// build-areas.mjs already decided, and deciding twice invites disagreeing.
function stadsdelOfDistrict(name) {
  return stadsdelFeatures.find((f) => f.properties.covers.includes(name))?.properties.name ?? null;
}

export function highlight(map, hit) {
  const { feature, origin } = hit;
  const { name } = feature.properties;

  if (origin === 'street') {
    setShape(map, shapeOf(map, feature, 'transportation_name'));
    return;
  }
  if (origin === 'area') {
    // Tile-clipped, so fill only — an outline would trace the tile grid.
    setShape(map, shapeOf(map, feature, feature.sourceLayer));
    return;
  }
  const layer = feature.layer?.id ?? '';
  if (layer === 'area-label-stadsdel' && name) {
    setShape(map, stadsdelShape(name));
    return;
  }
  if (layer === 'area-label-neighbourhood' && name) {
    // GeoJSON source properties arrive JSON-encoded through the tiler.
    const covers = typeof feature.properties.covers === 'string'
      ? JSON.parse(feature.properties.covers) : feature.properties.covers;
    setShape(map, neighbourhoodShape(covers ?? [name]));
    return;
  }
  if (layer.startsWith('district-label') && name) {
    setShape(map, districtShape(name));
    return;
  }
  if (feature.geometry.type === 'Point') {
    setShape(map, ringAt(feature.geometry.coordinates));
    return;
  }
  setShape(map, [{ type: 'Feature', geometry: feature.geometry, properties: { _outline: true } }]);
}

// Search results arrive as a name and a point, with no feature behind them, so
// the shape has to be found again once the map has flown there and loaded it.
export function highlightSearchResult(map, entry) {
  if (entry.cat === 'neighbourhood') {
    const covers = neighbourhoodFeatures.find((f) => f.properties.name === entry.name)?.properties.covers;
    if (covers) { setShape(map, neighbourhoodShape(covers)); return; }
  }
  if (entry.cat === 'stadsdel') {
    const shape = stadsdelShape(entry.name);
    if (shape.length) { setShape(map, shape); return; }
  }
  if (entry.cat === 'district') {
    const shape = districtShape(entry.name);
    if (shape.length) { setShape(map, shape); return; }
  }
  if (entry.cat === 'street') {
    const near = nearestNamedStreet(map, { lng: entry.point[0], lat: entry.point[1] }, 60);
    if (near?.properties.name === entry.name) {
      setShape(map, shapeOf(map, near, 'transportation_name'));
      return;
    }
  }
  setShape(map, ringAt(entry.point));
}

// ---- what to say about it ---------------------------------------------------
export function describeHit({ feature, origin }) {
  const p = feature.properties ?? {};
  const layer = feature.layer?.id ?? '';

  if (layer.startsWith('landmark-')) {
    return {
      name: p.name,
      meta: [p.tier === 1 ? 'Landmärke' : 'Sevärdhet', p.district].filter(Boolean).join(' · '),
      description: p.description,
    };
  }
  // The three tiers of area, each saying how it sits in the others: a stadsdel
  // lists what it covers, a delområde says which stadsdel it is in, and a name
  // with no boundary of its own at least says where it is.
  if (layer === 'area-label-stadsdel') {
    const covers = p.covers ?? [];
    return {
      name: p.name,
      meta: ['Stadsdel', `${covers.length} delområden`, p.area_km2 ? `${p.area_km2} km²` : null]
        .filter(Boolean).join(' · '),
      description: covers.join(' · '),
    };
  }
  if (layer.startsWith('district-label')) {
    const inside = stadsdelOfDistrict(p.name);
    return {
      name: p.name,
      meta: ['Delområde', inside && `i ${inside}`].filter(Boolean).join(' · '),
    };
  }
  if (layer === 'area-label-neighbourhood') {
    const covers = (typeof p.covers === 'string' ? JSON.parse(p.covers) : p.covers) ?? [];
    const partial = (typeof p.partial === 'string' ? JSON.parse(p.partial) : p.partial) ?? [];
    return {
      name: p.name,
      meta: ['Område', p.stadsdel && `i ${p.stadsdel}`].filter(Boolean).join(' · '),
      // Every name at this level stands for delområden below it — that is what
      // makes it this level. The partials are named as partial rather than
      // quietly drawn whole.
      description: covers.length
        ? `Omfattar ${covers.join(', ')}${partial.length ? ` (delvis ${partial.join(', ')})` : ''}.`
        : null,
    };
  }
  if (layer.startsWith('area-label')) {
    const inside = stadsdelAt(feature.geometry.coordinates);
    return {
      name: p.name,
      meta: [kindLabel(p) ?? 'Område', inside && `i ${inside}`].filter(Boolean).join(' · '),
      // Said plainly rather than drawn, because there is nothing to draw.
      description: 'Namn utan egen gräns i kartdatan.',
    };
  }

  // A pin from a category: what it is beats which chip drew it — "Bageri" is
  // the answer, "Mat" only the shelf it was filed under — and it earns the same
  // "in Möllevången" every other point on this map gets.
  const category = categoryOfLayer(layer);
  if (category) {
    const kind = kindLabel(p);
    const inside = feature.geometry.type === 'Point' ? stadsdelAt(feature.geometry.coordinates) : null;
    return {
      name: p.name || kind || category.label,
      meta: [p.name ? kind ?? category.label : category.label, inside && `i ${inside}`]
        .filter(Boolean).join(' · '),
    };
  }

  if (origin === 'street') {
    return { name: p.name, meta: [kindLabel(p), p.ref].filter(Boolean).join(' · ') };
  }

  // Basemap icon or area: the name if it has one, and always what it is.
  const kind = kindLabel(p);
  return { name: p.name || kind || 'Plats', meta: p.name ? kind : null };
}
