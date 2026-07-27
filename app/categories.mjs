// The layer menu: everything the map draws only when you ask for it.
//
// The map opens with no pins at all — not a café, not a landmark. Every
// point-shaped thing on this map belongs to a category here, and a category is
// off until it is tacked on from the chip row along the bottom of the screen.
// One category starts on: the road network, because a reference map you cannot
// find a street on is not one.
//
// Three kinds of source, and the choice is always "what does this best":
//
//   poi      the basemap's own `poi` layer, filtered by OpenMapTiles `class`.
//            4 227 POIs are already inside the pmtiles archive on disk, so a
//            category costs one filter — no extra fetch, no extra build step,
//            and it works offline like everything else. They exist from z14.
//   geojson  the three things the tiles do worse: the curated landmark list,
//            the rail stations (wanted from z11, but tiles carry no POI below
//            z14) and the cycle network (lines, including named routes the
//            tiles don't have at all).
//   basemap  layers style.json already draws; the category only flips them.
//
// The class → category table was written against what is actually in the
// tileset rather than against the OpenMapTiles schema: `scripts/poi-inventory.mjs`
// prints every class and subclass in the archive with counts, and
// `test/categories.test.mjs` fails if a class is claimed by two categories or
// by none without a reason in UNCLAIMED. Reading the schema instead would have
// given "bakery" a category of its own and missed that plain `shop` is 536
// places — an eighth of every POI in Malmö.

/** POIs are in the tiles from z14; nothing a category does can conjure them earlier. */
export const POI_MINZOOM = 14;
/** Names arrive a zoom and a half later, when there is room for them. */
const POI_LABEL_MINZOOM = 15.5;

// One colour per category, carried by the chip, the dot and the name, so the
// answer to "which of these did I turn on?" is never in doubt.
export const CATEGORIES = [
  {
    id: 'food',
    label: 'Mat',
    color: '#b8562b',
    poi: ['restaurant', 'fast_food', 'cafe', 'bakery', 'ice_cream'],
  },
  {
    id: 'bars',
    label: 'Barer',
    color: '#8c4a6b',
    // `beer` is OpenMapTiles for pub and biergarten; `bar` swallows nightclub.
    poi: ['bar', 'beer', 'alcohol_shop'],
  },
  {
    id: 'culture',
    label: 'Kultur',
    color: '#7a4f9c',
    poi: ['museum', 'art_gallery', 'theatre', 'cinema', 'library', 'monument',
      'castle', 'attraction', 'zoo', 'aquarium', 'theme_park'],
  },
  {
    id: 'landmarks',
    label: 'Landmärken',
    // Ink, not a hue: the curated list is the map's own voice, and it keeps its
    // drawn icons rather than becoming another coloured dot.
    color: '#3a332a',
    geojson: 'landmarks',
  },
  {
    id: 'parks',
    label: 'Parker',
    color: '#4a7a2b',
    // Green *space*, not green colour: the park polygons underneath are part of
    // the basemap and stay whatever you do here. This is the named ones.
    poi: ['park', 'garden', 'playground', 'dog_park', 'picnic_site'],
  },
  {
    id: 'sport',
    label: 'Sport & bad',
    color: '#2b6f8f',
    // The long tail is one unnamed pitch each — orienteering, billiards, yoga —
    // and claiming them costs a word, while leaving them out means the map can
    // never draw them at all.
    poi: ['sports_centre', 'pitch', 'stadium', 'swimming', 'swimming_pool',
      'water_park', 'golf', 'climbing', 'equestrian', 'horse_racing', 'cycling',
      'multi', 'ice_rink', 'athletics', 'running', 'skateboard', 'shooting',
      'bmx', 'karting', 'sailing', 'orienteering', 'billiards', 'yoga'],
  },
  {
    id: 'shops',
    label: 'Butiker',
    color: '#a07a1f',
    poi: ['shop', 'grocery', 'clothing_store', 'butcher', 'hairdresser',
      'bicycle', 'music', 'laundry'],
  },
  {
    id: 'care',
    label: 'Vård',
    color: '#b0453f',
    poi: ['hospital', 'doctors', 'dentist', 'pharmacy', 'veterinary'],
  },
  {
    id: 'civic',
    label: 'Samhälle',
    color: '#5a6472',
    poi: ['school', 'college', 'town_hall', 'police', 'fire_station', 'post',
      'bank', 'atm', 'place_of_worship', 'prison'],
  },
  {
    id: 'lodging',
    label: 'Hotell',
    color: '#8a5a3c',
    poi: ['lodging', 'campsite'],
  },
  {
    id: 'car',
    label: 'Bil & parkering',
    color: '#6f6a60',
    // `fuel` is mostly charging stations here (81 of 111), which is Malmö.
    poi: ['fuel', 'parking', 'car', 'motorcycle_parking'],
  },
  {
    id: 'transit',
    label: 'Kollektivtrafik',
    color: '#1d5f8a',
    // Rail only, and from z11: a station is orientation at city scale, which is
    // exactly where the tiles have no POIs. See DECISIONS on the bus stops.
    geojson: 'transit',
    minzoom: 11,
  },
  {
    id: 'cycling',
    label: 'Cykel',
    color: '#1f6f5c',
    // The one category that is lines *and* pins: the network from GeoJSON
    // (named routes included), the places you get a bike from the tiles.
    geojson: 'cycling',
    geometry: 'line',
    minzoom: 12,
    poi: ['bicycle_rental', 'bicycle_parking'],
  },
  {
    id: 'roads',
    label: 'Bilvägar',
    color: '#7a7268',
    // The only category that starts on, and the only one made of basemap
    // layers: streets, their casings, their names and their shields.
    basemap: true,
    on: true,
  },
];

/**
 * POI classes in the tileset that no category claims, each with the reason —
 * the same bargain build-style.mjs makes with the layers it drops.
 *
 * test/categories.test.mjs holds the tileset to this in both directions: a
 * class nobody claims and nobody excuses fails, and so does an excuse for a
 * class the extract no longer contains. So this cannot become a list of
 * things that used to be true.
 */
const NOT_DRAWN = [
  { reason: 'bus stops are texture, not detail — 427 of them (see DECISIONS)', classes: ['bus'] },
  { reason: 'drawn from transit.geojson instead, which reaches z11', classes: ['railway'] },
  { reason: 'an office is somewhere you have the address of already', classes: ['office'] },
  { reason: 'noticeboards, guideposts and one snorkelling route', classes: ['information'] },
  { reason: 'a door is not a destination', classes: ['entrance'] },
  { reason: 'already drawn as landuse; a pin on top says nothing new', classes: ['cemetery'] },
  { reason: 'the marinas are landmarks and the docks are water', classes: ['harbor'] },
  { reason: 'barriers along a way, not places you go', classes: ['gate', 'lift_gate', 'bollard', 'stile', 'cycle_barrier', 'sally_port', 'toll_booth', 'border_control'] },
  { reason: 'landuse that came through in the POI layer', classes: ['brownfield', 'basin'] },
  { reason: 'street furniture: a map of these is a different map', classes: ['toilets', 'drinking_water', 'waste_basket', 'shelter', 'recycling'] },
  { reason: 'one or two of each, and no category they would not stretch', classes: ['ferry_terminal', 'escape_game', 'hackerspace'] },
];

export const UNCLAIMED = Object.fromEntries(
  NOT_DRAWN.flatMap(({ reason, classes }) => classes.map((c) => [c, reason])),
);

// ---- layers ----------------------------------------------------------------
const hidden = (on) => ({ visibility: on ? 'visible' : 'none' });

const poiFilter = (classes) => ['in', ['get', 'class'], ['literal', classes]];

function dotLayer(cat, { id, source, sourceLayer, filter, minzoom }) {
  return {
    id,
    type: 'circle',
    source,
    ...(sourceLayer ? { 'source-layer': sourceLayer } : {}),
    ...(filter ? { filter } : {}),
    minzoom,
    layout: hidden(cat.on),
    metadata: { category: cat.id },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], minzoom, 2.6, 17, 5.5],
      'circle-color': cat.color,
      'circle-opacity': 0.85,
      'circle-stroke-color': '#fffefc',
      'circle-stroke-width': 1,
    },
  };
}

function labelLayer(cat, { id, source, sourceLayer, filter, minzoom }) {
  return {
    id,
    type: 'symbol',
    source,
    ...(sourceLayer ? { 'source-layer': sourceLayer } : {}),
    filter: filter ? ['all', filter, ['has', 'name']] : ['has', 'name'],
    minzoom,
    metadata: { category: cat.id },
    layout: {
      ...hidden(cat.on),
      'text-field': ['get', 'name'],
      'text-font': ['Roboto Regular'],
      'text-size': 11,
      'text-anchor': 'left',
      'text-offset': [0.7, 0],
      'text-max-width': 10,
      'text-optional': true,
    },
    paint: {
      'text-color': cat.color,
      'text-halo-color': 'rgba(255,255,255,0.95)',
      'text-halo-width': 1.5,
    },
  };
}

/**
 * The layers a category draws, in draw order.
 *
 * Not every category has any: `landmarks` keeps the icon layers app/layers.js
 * builds from the curated list, and `roads` only flips layers style.json
 * already has. Both are registered by the app instead, which is why this
 * returns an empty array for them rather than pretending.
 */
export function categoryLayers(cat) {
  const layers = [];
  const minzoom = cat.minzoom ?? POI_MINZOOM;

  if (cat.geojson && cat.geometry === 'line') {
    layers.push({
      id: `cat-${cat.id}-line`,
      type: 'line',
      source: cat.geojson,
      minzoom,
      layout: { ...hidden(cat.on), 'line-cap': 'round', 'line-join': 'round' },
      metadata: { category: cat.id },
      paint: {
        'line-color': cat.color,
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 16, 2.6],
        'line-opacity': 0.75,
      },
    });
  } else if (cat.geojson && cat.geojson !== 'landmarks') {
    const from = { id: `cat-${cat.id}-dot`, source: cat.geojson, minzoom };
    layers.push(dotLayer(cat, from));
    layers.push(labelLayer(cat, { ...from, id: `cat-${cat.id}-label` }));
  }

  if (cat.poi) {
    // A category with both (cycling) keeps its pins on their own ids, and its
    // pins obey the POI floor even when its lines start earlier.
    const suffix = cat.geojson ? '-poi' : '';
    const from = {
      id: `cat-${cat.id}${suffix}-dot`,
      source: 'openmaptiles',
      sourceLayer: 'poi',
      filter: poiFilter(cat.poi),
      minzoom: POI_MINZOOM,
    };
    layers.push(dotLayer(cat, from));
    layers.push(labelLayer(cat, { ...from, id: `cat-${cat.id}${suffix}-label`, minzoom: POI_LABEL_MINZOOM }));
  }

  return layers;
}

/**
 * Is this basemap layer part of the drivable network?
 *
 * A rule rather than a list of 45 layer ids, because Liberty draws every road
 * three times (road_, bridge_, tunnel_) with a casing each, and a list would
 * rot the first time upstream adds one. Rail is not a car road; footways and
 * pedestrian areas are not either, and both stay on when this category is off —
 * turning off "Bilvägar" should leave you the city you can walk.
 */
export function isCarRoadLayer(id) {
  if (!/^(road|bridge|tunnel)_/.test(id)) return false;
  if (/rail/.test(id)) return false;
  if (/path_pedestrian/.test(id)) return false;
  if (id === 'road_area_pattern') return false;
  return true;
}

/**
 * The lowest zoom at which a category can draw anything.
 *
 * Not a style choice but a fact about the data: the tiles carry no POI below
 * z14, so a chip tapped at city level would otherwise just look broken. The
 * GeoJSON categories are whatever they say, and landmarks carry a min_zoom per
 * feature, the lowest of which is well below anything reachable here.
 */
export function categoryMinzoom(cat) {
  if (cat.minzoom !== undefined) return cat.minzoom;
  return cat.poi && !cat.geojson ? POI_MINZOOM : 0;
}

/** The category a POI class belongs to, or null. */
export function categoryForClass(name) {
  return CATEGORIES.find((c) => c.poi?.includes(name)) ?? null;
}

/** The category an app layer id belongs to, or null. */
export function categoryOfLayer(id) {
  if (id.startsWith('landmark-')) return CATEGORIES.find((c) => c.id === 'landmarks');
  const match = /^cat-([a-z]+)(-poi)?-(dot|label|line)$/.exec(id);
  return match ? CATEGORIES.find((c) => c.id === match[1]) ?? null : null;
}

/** The categories on when nothing has been chosen yet. */
export const DEFAULT_ON = CATEGORIES.filter((c) => c.on).map((c) => c.id);
