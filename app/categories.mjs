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
//   geojson  the two things the tiles do worse: the curated landmark list and
//            the cycle network (lines, including named routes the tiles don't
//            have at all).
//   basemap  layers style.json already draws; the category only flips them.
//
// The class → category table was written against what is actually in the
// tileset rather than against the OpenMapTiles schema: `scripts/poi-inventory.mjs`
// prints every class and subclass in the archive with counts, and
// `test/categories.test.mjs` fails if a class is claimed by two categories or
// by none without a reason in UNCLAIMED. Reading the schema instead would have
// given "bakery" a category of its own and missed that plain `shop` is 536
// places — an eighth of every POI in Malmö.

import { TIER } from './area-levels.mjs';

/** POIs are in the tiles from z14; nothing a category does can conjure them earlier. */
export const POI_MINZOOM = 14;

// One colour per category, carried by the chip, the dot and the name, so the
// answer to "which of these did I turn on?" is never in doubt. And one icon,
// drawn here as path data rather than kept in a file each: the chip row is the
// only thing that draws them, they are 200 bytes apiece, and a category that
// carries its own picture cannot be added without one. 24×24, stroke only —
// the colour comes from the chip, which is what makes the icon a legend too.
export const CATEGORIES = [
  {
    id: 'food',
    label: 'Mat',
    color: '#b8562b',
    icon: 'M7 3v6a2.2 2.2 0 0 0 4.4 0V3M9.2 9.2V21M17.4 3c-1.6 1.4-2.4 3.4-2.4 5.6 0 1.6.8 2.8 2.4 3.2V21',
    poi: ['restaurant', 'fast_food', 'cafe', 'bakery', 'ice_cream'],
  },
  {
    id: 'bars',
    label: 'Barer',
    color: '#8c4a6b',
    icon: 'M4.5 4.5h15l-7.5 7.6zM12 12.1V19M8 19h8',
    // `beer` is OpenMapTiles for pub and biergarten; `bar` swallows nightclub.
    poi: ['bar', 'beer', 'alcohol_shop'],
  },
  {
    id: 'culture',
    label: 'Kultur',
    color: '#7a4f9c',
    icon: 'M4 5h16v14H4zM4 15.5 8.5 11l3.5 3.5 3-3 5 5',
    poi: ['museum', 'art_gallery', 'theatre', 'cinema', 'library', 'monument',
      'castle', 'attraction', 'zoo', 'aquarium', 'theme_park'],
  },
  {
    id: 'landmarks',
    label: 'Landmärken',
    // Ink, not a hue: the curated list is the map's own voice, and it keeps its
    // drawn icons rather than becoming another coloured dot.
    color: '#3a332a',
    icon: 'M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.2-4.1 5.8-.8z',
    geojson: 'landmarks',
  },
  {
    id: 'parks',
    label: 'Parker',
    color: '#4a7a2b',
    icon: 'M12 21v-4.5M6.6 16.5h10.8L12 4z',
    // Green *space*, not green colour: the park polygons underneath are part of
    // the basemap and stay whatever you do here. This is the named ones.
    poi: ['park', 'garden', 'playground', 'dog_park', 'picnic_site'],
  },
  {
    id: 'sport',
    label: 'Sport & bad',
    color: '#2b6f8f',
    icon: 'M12 3.2a8.8 8.8 0 1 0 0 17.6 8.8 8.8 0 0 0 0-17.6zM3.6 9.2h16.8M3.6 14.8h16.8M9.2 3.6c-1.9 5.4-1.9 11.4 0 16.8M14.8 3.6c1.9 5.4 1.9 11.4 0 16.8',
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
    icon: 'M6.2 8h11.6l1 12H5.2zM9 8V6.2a3 3 0 0 1 6 0V8',
    poi: ['shop', 'grocery', 'clothing_store', 'butcher', 'hairdresser',
      'bicycle', 'music', 'laundry'],
  },
  {
    id: 'care',
    label: 'Vård',
    color: '#b0453f',
    icon: 'M9.6 4h4.8v5.6H20v4.8h-5.6V20H9.6v-5.6H4V9.6h5.6z',
    poi: ['hospital', 'doctors', 'dentist', 'pharmacy', 'veterinary'],
  },
  {
    id: 'civic',
    label: 'Samhälle',
    color: '#5a6472',
    icon: 'M3.5 9.5 12 4l8.5 5.5M6.5 10v8M12 10v8M17.5 10v8M4 20h16',
    poi: ['school', 'college', 'town_hall', 'police', 'fire_station', 'post',
      'bank', 'atm', 'place_of_worship', 'prison'],
  },
  {
    id: 'lodging',
    label: 'Hotell',
    color: '#8a5a3c',
    icon: 'M3.5 19V8M3.5 13.5h13a4 4 0 0 1 4 4V19M3.5 19h17M7.5 10.5h3.5',
    poi: ['lodging', 'campsite'],
  },
  {
    id: 'car',
    label: 'Bil & parkering',
    color: '#6f6a60',
    icon: 'M4.5 15.5l1.6-5.2A2 2 0 0 1 8 9h8a2 2 0 0 1 1.9 1.3l1.6 5.2M4.5 15.5h15M4.5 15.5V19h2.6v-3.5M19.5 15.5V19h-2.6v-3.5',
    // `fuel` is mostly charging stations here (81 of 111), which is Malmö.
    poi: ['fuel', 'parking', 'car', 'motorcycle_parking'],
  },
  {
    id: 'cycling',
    label: 'Cykel',
    color: '#1f6f5c',
    icon: 'M6.5 19a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8zM17.5 19a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8zM6.5 15.6h5l4-7M9.5 8.6h3.5M15.5 8.6h2.6l-.6 7',
    // The one category that is lines *and* pins: the network from GeoJSON
    // (named routes included), the places you get a bike from the tiles.
    geojson: 'cycling',
    geometry: 'line',
    minzoom: 12,
    poi: ['bicycle_rental', 'bicycle_parking'],
  },
  {
    id: 'parts',
    label: 'Kvarter',
    // The one category that is neither pins nor basemap: the names finer than a
    // delområde (Gamla Väster, Erikslust, Seved). Its layer belongs to the
    // ladder in area-levels.mjs — the chip only flips it, the way "Bilvägar"
    // flips the basemap's roads. Ink rather than a hue, like landmarks: this is
    // the map's own voice, not another coloured dot.
    //
    // It starts on because it is a division of the city and not a pin, and it
    // has a chip at all because 14 names with no boundaries to sit in may well
    // turn out to be clutter — see DECISIONS. Turn it off and the ladder is
    // exactly the four levels it was before.
    color: '#6f6656',
    icon: 'M4.5 4.5h15v15h-15zM11 4.5v15M4.5 12h6.5',
    geojson: 'parts',
    ladder: true,
    on: true,
    // Its own layer's minzoom, so the chip greys out above the city rather than
    // promising names that cannot arrive until the delområden do.
    minzoom: TIER.delomrade,
  },
  {
    id: 'roads',
    label: 'Bilvägar',
    color: '#7a7268',
    icon: 'M8.5 21 10.5 3M15.5 21 13.5 3M12 6v2M12 11v2M12 16v2',
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
  { reason: 'the rail lines are already drawn; the stations stay in search only', classes: ['railway'] },
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
 * builds from the curated list, `parts` is drawn by the ladder in
 * area-levels.mjs, and `roads` only flips layers style.json already has. All
 * three are registered by the app instead, which is why this returns an empty
 * array for them rather than pretending.
 */
export function categoryLayers(cat) {
  const layers = [];
  const minzoom = cat.minzoom ?? POI_MINZOOM;

  // Drawn by the ladder, which owns the styling of every area name on the map.
  // The source is still ours to declare, which is why `geojson` is set.
  if (cat.ladder) return layers;

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
    // Names arrive with the dots rather than a zoom and a half later: a
    // category you asked for should say what its dots *are* from the moment it
    // can draw them, and collision drops the ones that will not fit anyway.
    layers.push(dotLayer(cat, from));
    layers.push(labelLayer(cat, { ...from, id: `cat-${cat.id}${suffix}-label` }));
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
  if (id === 'area-label-part') return CATEGORIES.find((c) => c.id === 'parts');
  const match = /^cat-([a-z]+)(-poi)?-(dot|label|line)$/.exec(id);
  return match ? CATEGORIES.find((c) => c.id === match[1]) ?? null : null;
}

/** The categories on when nothing has been chosen yet. */
export const DEFAULT_ON = CATEGORIES.filter((c) => c.on).map((c) => c.id);
