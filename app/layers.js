// Everything drawn on top of the basemap: districts, landmarks, categories.
//
// These files are the parts of the map that are mine rather than
// OpenStreetMap's rendering conventions — a hand-curated landmark list, the
// city's own administrative division, and the cycle network. They are GeoJSON
// rather than tiles because together they are under 2 MB, which is cheaper to
// ship whole than to tile.
//
// The other thing here is the category machinery: no pin is drawn until a chip
// asks for it, and which pins a chip stands for is decided in categories.mjs.
//
// One rule shows up repeatedly below: *zoom is compared to a per-feature
// property by splitting into buckets, not by an expression.* MapLibre will not
// compare ["zoom"] against ["get", …] in a filter, so a landmark that should
// appear at z12 lives in the z12 layer. Hence the small layer factories.

import { areaLayers } from './area-levels.mjs';
import {
  CATEGORIES, DEFAULT_ON, categoryLayers, isCarRoadLayer,
} from './categories.mjs';
import {
  addHighlightLayers, clearHighlight, describeHit, highlight, pickFeature,
  setDistrictFeatures, setNeighbourhoods, setStadsdelar, stadsdelNames,
} from './highlight.js';

const DATA = '/data';

// ---- landmark icons --------------------------------------------------------
// Tier 1 gets drawn icons (landmarks/icons/*.svg, rasterised here at 2x so they
// stay crisp on a phone); tier 2 borrows the basemap sprite, which is what
// "generic" means. The map never asks the network for an icon it hasn't got.
const DRAWN = ['amusement', 'beach', 'bridge', 'castle', 'church', 'concert',
  'park', 'shopping', 'square', 'stadium', 'station', 'tower'];

// icon id in landmarks.json → sprite id in the OSM Liberty sprite sheet.
const SPRITE_FOR = {
  bath: 'swimming_11', beach: 'beach_11', castle: 'castle_11', church: 'religious_christian_11',
  library: 'library_11', market: 'grocery_11', mosque: 'religious_muslim_11', museum: 'museum_11',
  nature: 'garden_11', park: 'park_11', quarry: 'mountain_11', shopping: 'shop_11',
  square: 'square_stroked_11', stadium: 'stadium_11', station: 'railway_11',
  synagogue: 'religious_jewish_11', theatre: 'theatre_11', university: 'college_11',
};
const SPRITE_FALLBACK = 'circle_stroked_11';

async function loadDrawnIcons(map) {
  await Promise.all(DRAWN.map(async (id) => {
    const url = `/landmark-icons/${id}.svg`;
    const img = new Image(48, 48);
    img.src = url;
    try {
      await img.decode();
    } catch {
      console.warn(`landmark icon missing: ${url}`);
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 48;
    canvas.getContext('2d').drawImage(img, 0, 0, 48, 48);
    map.addImage(`lm-${id}`, canvas.getContext('2d').getImageData(0, 0, 48, 48), { pixelRatio: 2 });
  }));
}

// A landmark's icon is drawn if we drew one, otherwise the sprite equivalent,
// otherwise a plain circle — resolved once, as a match expression.
function iconExpression() {
  const cases = [];
  for (const id of new Set([...DRAWN, ...Object.keys(SPRITE_FOR)])) {
    cases.push(id, DRAWN.includes(id) ? `lm-${id}` : SPRITE_FOR[id]);
  }
  return ['match', ['get', 'icon'], ...cases, SPRITE_FALLBACK];
}

// ---- districts -------------------------------------------------------------
// The delområde names — Erikslust, Slottsstaden, Gamla Staden — are how people
// actually say where something is, so they are the labels this map is for.
//
// The zoom ladder that decides which of them you see lives in area-levels.mjs,
// on its own, because three files depend on it. Everything below is the data
// side of it: loading the sources those layers name, and turning polygons into
// the label points the symbol layers want.

// Outer rings of a (Multi)Polygon, each with its shoelace area. Longitude is
// scaled by latitude so the areas compare as ground area rather than degrees²;
// they are only ever used to rank and to pick a part, never reported.
function outerRings(feature) {
  const rings = feature.geometry.type === 'MultiPolygon'
    ? feature.geometry.coordinates.map((p) => p[0])
    : [feature.geometry.coordinates[0]];
  const k = Math.cos(55.6 * Math.PI / 180);
  return rings.map((ring) => {
    let sum = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
    }
    return { ring, area: Math.abs(sum) / 2 * k };
  });
}

// A district is one place with one name, but several polygons — Västra Hamnen
// is cut into four by the docks. Left as polygons, MapLibre labels every part,
// so the name appears four times. Labels therefore come from a separate point
// layer: one point per district, in its largest part.
//
// The point is that part's centroid, which for a horseshoe-shaped district can
// land just outside it. Rare here, and visibly wrong rather than subtly wrong.
function districtLabelPoints(features) {
  return features.map((f) => {
    const biggest = outerRings(f).sort((a, b) => b.area - a.area)[0].ring;
    let x = 0;
    let y = 0;
    let a = 0;
    for (let i = 0, j = biggest.length - 1; i < biggest.length; j = i++) {
      const cross = biggest[j][0] * biggest[i][1] - biggest[i][0] * biggest[j][1];
      a += cross;
      x += (biggest[j][0] + biggest[i][0]) * cross;
      y += (biggest[j][1] + biggest[i][1]) * cross;
    }
    const point = a === 0 ? biggest[0] : [x / (3 * a), y / (3 * a)];
    return { type: 'Feature', geometry: { type: 'Point', coordinates: point }, properties: f.properties };
  });
}

function districtLabels(geojson) {
  const al10 = geojson.features.filter((f) => f.properties.admin_level === 10);
  const al9 = geojson.features.filter((f) => f.properties.admin_level === 9);
  // Rank 0 = largest. Used as the collision sort key, nothing else.
  al10
    .map((f) => ({ f, area: outerRings(f).reduce((s, r) => s + r.area, 0) }))
    .sort((a, b) => b.area - a.area)
    .forEach(({ f }, i) => { f.properties.rank = i; });
  for (const f of al9) f.properties.rank = 0;
  return { type: 'FeatureCollection', features: districtLabelPoints([...al9, ...al10]) };
}

// ---- categories --------------------------------------------------------------
// Every pin on this map belongs to a category, and every category is off until
// asked for — the table, the colours and the reasons live in categories.mjs.
// What lives here is the plumbing: which layer ids belong to which category,
// and flipping them.
//
// The three shapes a category can take (basemap POIs by class, a GeoJSON file
// of our own, layers style.json already draws) all end up in the same registry,
// so the chip row does not have to know which is which.
const categoryLayerIds = new Map(CATEGORIES.map((c) => [c.id, []]));
const on = new Set(DEFAULT_ON);

const register = (catId, ...ids) => categoryLayerIds.get(catId).push(...ids);

/** Turn a category on or off. The one thing the chip row does. */
export function setCategoryVisible(map, catId, visible) {
  if (visible) on.add(catId); else on.delete(catId);
  for (const id of categoryLayerIds.get(catId) ?? []) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  }
}

export const isCategoryOn = (catId) => on.has(catId);

/**
 * Put back what was on last time, before any layer exists — so a restored
 * category is drawn visible rather than added hidden and then flipped, which
 * would show as a flash of the wrong map on every load.
 */
export function restoreCategories(ids) {
  on.clear();
  for (const cat of CATEGORIES) if (ids.includes(cat.id)) on.add(cat.id);
}

// ---- assembly --------------------------------------------------------------
export async function addDataLayers(map) {
  const [districts, landmarks, stadsdelar, neighbourhoods, kommun] = await Promise.all([
    fetch(`${DATA}/districts.geojson`).then((r) => r.json()),
    fetch(`${DATA}/landmarks.geojson`).then((r) => r.json()),
    fetch(`${DATA}/stadsdelar.geojson`).then((r) => r.json()),
    fetch(`${DATA}/neighbourhoods.geojson`).then((r) => r.json()),
    fetch(`${DATA}/kommun.geojson`).then((r) => r.json()),
    loadDrawnIcons(map),
  ]);

  // Boundaries and names are two sources on purpose — see districtLabels().
  map.addSource('district-labels', { type: 'geojson', data: districtLabels(districts) });
  // Selecting a district draws its real outline, so the highlight needs the
  // polygons as they came off disk, before the map cuts them into tiles.
  setDistrictFeatures(districts.features);
  setStadsdelar(stadsdelar.features);
  setNeighbourhoods(neighbourhoods.features);
  map.addSource('stadsdelar', {
    type: 'geojson',
    data: stadsdelar,
    // CC0, so no obligation — credited because the shapes exist nowhere else.
    attribution: 'Stadsdelar © <a href="https://opendata.malmo.se/" target="_blank" rel="noopener">Malmö stad</a> (CC0)',
  });
  map.addSource('stadsdel-labels', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: districtLabelPoints(stadsdelar.features) },
  });
  map.addSource('districts', { type: 'geojson', data: districts });
  map.addSource('kommun', { type: 'geojson', data: kommun });
  map.addSource('neighbourhoods', { type: 'geojson', data: neighbourhoods });
  // A grouping's geometry is its outline, so its name needs a point of its own —
  // computed at build time (labelPointFor) and carried as a property, because
  // labelling a MultiLineString would run the name along the boundary.
  map.addSource('neighbourhood-labels', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: neighbourhoods.features.map((f) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: f.properties.label },
        properties: f.properties,
      })),
    },
  });
  map.addSource('landmarks', { type: 'geojson', data: landmarks });
  for (const cat of CATEGORIES) {
    if (cat.geojson && cat.geojson !== 'landmarks') {
      map.addSource(cat.geojson, { type: 'geojson', data: `${DATA}/${cat.geojson}.geojson` });
    }
  }

  // The whole ladder, in two passes, because the selection wash belongs between
  // them: above the outlines and the roads it covers, below every label, so
  // highlighting a street never hides the street's name.
  //
  // (The five stadsområden in districts.geojson are not drawn at any level:
  // Norr/Söder/Väster/Öster is a division nobody ever said out loud, and a
  // fifth level would only blur the four that mean something.)
  const ladder = areaLayers({ notADistrict: notADistrictFilter(districts, neighbourhoods) });
  for (const layer of ladder) if (layer.metadata.role === 'outline') map.addLayer(layer);
  addHighlightLayers(map);
  for (const layer of ladder) if (layer.metadata.role === 'name') map.addLayer(layer);

  addCategoryLayers(map);

  // Landmarks sit above every other category: they are the fixed points you
  // navigate your mental map by, and they should never be hidden by a café dot.
  const landmarksOn = on.has('landmarks');
  const icon = iconExpression();
  for (const zoom of [...new Set(landmarks.features.map((f) => f.properties.min_zoom))].sort((a, b) => a - b)) {
    const id = `landmark-${zoom}`;
    register('landmarks', id);
    map.addLayer({
      id,
      type: 'symbol',
      source: 'landmarks',
      filter: ['==', ['get', 'min_zoom'], zoom],
      minzoom: zoom,
      metadata: { category: 'landmarks' },
      layout: {
        visibility: landmarksOn ? 'visible' : 'none',
        'icon-image': icon,
        'icon-size': ['interpolate', ['linear'], ['zoom'], zoom, 0.8, zoom + 3, 1],
        'icon-allow-overlap': false,
        'text-field': ['get', 'name'],
        'text-font': ['Roboto Medium'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 12, 11, 16, 13],
        'text-anchor': 'top',
        'text-offset': [0, 0.9],
        'text-max-width': 9,
        'text-optional': true,
      },
      paint: {
        'text-color': '#3a332a',
        'text-halo-color': 'rgba(255,255,255,0.95)',
        'text-halo-width': 1.6,
        // Icons carry the shape at low zoom; names arrive when there is room.
        'text-opacity': ['interpolate', ['linear'], ['zoom'], Math.max(zoom, 12.5), 0, Math.max(zoom, 12.5) + 0.6, 1],
      },
    });
  }
}

// The one runtime input to the ladder: which OSM place names are *not* already
// one of ours.
//
// The basemap carries place=suburb nodes for names the administrative division
// missed, and they are worth having — but "Gamla staden" the suburb node and
// "Gamla Staden" the delområde are the same place written twice, and only one
// of them should be on screen. So the level-4 suburb layer is filtered against
// everything this map draws from its own data: the 136 delområden, the curated
// grouping names, and the stadsdelar including their first part, so the OSM
// "Limhamn" node doesn't sit next to the "Limhamn-Bunkeflo" boundary saying the
// same thing twice.
function notADistrictFilter(districts, neighbourhoods) {
  const known = [...new Set([
    ...districts.features.map((f) => f.properties.name),
    ...neighbourhoods.features.map((f) => f.properties.name),
    ...stadsdelNames().flatMap((n) => [n, n.split('-')[0]]),
  ].map((n) => n.toLowerCase()))];
  return ['!', ['in', ['downcase', ['get', 'name']], ['literal', known]]];
}

// Every category's own layers, plus the one category that has none of its own:
// "Bilvägar" is the basemap's road layers, found by rule rather than listed, so
// the registry can flip them like anything else.
function addCategoryLayers(map) {
  for (const cat of CATEGORIES) {
    if (cat.basemap) {
      const ids = map.getStyle().layers.map((l) => l.id).filter(isCarRoadLayer);
      register(cat.id, ...ids);
      // The style ships them visible, so only the unusual case needs applying.
      if (!on.has(cat.id)) setCategoryVisible(map, cat.id, false);
      continue;
    }
    for (const layer of categoryLayers({ ...cat, on: on.has(cat.id) })) {
      register(cat.id, layer.id);
      map.addLayer(layer);
    }
  }
}

// ---- selection -------------------------------------------------------------
// The app's own layers, which win any tie against the basemap beneath them.
// Only what is actually on screen is tappable: a category you turned off is not
// a hidden answer waiting to be found. The names count as well as the dots —
// a café's label is a bigger target than its 5 px circle, and both answer with
// the same card.
function appLayerIds(map) {
  const drawn = [...on].flatMap((id) => categoryLayerIds.get(id) ?? [])
    .filter((id) => id.startsWith('landmark-') || /-(dot|line|label)$/.test(id));
  return map.getStyle().layers.map((l) => l.id)
    .filter((id) => drawn.includes(id)
      || id.startsWith('district-label') || id.startsWith('area-label'));
}

export function onFeatureClick(map, show) {
  map.on('click', (e) => {
    const hit = pickFeature(map, e, appLayerIds(map));
    if (!hit) { clearHighlight(map); return; }
    e._handled = true;
    highlight(map, hit);
    show(describeHit(hit));
  });

  // Pointer feedback for the app's own icons only: working out whether the
  // cursor is over a nameable basemap feature means querying the name layer,
  // which is too much work to redo on every mouse move.
  map.on('mousemove', (e) => {
    const hits = map.queryRenderedFeatures(e.point, { layers: appLayerIds(map) });
    map.getCanvas().style.cursor = hits.length ? 'pointer' : '';
  });
}
