// Everything drawn on top of the basemap: districts, landmarks, overlays.
//
// These four files are the parts of the map that are mine rather than
// OpenStreetMap's rendering conventions — a hand-curated landmark list, the
// city's own administrative division, and four subject overlays that are off
// until asked for. They are GeoJSON rather than tiles because all four together
// are under 2 MB, which is cheaper to ship whole than to tile.
//
// One rule shows up repeatedly below: *zoom is compared to a per-feature
// property by splitting into buckets, not by an expression.* MapLibre will not
// compare ["zoom"] against ["get", …] in a filter, so a landmark that should
// appear at z12 lives in the z12 layer. Hence the small layer factories.

import {
  addHighlightLayers, clearHighlight, describeHit, highlight, pickFeature,
  setDistrictFeatures, setStadsdelar, stadsdelNames,
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
// The delområde names — Erikslust, Slottstaden, Gamla Staden — are how people
// actually say where something is, so they are the labels this map is for.
//
// The zoom ladder is a hierarchy, one level at a time — this is the part of the
// map meant to teach you how Malmö is put together:
//
//   z < 11        Malmö. Just the city.
//   z 11 – 12.8   the ten stadsdelar, all of them, whatever their size
//   z ≥ 12.8      the 136 delområden, all of them, and their boundaries
//
// The handover is a hard cut at TIER_SWITCH rather than a fade or a
// size-ranked dissolve: a level you can see half of is a level you can't learn.
// Two earlier attempts failed this — zoom buckets by polygon area buried the
// small central districts, and letting both levels compete on collision made
// which level you were looking at a matter of where you happened to be.
const TIER_SWITCH = 12.8;
const STADSDEL_MINZOOM = 11;

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

// ---- overlays --------------------------------------------------------------
// Off by default, one colour each, and no attempt to be a directory: the point
// is "where are the cafés, roughly", not which one is open.
export const overlays = [
  { id: 'food', label: 'Mat & dryck', color: '#b8562b', kind: 'point' },
  { id: 'culture', label: 'Kultur', color: '#7a4f9c', kind: 'point' },
  { id: 'cycling', label: 'Cykelvägar', color: '#1f6f5c', kind: 'line' },
  { id: 'transit', label: 'Tågstationer', color: '#1d5f8a', kind: 'point' },
].map((o) => ({
  ...o,
  visible: false,
  layers: o.kind === 'point' ? [`${o.id}-dot`, `${o.id}-label`] : [`${o.id}-line`],
  setVisible(map, on) {
    this.visible = on;
    for (const id of this.layers) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    }
  },
}));

const OVERLAY_MINZOOM = { food: 14, culture: 13, cycling: 12, transit: 11 };

// ---- assembly --------------------------------------------------------------
export async function addDataLayers(map) {
  const [districts, landmarks, stadsdelar] = await Promise.all([
    fetch(`${DATA}/districts.geojson`).then((r) => r.json()),
    fetch(`${DATA}/landmarks.geojson`).then((r) => r.json()),
    fetch(`${DATA}/stadsdelar.geojson`).then((r) => r.json()),
    loadDrawnIcons(map),
  ]);

  // Boundaries and names are two sources on purpose — see districtLabels().
  map.addSource('district-labels', { type: 'geojson', data: districtLabels(districts) });
  // Selecting a district draws its real outline, so the highlight needs the
  // polygons as they came off disk, before the map cuts them into tiles.
  setDistrictFeatures(districts.features);
  setStadsdelar(stadsdelar.features);
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
  map.addSource('landmarks', { type: 'geojson', data: landmarks });

  // Level 3's boundaries, starting exactly where level 2's stop.
  map.addLayer({
    id: 'district-line',
    type: 'line',
    source: 'districts',
    filter: ['==', ['get', 'admin_level'], 10],
    minzoom: TIER_SWITCH,
    paint: {
      'line-color': '#a89880',
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 16, 1],
      'line-opacity': 0.5,
      'line-dasharray': [3, 2],
    },
  });

  // The selection wash goes here, above the roads it covers and below every
  // label, so highlighting a street never hides the street's name.
  addHighlightLayers(map);

  // (The five stadsområden in districts.geojson are not drawn at all:
  // Norr/Söder/Väster/Öster is a division nobody ever said out loud, and a
  // fourth level would only blur the three that mean something.)
  // Level 2: the stadsdelar, with their boundaries, and nothing finer.
  map.addLayer({
    id: 'stadsdel-line',
    type: 'line',
    source: 'stadsdelar',
    minzoom: STADSDEL_MINZOOM,
    maxzoom: TIER_SWITCH,
    paint: {
      'line-color': '#a89880',
      'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.9, 12.8, 1.6],
      'line-opacity': 0.55,
    },
  });

  map.addLayer({
    id: 'area-label-stadsdel',
    type: 'symbol',
    source: 'stadsdel-labels',
    minzoom: STADSDEL_MINZOOM,
    maxzoom: TIER_SWITCH,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Roboto Medium'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 11, 12, 12.8, 14],
      'text-letter-spacing': 0.18,
      'text-transform': 'uppercase',
      'text-max-width': 8,
      // All ten, always: at this zoom they are what the map is saying.
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: {
      'text-color': '#7c705f',
      'text-halo-color': 'rgba(248,244,240,0.9)',
      'text-halo-width': 1.6,
    },
  });

  map.addLayer({
    id: 'district-label',
    type: 'symbol',
    source: 'district-labels',
    filter: ['==', ['get', 'admin_level'], 10],
    minzoom: TIER_SWITCH,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Roboto Medium'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 12.8, 11.5, 15, 12.5, 17, 13.5],
      'text-letter-spacing': 0.08,
      'text-max-width': 9,
      // Small padding, and area only as a tiebreak: at this zoom perhaps a
      // dozen districts are on screen, so nearly all of them get placed, and
      // the ones that don't are genuinely on top of each other.
      'text-padding': 3,
      'symbol-sort-key': ['get', 'rank'],
    },
    paint: {
      'text-color': '#5f574a',
      'text-halo-color': 'rgba(248,244,240,0.92)',
      'text-halo-width': 1.5,
    },
  });

  addAreaNameLayers(map, districts);
  addOverlayLayers(map);

  // Landmarks sit above the overlays: they are the fixed points you navigate
  // your mental map by, and they should never be hidden by a café dot.
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

// The names people use that the administrative division doesn't have.
//
// Slottsstaden, Limhamn, Kirseberg, Hyllie, Rosengård — these are how the city
// is talked about, and several of them are not delområden at all; they live in
// OSM as place=suburb nodes, in the basemap tiles. They are drawn here rather
// than in the style so that every area name on this map is styled in one place
// and can be filtered against the districts, which is the whole difficulty:
// "Gamla staden" the suburb node and "Gamla Staden" the delområde are the same
// place written twice, and only one of them should be on screen.
function addAreaNameLayers(map, districts) {
  // Anything already drawn as an area: the 136 delområden, and the stadsdelar
  // including their first part, so the "Limhamn" node doesn't sit next to the
  // "Limhamn-Bunkeflo" boundary saying the same thing twice.
  const known = [...new Set([
    ...districts.features.map((f) => f.properties.name),
    ...stadsdelNames().flatMap((n) => [n, n.split('-')[0]]),
  ].map((n) => n.toLowerCase()))];
  const notADistrict = ['!', ['in', ['downcase', ['get', 'name']], ['literal', known]]];

  const style = (size) => ({
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Roboto Medium'],
      'text-size': size,
      'text-letter-spacing': 0.08,
      'text-max-width': 9,
      'text-padding': 7,
    },
    paint: {
      'text-color': '#5f574a',
      'text-halo-color': 'rgba(248,244,240,0.92)',
      'text-halo-width': 1.5,
    },
  });

  // These belong to level 3: they are the same grain as a delområde — a part of
  // town you'd walk across — so they arrive with the delområden, not before.
  map.addLayer({
    id: 'area-label-suburb',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'place',
    filter: ['all', ['==', ['get', 'class'], 'suburb'], notADistrict],
    minzoom: TIER_SWITCH,
    ...style(['interpolate', ['linear'], ['zoom'], 12.8, 11.5, 15, 12.5, 17, 13.5]),
  });

  map.addLayer({
    id: 'area-label-neighbourhood',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'place',
    filter: ['all', ['in', ['get', 'class'], ['literal', ['neighbourhood', 'quarter', 'islet', 'island']]], notADistrict],
    minzoom: 13.5,
    ...style(['interpolate', ['linear'], ['zoom'], 13.5, 10.5, 17, 12.5]),
  });
}

function addOverlayLayers(map) {
  for (const o of overlays) {
    map.addSource(o.id, { type: 'geojson', data: `${DATA}/${o.id}.geojson` });
    const minzoom = OVERLAY_MINZOOM[o.id];
    const hidden = { visibility: 'none' };

    if (o.kind === 'line') {
      map.addLayer({
        id: `${o.id}-line`,
        type: 'line',
        source: o.id,
        minzoom,
        layout: { ...hidden, 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': o.color,
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 16, 2.6],
          'line-opacity': 0.75,
        },
      });
      continue;
    }

    map.addLayer({
      id: `${o.id}-dot`,
      type: 'circle',
      source: o.id,
      minzoom,
      layout: hidden,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], minzoom, 2.6, 17, 5.5],
        'circle-color': o.color,
        'circle-opacity': 0.85,
        'circle-stroke-color': '#fffefc',
        'circle-stroke-width': 1,
      },
    });
    map.addLayer({
      id: `${o.id}-label`,
      type: 'symbol',
      source: o.id,
      minzoom: o.id === 'transit' ? minzoom : 16,
      filter: ['has', 'name'],
      layout: {
        ...hidden,
        'text-field': ['get', 'name'],
        'text-font': ['Roboto Regular'],
        'text-size': 11,
        'text-anchor': 'left',
        'text-offset': [0.7, 0],
        'text-max-width': 10,
        'text-optional': true,
      },
      paint: {
        'text-color': o.color,
        'text-halo-color': 'rgba(255,255,255,0.95)',
        'text-halo-width': 1.5,
      },
    });
  }
}

// ---- selection -------------------------------------------------------------
// The app's own layers, which win any tie against the basemap beneath them.
function appLayerIds(map) {
  return map.getStyle().layers.map((l) => l.id).filter((id) => id.startsWith('landmark-')
    || id.startsWith('district-label') || id.startsWith('area-label')
    || overlays.some((o) => o.visible && (id === `${o.id}-dot` || id === `${o.id}-line`)));
}

export function onFeatureClick(map, show) {
  map.on('click', (e) => {
    const hit = pickFeature(map, e, appLayerIds(map));
    if (!hit) { clearHighlight(map); return; }
    e._handled = true;
    highlight(map, hit);
    show(describeHit(hit, overlays));
  });

  // Pointer feedback for the app's own icons only: working out whether the
  // cursor is over a nameable basemap feature means querying the name layer,
  // which is too much work to redo on every mouse move.
  map.on('mousemove', (e) => {
    const hits = map.queryRenderedFeatures(e.point, { layers: appLayerIds(map) });
    map.getCanvas().style.cursor = hits.length ? 'pointer' : '';
  });
}
