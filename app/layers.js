// Everything drawn on top of the basemap: districts and landmarks.
//
// These files are the parts of the map that are mine rather than
// OpenStreetMap's rendering conventions — a hand-curated landmark list and the
// city's own administrative division. They are GeoJSON rather than tiles
// because together they are under 2 MB, which is cheaper to ship whole than to
// tile.
//
// There is nothing here to turn on or off. Everything this file adds is drawn
// from the moment the map loads, which is why it is a short file: what used to
// be a menu of fourteen kinds of pin is now the landmark list and the area
// names, and both are the map's own voice rather than an overlay on it.
//
// One rule shows up repeatedly below: *zoom is compared to a per-feature
// property by splitting into buckets, not by an expression.* MapLibre will not
// compare ["zoom"] against ["get", …] in a filter, so a landmark that should
// appear at z12 lives in the z12 layer. Hence the small layer factories.

import { areaLayers } from './area-levels.mjs';
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

// ---- what the app draws ----------------------------------------------------
// Every name layer the ladder produces, collected as the ladder is added rather
// than listed here, because a list would be area-levels.mjs written down twice.
// They are all always drawn, so they are all always tappable.
const ladderLabels = [];

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
  // The finest rung of the ladder (Gamla Väster, Erikslust, Seved) is a file of
  // its own; the layer that draws it belongs to area-levels.mjs, the source to
  // here, like every other source on this map.
  map.addSource('parts', { type: 'geojson', data: `${DATA}/parts.geojson` });

  // The whole ladder, in two passes, because the selection wash belongs between
  // them: above the outlines and the roads it covers, below every label, so
  // highlighting a street never hides the street's name.
  //
  // (The five stadsområden in districts.geojson are not drawn at any level:
  // Norr/Söder/Väster/Öster is a division nobody ever said out loud, and a
  // fifth level would only blur the four that mean something.)
  const ladder = areaLayers({
    notADistrict: notADistrictFilter(districts, neighbourhoods),
    notGrouped: notGroupedFilter(neighbourhoods),
  });
  for (const layer of ladder) if (layer.metadata.role === 'outline') map.addLayer(layer);
  addHighlightLayers(map);
  for (const layer of ladder) {
    if (layer.metadata.role !== 'name') continue;
    map.addLayer(layer);
    ladderLabels.push(layer.id);
  }

  // Landmarks sit above everything else: they are the fixed points you navigate
  // your mental map by, and nothing on this map should be allowed to cover them.
  const icon = iconExpression();
  for (const zoom of [...new Set(landmarks.features.map((f) => f.properties.min_zoom))].sort((a, b) => a - b)) {
    map.addLayer({
      id: `landmark-${zoom}`,
      type: 'symbol',
      source: 'landmarks',
      filter: ['==', ['get', 'min_zoom'], zoom],
      minzoom: zoom,
      layout: {
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
// The other runtime input: which delområden have no name above them, and so are
// elevated to level 3 under their own.
//
// Read off the curated features rather than kept as a second list, because
// `covers` is already the answer — a delområde is grouped exactly when some
// grouping names it, partial members included. They are drawn whole into their
// grouping, so they must not also be drawn beside it.
function notGroupedFilter(neighbourhoods) {
  const grouped = [...new Set(neighbourhoods.features.flatMap((f) => f.properties.covers ?? []))];
  return ['!', ['in', ['get', 'name'], ['literal', grouped]]];
}

function notADistrictFilter(districts, neighbourhoods) {
  const known = [...new Set([
    ...districts.features.map((f) => f.properties.name),
    ...neighbourhoods.features.map((f) => f.properties.name),
    ...stadsdelNames().flatMap((n) => [n, n.split('-')[0]]),
  ].map((n) => n.toLowerCase()))];
  return ['!', ['in', ['downcase', ['get', 'name']], ['literal', known]]];
}

// ---- selection -------------------------------------------------------------
// The app's own layers, which win any tie against the basemap beneath them: the
// landmark icons and every name the ladder draws. Asked of the live style
// rather than assembled from a list, so a layer that failed to be added is not
// a target that answers with nothing.
function appLayerIds(map) {
  const drawn = new Set(ladderLabels);
  return map.getStyle().layers
    .map((l) => l.id)
    .filter((id) => drawn.has(id) || id.startsWith('landmark-'));
}

// `busy` is the quiz saying "this tap is mine". Selection is the study map's
// reason to exist and the one thing a round cannot allow: tapping the map to be
// told what is under your finger is the answer to the question you are being
// asked.
export function onFeatureClick(map, show, busy = () => false) {
  map.on('click', (e) => {
    if (busy()) return;
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
    if (busy()) return;
    const hits = map.queryRenderedFeatures(e.point, { layers: appLayerIds(map) });
    map.getCanvas().style.cursor = hits.length ? 'pointer' : '';
  });
}
