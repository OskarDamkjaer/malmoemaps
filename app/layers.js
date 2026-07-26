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
// 136 delområden all at once is wallpaper; five stadsområden is not a map of
// anywhere. So the big ones come first and the rest fill in as you zoom.
// Polygon area stands in for prominence — a stopgap: it puts Hyllievång ahead
// of Möllevången, which is wrong about Malmö but right about the geometry, and
// it is a hand-picked list away from being right about both.
const DISTRICT_STEPS = [
  { zoom: 11, share: 0.15, size: 12 },
  { zoom: 12.5, share: 0.45, size: 11.5 },
  { zoom: 13.5, share: 1, size: 11 },
];

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
  const ranked = al10
    .map((f) => ({ f, area: outerRings(f).reduce((s, r) => s + r.area, 0) }))
    .sort((a, b) => b.area - a.area);
  ranked.forEach(({ f }, i) => {
    const share = (i + 1) / ranked.length;
    f.properties.labelz = DISTRICT_STEPS.find((s) => share <= s.share).zoom;
  });
  for (const f of al9) f.properties.labelz = 10;
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
  const [districts, landmarks] = await Promise.all([
    fetch(`${DATA}/districts.geojson`).then((r) => r.json()),
    fetch(`${DATA}/landmarks.geojson`).then((r) => r.json()),
    loadDrawnIcons(map),
  ]);

  // Boundaries and names are two sources on purpose — see districtLabels().
  map.addSource('district-labels', { type: 'geojson', data: districtLabels(districts) });
  map.addSource('districts', { type: 'geojson', data: districts });
  map.addSource('landmarks', { type: 'geojson', data: landmarks });

  // Boundaries stay a whisper: they explain the labels, they are not the map.
  map.addLayer({
    id: 'district-line',
    type: 'line',
    source: 'districts',
    filter: ['==', ['get', 'admin_level'], 10],
    minzoom: 12,
    paint: {
      'line-color': '#a89880',
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 16, 1],
      'line-opacity': 0.5,
      'line-dasharray': [3, 2],
    },
  });

  // Stadsområde first, then delområden in three waves (see DISTRICT_STEPS).
  map.addLayer({
    id: 'district-label-area',
    type: 'symbol',
    source: 'district-labels',
    filter: ['==', ['get', 'admin_level'], 9],
    minzoom: 10,
    maxzoom: 12,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Roboto Medium'],
      'text-size': 13,
      'text-letter-spacing': 0.18,
      'text-transform': 'uppercase',
      'text-max-width': 8,
    },
    paint: {
      'text-color': '#7c705f',
      'text-halo-color': 'rgba(248,244,240,0.9)',
      'text-halo-width': 1.4,
      'text-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.9, 11.6, 0.9, 12, 0],
    },
  });

  for (const step of DISTRICT_STEPS) {
    map.addLayer({
      id: `district-label-${step.zoom}`,
      type: 'symbol',
      source: 'district-labels',
      filter: ['all', ['==', ['get', 'admin_level'], 10], ['==', ['get', 'labelz'], step.zoom]],
      minzoom: step.zoom,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Roboto Medium'],
        'text-size': step.size,
        'text-letter-spacing': 0.08,
        'text-max-width': 9,
        'text-padding': 6,
      },
      paint: {
        'text-color': '#6b6153',
        'text-halo-color': 'rgba(248,244,240,0.92)',
        'text-halo-width': 1.4,
      },
    });
  }

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
const KIND_LABEL = {
  restaurant: 'Restaurang', cafe: 'Café', bar: 'Bar', pub: 'Pub', fast_food: 'Snabbmat',
  ice_cream: 'Glass', museum: 'Museum', gallery: 'Galleri', artwork: 'Konstverk',
  theatre: 'Teater', arts_centre: 'Kulturhus', memorial: 'Minnesmärke', station: 'Station',
  tram_stop: 'Spårvagn', cycleway: 'Cykelväg', path: 'Cykelstråk', footway: 'Cykelstråk',
};

function describe(feature) {
  const p = feature.properties;
  const layer = feature.layer.id;
  if (layer.startsWith('landmark-')) {
    return {
      name: p.name,
      meta: [p.tier === 1 ? 'Landmärke' : 'Sevärdhet', p.district].filter(Boolean).join(' · '),
      description: p.description,
    };
  }
  if (layer.startsWith('district-label')) {
    return { name: p.name, meta: p.admin_level === 9 ? 'Stadsområde' : 'Delområde' };
  }
  const overlay = overlays.find((o) => layer.startsWith(`${o.id}-`));
  const kind = p.kind ?? p.amenity;
  return {
    name: p.name || KIND_LABEL[kind] || overlay?.label || 'Plats',
    meta: [overlay?.label, p.name ? KIND_LABEL[kind] ?? kind : null].filter(Boolean).join(' · '),
  };
}

export function onFeatureClick(map, show) {
  map.on('click', (e) => {
    // Only our own layers are clickable — the basemap is scenery, and tapping a
    // random building should do nothing at all.
    const ids = [
      ...map.getStyle().layers.map((l) => l.id).filter((id) => id.startsWith('landmark-')
        || id.startsWith('district-label')
        || overlays.some((o) => o.visible && (id === `${o.id}-dot` || id === `${o.id}-line`))),
    ];
    const hits = map.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], { layers: ids });
    if (!hits.length) return;
    e._handled = true;
    show(describe(hits[0]));
  });

  map.on('mousemove', (e) => {
    const hits = map.queryRenderedFeatures(e.point).filter((f) => f.layer.id.startsWith('landmark-'));
    map.getCanvas().style.cursor = hits.length ? 'pointer' : '';
  });
}
